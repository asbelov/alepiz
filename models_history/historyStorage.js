/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var path = require('path');

var log = require('../lib/log')(module);
var proc = require('../lib/proc');

var sqlite = require('../lib/sqlite');
var countersDB = require('../models_db/countersDB');
var parameters = require('../models_history/historyParameters');

var transProcessArgID = 'trans';
if(!module.parent) runProcessForQueries(process.argv[2]);  //standalone process

var storage = {};
module.exports = storage;

// array of minutes for trends. long time (keepTrends time) keeps only trends with time interval 60
// trends less the 60 will keeps as history data (keepHistory time)
var trendsTimeIntervals = [10, 30, 60];
var selectQueryQueue = [], queriesInProgress = 0;
var storageQueryingProcesses, storageModifyingProcess;


storage.initStorage = function (cache, callback) {

    var dbPath = path.join(__dirname, '..', parameters.dbPath, parameters.dbFile);

    log.info('Open storage file ', dbPath, '...');
    sqlite.init(dbPath, function (err, db) {
        if (err) return callback(new Error('Can\'t initialise storage database ' + dbPath + ': ' + err.message));

        function createTrendTable(timeInterval, callback) {
            db.run(
                'CREATE TABLE IF NOT EXISTS trends' + timeInterval + 'min (' +
                'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                'timestamp INTEGER NOT NULL,' +
                'data REAL NOT NULL)',
                function (err) {
                    if (err) return callback(new Error('Can\'t create trends' + timeInterval + 'min table in storage database: ' + err.message));

                    db.run('CREATE INDEX IF NOT EXISTS objectID_timestamp_trends' + timeInterval + 'min_index on trends' + timeInterval + 'min(objectID, timestamp)',
                        function (err) {
                            if (err) return callback(new Error('Can\'t create objects-timestamp index in trends' + timeInterval + 'min table in storage database: ' + err.message));
                            callback();
                        }
                    );
                }
            )
        }

        db.run(
            'CREATE TABLE IF NOT EXISTS objects (' +
            'id INTEGER PRIMARY KEY ASC,' +
            'type INTEGER,' + // 0 - number, 1 - string
            'cachedRecords INTEGER)',
            function (err) {
                if (err) return callback(new Error('Can\'t create objects table in storage database: ' + err.message));

                async.parallel([function (callback) {
                    db.run(
                        'CREATE TABLE IF NOT EXISTS numbers (' +
                        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                        'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                        'timestamp INTEGER NOT NULL,' +
                        'data REAL NOT NULL)',
                        function (err) {
                            if (err) return callback(new Error('Can\'t create numbers table in storage database: ' + err.message));

                            db.run('CREATE INDEX IF NOT EXISTS objectID_timestamp_numbers_index on numbers(objectID, timestamp)',
                                function (err) {
                                    if (err) return callback(new Error('Can\'t create objects-timestamp index in numbers table in storage database: ' + err.message));
                                    callback();
                                }
                            );
                        }
                    )
                }, function (callback) {
                    db.run(
                        'CREATE TABLE IF NOT EXISTS strings (' +
                        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                        'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                        'timestamp INTEGER NOT NULL,' +
                        'data TEXT NOT NULL)',
                        function (err) {
                            if (err) return callback(new Error('Can\'t create strings table in storage database: ' + err.message));

                            db.run('CREATE INDEX IF NOT EXISTS objectID_timestamp_strings_index on strings(objectID, timestamp)',
                                function (err) {
                                    if (err) return callback(new Error('Can\'t create objects-timestamp index in strings table in storage database: ' + err.message));
                                    callback();
                                    /*
                                    db.run('CREATE INDEX IF NOT EXISTS data_strings_index on strings(data)',
                                        function (err) {
                                            if (err) return callback(new Error('Can\'t create value index in strings table in storage database: ' + err.message));

                                            callback();
                                        }
                                    );
                                     */
                                }
                            );
                        }
                    )
                }, function (callback) {
                    db.run('CREATE TABLE IF NOT EXISTS config (' +
                    'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                    'name TEXT NOT NULL UNIQUE,' +
                    'value TEXT)',
                    function (err) {
                        if (err) return callback(new Error('Can\'t create config table in storage database: ' + err.message));
                        callback();
                    });
                },
                    function (callback) {
                    async.eachSeries(trendsTimeIntervals, createTrendTable, callback);
                }], function (err) {
                    if (err) return callback(err);

                    log.info('Truncating the WAL journal file');
                    db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                        if(err) log.error('Can\'t truncate WAL journal file: ', err.message);

                        log.info('Optimizing database');
                        db.exec('PRAGMA optimize', function(err) {
                            if (err) log.error('Can\'t optimize database: ', err.message);

                            // loading data to cache from DB only when cache is empty
                            //loadDataToCache(db, cache, function(err, cache) {
                            //    if(err) return callback(err);

                                db.close(function (err) {
                                    if (err) return callback(new Error('Can\'t close storage DB: ' + err.message));

                                    log.info('Close storage DB file in main history process');

                                    // print warning when queue exist every 30 sec
                                    setInterval(function () {
                                        if (selectQueryQueue.length > parameters.queriesMaxQueueLength) {
                                            log.warn('Too many queries in queue (', selectQueryQueue.length,
                                                ') for getting data from history at same time. ' +
                                                'Queries are queued.');

                                            // try to process queue.
                                            // dontPushToQueue set to 1 or true when query was pushed to queue and now
                                            // query don't queued
                                            childFunc.apply(this, selectQueryQueue.shift());
                                        }
                                    }, 120000);

                                    log.info('Starting main storage process for processing transaction...');
                                    storageModifyingProcess = new proc.parent({
                                        childProcessExecutable: __filename,
                                        args: [transProcessArgID],
                                        killTimeout: 1800000, // waiting for finishing all transactions
                                        restartAfterErrorTimeout: 200,
                                        childrenNumber: 1,
                                        module: 'historyStorage:writer',
                                        cleanUpCallbacksPeriod: 86400000,
                                    }, function (err, storageModifyingProcess) {
                                        if (err) {
                                            return callback(new Error('Can\'t initializing main storage process for processing transaction: ' + err.message));
                                        }

                                        storageModifyingProcess.start(function (err) {
                                            if (err) {
                                                return callback(new Error('Can\'t run main storage process for processing transaction: ' + err.message));
                                            }

                                            log.info('Starting storage processes for getting data from database...');
                                            storageQueryingProcesses = new proc.parent({
                                                childProcessExecutable: __filename,
                                                killTimeout: 60000,
                                                restartAfterErrorTimeout: 200,
                                                module: 'historyStorage:reader',
                                                cleanUpCallbacksPeriod: 86400000,
                                            }, function (err, storageQueryingProcesses) {
                                                if (err) {
                                                    return callback(new Error('Can\'t initializing storage processed for for getting data from database: ' + err.message));
                                                }

                                                storageQueryingProcesses.startAll(function (err) {
                                                    if (err) {
                                                        return callback(new Error('Can\'t run storage processed for for getting data from database: ' + err.message));
                                                    }

                                                    callback(null, cache);
                                                });
                                            });
                                        });
                                    });
                                });

                            //});
                        });
                    });
                });
            }
        );
    });
};

