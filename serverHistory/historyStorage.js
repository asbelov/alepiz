/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var path = require('path');

var log = require('../lib/log')(module);
var threads = require('../lib/threads');
const Database = require("better-sqlite3");


var storage = {};
module.exports = storage;

// array of minutes for trends. long time (keepTrends time) keeps only trends with time interval 60
// trends less the 60 will keep as history data (keepHistory time)
const trendsTimeIntervals = [10, 30, 60];
const transProcessArgID = 'trans';
var selectQueryQueue = [], queriesInProgress = 0;
var storageQueryingProcesses, storageModifyingProcess;
var parameters = {};

function getDbPaths(_parameters) {
    if(!_parameters) _parameters = parameters;

    if(Array.isArray(_parameters.db) && _parameters.db.length) {
        var dbPaths = _parameters.db.map(function (obj) {
            if (obj && obj.path && obj.file) {
                if(obj.relative) return path.join(__dirname, '..', obj.path, obj.file);
                else return path.join(obj.path, obj.file);
            } else log.error('Can\'t create DB path from ', _parameters.db, ': ', obj);
        });
    } else if (_parameters.dbPath && _parameters.dbFile) {
        dbPaths = [path.join(__dirname, '..', _parameters.dbPath, _parameters.dbFile)];
    }

    return dbPaths;
}

storage.getDbPaths = getDbPaths;
storage.trendsTimeIntervals = trendsTimeIntervals;
storage.transProcessArgID = transProcessArgID;

storage.initStorage = function (initParameters, callback) {

    parameters = initParameters;

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
        var initStorageModifyingProcess = new threads.parent({
            childProcessExecutable: path.join(__dirname, 'historyStorageServer.js'),
            args: [transProcessArgID, '%:childID:%'],
            killTimeout: 1800000, // waiting for finishing all transactions
            restartAfterErrorTimeout: 200,
            childrenNumber: dbPaths, //If dbPaths is an array, then number will be equal to array length and %:childID:% will be set to array item
            module: 'historyStorage:writer',
            cleanUpCallbacksPeriod: 86400000,
        }, function (err, _storageModifyingProcess) {
            if (err) {
                return callback(new Error('Can\'t initializing main storage process for processing transaction: ' + err.message));
            }

            _storageModifyingProcess.startAll(function (err) {
                if (err) {
                    return callback(new Error('Can\'t run main storage process for processing transaction: ' + err.message));
                }

                log.info('Sending parameters to main storage process for processing transaction...');
                var paramsForTransfer = {};
                // remove functions from parameters for transfer to worker thread
                for(var key in parameters) {
                    if(typeof parameters[key] !== 'function') paramsForTransfer[key] = parameters[key];
                }
                _storageModifyingProcess.sendAndReceiveToAll({
                    parameters: paramsForTransfer,
                }, function(err) {
                    if (err) log.error('Error sending parameters to storage processes for processing transaction: ', err.message);
                    storageModifyingProcess = initStorageModifyingProcess;

                    log.info('Starting storage processes for getting data from DB...');
                    var initStorageQueryingProcesses = new threads.parent({
                        childProcessExecutable: path.join(__dirname, 'historyStorageServer.js'),
                        killTimeout: 60000,
                        restartAfterErrorTimeout: 200,
                        module: 'historyStorage:reader',
                        cleanUpCallbacksPeriod: 86400000,
                        childrenNumber: parameters.storageQueryingProcessesNum || 0,
                    }, function (err, _storageQueryingProcesses) {
                        if (err) {
                            return callback(new Error('Can\'t initializing storage processes for for getting data from DB: ' + err.message));
                        }

                        _storageQueryingProcesses.startAll(function (err) {
                            if (err) {
                                return callback(new Error('Can\'t run storage processes for getting data from DB: ' + err.message));
                            }

                            log.info('Sending parameters to storage processes for for getting data from DB...');
                            _storageQueryingProcesses.sendAndReceiveToAll({
                                parameters: paramsForTransfer,
                            }, function(err) {
                                if (err) log.error('Error sending parameters to storage processes for for getting data from DB: ', err.message);
                                storageQueryingProcesses = initStorageQueryingProcesses;
                                callback();
                            });
                        });
                    });
                });


            });
        });
    });
};

storage.stop = function(callback) {
    // use series to be able to fetch data while waiting while transactional processes are closing the DB
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

    // storageModifyingProcess for modify DB
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

        //if(funcName === 'config') { log.info('Func: ', funcName, ' send: ', args); log.info('Func: ', funcName, ' receive: ', data); }
        callback(null, data);
    });
}

function initDB(dbPath, callback) {
    //log.info('Open storage file ', dbPath, '...');

    try {
        var db = new Database(dbPath, {timeout: Number(parameters.dbLockTimeout) || 5000});
    } catch (err) {
        return log.throw('Can\'t open DB ', dbPath, ': ', err.message);
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS objects (' +
            'id INTEGER PRIMARY KEY ASC,' +
            'type INTEGER,' + // 0 - number, 1 - string
            'cachedRecords INTEGER,' +
            'trends TEXT)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects table in storage DB: ' + err.message))
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS numbers (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
            'timestamp INTEGER NOT NULL,' +
            'data REAL NOT NULL)').run();
    } catch (err) {
        return callback(new Error('Can\'t create numbers table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_numbers_index on numbers(objectID, timestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects-timestamp index in numbers table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS strings (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
            'timestamp INTEGER NOT NULL,' +
            'data TEXT NOT NULL)').run();
    } catch (err) {
        return callback(new Error('Can\'t create strings table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_strings_index on strings(objectID, timestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects-timestamp index in strings table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS config (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'name TEXT NOT NULL UNIQUE,' +
            'value TEXT)').run();
    } catch (err) {
        return callback(new Error('Can\'t create config table in storage DB: ' + err.message));
    }

    for (var i = 0; i < trendsTimeIntervals.length; i++) {
        var timeInterval = trendsTimeIntervals[i];
        try {
            db.prepare('CREATE TABLE IF NOT EXISTS trends' + timeInterval + 'min (' +
                'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                'timestamp INTEGER NOT NULL,' +
                'data REAL NOT NULL)').run();
        } catch (err) {
            return callback(new Error('Can\'t create trends' + timeInterval + 'min table in storage DB: ' + err.message));
        }

        try {
            db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_trends' + timeInterval +
                'min_index on trends' + timeInterval + 'min(objectID, timestamp)').run();
        } catch (err) {
            return callback(new Error('Can\'t create objects-timestamp index in trends' + timeInterval +
                'min table in storage DB: ' + err.message));
        }
    }

    try {
        db.close();
        log.info('Close storage DB file in main history process');
    } catch (err) {
        callback(new Error('Can\'t close storage DB: ' + err.message));
    }

    callback();
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

// callback(null,
//  [   {    id: 1625308767715,    timestamp: 1625308768388,    result: { len: 0, timestamp: 0 }  },
//      {    id: 1625308767711,    timestamp: 1625308768388,    result: { len: 0, timestamp: 0 }  },
//  [length]: 2]
//  );
storage.getTransactionsQueueInfo = function () {
    var args = Array.prototype.slice.call(arguments);
    args.push('getTransactionsQueueInfo'); // add last parameter (funcName)
    args.push(1); // add last parameter (dontPushToQueue)

    childFunc.apply(this, args);
}

// transactionDescription, callback
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