/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
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
var exitHandler = require('../lib/exitHandler');

if(module.parent) initServer();
else runServerProcess(process.argv[2]); //standalone process

function initServer() {
    var replicationServer = {};
    module.exports = replicationServer;

    var configurations = conf.get('replication:server'),
        startFunctions = [], stopFunctions = [], killTimeout = 3000;

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
                        restartAfterErrorTimeout: 2000, // was 2000
                        killTimeout: killTimeout,
                        args: [id],
                        module: 'replicationServer',
                    }, function (err, replicationServerProcess) {
                        if (err) return callback(new Error('Can\'t initializing replication server: ' + err.message));

                        replicationServerProcess.start(function (err) {
                            if (err) return callback(new Error('Can\'t run replication server: ' + err.message));

                            // order of stop and start functions may be not equal
                            stopFunctions.push(replicationServerProcess.stop);
                            log.info('Replication server ', id ,' is successfully initialized');
                            callback();
                        });
                    });
                });
            })(id);
        }
    }

    replicationServer.start = function(callback) {
        if(!startFunctions.length) return callback();
        log.info('Starting ', startFunctions.length, ' replication servers...');
        async.parallel(startFunctions, callback);
    };

    replicationServer.stop = function (callback) {
        if(!stopFunctions.length) {
            log.warn('Command received to stop the replication server, but the servers are not started');
            return callback();
        }
        log.warn('Stopping replication server. Found  ', stopFunctions.length, ' running server for stop');
        async.parallel(stopFunctions, function(err) {
            clearTimeout(stopTimeout);
            if(err) log.error(err.message);
            var copyCallback = callback;
            callback = function () {};
            stopFunctions = [];
            copyCallback();
        });

        var stopTimeout = setTimeout(function() {
            log.exit('Can\'t wait for the replication servers are stop ', stopFunctions.length,' in ', killTimeout * 2 / 1000, 'sec.');
            var copyCallback = callback;
            callback = function () {};
            copyCallback();
        }, killTimeout * 2);
    };
}

function runServerProcess(id) {
    var db,
        queriesQueue = [],
        maxQueueSize = conf.get('replication:server:maxQueueSize') || 1000,
        processingQueries = 0,
        fullTimeProcessing = 0,
        firstMessageID = 1, // must be always equal to firstMessageID in dbReplication.js
        prevMessageNum = firstMessageID - 2,
        stmts = new Map(),
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
        memUsageStartTime = 0,
        defaultMaxMemoryUsageMb = 4096,
        defaultMaxMemoryUsageTime = 600000,
        defaultDumpFile = 'repl.dump',
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
        return log.disconnect(function () { process.exit(2) });
    }

    if (!cfg.serverAddress || !cfg.serverPort) {
        log.error('[', id, ']: serverAddress or serverPort are not set: ', cfg);
        return log.disconnect(function () { process.exit(2) });
    }

    var dumpPath = path.join(__dirname, '..', cfg.dbPath, id + '.' + (conf.get('replication:server:dumpFile') || defaultDumpFile));
    if(fs.existsSync(dumpPath)) {
        try {
            var data = fs.readFileSync(dumpPath, 'utf8');
            if(data && data.length > 10) queriesQueue = JSON.parse(String(data));
            fs.unlinkSync(dumpPath);
            log.info('Successfully loaded data to queriesQueue from ', dumpPath, ': queriesQueue length: ', queriesQueue.length);
        } catch (e) {
            log.warn('Error while loading, parsing or deleting dump ', dumpPath, ': ', e.message);
        }
    }

    sqlite.init(dbPath, function (err, _db) {
        if (err) {
            log.exit('['+ id +']: can\'t initialise database ' + dbPath + ': ' + err.message);
            return log.disconnect(function () { process.exit(2) });
        }

        db = _db;

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
                        log.disconnect(function () { process.exit(2) });
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
                    log.disconnect(function () { process.exit(2) });
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
                    });
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

                    var memUsage = Math.round(process.memoryUsage().rss / 1048576);
                    var maxMemoryUsageMb = conf.get('replication:server:maxMemoryUsageMb') || defaultMaxMemoryUsageMb;
                    if(memUsage > maxMemoryUsageMb) {
                        log.warn('[' + id +']: memory usage too high ', memUsage, 'Mb, threshold ', maxMemoryUsageMb,
                            'Mb. Restarting...');
                        log.warn('[' + id +']: replication data saved from queue to to database. Closing database...');
                        db.close(function(err) {
                            log.warn('[' + id +']: database successfully closed, exiting');
                            if(err) log.warn('['+ id +']: can\'t close database: ' + err.message);
                            log.disconnect(function () { exitHandler.exit(12) }); // process.exit(12)
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
                if(query.type === 'prepare') return stmts.set(query.id, db.prepare(query.sql, query.param, callback));

                var stmt = stmts.get(query.id);
                if(query.type === 'finalize') {
                    if (!stmt) return callback(new Error('Can\'t find stmt with id ' + query.id + 'for finalizing'));
                    stmt.finalize(callback);
                    return stmts.delete(query.id);
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
        var memUsage = Math.round(process.memoryUsage().rss / 1048576);
        var maxMemoryUsageMb = conf.get('replication:server:maxMemoryUsageMb')  || defaultMaxMemoryUsageMb;
        var _idleTime = processingQueries ? idleTime : idleTime + Date.now() - startIdleTime;
        if(memUsage > maxMemoryUsageMb && _idleTime < 1000) {
            if(!memUsageStartTime) memUsageStartTime = Date.now();
            else {
                var maxMemoryUsageTime = conf.get('replication:server:maxMemoryUsageTime') || defaultMaxMemoryUsageTime;
                //log.info('Memory usage delay: ', Date.now() - memUsageStartTime, ' ? ', maxMemoryUsageTime);
                if(Date.now() - memUsageStartTime > maxMemoryUsageTime) {
                    log.error('[', id ,']: high memory usage (', memUsage, 'Mb) continues for too long (', maxMemoryUsageTime,
                        'ms). Saving cache to ', dumpPath, ' and restarting...' );

                    try {
                        fs.writeFile(dumpPath, JSON.stringify(queriesQueue), 'utf8', function (err) {
                            if (err) log.exit('[' + id + ']: can\'t save dump to ', dumpPath, ': ', err);

                            db.close(function (err) {
                                log.warn('[' + id + ']: database successfully closed, exiting');
                                if (err) log.warn('[' + id + ']: can\'t close database: ' + err.message);
                                log.disconnect(function () { exitHandler.exit(12) }); //process.exit(12)
                            });
                        });
                    } catch(e) {
                        log.error('Can\'t save queries queue (',
                            (Array.isArray(queriesQueue) ? queriesQueue.length : 'unknown number of') ,' objects) to ',
                                dumpPath, ': ', e.message);
                    }
                }
            }
        } else memUsageStartTime = 0;

        log.info('[', id ,']: ', memUsage, 'Mb, received/processed/in queue/queue: ', receivedQueriesCnt,
            '/', processedQueriesCnt,
            '/', queriesQueue.length - queriesQueueIdx, '/', queriesQueue.length,
            '; time full/query/idle: ', processingQueries ? fullTimeProcessing + Date.now() - processingQueries : fullTimeProcessing,
            '/', startQueryExecution ? queryExecutionTime + Date.now() - startQueryExecution : queryExecutionTime,
            '/', _idleTime,
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