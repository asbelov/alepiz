/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var path = require('path');
var fs = require('fs');

var log = require('../lib/log')(module);
var proc = require('../lib/proc');
var exitHandler = require('../lib/exitHandler');
var sqlite = require('../lib/sqlite');
var countersDB = require('../models_db/countersDB');
var parameters = require('../models_history/historyParameters');

var transProcessArgID = 'trans';
if(!module.parent) runProcessForQueries(process.argv[2], process.argv[3]);  //standalone process

var storage = {};
module.exports = storage;

// array of minutes for trends. long time (keepTrends time) keeps only trends with time interval 60
// trends less the 60 will keeps as history data (keepHistory time)
var trendsTimeIntervals = [10, 30, 60];
var selectQueryQueue = [], queriesInProgress = 0;
var storageQueryingProcesses, storageModifyingProcess;


function getDbPaths() {
    var dbPaths = [path.join(__dirname, '..', parameters.dbPath, parameters.dbFile)];
    if(Array.isArray(parameters.db) && parameters.db.length) {
        dbPaths = parameters.db.map(function (obj) {
            if(obj.relative) return path.join(__dirname, '..', obj.path, obj.file);
            else return path.join(obj.path, obj.file);
        })
    }
    return dbPaths;
}

storage.getDbPaths = getDbPaths;

storage.initStorage = function (callback) {

    var dbPaths = getDbPaths();
    async.eachSeries(dbPaths, initDB, function (err) {
        if(err) return callback(err);


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
            args: [transProcessArgID, '%:childID:%'],
            killTimeout: 1800000, // waiting for finishing all transactions
            restartAfterErrorTimeout: 200,
            childrenNumber: dbPaths, //If array, then number will be equal to array length and %:childID:% will be set to array item
            module: 'historyStorage:writer',
            cleanUpCallbacksPeriod: 86400000,
        }, function (err, storageModifyingProcess) {
            if (err) {
                return callback(new Error('Can\'t initializing main storage process for processing transaction: ' + err.message));
            }

            storageModifyingProcess.startAll(function (err) {
                if (err) {
                    return callback(new Error('Can\'t run main storage process for processing transaction: ' + err.message));
                }

                storageModifyingProcess.sendToAll({
                    parameters: parameters,
                });

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

                        storageQueryingProcesses.sendToAll({
                            parameters: parameters,
                        });

                        callback();
                    });
                });
            });
        });
    });
};

storage.restartStorageModifierProcess = function(callback) {
    storageModifyingProcess.sendAndReceiveToAll({
        restart: 'storage modifier',
        waitForCallback: true,
    }, callback);
}

storage.restartStorageQueryProcesses = function(callback) {
    storageQueryingProcesses.sendToAll({
        restart: 'storage query processor'
    }, callback);
}

storage.stop = function(callback) {
    // use series to be able to fetch data while waiting while transactional processes are closing the database
    async.series([
        function(callback) {
            if(storageModifyingProcess && typeof storageModifyingProcess.stopAll === "function") {
                storageModifyingProcess.stopAll(function (err) {
                    if(err) log.warn('Error while stopped storage transaction processes: ', err.message);
                    else log.warn('Storage transaction processes were stopped successfully');
                    callback();
                });
            } else {
                log.warn('storageModifyingProcess.stopAll is not a function. Can\'t stop storage transaction process');
                callback();
            }
        }, function(callback) {
            if(storageQueryingProcesses && typeof storageQueryingProcesses.stopAll === "function") {
                storageQueryingProcesses.stopAll(function (err) {
                    if(err) log.warn('Error while stopped storage query processes: ', err.message);
                    else log.warn('Storage query processes were stopped successfully');
                    callback();
                });
            }
            else {
                log.warn('storageQueryingProcesses.stopAll is not a function. Can\'t stop storage query process');
                callback();
            }
        }
    ], callback);
};

