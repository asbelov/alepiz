/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
var path = require('path');
var fs = require('fs');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var sqlite = require('../lib/sqlite');
var conf = require('../lib/conf');
conf.file('config/conf.json');

if(module.parent) initServer();
else runServerProcess(process.argv[2]); //standalone process

function initServer() {
    var replicationServer = {};
    module.exports = replicationServer;

    var configurations = conf.get('replication:server'),
        startFunctions = [], stopFunctions = [];

    if(configurations.disable) log.info('Replication server was disabled in configuration. Server is not starting');
    else {
        for (var id in configurations) {
            if (typeof configurations[id] !== 'object') continue;

            if (configurations[id].disable) {
                log.info('Replication for ', id, ' is disabled');
                continue;
            }

            if (!configurations[id].serverAddress || !configurations[id].serverPort) {
                log.error('[', id, ']: serverAddress or serverPort are not set: ', configurations[id]);
                continue;
            }

            if (!configurations[id].dbPath || !configurations[id].dbFile) {
                log.error('[', id, ']: dbPath or dbFile are not set: ', configurations[id]);
                continue;
            }

            var dbPath = path.isAbsolute(configurations[id].dbPath) ?
                path.join(configurations[id].dbPath, configurations[id].dbFile) :
                path.join(__dirname, '..', configurations[id].dbPath, configurations[id].dbFile);

            if (!fs.existsSync(dbPath)) {
                log.warn('[', id, ']: cannot find database file ', dbPath, ' to start replication. ' +
                    'Please stop all ALEPIZ instances and copy the database file from the main ALEPIZ instance to ', dbPath,
                    ' then start all ALEPIZ instances');
                continue;
            }

            // closure for id
            (function (id) {
                startFunctions.push(function (_callback) {
                    var callback = function (err) {
                        if (typeof _callback === 'function') return _callback(err);
                        if (err) log.error('[', id, ']:', err.message);
                    };

                    new proc.parent({
                        childrenNumber: 1,
                        childProcessExecutable: __filename,
                        restartAfterErrorTimeout: 2000,
                        killTimeout: 1000,
                        args: [id],
                        module: 'replicationServer',
                    }, function (err, replicationServerProcess) {
                        if (err) return callback(new Error('Can\'t initializing replication server: ' + err.message));

                        replicationServerProcess.start(function (err) {
                            if (err) return callback(new Error('Can\'t run replication server: ' + err.message));

                            // order of stop and start functions may be not equal
                            stopFunctions.push(replicationServerProcess.stop);
                            callback();
                        });
                    });
                });
            })(id);
        }
    }

    replicationServer.start = function(callback) {
        if(!startFunctions.length) return callback();
        async.parallel(startFunctions, callback);
    };

    replicationServer.stop = function (callback) {
        if(!stopFunctions.length) return callback();
        async.parallel(stopFunctions, callback);
    };
}