/*
    loading data from storage into the cache when init cache first time

    callback(err, cache), cache - loaded cache
 */
/*
function loadDataToCache(db, cache, callback) {

    if(typeof cache === 'object' && Object.keys(cache).length > 2) return callback(null, cache);
    cache =db.all( {};

    db.all('SELECT * FROM objects', function (err, rows) { // id, type, cachedRecords
        if (err) return callback(new Error('Can\'t get data from objects table from storage database: ' + err.message));

        var objectsParameters = {};
        rows.forEach(function (row) {
            objectsParameters[row.id] = row;
        });

        log.info('Starting load history data to cache from database for ', Object.keys(objectsParameters).length, ' objects');

        var recordsCnt = 0, loaded = 0, nextInfo = Object.keys(objectsParameters).length / 10, loadStep = nextInfo;
        // 'limit' canceled database high loading with many parallel queries
        async.eachOfLimit(objectsParameters, 10, function (row, ID, callback) {

            // loading data to cache from numbers and strings tables for required object
            var cachedRecords = row.cachedRecords ? row.cachedRecords : parameters.initCachedRecords;
            var trendsTimeIntervalsObj = {};
            trendsTimeIntervals.forEach(function (timeInterval) {
                trendsTimeIntervalsObj[timeInterval] = timeInterval;
            });
            db.all('SELECT timestamp, data FROM numbers  WHERE objectID=$id ' +
                'UNION ALL ' +
                'SELECT timestamp, data FROM strings WHERE objectID=$id ' +
                'ORDER BY timestamp DESC LIMIT $cachedRecords', {
                $id: ID,
                $cachedRecords: cachedRecords
            }, function (err, records) {
                if (err) return callback(new Error('Can\'t load ' + row.cachedRecords +
                    ' records to cache from storage database for object: ' + ID + ': ' + err.message));

                async.mapValues(trendsTimeIntervalsObj, function (timeInterval, key, callback) {
                    db.get('SELECT timestamp, data FROM trends' + timeInterval + 'min ORDER BY ROWID DESC LIMIT 1', function (err, row) {
                        if (err) return callback('Can\'t get latest record from trends' + timeInterval + 'min table: ' + err.message);
                        callback(null, row);
                    });
                }, function (err, trends) {
                    if (err) return callback(err);

                    cache[ID] = {
                        cachedRecords: cachedRecords,
                        savedCnt: records.length,
                        records: records.reverse(),
                        trends: trends // {'2': {timestamp:..., data:...}, '10': {timestamp:..., data:...}, '30':{..}, '60':{..}}
                    };
                    //log.debug('Loading data for ', ID, ': ', cache[ID]);
                    recordsCnt += records.length;
                    ++loaded;
                    if (loaded > nextInfo) {
                        nextInfo += loadStep;
                        log.info('Loaded ', Math.ceil(loaded * 100 / Object.keys(objectsParameters).length) - 1, '% data to cache (', recordsCnt, ' records)');
                    }
                    callback();
                });
            });
        }, function (err) {
            callback(err, cache);
            log.info('Finishing load history data to cache. Loaded ', recordsCnt, ' records for ', Object.keys(cache).length, ' objects');
        });
    });
}

 */