storage.kill = function() {
    if(storageModifyingProcess && typeof storageModifyingProcess.killAll === 'function') storageModifyingProcess.killAll();
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
    var sendAndReceive = dontPushToQueue === 0 || dontPushToQueue === 1 ?
        storageModifyingProcess.sendAndReceiveToAll : storageQueryingProcesses.sendAndReceive;

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

        //if(funcName === 'config') { log.info('Func: ', funcName, ' send: ', args); log.info('Func: ', funcName, ' recv: ', data); }
        callback(null, data);
    });
}

function initDB(dbPath, callback) {
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
            'cachedRecords INTEGER,' +
            'trends TEXT)',
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
/*
                log.info('Truncating the WAL journal file');
                db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function (err) {
                    if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                    log.info('Optimizing database');
                    db.exec('PRAGMA optimize', function (err) {
                        if (err) log.error('Can\'t optimize database: ', err.message);

 */

                        // loading data to cache from DB only when cache is empty
                        //loadDataToCache(db, cache, function(err, cache) {
                        //    if(err) return callback(err);

                        db.close(function (err) {
                            if (err) return callback(new Error('Can\'t close storage DB: ' + err.message));

                            log.info('Close storage DB file in main history process');

                            callback(null);
                        });
                    //});
                //});
            });
        });
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

//recordsForSave, callback
storage.saveRecordsForObject = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('saveRecordsForObject'); // add last parameter (funcName)
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