function runServerProcess(id) {
    var queriesQueue = [],
        maxQueueSize = conf.get('replication:server:maxQueueSize') || 1000,
        processingQueries = 0,
        fullTimeProcessing = 0,
        firstMessageID = 1, // must be always equal to firstMessageID in dbReplication.js
        prevMessageNum = firstMessageID - 2,
        stmts = {},
        childProc,
        queriesQueueIdx = 0,
        maxQueriesQueueIdx = 500000,
        receivedQueriesCnt = 0,
        processedQueriesCnt = 0,
        notInOrderMessages = 0,
        countTimesToWaitInOrderMessage = 0,
        sortedQueueTimes = 0,
        skipToWaitInOrderMessageTimes = 0,
        startQueryExecution = 0,
        queryExecutionTime = 0,
        startIdleTime = Date.now(),
        idleTime = 0,
        maxSocketErrorCnt = conf.get('maxSocketErrorsCnt') || 50,
        socketErrorsCounter = 0,
        stopCallback;
    var cfg = conf.get('replication:server:' + id);
    var dbPath = path.isAbsolute(cfg.dbPath) ?
        path.join(cfg.dbPath, cfg.dbFile) :
        path.join(__dirname, '..', cfg.dbPath, cfg.dbFile);

    log.info('[', id ,']: starting replications server process for ', id, '. DB: ', dbPath);

    if (!fs.existsSync(dbPath)) {
        log.error('[', id, ']: cannot find database file ', dbPath, ' to start replication server. Exiting');
        return setTimeout(process.exit, 60000, 2);
    }

    if (!cfg.serverAddress || !cfg.serverPort) {
        log.error('[', id, ']: serverAddress or serverPort are not set: ', cfg);
        return setTimeout(process.exit, 60000, 2);
    }

    sqlite.init(dbPath, function (err, db) {
        if (err) {
            log.exit('['+ id +']: can\'t initialise database ' + dbPath + ': ' + err.message);
            return setTimeout(process.exit, 60000, 2);
        }

        log.info('['+ id +']: truncating WAL journal file');
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
            if (err) log.error('['+ id +']: can\'t truncate WAL journal file: ', err.message);

            cfg.id = 'replicationServer';
            var serverIPC = new IPC.server(cfg, function (err, message, socket) {
                if (err) {
                    ++socketErrorsCounter;
                    log.error('[', id ,']: error #', socketErrorsCounter, ': ', err.message);
                    if (socketErrorsCounter > maxSocketErrorCnt) {
                        log.exit('['+ id +']: maximum number of IPC errors are occurred. Try to restart process...');
                        setTimeout(function () {
                            process.exit(2)
                        }, 10000);
                    }
                }

                if (socket === -1) { // server starting listening
                    childProc = new proc.child({
                        module: 'replicationServer',
                        onDisconnect: destroy,
                        onDestroy: destroy,
                        onStop: stop,
                    });
                }

                if (message) {
                    Array.prototype.push.apply(queriesQueue, message);
                    receivedQueriesCnt += message.length;
                    if(!processingQueries) processQueriesQueue();
                }
            });

            function stop(callback) {
                stopCallback = callback;
                serverIPC.stop(function(err) {
                    if(err) log.exit('['+ id +']: can\'t stop IPC system: ' + err.message);

                    if(queriesQueue.length) {
                        log.exit('['+ id +']: Waiting for write data from queue to DB. Queue length: ' + queriesQueue.length);
                    } else {
                        log.exit('[' + id +']: No data in replication queue. Closing database...');
                        db.close(function(err) {
                            log.exit('[' + id +']: database successfully closed. exiting');
                            if(err) log.exit('['+ id +']: can\'t close DB: ' + err.message);
                            callback();
                            stopCallback = null;
                        });
                    }
                });
            }

            function destroy() {  // exit on disconnect from parent or destroy (then server will be restarted)
                db.close(function(err) {
                    log.exit('[' + id +']: replication server was destroyed or client was disconnected. Closing DB and exiting');
                    if(err) log.exit('['+ id +']: can\'t close DB: ' + err.message);
                    setTimeout(process.exit, 500, 2);
                });
            }

            function processQueriesQueue() {
                processingQueries = Date.now();
                idleTime += Date.now() - startIdleTime;
                queriesQueueIdx = 0;

                processQuery();

                function processQuery() {
                    if(queriesQueueIdx > maxQueriesQueueIdx) {
                        /*
                            var myFish = ['angel', 'clown', 'mandarin', 'sturgeon']; var removed = myFish.splice(2);
                            // myFish ["angel", "clown"]; removed ["mandarin", "sturgeon"]
                        */
                        queriesQueue = queriesQueue.splice(queriesQueueIdx); // try to free memory
                        queriesQueueIdx = 0;
                    }

                    var nearestMessageNum = queriesQueue[queriesQueueIdx].num;
                    var query = queriesQueue[queriesQueueIdx++];
                    if(nearestMessageNum - 2 > prevMessageNum) { // try to find nearest message number in first maxQueueSize messages from queriesQueue
                        for (var nearestMessageIdx = queriesQueueIdx-1, i = queriesQueueIdx, queriesQueueLength = queriesQueue.length;
                             nearestMessageNum - 2 > prevMessageNum && i < maxQueueSize && i < queriesQueueLength;
                             i++) {
                            if (nearestMessageNum - prevMessageNum < queriesQueue[i].num - prevMessageNum) {
                                nearestMessageIdx = i;
                                nearestMessageNum = queriesQueue[nearestMessageIdx].num;
                            }
                        }

                        if (nearestMessageNum - 2 > prevMessageNum) {
                            if (queriesQueueLength > maxQueueSize || stopCallback) ++skipToWaitInOrderMessageTimes;
                            else {
                                ++countTimesToWaitInOrderMessage;
                                return finishingQueryProcessing(); // waiting for in order message
                            }
                        }

                        if (nearestMessageIdx !== queriesQueueIdx-1) {
                            ++notInOrderMessages;
                            query = queriesQueue.splice(nearestMessageIdx, 1)[0];
                            queriesQueueIdx--;
                        } // else query already set to queriesQueue[queriesQueueIdx++]
                    }
                    startQueryExecution = Date.now();
                    runQuery(query, function(err) {
                        queryExecutionTime += Date.now() - startQueryExecution;
                        startQueryExecution = 0;
                        prevMessageNum = query.num;
                        if (err) log.error('[', id ,']: error processing query: ', query, ': ', err.message);
                        else {
                            ++processedQueriesCnt;
                            log.debug('[',id,']: finished query: ', query);
                        }

                        if(queriesQueueIdx < queriesQueue.length) return processQuery();
                        queriesQueue = [];
                        queriesQueueIdx = 0;

                        finishingQueryProcessing();
                    })
                }

                function finishingQueryProcessing() {
                    fullTimeProcessing += Date.now() - processingQueries;
                    processingQueries = 0;
                    startIdleTime = Date.now();

                    if(typeof stopCallback === 'function') {
                        log.exit('[' + id +']: replication data saved from queue to to database. Closing database...');
                        db.close(function(err) {
                            log.exit('[' + id +']: database successfully closed, exiting');
                            if(err) log.exit('['+ id +']: can\'t close database: ' + err.message);
                            stopCallback();
                            stopCallback = null;
                        });
                    }
                }
            }

            /*
            query = {
                type: <prepare|exec|run|finalize|>
                id: id of stmt for query type 'prepare'
                sql: sql string
                param: parameters for sql
                num: message number
            }
            */
            function runQuery(query, callback) {
                if(query.type === 'prepare') return stmts[query.id] = db.prepare(query.sql, query.param, callback);

                var stmt = stmts[query.id];
                if(query.type === 'finalize') {
                    if (!stmt) return callback(new Error('Can\'t find stmt with id ' + query.id + 'for finalizing'));
                    stmt.finalize(callback);
                    return delete stmts[query.id];
                }

                if(query.id) {
                    if(!stmt) return callback(new Error('Can\'t find stmt with id ' + query.id + ' for executing'));
                    return stmt[query.type](query.param, callback);
                }

                if(query.sql && query.param) return db[query.type](query.sql, query.param, callback);

                if(query.sql) db[query.type](query.sql, callback);
            }
        });
    });

    setInterval(function() {
        log.info('[', id ,']: received/processed/in queue/queue: ', receivedQueriesCnt,
            '/', processedQueriesCnt,
            '/', queriesQueue.length - queriesQueueIdx, '/', queriesQueue.length,
            '; time full/query/idle: ', processingQueries ? fullTimeProcessing + Date.now() - processingQueries : fullTimeProcessing,
            '/', startQueryExecution ? queryExecutionTime + Date.now() - startQueryExecution : queryExecutionTime,
            '/', processingQueries ? idleTime : idleTime + Date.now() - startIdleTime,
            'ms; not in order messages: ', notInOrderMessages,
            '; wait cnt for in order messages: ', countTimesToWaitInOrderMessage,
            '; skip messages: ', skipToWaitInOrderMessageTimes,
            '; last message #', prevMessageNum);
        processedQueriesCnt = 0;
        receivedQueriesCnt = 0;
        idleTime = 0;
        if(!processingQueries) startIdleTime = Date.now();
        else processingQueries = Date.now();
        fullTimeProcessing = 0;
        if(startQueryExecution) startQueryExecution = Date.now();
        queryExecutionTime = 0;
        notInOrderMessages = 0;
        countTimesToWaitInOrderMessage = 0;
        sortedQueueTimes = 0;
        skipToWaitInOrderMessageTimes = 0;
    }, 60000);
}