storage.stop = function(callback) {
    async.series([
        function(callback) {
            if(storageModifyingProcess && typeof storageModifyingProcess.stop === "function") storageModifyingProcess.stop(callback);
            else callback();
        }, function(callback) {
            if(storageQueryingProcesses && typeof storageQueryingProcesses.stopAll === "function") storageQueryingProcesses.stopAll(callback);
            else callback();
        }
    ], callback);
};

storage.kill = function() {
    if(storageModifyingProcess && typeof storageModifyingProcess.kill === 'function') storageModifyingProcess.kill();
    if(storageQueryingProcesses && typeof storageQueryingProcesses.killAll ==='function') storageQueryingProcesses.killAll();
};

function childFunc() {
    var args = Array.prototype.slice.call(arguments);
    var dontPushToQueue = args.pop(); // get last argument

    /*
     limiting queries number to parameters.queriesMaxQueueLength
     if queries number more then parameters.queriesMaxQueueLength push query to queue
     */
    if (/*(!dontPushToQueue && queriesInProgress > parameters.queriesMaxQueueLength) ||*/
        // can be when history server is restarting
        !storageModifyingProcess || !storageQueryingProcesses) {

        // add last parameter (dontPushToQueue):
        if(dontPushToQueue === 0) args.push(1); // 1|0 for modifying DB
        else args.push(true); // true|false for querying DB

        selectQueryQueue.push(args);

        /*if(!storageModifyingProcess || !storageQueryingProcesses)*/
        setTimeout(function() {
            if (selectQueryQueue.length) childFunc.apply(this, selectQueryQueue.shift());
        }, 2000)

        return;
    }

    // storageModifyingProcess for modify database
    var sendAndReceive = dontPushToQueue === 0 || dontPushToQueue === 1 ? storageModifyingProcess.sendAndReceive : storageQueryingProcesses.sendAndReceive;

    var funcName = args.pop();
    var callback = args.pop();

    queriesInProgress++;
    sendAndReceive({
        funcName: funcName,
        arguments: args
    }, function(err, data) {
        if(--queriesInProgress < 0) queriesInProgress = 0;
        if(err) return callback(err);

        // get one query result, run to process one query from queue
        if (selectQueryQueue.length) childFunc.apply(this, selectQueryQueue.shift());

        //if(funcName === 'saveRecords') { log.info('Func: ', funcName, ' send: ', args); log.info('Func: ', funcName, ' recv: ', data); }
        callback(null, data);
    });
}
/*
// create new unique message ID
function getNewMessageID() {
    return (messageID < maxMessageID-1 ? messageID++ : 0);
}

 */

// id, last, cnt, maxRecordsCnt, callback
storage.getRecordsFromStorageByIdx = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('getRecordsFromStorageByIdx'); // add last parameter (funcName)
    args.push(false); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};


/*
 return requested records from a storage

 callback(err, records, type), where
 records: [{data:.., timestamp:..}, ....], sorted by ascending timestamp
 */
storage.getRecordsFromStorageByTime = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('getRecordsFromStorageByTime'); // add last parameter (funcName)
    args.push(false); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// id, value, callback
storage.getLastRecordTimestampForValue = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('getLastRecordTimestampForValue'); // add last parameter (funcName)
    args.push(false); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// callback
storage.beginTransaction = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('beginTransaction'); // add last parameter (funcName)
    args.push(1); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// callback
storage.commitTransaction = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('commitTransaction'); // add last parameter (funcName)
    args.push(1); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// IDs, daysToKeepHistory, daysToKeepTrends, callback
storage.delRecords = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('delRecords'); // add last parameter (funcName)
    args.push(0); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

//id, newObjectParameters, records, trends, callback
storage.saveRecords = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('saveRecords'); // add last parameter (funcName)
    args.push(0); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

//id, objectParameters, callback
storage.createStorage = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('createStorage'); // add last parameter (funcName)
    args.push(0); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// callback
storage.removeZombiesFromStorage = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('removeZombiesFromStorage'); // add last parameter (funcName)
    args.push(1); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};

// action (get, set), name, value, callback
storage.config = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('config'); // add last parameter (funcName)
    args.push(1); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
};


// =============================================================================================

