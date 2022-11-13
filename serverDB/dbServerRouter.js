/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */



const log = require('../lib/log')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const thread = require('../lib/threads');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');
const path = require("path");
const os = require("os");

log.info('Starting dbServer thread...');
var dbServerThread, dbQueryServerThreads, dbTransServerThreads = new Map(), stopInProgress = false;
var dbTransServerThreadsInitStatus = new Map();
var dbChildrenNum = confSqlite.get('dbChildrenNum') || 0;

var writeOperations = 0, readOperations = 0, prepareOperations = 0, otherOperations = 0, transServerNum = 0;
var cfg = confSqlite.get(); // configuration for each module
cfg.id = 'dbServer';

new IPC.server(cfg, function (err, msg, socket, callback) {
    if (err) log.error(err.message);
    if (msg) processMessage(msg, socket, callback);
    if (socket === -1 && !dbServerThread) { // server starting to listen socket

        // run threads for processing readonly queries (db.all() and db.get())
        dbQueryServerThreads = new thread.parent({
            childrenNumber: dbChildrenNum,
            childProcessExecutable: path.join(__dirname, 'dbSubServer.js'),
            restartAfterErrorTimeout: 0, // was 2000
            killTimeout: 3000,
            args: ['query'],
            module: 'dbClientQuery',
        }, function (err, dbQueryServerProcess) {
            if (err) return log.error('Can\'t initializing dbServer query thread: ', err.message);

            dbQueryServerProcess.start(function (err) {
                if (err) return callback(new Error('Can\'t run dbServer query thread: ' + err.message));

                log.info('dbServer query ', (dbChildrenNum || os.cpus().length), ' threads were started ...');
            });

            dbServerThread = new thread.child({
                module: 'dbServer',
                onDestroy: stopDBServer,
                onStop: stopDBServer,
            });
        });

        setInterval(function () {
            // server running but not used
            if(readOperations || writeOperations || prepareOperations || otherOperations) {
                log.info('DB read: ', readOperations, '; write: ', writeOperations,
                    '; prepare: ', prepareOperations, '; other: ', otherOperations,
                    '; threads num query/trans: ', (dbChildrenNum || os.cpus().length), '/', transServerNum);
            }

            writeOperations = readOperations = prepareOperations = otherOperations = 0;
        }, 60000);
    }
});

function processMessage(message, socket, callback) {
    if (message.func) {
        if (message.func === 'get' || message.func === 'all') ++readOperations;
        else if (message.func === 'run' || message.func === 'exec') ++writeOperations;
        else if (message.func === 'prepare') ++prepareOperations;
        else ++otherOperations;

        // Forward message with readonly query to query thread.
        // Using for db.all() and db.get()
        // Other message forward to trans server
        if (!message.stmtID && (message.func === 'get' || message.func === 'all')) {
            //dbQueryServerThreads.sendAndReceive(message, callback);
            if(typeof callback === 'function') {
                dbQueryServerThreads.sendAndReceive(message, function () {
                    var args = Array.prototype.slice.call(arguments);
                    callback.apply(this, args);
                });
            } else dbQueryServerThreads.send(message);
        } else {
            getDBTransServer(socket, function (err, dbTransServerThread) {
                if (message.func === 'prepare') dbTransServerThread.sendAndReceive(message, callback);
                else {
                    if(typeof callback === 'function') {
                        dbTransServerThread.sendAndReceive(message, function () {
                            var args = Array.prototype.slice.call(arguments);
                            callback.apply(this, args);
                        });
                    } else dbTransServerThread.send(message);
                }
            });
        }
    } else if(message.stop) stopDBServer(callback);
}

function getDBTransServer(socket, callback) {
    if(dbTransServerThreads.has(socket)) return callback(null, dbTransServerThreads.get(socket));

    // init trans server in progress
    if(dbTransServerThreadsInitStatus.has(socket)) return setTimeout(getDBTransServer, 50, socket, callback);
    dbTransServerThreadsInitStatus.set(socket, true);

    new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'dbSubServer.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        args: ['trans', socket],
        module: 'dbClientTrans',
    }, function (err, dbTransServerThread) {
        if (err) return callback(new Error('Can\'t initializing dbServer trans thread: ' + err.message));

        dbTransServerThread.start(function (err) {
            if (err) return callback(new Error('Can\'t run dbServer trans thread: ' + err.message));

            dbTransServerThreads.set(socket, dbTransServerThread);
            dbTransServerThreadsInitStatus.delete(socket);
            ++transServerNum;
            log.info('dbServer trans thread ', socket, ' was started...');
            callback(null, dbTransServerThread);
        });
    });
}

function stopDBServer(callback) {
    if (stopInProgress) {
        if(typeof callback === 'function') callback();
        return;
    }
    stopInProgress = true;

    log.warn('Stopping trans dbServers...');
    async.eachOf(Object.fromEntries(dbTransServerThreads), function (dbTransServerThread, socket, callback) {
        dbTransServerThread.stop(callback);
    }, function () {
        dbTransServerThreads.clear();
        log.warn('Stopping query dbServers...');
        dbQueryServerThreads.stop(() => {
            if(typeof callback === 'function') callback();
        });
    })
}