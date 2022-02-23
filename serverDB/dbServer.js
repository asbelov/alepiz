/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var async = require('async');
var IPC = require('../lib/IPC');
var thread = require('../lib/threads');
var db = require('../models_db/dbWrapper');
var Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');
const path = require("path");
const os = require("os");


log.info('Starting dbServer thread');
var dbServerThread, dbQueryServerThread, dbTransServerThread, stopInProgress;
var stmtID = 1, maxStmtID = 0xffffffff; // maxStmtID must be >= 0 and <= 4294967295
var stmts = new Map();
var stmtsDeleteInterval = confSqlite.get('stmtsDeleteInterval') || 18000000;
var dbChildrenNum = confSqlite.get('dbChildrenNum') || 0;
var transMessageLimit = confSqlite.get('sameTimeProcessedTransNum') || 5;
var queryMessageLimit = confSqlite.get('sameTimeProcessedQueryNum') || dbChildrenNum || 10;
var stmtsMaxNum = 10000;
var serverType = thread.workerData ? thread.workerData[0] : null;
const queryServerID = 'queryServer';
const transServerID = 'transServer';
var processMessageQueue = new Map();
var transMessages = new Set();
var queryMessages = new Set();


var writeOperations = 0, readOperations = 0, prepareOperations = 0, otherOperations = 0;

if(serverType === queryServerID) {
    dbServerThread = new thread.child({
        module: 'dbQueryServer',
        onDestroy: stopDBServer,
        onStop: stopDBServer,
        onMessage: processMessage,
    });
} else if(serverType === transServerID) {
    dbServerThread = new thread.child({
        module: 'dbTransServer',
        onDestroy: stopDBServer,
        onStop: stopDBServer,
        onMessage: processMessage,
    });
} else {
    var cfg = confSqlite.get(); // configuration for each module
    cfg.id = 'dbServer';
    new IPC.server(cfg, function (err, msg, socket, callback) {
        if (err) log.error(err.message);
        if (msg) processMessage(msg, callback);
        if (socket === -1 && !dbServerThread) { // server starting to listen socket

            // run threads for processing readonly queries (db.all() and db.get())
            if (!serverType) {
                var queryChildNum = dbChildrenNum;
                dbQueryServerThread = new thread.parent({
                    childrenNumber: queryChildNum,
                    childProcessExecutable: path.join(__dirname, 'dbServer.js'),
                    restartAfterErrorTimeout: 0, // was 2000
                    killTimeout: 3000,
                    args: [queryServerID],
                    module: 'dbClientQuery',
                }, function (err, dbQueryServerProcess) {
                    if (err) return callback(new Error('Can\'t initializing dbServer query thread: ' + err.message));

                    dbQueryServerProcess.start(function (err) {
                        if (err) return callback(new Error('Can\'t run dbServer query thread: ' + err.message));

                        log.info('dbServer query ', (queryChildNum || os.cpus().length), ' threads were started ...');
                    });

                    dbTransServerThread = new thread.parent({
                        childrenNumber: 1,
                        childProcessExecutable: path.join(__dirname, 'dbServer.js'),
                        restartAfterErrorTimeout: 0, // was 2000
                        killTimeout: 3000,
                        args: [transServerID],
                        module: 'dbClientTrans',
                    }, function (err, dbTransServerThread) {
                        if (err) return callback(new Error('Can\'t initializing dbServer trans thread: ' + err.message));

                        dbTransServerThread.start(function (err) {
                            if (err) return callback(new Error('Can\'t run dbServer trans thread: ' + err.message));

                            log.info('dbServer trans thread was started...');
                        });

                        dbServerThread = new thread.child({
                            module: 'dbServer',
                            onDestroy: stopDBServer,
                            onStop: stopDBServer,
                            onMessage: processMessage,
                        });

                        setInterval(function () {
                            // server running but not used
                            if(readOperations || writeOperations || prepareOperations || otherOperations ||
                                transMessages.size || queryMessages.size ||
                                processMessageQueue.get(dbQueryServerProcess) ||
                                processMessageQueue.get(dbTransServerThread)
                            ) {
                                log.info('DB operations: read: ', readOperations, '; write: ', writeOperations,
                                    '; prepare: ', prepareOperations, '; other: ', otherOperations,
                                    '; trans queue: ', transMessages.size, '; query queue: ', queryMessages.size,
                                    (processMessageQueue.get(dbQueryServerProcess) ?
                                        '; query: ' + new Date(processMessageQueue.get(dbQueryServerProcess)).toLocaleString() : ''),
                                    (processMessageQueue.get(dbTransServerThread) ?
                                        '; trans: ' + new Date(processMessageQueue.get(dbTransServerThread)).toLocaleString() : '')
                                );
                            }

                            confSqlite.reload();
                            transMessageLimit = confSqlite.get('sameTimeProcessedTransNum') || 5;
                            queryMessageLimit = confSqlite.get('sameTimeProcessedQueryNum') || dbChildrenNum || 10;

                            writeOperations = readOperations = prepareOperations = otherOperations = 0;
                        }, 60000);
                    });
                });
            }
        }
    });

    // clearing unused stmts
    setInterval(function () {
        if(stmts.size < stmtsMaxNum) return;
        var deletedStmts = 0, timeToDelete = Date.now() - stmtsDeleteInterval;
        stmts.forEach((stmtObj, myStmtID) => {
            if(stmtObj.timestamp < timeToDelete) {
                stmts.delete(myStmtID);
                ++deletedStmts;
            }
        });

        if(deletedStmts) log.info('Deleted DB statements: ', deletedStmts, '; remain ', stmts.size);
    }, stmtsDeleteInterval);
}