function runProcessForQueries(isTransactionProcess, dbPath) {

    var db, initDB;
    var functions = {};
    var trendsData = new Map();
    var objectsParameters; // it's new Map(), but it must be undefined to be checked on initialization
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

    if(isTransactionProcess && isTransactionProcess === transProcessArgID) {
        var dbReplication = function(initDB, id, callback) {
            transactionInProgress = true;
            //log.info('Truncate WAL journal file for ', dbPath,'...');
            //initDB.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
            //    if (err) log.error('Can\'t truncate WAL journal file for ', dbPath, ':', err.message);

            //    log.info('Optimizing database ', dbPath);
            //    initDB.exec('PRAGMA optimize', function (err) {
            //        if (err) log.error('Can\'t optimize database ', dbPath, ': ', err.message);

                    transactionInProgress = false;
                    log.info('Loading trends data...');
                    loadTrendsData(initDB, function(err) {
                        if(err) log.error(err.message);
                        else log.info('Loading trends data is complete');

                        if (transactionsFunctions.length) {
                            log.warn('Starting ', transactionsFunctions.length, ' delayed transactions');
                            functions.beginTransaction(transactionsFunctions.shift());
                        }
                    });

                //});
            //});
            repl(initDB, id, callback);
            //});
        };
    } else {
        dbPath = getDbPaths()[0];
        dbReplication = function(initDB, id, callback) { callback(null, initDB); };
    }

    sqlite.init(dbPath, function (err, _initDB) {
        if (err) {
            log.exit('Can\'t initialize storage database ' + dbPath + ': ' + err.message);
            log.disconnect(function () {
                log.disconnect(function () { process.exit(2) });
            });
            return;
        }

        initDB = _initDB;

        dbReplication(_initDB, 'history', function (err, replicationDB) {
            if (err) {
                log.error('Can\'t initialize replication for storage database ' + dbPath + ': ' + err.message);
                log.disconnect(function () {
                    log.disconnect(function () { process.exit(2) });
                });
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
                            _initDB.close(function (err) {
                                if (err) log.exit('Error while close storage DB: ' + err.message);
                                else log.exit('Storage DB closed successfully');
                            });
                        },
                        onDisconnect: function () {  // exit on disconnect from parent (then server will be restarted)
                            log.exit('History storage process ' + process.pid + ' was disconnected from server unexpectedly. Exiting');
                            onStop(function () {
                                log.disconnect(function () { process.exit(2) });
                            });
                        },
                    });
                });
            });
        });
    });

    function onMessage(message, callback) {
        if (message && message.restart) {
            log.warn('Receiving message for restart history ', message.restart,' for ', dbPath,'...');
            onStop(function (err) {
                if(message.waitForCallback) callback();

                if(err) log.error('Error when preparing to stop history ', message.restart,' for ', dbPath,': ', err.message);
                else log.warn('History ', message.restart ,' for ', dbPath, ' successfully stopped.');

                log.disconnect(function () {
                    setTimeout(function() {
                        exitHandler.exit(12); // process.exit(12)
                    }, 10000);
                });
            });
            return;
        }

        // init parameters
        if(message && typeof message.parameters === 'object') {
            parameters = message.parameters;
            return;
        }

        if (!message || !message.funcName || !functions[message.funcName] || !message.arguments)
            return log.error('Incorrect message: ', message);

        var storageFunctionArguments = message.arguments.slice();
        storageFunctionArguments.push(function () {
            var storageFunctionResult = Array.prototype.slice.call(arguments);
            //log.info('Send data back for ', message, ': ', storageFunctionResult);
            //console.log('Send data back for ', message, ': ', storageFunctionResult);

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
            callbackOnStop = function(err) {
                if (err) log.error('Error while committing an unexpected transaction: ' + err.message);
                else log.error('Unexpected transaction committed successfully');
            };

            var timeToWaitForDB = isTransactionProcess === transProcessArgID ? 300 : 15; //sec

            log.warn('Closing the database for ', (isTransactionProcess === transProcessArgID ?
                    ('transactions process ' + dbPath + '...') : 'queries process...'));

            initDB.close(function (err) {
                if (err) {
                    log.error('Error while close storage DB for ' + (isTransactionProcess === transProcessArgID ?
                        'transactions process ' + dbPath + ': ' : 'queries process: ') + err.message);
                } else {
                    log.warn('Storage DB closed successfully for ', (isTransactionProcess === transProcessArgID ?
                        ('transactions process ' + dbPath) : 'queries process'));
                }
                db.sendReplicationData(function (err) {
                    if (err) log.error('Error while sending replication data: ' + err.message);

                    clearTimeout(terminateTimeout);
                    if(typeof callback === 'function') callback();
                    callback = null;
                });
            });
        } else {
            var waitingTimeout = setTimeout(function() {
                log.warn('Continue waiting while last transaction is committed for ' + dbPath + '...');
            }, 30000);
            log.warn('Waiting while last transaction is committed for ' + dbPath + '...');

            // clear transaction queue
            transactionsFunctions = [];
            timeToWaitForDB = 300; //sec

            // function will running after transaction.commit
            callbackOnStop = function(err) {
                // prevent to run transaction
                transactionInProgress = true;
                clearTimeout(waitingTimeout);
                if (err) log.error('Error while commit transaction for ' + dbPath + ': ' + err.message);
                else log.warn('Transaction commit successfully for ' + dbPath);

                log.warn('Closing the database after commit transaction for ' + dbPath + '...');
                initDB.close(function (err) {
                    if (err) log.error('Error while close storage DB after commit transaction for ' + dbPath + ': ' + err.message);
                    else log.warn('Storage DB closed successfully after commit transaction for ' + dbPath);

                    log.warn('Sending cached transaction to replication server for ' + dbPath + '...');
                    db.sendReplicationData(function (err) {
                        if (err) log.error('Error while sending transaction for ' + dbPath + ': ' + err.message);
                        else log.warn('Sending transaction successfully for ' + dbPath + '. Exiting');

                        clearTimeout(terminateTimeout);
                        if(typeof callback === 'function') callback();
                        callback = null;
                    });
                });
            };
        }

        var terminateTimeout = setTimeout(function () {
            log.warn('Cannot close database ', dbPath, ' in ', timeToWaitForDB,'sec. Terminate...');
            db.sendReplicationData(function (err) {
                if (err) log.error('Error while sending replication data: ' + err.message);
                if(typeof callback === 'function') callback();
                callback = null;
            });
        }, timeToWaitForDB * 1000);
    }

    /*
    SELECT * FROM table LIMIT 3 OFFSET 4 will skipping first 4 and get next 3 records
    [1  2  3  4  5 6 7 8 9] => [5 6 7]
    [13 12 11 10 9 8 7 6 5 4 3 2 1] => [9 8 7]

    recordsType: [0|1|2]: 0 - number and string, 1 number, 2 - string
     */
    functions.getRecordsFromStorageByIdx = function (id, offset, cnt, firstTimestamp, maxRecordsCnt, recordsType, callback) {

        var startTime = Date.now();
        var timeStampCondition = firstTimestamp ? 'AND timestamp < $firstTimestamp ' : '';

        if(recordsType < 2) {
            var tableType = 'numbers';
            if(cnt > parameters.queryMaxResultNumbers) cnt = parameters.queryMaxResultNumbers;
        } else {
            tableType = 'strings';
            if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;
        }

        db.all('SELECT data, timestamp FROM ' + tableType + ' WHERE objectID=$id ' + timeStampCondition +
            'ORDER BY timestamp DESC LIMIT $count OFFSET $offset', {
            $id: id,
            $offset: offset,
            $count: cnt,
            $firstTimestamp: firstTimestamp || undefined
        }, function (err, records1) {

            if (err) return callback(err);
            if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                addSlowRecord(Date.now() - startTime, records1.length);
            }
            /*
            log.debug('Getting records for object id: ' + id + ', from '+ tableType +', position: ' + offset + ', count: ' + cnt + ': ', records1);
             */

            if(recordsType > 0) return callback(null, records1.reverse());

            if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;
            db.all('SELECT data, timestamp FROM strings WHERE objectID=$id ' + timeStampCondition +
                'ORDER BY timestamp DESC LIMIT $count OFFSET $offset', {
                $id: id,
                $offset: offset,
                $count: cnt,
                $firstTimestamp: firstTimestamp || undefined
            }, function (err, records2) {

                if (err) return callback(err);
                if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                    addSlowRecord(Date.now() - startTime, records2.length);
                }

                if(!records2.length) return callback(null, records1.reverse());

                Array.prototype.push.apply(records1, records2);
                records1.sort(function (a, b) {
                    return a.timestamp - b.timestamp; // inc sorting
                });

                /*
                log.debug('Getting records for object id: ' + id + ', from strings, position: ' + offset + ', count: ' + cnt + ': ', records2);
                 */
                // remove first unneeded and return not more then required number of records
                callback(null ,records1.slice(Math.max(records1.length - cnt, 0)));
            });
        });
    };

    /*
 return requested records from a storage

 id: object ID

 recordsType: [0|1|2]: 0 - number and string, 1 number, 2 - string

 callback(err, records), where
 records: [{data:.., timestamp:..}, ....], sorted by ascending timestamp
 */
    functions.getRecordsFromStorageByTime = function (id, timeFrom, timeTo, maxRecordsCnt, recordsType, callback) {

        var startTime = Date.now();
        if(recordsType < 2) {
            if(maxRecordsCnt > parameters.queryMaxResultNumbers) maxRecordsCnt = parameters.queryMaxResultNumbers;
            var cnt = parameters.queryMaxResultNumbers;
        } else cnt = parameters.queryMaxResultStrings;

        getTableName(id, timeFrom, timeTo, maxRecordsCnt, recordsType, function(tableType) {
            /*
            Note that the BETWEEN operator is inclusive. It returns true when the test_expression is less than or equal
            to high_expression and greater than or equal to the value of low_expression:
            test_expression >= low_expression AND test_expression <= high_expression

            Use DESC for show last records if number of the records are more then cnt
            */
            db.all('SELECT data, timestamp FROM ' + tableType + ' WHERE objectID=$id AND ' +
                'timestamp BETWEEN $timeFrom AND $timeTo ORDER BY timestamp DESC LIMIT $queryMaxResult', {
                $id: id,
                $timeFrom: timeFrom,
                $timeTo: timeTo,
                $queryMaxResult: cnt,
            }, function (err, records1) {

                if (err) return callback(err);
                if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                    addSlowRecord(Date.now() - startTime, records1.length);
                }
                /*
                log.debug('Getting records from ' + tableType + ' for object id: ', id, ', from: ',
                    (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
                    ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records1);
                */
                if(recordsType > 0) {
                    if(records1.length) {
                        records1 = records1.reverse();
                        records1[0].isDataFromTrends = tableType !== 'numbers';
                    }
                    return callback(null, records1);
                }

                if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;

                db.all('SELECT data, timestamp FROM strings WHERE objectID=$id AND ' +
                    'timestamp BETWEEN $timeFrom AND $timeTo ORDER BY timestamp DESC LIMIT $queryMaxResult', {
                    $id: id,
                    $timeFrom: timeFrom,
                    $timeTo: timeTo,
                    $queryMaxResult: cnt,
                }, function (err, records2) {

                    if (err) return callback(err);
                    if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
                        addSlowRecord(Date.now() - startTime, records2.length);
                    }

                    if(!records2.length) {
                        if(records1.length) {
                            records1 = records1.reverse();
                            records1[0].isDataFromTrends = tableType !== 'numbers';
                        }
                        return callback(null, records1);
                    }

                    Array.prototype.push.apply(records1, records2);
                    records1.sort(function (a, b) {
                        return a.timestamp - b.timestamp; // inc sorting
                    });

                    /*
                    log.debug('Getting records from strings for object id: ', id, ', from: ',
                        (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
                        ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records2);
                    */
                    records1[0].isDataFromTrends = tableType !== 'numbers';
                    return callback(null, records1);
                });
            });
        });
    };

    function getTableName(id, timeFrom, timeTo, maxRecordsCnt, recordsType, callback) {
        if (!maxRecordsCnt || maxRecordsCnt === 1) return callback('numbers');
        //0 - number and string, 1 number, 2 - string
        if (recordsType >= 2) return callback('strings');

        var requiredTimeInterval = ((timeTo - timeFrom) / (maxRecordsCnt - 1)) / 60000;

        if(requiredTimeInterval < trendsTimeIntervals[0] / 2) return callback('numbers');
        var idx = trendsTimeIntervals.length - 1;
        if(requiredTimeInterval < trendsTimeIntervals[0]) idx = 0;
        else {
            for (var i = 0; i < trendsTimeIntervals.length - 1; i++) {
                if (requiredTimeInterval - trendsTimeIntervals[i] <= trendsTimeIntervals[i+1] - requiredTimeInterval) {
                    idx = i;
                    break;
                }
            }
        }

        var debugInfo = [];

        // trendsTables = [2, 10, 30, 60]; idx = 2; trendsTimeIntervals.slice(0,idx+1).reverse() = [30, 10, 2];
        async.each(trendsTimeIntervals.slice(0, idx + 1).reverse(), function (trendTimeInterval, callback) {
            var trendsTableName = 'trends' + trendTimeInterval + 'min';
            db.all('SELECT count(*) AS num FROM ' + trendsTableName + ' WHERE objectID=$id AND timestamp BETWEEN $timeFrom AND $timeTo', {
                $id: id,
                $timeFrom: timeFrom,
                $timeTo: timeTo,
            }, function (err, count) {
                if (err) {
                    log.error('Can\'t get number of rows for object ', id,
                        ', time interval: ',
                        (new Date(timeFrom)).toLocaleString(), '-', (new Date(timeTo)).toLocaleString(),
                        ' from table "', trendsTableName, '": ', err.message);
                    return callback();
                }
                if (!count[0] || count[0].num * 0.8 < maxRecordsCnt) {
                    debugInfo.push(trendsTableName + ': ' + count[0].num);
                    return callback();
                }
                return callback(trendsTableName);
            });
        }, function(trendsTableName) {
            if(trendsTableName) return callback(trendsTableName);

            log.debug('Using numbers table for get ', maxRecordsCnt,' records for object ', id,
                ', time interval: ', (new Date(timeFrom)).toLocaleString(), ' - ', (new Date(timeTo)).toLocaleString(),
                '; required time interval: ', Math.round(requiredTimeInterval), 'min; ',
                ' records in trends: ', debugInfo.join('; '));
            return callback('numbers');
        });
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

        objectsParameters = new Map();
        log.info('The initial loading of object parameters into the cache is performed before starting first transaction');
        db.all('SELECT * FROM objects', function (err, rows) { // id, type, cachedRecords
            if (err) return callback(new Error('Can\'t get data from objects table from storage database: ' + err.message));

            rows.forEach(function (row) {
                objectsParameters.set(row.id, row);
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
            if(typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

            var walPath = dbPath.replace(/\.db$/i, '.wal');
            fs.stat(walPath, function (err, stat) {
                if(err) log.debug('Can\'t stat file ', walPath, ': ', err.message);
                var logOperations = false;
                if(stat && stat.size) {
                    for(var i = 0, size = stat.size; i < 3 && size > 1024; i++) size = Math.round(size / 1024);
                    log.info('Truncate WAL journal file size: ', size, ['B', 'KB', 'MB', 'GB'][i],
                        ' path: ', walPath, ', db path: ', dbPath, '...');
                    logOperations = true;
                }
                db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function (err) {
                    if (err) log.error('Can\'t truncate WAL journal file: ', err.message);
                    else if(logOperations) log.info('Truncate WAL journal file is completed');
                    if (typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

                    if(logOperations) log.info('Optimizing database ', dbPath);
                    initDB.exec('PRAGMA optimize', function (err) {
                        if (err) log.error('Can\'t optimize database ', dbPath, ': ', err.message);
                        else if(logOperations) log.info('Optimize WAL journal file is completed, starting transaction...');
                        if (typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

                        db.exec('BEGIN', function (err) {
                            if (err) return callback(new Error('Can\'t start transaction for storage database: ' + err.message));
                            callback();
                        });
                    });
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

                        objectsParameters.delete(id);
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
    Loading data for create trends
     */

    function loadTrendsData(db, callback) {
        db.all('SELECT id, trends FROM objects', function(err, rows) {
            if (err) return callback(new Error('Can\'t load trends data from DB: ' + err.message));

            rows.forEach(function(row) {
                if(!row.trends) return;
                try {
                    var trendObj = JSON.parse(row.trends);
                    trendsData.set(row.id, new Map());
                    var trendData = trendsData.get(row.id);

                    // convert trend time intervals to Number
                    for(var key in trendObj) {
                        if(Number(key) === parseInt(String(key), 10)) key = Number(key);
                        trendData.set(key, trendObj[key]);
                    }
                } catch (e) {
                    log.warn('Can\'t parse trends data for object ', row.id, ': ', e.message, '; data: ', row.trends);
                }
            });

            callback();
        });
    }

    function saveTrendData(id, trendsStr, callback) {
        if(!trendsStr) return callback();

        db.run('UPDATE objects SET trends=$trendsStr WHERE id=$id', {
            $trendsStr: trendsStr,
            $id: id
        }, function(err) {
            if(err) callback(new Error('Can\'t update trends data for object ' + id + ': ' + err.message + '; data: ' + trendsStr));
            callback()
        });
    }

    /*
    Prepare SQL if not prepared before, then run with parameters. Used in saveRecordsForObject for optimize DB access
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

    functions.saveRecordsForObject = function (id, newObjectParameters, recordsForSave, callback) {
        if (!id) return callback(new Error('Undefined ID while saving records to storage database'));

        var objectParametersObj = objectsParameters.get(Number(id));
        if (!objectParametersObj) {
            var updateObjectParameters = function (callback) {
                createStorage(id, newObjectParameters, callback)
            };
        } else {
            if (objectParametersObj.cachedRecords === newObjectParameters.cachedRecords)
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

        objectsParameters.set(Number(id), newObjectParameters);
        var savedTrends = 0,
            stmtNumbers,
            stmtStrings,
            stmtTrends = {},
            trendData = trendsData.get(id),
            initTrendsStr = trendData ? JSON.stringify(Object.fromEntries(trendData.entries())) : '';
        updateObjectParameters(function (err) {
            if (err) return callback(new Error('Can\'t update or create storage parameters for object id ' + id + ': ' + err.message));

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
                    // trendsData[id] = {"10":{"timestamp":1609863584322,"data":0.5127103117898119},"30":{"timestamp":1609862915322,"data":0.5127103117898119},"60":{"timestamp":1609861114626,"data":0.5127103117898119},"prevRecordTimestamp":1609863794413}
                    if(!trendsData.has(id)) trendsData.set(id, new Map([['prevRecordTimestamp', 0]]));
                    var trendData = trendsData.get(id);

                    async.eachSeries(trendsTimeIntervals, function (timeInterval, callback) {
                        timeInterval = Number(timeInterval);

                        // timeInterval was converted to Number when trends data is loaded
                        var trendDataForTimeInterval = trendData.get(timeInterval);
                        if (!trendDataForTimeInterval) {
                            trendData.set(timeInterval, record); // record = {data:.., timestamp:...}
                            return callback();
                        }

                        // The time interval between the current and the previous record is greater than the trend time interval
                        var longTimeSpan = record.timestamp - trendData.get('prevRecordTimestamp') > timeInterval * 60000;

                        // if the time interval between current and previous record greater than time interval between trends records
                        // or if current record and previous record data are 0 then write the current record
                        // f.e. (0 + 0) / 2 = 1.7487687511971466e-48 sec
                        trendDataForTimeInterval.data =
                            longTimeSpan || (!record.data && !trendDataForTimeInterval.data) ?
                                record.data :
                                (record.data + trendDataForTimeInterval.data) / 2;

                        if (record.timestamp - trendDataForTimeInterval.timestamp < timeInterval * 60000) return callback();

                        dbRun(stmtTrends[timeInterval],
                            'INSERT INTO trends' + timeInterval + 'min (objectID, timestamp, data) VALUES ($id, $timestamp, $data)',
                            {
                                $id: id,
                                $timestamp: longTimeSpan ? record.timestamp :
                                    record.timestamp + Math.round((record.timestamp - trendDataForTimeInterval.timestamp) / 2),
                                $data: trendDataForTimeInterval.data,
                            }, function(err, stmt) {
                                stmtTrends[timeInterval] = stmt;

                                if (err) return callback(new Error('Can\'t insert data to trends' +
                                    timeInterval + 'min table: objectID: ' + id + ' trends: ' +
                                    JSON.stringify(Object.fromEntries(trendData.entries())) + '; record: ' +
                                    JSON.stringify(record) + ': ' + err.message));

                                trendDataForTimeInterval.timestamp = record.timestamp;
                                savedTrends++;
                                callback();
                            });
                    }, function (err) {
                        trendData.set('prevRecordTimestamp', record.timestamp);
                        callback(err)
                    });
                });
            }, function (err) {
                if(stmtNumbers) stmtNumbers.finalize();
                if(stmtStrings) stmtStrings.finalize();
                trendsTimeIntervals.forEach(function (timeInterval) {
                    if(stmtTrends[timeInterval]) stmtTrends[timeInterval].finalize();
                });
                if(err) return callback(err);

                var trendsStr = trendData ? JSON.stringify(Object.fromEntries(trendData.entries())) : '';
                // check and don't save unchanged trend data
                saveTrendData(id, trendsStr !== initTrendsStr ? trendsStr : '', function(err) {
                    if(err) log.error(err.message);

                    log.debug('Saving ', recordsForSave.length, ' records, ', savedTrends, ' trends for object ', id,
                        '. parameters: ', newObjectParameters, ': records: ', recordsForSave, ': trends: ', trendsStr);

                    callback(err, {
                        savedRecords: recordsForSave.length,
                        savedTrends: savedTrends
                    });
                });
            });
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
                return callback(new Error('Can\'t set incorrect or undefined configuration parameter "' + name +
                    '" value to config table'));
            }

            db.run('INSERT INTO config (name, value) VALUES ($name, $value) ON CONFLICT (name) DO UPDATE SET value=$value', {
                $name: name,
                $value: String(value),
            }, function(err) {
                if(err) {
                    return callback(new Error('Can\'t insert or update configuration parameter ' + name +
                        ' = ' + String(value) + ' :' + err.message));
                }
                callback();
            });

            return;
        }

        return callback(new Error('Can\'t set or get parameter ' + name + ' to config table: invalid action ' + action));
    };
}