function runProcessForQueries(isTransactionProcess) {
    var dbPath = path.join(__dirname, '..', parameters.dbPath, parameters.dbFile);
    var db;
    var functions = {};
    var objectsParameters; // mast be undefined for check for initializing
    var transactionInProgress = false;
    var transactionsFunctions = [];
    var callbackOnStop;
    var repl = require('../lib/dbReplication');

    var slowRecords = {
        timeAvg: 0,
        recordsNumAvg: 0,
        recordsNum: 0,
    };
    setInterval(function() {
        if(!slowRecords.timeAvg) return;
        log.warn('Slow queries avg time: ', Math.round(slowRecords.timeAvg / 1000),' sec; avg records number/query: ',
            Math.round(slowRecords.recordsNumAvg), '; all records number: ', slowRecords.recordsNum);
        slowRecords = {
            timeAvg: 0,
            recordsNumAvg: 0,
            recordsNum: 0,
        };
    }, 60000);


    function addSlowRecord(receiveTime, recordsNum) {
        if(slowRecords.timeAvg) {
            slowRecords.timeAvg = (slowRecords.timeAvg + receiveTime) / 2;
            slowRecords.recordsNumAvg = (slowRecords.recordsNumAvg - recordsNum) / 2;
        }
        else {
            slowRecords.timeAvg = receiveTime;
            slowRecords.recordsNumAvg = recordsNum;
        }
        slowRecords.recordsNum += recordsNum;
    }

    if(isTransactionProcess && isTransactionProcess === transProcessArgID) var dbReplication = repl;
    else dbReplication = function(initDB, id, callback) { callback(null, initDB); };

    sqlite.init(dbPath, function (err, initDB) {
        if (err) {
            log.exit('Can\'t initialize storage database ' + dbPath + ': ' + err.message);
            setTimeout(process.exit, 500, 2);
        }

        dbReplication(initDB, 'history', function (err, replicationDB) {
            if (err) {
                log.error('Can\'t initialize replication for storage database ' + dbPath + ': ' + err.message);
                setTimeout(process.exit, 500, 2);
            }

            db = replicationDB;
            if(typeof db.sendReplicationData !== 'function') db.sendReplicationData = function(callback) { callback(); };

            db.exec("PRAGMA synchronous = OFF", function (err) {
                if (err) log.error('Can\'t apply "PRAGMA synchronous = OFF to storage DB": ', err.message);

                db.exec("PRAGMA journal_mode = WAL", function (err) {
                    if (err) log.error('Can\'t apply "PRAGMA journal_mode = WAL to storage DB": ', err.message);

                    log.info('Init history storage child ', process.pid, ' complete');
                    new proc.child({
                        module: 'historyStorage',
                        cleanUpCallbacksPeriod: 86400000,
                        onMessage: onMessage,
                        onStop: onStop,
                        onDestroy: function () {
                            initDB.close(function (err) {
                                if (err) log.exit('Error while close storage DB: ' + err.message);
                                else log.exit('Storage DB closed successfully');
                            });
                        },
                        onDisconnect: function () {  // exit on disconnect from parent (then server will be restarted)
                            log.exit('History storage process ' + process.pid + ' was disconnected from server unexpectedly. Exiting');
                            onStop(function () {
                                process.exit(2);
                            });
                        },
                    });
                });
            });
        });
    });

    function onMessage(message, callback) {
        if (!message || !message.funcName || !functions[message.funcName] || !message.arguments)
            return log.error('Incorrect message: ', message);

        var storageFunctionArguments = message.arguments.slice();
        storageFunctionArguments.push(function () {
            var storageFunctionResult = Array.prototype.slice.call(arguments);
            //log.info('Send data back for ', message, ': ', storageFunctionResult);

            // callback arguments is [err, data]
            var err = storageFunctionResult[0];
             //return message without callback back
            var result = storageFunctionResult[1];

            callback(err, result);
        });
        functions[message.funcName].apply(this, storageFunctionArguments);
    }

    function onStop(callback) {
        if(!transactionInProgress) {
            // prevent to run transaction
            transactionInProgress = true;
            callbackOnStop = function(err) { if (err) log.error('Error while commit transaction: ' + err.message); };
            log.warn('No transaction in progress. Closing database...');
            // but in any cases try to rollback transaction
            db.exec('ROLLBACK', function() {
                db.close(function (err) {
                    if (err) log.error('Error while close storage DB: ' + err.message);
                    else log.warn('Storage DB closed successfully');
                    db.sendReplicationData(callback);
                });
            });
            setTimeout(function () {
                log.error('Can\'t close database without transactions in 15sec.');
                db.sendReplicationData(callback);
                callback = null;
            }, 15000);
        } else {
            var waitingTimeout = setTimeout(function() {
                log.warn('Continue waiting while last transaction is committed...');
            }, 30000);
            log.warn('Waiting while last transaction is committed...');

            // clear transaction queue
            transactionsFunctions = [];

            // function will running after transaction.commit
            callbackOnStop = function(err) {
                // prevent to run transaction
                transactionInProgress = true;
                clearTimeout(waitingTimeout);
                if (err) log.error('Error while commit transaction: ' + err.message);
                else log.warn('Transaction commit successfully');

                log.warn('Truncate WAL journal file...');
                db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                    if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                    log.warn('Closing database...');
                    // but in any cases try to rollback transaction
                    db.exec('ROLLBACK', function() {
                        db.close(function (err) {
                            if (err) log.error('Error while close storage DB: ' + err.message);
                            else log.warn('Storage DB closed successfully');
                            log.warn('Sending cached transaction to replication server...');
                            db.sendReplicationData(function (err) {
                                if (err) log.error('Error while sending transaction: ' + err.message);
                                else log.warn('Sending transaction successfully. Exiting');
                                callback();
                            });
                        });
                    });
                    setTimeout(function () {
                        log.warn('Can\'t close database with transactions, but it committed in 30sec.');
                        db.sendReplicationData(callback);
                        callback = null;
                    }, 60000);
                });
            };
        }
    }

    /*
    SELECT * FROM table LIMIT 3 OFFSET 4 will skipping first 4 and get next 3 records
    [1  2  3  4  5 6 7 8 9] => [5 6 7]
    [13 12 11 10 9 8 7 6 5 4 3 2 1] => [9 8 7]
     */
    functions.getRecordsFromStorageByIdx = function (id, offset, cnt, firstTimestamp, maxRecordsCnt, callback) {

        var startTime = Date.now();
        var timeStampCondition = firstTimestamp ? 'AND timestamp < $firstTimestamp ' : '';
        if(cnt > parameters.queryMaxResult) cnt = parameters.queryMaxResult;
        db.all('SELECT data, timestamp FROM numbers WHERE objectID=$id ' + timeStampCondition +
            'UNION ALL ' +
            'SELECT data, timestamp FROM strings WHERE objectID=$id ' + timeStampCondition +
            'ORDER BY timestamp DESC LIMIT $count OFFSET $offset', {
            $id: id,
            $offset: offset,
            $count: cnt,
            $firstTimestamp: firstTimestamp || undefined
        }, function (err, records) {

            if (err) {
                //return callback(new Error('Can\'t get records for object id: ' + id + ', from position: ' + offset + ', count: ' + cnt + ': ' + err.message));
                return callback(err);
            }

            if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                //log.warn('Getting records ', (Date.now() - startTime), ' ms for object id: ' + id + ', from position: ' + offset + ', count: ' + cnt + ': ', records);
                addSlowRecord(Date.now() - startTime, records.length);
            } else {
                log.debug('Getting records for object id: ' + id + ', from position: ' + offset + ', count: ' + cnt + ': ', records);
            }
            callback(null, records.reverse());
        });
    };

    /*
 return requested records from a storage

 id: object ID

 callback(err, records, type), where
 records: [{data:.., timestamp:..}, ....], sorted by ascending timestamp
 */
    functions.getRecordsFromStorageByTime = function (id, timeFrom, timeTo, maxRecordsCnt, callback) {

        var startTime = Date.now();
        if(maxRecordsCnt > parameters.queryMaxResult) maxRecordsCnt = parameters.queryMaxResult;
        var tableNameForNumbers = getTableNameForNumbers(timeFrom, timeTo, maxRecordsCnt);

        /*
        Note that the BETWEEN operator is inclusive. It returns true when the test_expression is less than or equal
        to high_expression and greater than or equal to the value of low_expression:
        test_expression >= low_expression AND test_expression <= high_expression
        */
        db.all('SELECT data, timestamp FROM ' + tableNameForNumbers + ' WHERE objectID=$id AND timestamp BETWEEN $timeFrom AND $timeTo ' +
            'UNION ALL ' +
            'SELECT data, timestamp FROM strings WHERE objectID=$id AND timestamp BETWEEN $timeFrom AND $timeTo ' +
            'ORDER BY timestamp LIMIT $queryMaxResult', {
            $id: id,
            $timeFrom: timeFrom,
            $timeTo: timeTo,
            $queryMaxResult: parameters.queryMaxResult,
        }, function (err, records) {

            if (err) {
                /*
                return callback(new Error('Can\'t get records from ' + tableNameForNumbers + ' for object id: ' + id +
                    ', from: ' + (new Date(timeFrom)).toLocaleString() + '(' + timeFrom + ')' +
                    ' to: ' + (new Date(timeTo)).toLocaleString() + '(' + timeTo + '): ' + err.message));
                 */
                return callback(err);
            }

            if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                /*
                log.warn('Getting records ', (Date.now() - startTime),
                    ' ms from ' + tableNameForNumbers + ' for object id: ', id, ', from: ',
                    (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
                    ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records);
                 */

                addSlowRecord(Date.now() - startTime, records.length);
            } else {
                log.debug('Getting records from ' + tableNameForNumbers + ' for object id: ', id, ', from: ',
                    (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
                    ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records);
            }

            callback(null, records, tableNameForNumbers !== 'numbers');
        });
    };

    function getTableNameForNumbers(timeFrom, timeTo, maxRecordsCnt) {
        if (!maxRecordsCnt || maxRecordsCnt === 1) return 'numbers';

        var requiredTimeInterval = ((timeTo - timeFrom) / (maxRecordsCnt - 1)) / 60000;
        var timeIntervals = [0];
        Array.prototype.push.apply(timeIntervals, trendsTimeIntervals);

        for (var i = 1; i < timeIntervals.length; i++) {
            if (requiredTimeInterval > timeIntervals[i]) continue;
            if (requiredTimeInterval - timeIntervals[i - 1] >= timeIntervals[i] - requiredTimeInterval) return 'trends' + timeIntervals[i] + 'min';
            if (i === 1) return 'numbers';
            return 'trends' + timeIntervals[i - 1] + 'min';
        }

        return 'trends' + trendsTimeIntervals[trendsTimeIntervals.length - 1] + 'min';
    }

    functions.getLastRecordTimestampForValue = function (id, value, callback) {
        if (!isNaN(parseFloat(value)) && isFinite(value)) var table = 'numbers';
        else table = 'strings';

        var startTime = Date.now();
        db.get('SELECT timestamp FROM ' + table + ' WHERE objectID=$id AND data=$value ORDER BY timestamp DESC LIMIT 1', {
            $id: id,
            $value: value
        }, function (err, row) {

            if (err) return callback(new Error('Can\'t get last timestamp for object id: ' + id + ', value: ' + value +
                ' from history table ' + table + ': ' + err.message));

            if (Date.now() - startTime > parameters.slowQueueSec * 1000)
                log.warn('Getting last timestamp ', (Date.now() - startTime),
                    'ms for object id: ' + id + ', value: ' + value +
                    ' from history table "' + table + '" is: ' + (row ? row.timestamp : 'not found'));
            else
                log.debug('Last timestamp for object id: ' + id + ', value: ' + value +
                    ' from history table "' + table + '" is: ' + (row ? row.timestamp : 'not found'));
            callback(null, row ? row.timestamp : undefined);
        })
    };

    function getObjectsParameters (callback) {
        if(objectsParameters) return callback();

        objectsParameters = {};
        log.info('This process used for storage database modification, loading objects parameters to cache');
        db.all('SELECT * FROM objects', function (err, rows) { // id, type, cachedRecords
            if (err) return callback(new Error('Can\'t get data from objects table from storage database: ' + err.message));

            rows.forEach(function (row) {
                objectsParameters[row.id] = row;
            });

            callback();
        });
    }

    functions.beginTransaction = function(callback) {
        if(typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

        if(transactionInProgress) {
            transactionsFunctions.push(callback);
            return;
        }
        transactionInProgress = true;

        getObjectsParameters(function(err) {
            if(err) return callback(err);

            db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                db.exec('BEGIN', function (err) {
                    if (err) return callback(new Error('Can\'t start transaction for storage database: ' + err.message));
                    callback();
                });
            });
        });
    };

    functions.commitTransaction = function(err, _callback) {

        function callback(err) {
            if(typeof callbackOnStop === 'function') callbackOnStop(err);
            _callback(err);
        }

        if(err) {
            db.exec('ROLLBACK', function(errRollback) {
                if(errRollback) return callback(new Error(err.message + '; and can\'t rollback transaction for storage database :' + errRollback.message));


                db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                    if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                    transactionInProgress = false;
                    if(transactionsFunctions.length) functions.beginTransaction(transactionsFunctions.shift());
                    callback(err);
                });
            });
        } else {
            db.exec('COMMIT', function (err) {
                if (err) return callback(new Error('Can\'t commit transaction for storage database: ' + err.message));

                //log.info('Truncate WAL journal file');
                db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function (err) {
                    if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                    transactionInProgress = false;
                    if(transactionsFunctions.length) functions.beginTransaction(transactionsFunctions.shift());
                    callback();
                });
            });
        }
    };

    functions.delRecords = function (IDs, daysToKeepHistory, daysToKeepTrends, callback) {
        if (!callback) {
            callback = daysToKeepHistory;
            daysToKeepHistory = 0;
        }

        functions.beginTransaction(function(err) {
            if(err) return callback(err);

            delRecords(IDs, daysToKeepHistory, daysToKeepTrends, function(err) {
                functions.commitTransaction(err, callback);
            })
        })
    };

    function delRecords(IDs, daysToKeepHistory, daysToKeepTrends, callback) {

        if (daysToKeepHistory) {
            var now = new Date();
            var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToKeepHistory);
            var timestampForHistory = d.getTime();

            if (!daysToKeepTrends || daysToKeepTrends < daysToKeepHistory) daysToKeepTrends = daysToKeepHistory;
            d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToKeepTrends);
            var timestampForTrends = d.getTime();

            var stmtNumbers = db.prepare('DELETE FROM numbers WHERE objectID=$id AND timestamp<$timestamp', function (err) {
                if (err) return callback(new Error('Can\'t prepare to remove data from numbers table for objects: ' +
                    IDs.join(',') + ' and for ' + daysToKeepHistory + ' days: ' + err.message));

                var stmtStrings = db.prepare('DELETE FROM strings WHERE objectID=$id AND timestamp<$timestamp', function (err) {
                    if (err) return callback(new Error('Can\'t prepare to remove data from strings table for objects: ' +
                        IDs.join(',') + ' and for : ' + daysToKeepHistory + ' days: ' + err.message));

                    var stmtTrends = {};
                    async.each(trendsTimeIntervals, function (timeInterval, callback) {
                        stmtTrends[timeInterval] = db.prepare('DELETE FROM trends' + timeInterval + 'min WHERE objectID=$id AND timestamp<$timestamp', function (err) {
                            if (err) return callback(new Error('Can\'t prepare to delete data from trends' + timeInterval + 'min table for objects ' + IDs.join(', ') + ': ' + err.messgage));
                            callback();
                        });
                    }, function (err) {
                        if (err) return callback(err);

                        async.eachSeries(IDs, function (id, callback) {

                            stmtNumbers.run({
                                $id: id,
                                $timestamp: timestampForHistory,
                            }, function (err) {
                                if (err) return callback(new Error('Can\'t remove data from numbers table for object: ' + id +
                                    ' and for ' + daysToKeepHistory + ' days: ' + err.message));

                                stmtStrings.run({
                                    $id: id,
                                    $timestamp: timestampForHistory,
                                }, function (err) {
                                    if (err) return callback(new Error('Can\'t remove data from strings table for object: ' + id +
                                        ' and for ' + daysToKeepHistory + ' days: ' + err.message));

                                    async.each(trendsTimeIntervals, function (timeInterval, callback) {
                                        stmtTrends[timeInterval].run({
                                            $id: id,
                                            // remove trends data with time interval less then 1 hours like history data
                                            // (keepHistory time).
                                            $timestamp: timeInterval < 60 ? timestampForHistory: timestampForTrends,
                                        }, function (err) {
                                            if (err) return callback(new Error('Can\'t delete data from trends' +
                                                timeInterval + 'min table for objectID: ' + id + ': ' + err.message));
                                            callback();
                                        });
                                    }, callback);
                                })
                            })
                        }, function (err) {
                            stmtNumbers.finalize();
                            stmtStrings.finalize();
                            trendsTimeIntervals.forEach(function (timeInterval) {
                                stmtTrends[timeInterval].finalize();
                            });
                            callback(err);
                        });
                    });
                })
            })
        } else {
            var stmt = db.prepare('DELETE FROM objects WHERE id=?', function (err) {
                if (err) return callback(new Error('Can\'t prepare to remove all data for objects: ' +
                    IDs.join(',') + ' from storage: ' + err.message));

                async.eachSeries(IDs, function (id, callback) {

                    stmt.run(id, function (err) {
                        if (err) return callback(new Error('Can\'t remove all data for object: ' + id + ' from storage: ' + err.message));

                        delete (objectsParameters[id]);
                        callback();
                    })
                }, function (err) {
                    stmt.finalize();
                    callback(err);
                });
            })
        }
    }

    /*
    Prepare SQL if not prepared before, then run with parameters. Used in saveRecords for optimize DB access
    stmt - DB statement
    sql - SQL query
    param - query parameters
    callback(err, stmt)
     */

    function dbRun(stmt, sql, param, callback) {
        if(stmt && typeof stmt.run === 'function') {
            stmt.run(param, function(err) {
                callback(err, stmt);
            });
            return;
        }

        stmt = db.prepare(sql, function(err) {
            if(err) return callback(err);
            stmt.run(param, function(err) {
                callback(err, stmt);
            });
        });
    }

    /*
 Saving records to a storage

 id: objectID
 newObjectParameters: {
    savedCnt: cacheObj.savedCnt
    cachedRecords: cacheObj.cachedRecords
 }

 records: [{data:.., timestamp:..}, ...]
 trends: {'2': {timestamp:..., data:...}, '10': {timestamp:..., data:...}, '30':{..}, '60':{..}}
 callback(err)
 */
    functions.saveRecords = function (id, newObjectParameters, records, trends, callback) {
        if (!id) return callback(new Error('Undefined ID while saving records to storage database'));

        if (newObjectParameters.savedCnt >= records.length) return callback();

        // save records from saveCnt index to end of records array
        var recordsForSave = records.slice(newObjectParameters.savedCnt);

        if (!objectsParameters[id]) {
            var updateObjectParameters = function (callback) {
                createStorage(id, newObjectParameters, callback)
            };
        } else {
            if (objectsParameters[id].cachedRecords === newObjectParameters.cachedRecords)
                updateObjectParameters = function (callback) {
                    callback()
                };
            else
                updateObjectParameters = function (callback) {
                    db.run('UPDATE objects SET cachedRecords=$cachedRecords WHERE id=$id', {
                        $cachedRecords: newObjectParameters.cachedRecords,
                        $id: id
                    }, callback)
                }
        }

        objectsParameters[id] = newObjectParameters;
        var savedTrends = 0, stmtNumbers, stmtStrings, stmtTrends = {};
        updateObjectParameters(function (err) {
            if (err) return callback(new Error('Can\'t update or create storage parameters for object id ' + id + ': ' + err.message));

            // set prevRecordTimestamp to timestamp of last saved record or 0
            var prevRecordTimestamp = newObjectParameters.savedCnt > 0 && records[newObjectParameters.savedCnt - 1] ? records[newObjectParameters.savedCnt - 1].timestamp : 0;
            async.eachSeries(recordsForSave, function (record, callback) {
                if(!isNaN(parseFloat(String(record.data))) && isFinite(record.data)) {
                    var isNumber = true;
                    record.data = Number(record.data);
                } else isNumber = false;

                dbRun(isNumber ? stmtNumbers : stmtStrings,
                    'INSERT INTO ' + (isNumber ? 'numbers' : 'strings') + ' (objectID, timestamp, data) VALUES ($id, $timestamp, $data)',
                    {
                        $id: id,
                        $timestamp: record.timestamp,
                        $data: record.data
                    }, function (err, stmt) {

                    if(isNumber) stmtNumbers = stmt;
                    else stmtStrings = stmt;

                    if (err) return callback(new Error('Can\'t insert data into the ' +
                        (isNumber ? 'numbers' : 'strings') +
                        ' table for object id ' + id + ', timestamp: ' + record.timestamp + ', data: ' + record.data +
                        ': ' + err.message));

                    if (!isNumber) return callback();

                    // save trends
                    async.eachSeries(trendsTimeIntervals, function (timeInterval, callback) {
                        timeInterval = Number(timeInterval);

                        var longTimeSpan = record.timestamp - prevRecordTimestamp > timeInterval * 60000;
                        var trend = trends[timeInterval];
                        if (!trend) {
                            trends[timeInterval] = record; // record = {data:.., timestamp:...}
                            return callback();
                        }

                        // if time interval between current and previous record more then time interval between trends records
                        // or if current record and previous record data is 0 write current record
                        // f.e. (0 + 0) / 2 = 1.7487687511971466e-48 sec
                        trend.data = longTimeSpan || (!record.data && !trend.data) ? record.data : (record.data + trend.data) / 2;
                        if (record.timestamp - trend.timestamp < timeInterval * 60000) return callback();

                        dbRun(stmtTrends[timeInterval],
                            'INSERT INTO trends' + timeInterval + 'min (objectID, timestamp, data) VALUES ($id, $timestamp, $data)',
                            {
                                $id: id,
                                $timestamp: longTimeSpan ? record.timestamp : record.timestamp + Math.round((record.timestamp - trend.timestamp) / 2),
                                $data: trend.data
                            }, function(err, stmt) {
                            stmtTrends[timeInterval] = stmt;

                            if (err) return callback(new Error('Can\'t insert data to trends' +
                                timeInterval + 'min table: objectID: ' + id + ' trends: ' + JSON.stringify(trends) + '; record: ' +
                                JSON.stringify(record) + ': ' + err.message));

                            trend.timestamp = record.timestamp;
                            savedTrends++;
                            callback();
                        });
                    }, function (err) {
                        prevRecordTimestamp = record.timestamp;
                        callback(err);
                    });
                })
            }, function (err) {
                if(stmtNumbers) stmtNumbers.finalize();
                if(stmtStrings) stmtStrings.finalize();
                trendsTimeIntervals.forEach(function (timeInterval) {
                    if(stmtTrends[timeInterval]) stmtTrends[timeInterval].finalize();
                });
                if(err) return callback(err);

                log.debug('Saving ', recordsForSave.length, '/', records.length, ' records for object ', id,
                    '. parameters: ', newObjectParameters, ': records: ', recordsForSave, ': trends: ', trends);

                callback(err, {
                    trends: trends,
                    savedRecords: recordsForSave.length,
                    savedTrends: savedTrends
                });
            })
        });
    };

    /*
     if not exists, create directory with object id
     write storage parameters in any cases

     id: object id
     objectParameters: {cachedRecords:..}
     callback(err)
     */
    functions.createStorage = function (id, objectParameters, callback) {
        functions.beginTransaction(function(err) {
            if(err) return callback(err);

            createStorage(id, objectParameters, function(err) {
                functions.commitTransaction(err, callback)
            });
        });
    };

    function createStorage (id, objectParameters, callback) {
        if (objectParameters === undefined) objectParameters = {cachedRecords: parameters.initCachedRecords};
        else if (!objectParameters.cachedRecords) objectParameters.cachedRecords = parameters.initCachedRecords;

        log.info('Creating new storage for object id: ', id, '. Storage parameters: ', objectParameters);
        db.run('INSERT INTO objects (id, cachedRecords, type) VALUES (?, ?, ?)',
            [id, objectParameters.cachedRecords, 0], function (err) {
                if (err) return callback(new Error('Can\'t create a new storage for id ' + id + ', cached records: ' +
                    objectParameters.cachedRecords + ' in storage database: ' + err.message));

                callback();
            });
    }

    functions.removeZombiesFromStorage = function (callback) {
        log.info('Removing zombies objects from storage');

        db.all('SELECT * FROM objects', function (err, rows) { // id, type, cachedRecords
            if (err) return callback(new Error('Can\'t get data from objects table from storage database: ' + err.message));

            var OCIDs = rows.map(function (row) {
                return row.id
            });

            countersDB.getObjectsCounters(OCIDs, function(err, rows) {
                if(err) return callback(new Error('Can\'t get data from objectsCounters table: ' + err.message));

                if(rows.length === OCIDs.length) {
                    log.info('Zombies objects are not found in the storage');
                    return callback();
                }

                var zombiesOCIDs = [];
                rows.forEach(function (row) {
                    if(OCIDs.indexOf(row.id) === -1) zombiesOCIDs.push(row.id);
                });

                functions.delRecords(zombiesOCIDs, function (err) {
                    if(err) return callback('Error removing zombies objects from the storage: ' + err.message);

                    log.info('Done removing zombie objects from storage. Removed ', zombiesOCIDs.length, ' objects');
                    callback();
                });
            });
        });
    };

    functions.config = function(action, name, value, callback) {
        if(action === 'get') {
            if(typeof(name) !== 'string') {
                return callback(new Error('Can\'t get incorrect or undefined parameter name from config table'));
            }

            db.all('SELECT * FROM config WHERE name = ?', name, function(err, rows) {
                if(err) return callback(new Error('Can\'t get parameter ' + name + ' from config table: ' + err.message));
                if(rows.length < 1) return callback();
                return callback(null, rows[0].value);
            });
            return;
        }

        if(action === 'set') {
            if(typeof(name) !== 'string') {
                return callback(new Error('Can\'t set incorrect or undefined parameter name to config table'));
            }

            if(typeof value !== 'string' && typeof value !== 'number' && value !== null) {
                return callback(new Error('Can\'t set incorrect or undefined parameter "' + name + '" value to config table'));
            }

            db.run('INSERT INTO config (name, value) VALUES (?,?)', [name, String(value)], function(err_insert) {
                if(err_insert) {
                    db.run('UPDATE config SET value=? WHERE name=?', [String(value), name], function(err_update) {
                        if(err_update) {
                            return callback(new Error('Can\'t insert or update parameter ' + name + ' = ' + value +
                                ': insert error: ' + err_insert.message + '; update error: ' + err_update.message));
                        }
                        callback();
                    })
                }
            });
            return;
        }

        return callback(new Error('Can\'t set or get parameter ' + name + ' to config table: invalid action ' + action));
    };
}