function sendToQuery() {
    processMessageQueue.set(dbQueryServerThread, Date.now());

    var copyOfMessageQueue = Array.from(queryMessages);
    queryMessages.clear();

    async.eachLimit(copyOfMessageQueue, queryMessageLimit, function (obj, callback) {
        if(typeof obj.callback === 'function') {
            dbQueryServerThread.sendAndReceive(obj.message, function () {
                var args = Array.prototype.slice.call(arguments);
                obj.callback.apply(this, args);
                callback();
            });
        } else dbQueryServerThread.send(obj.message, callback);
    }, function () {
        processMessageQueue.set(dbQueryServerThread, 0);
        if(queryMessages.size) sendToQuery();
    });
}


function sendToTrans() {
    processMessageQueue.set(dbTransServerThread, Date.now());

    var copyOfMessageQueue = Array.from(transMessages);
    transMessages.clear();

    async.eachLimit(copyOfMessageQueue, transMessageLimit, function (obj, callback) {
        if(typeof obj.callback === 'function') {
            dbTransServerThread.sendAndReceive(obj.message, function () {
                var args = Array.prototype.slice.call(arguments);
                obj.callback.apply(this, args);
                callback();
            });
        } else dbTransServerThread.send(obj.message, callback);
    }, function () {
        processMessageQueue.set(dbTransServerThread, 0);
        if(transMessages.size) sendToTrans();
    });
}


function processMessage(message, callback) {
    if(message.func) {
        if(message.func === 'get' || message.func === 'all') ++readOperations;
        else if(message.func === 'run' || message.func === 'exec') ++ writeOperations;
        else if(message.func === 'prepare') ++prepareOperations;
        else ++otherOperations;

        // Forward message with readonly query to query thread.
        // Using for db.all() and db.get()
        // Other message forward to trans server
        if(!serverType) {
            if(!message.stmtID && (message.func === 'get' || message.func === 'all')) {
                //dbQueryServerThread.sendAndReceive(message, callback);
                queryMessages.add({
                    message: message,
                    callback: callback,
                });

                if(!processMessageQueue.get(dbQueryServerThread)) sendToQuery();
            } else {
                //dbTransServerThread.sendAndReceive(message, callback);
                if(message.func === 'prepare') dbTransServerThread.sendAndReceive(message, callback);
                else {
                    transMessages.add({
                        message: message,
                        callback: callback,
                    });
                    if(!processMessageQueue.get(dbTransServerThread)) sendToTrans();
                }
            }
            return;
        }

        var args = Array.isArray(message.args) ? message.args : [];

        if(message.func === 'prepare') {
            var myStmtID = getStmtID();
            args.push(function (err) {
                callback(err, myStmtID);
            });
            stmts.set(myStmtID, {
                timestamp: Date.now(),
                stmt: db.prepare.apply(this, args),
            });
//log.info('Create stmt ' + myStmtID + ' for ' + args[0]);
        } else if(message.stmtID) {
            myStmtID = Number(message.stmtID);
            if(!stmts.has(myStmtID)) {
                return callback(new Error('Can\'t find db statement with ID ' + myStmtID + '. Current stmt: ' +
                    stmtID + '; ' + JSON.stringify(message)) + '; ' + Array.from(stmts.keys()));
            }

            if(message.func === 'finalize') {
                stmts.delete(myStmtID);
//log.info('Delete stmt ' + myStmtID + '; stmt size ' + stmts.size);
                return callback();
            }
//log.info('Process stmt ' + myStmtID + '; ', message);
            var stmtObj = stmts.get(myStmtID);
            stmtObj.timestamp = Date.now();
            if(typeof stmtObj.stmt[message.func] !== 'function') {
                return callback(new Error('Can\'t find DB function ' + message.func + '. Statement ID ' + myStmtID +
                    '. Current stmt: ' + stmtID + '; ' + JSON.stringify(message)) + '; ' + Array.from(stmts.keys()));
            }

            args.push(callback);
            stmtObj.stmt[message.func].apply(this, args);
        } else {
            if(typeof db[message.func] !== 'function') {
                return callback(new Error('Can\'t find DB function ' + message.func + '; ' + JSON.stringify(message)));
            }

            args.push(callback);
            db[message.func].apply(this, args);
        }
    } else if(message.stop) stopDBServer(callback);
}

function getStmtID() {
    stmtID = stmtID >= maxStmtID ? 1 : stmtID + 1;
    return stmtID;
}

function stopDBServer(callback) {
    if (stopInProgress) {
        if(typeof callback === 'function') callback();
        return;
    }

    stopInProgress = true;
    log.warn('Stopping dbServer...');
    try {
        db.close();
    } catch (err) {
        log.exit('Cant close DB: ', err.message);
    }

    if(!serverType) {
        log.warn('Stopping trans dbServer...');
        dbTransServerThread.stop(() => {
            log.warn('Stopping query dbServer...');
            dbQueryServerThread.stop(() => {
                if(typeof callback === 'function') callback();
            });
        });
    } else if(typeof callback === 'function') callback();
}
