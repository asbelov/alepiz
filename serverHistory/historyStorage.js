/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require('async');
const path = require('path');

const log = require('../lib/log')(module);
const threads = require('../lib/threads');
const createDB = require('./historyCreateDB');
const setShift = require('../lib/utils/setShift');
const parameters = require('./historyParameters');
const Conf = require("../lib/conf");
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());


var storage = {};
module.exports = storage;

// array of minutes for trends. long time (keepTrends time) keeps only trends with time interval 60
// trends less the 60 will keep as history data (keepHistory time)
const trendsTimeIntervals = [10, 30, 60];
const transProcessArgID = 'trans';
var selectQueryQueue = new Set(), queriesInProgress = 0;
var storageQueryingProcesses, storageModifyingProcess;

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

storage.initStorage = function (callback) {

    var dbPaths = getDbPaths();
    async.eachSeries(dbPaths, function (dbPath, callback) {
        createDB(dbPath, trendsTimeIntervals, callback);
    }, function (err) {
        if(err) return callback(err);


        // print warning when queue exist every 30 sec
        setInterval(function () {
            if (selectQueryQueue.size > parameters.queriesMaxQueueLength) {
                log.warn('Too many queries in queue (', selectQueryQueue.size,
                    ') for getting data from history at same time. ' +
                    'Queries are queued.');

                // try to process queue.
                // dontPushToQueue set to 1 or true when query was pushed to queue and now
                // query don't queued
                childFunc.apply(this, setShift(selectQueryQueue));
            }
        }, 120000);

        log.info('Starting main storage process for processing transaction...');
        new threads.parent({
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

                log.info('Initialization main storage process for processing transaction...');

                _storageModifyingProcess.sendAndReceiveToAll({
                    init: true,
                }, function(err) {
                    if (err) log.error('Error sending parameters to storage processes for processing transaction: ', err.message);
                    storageModifyingProcess = _storageModifyingProcess;

                    log.info('Starting storage processes for getting data from DB...');
                    new threads.parent({
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

                            log.info('Initialization storage processes for for getting data from DB...');
                            _storageQueryingProcesses.sendAndReceiveToAll({
                                init: true,
                            }, function(err) {
                                if (err) log.error('Error sending parameters to storage processes for for getting data from DB: ', err.message);
                                storageQueryingProcesses = _storageQueryingProcesses;
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
    /*(!dontPushToQueue && queriesInProgress > parameters.queriesMaxQueueLength) ||*/
    // !storageModifyingProcess || !storageQueryingProcesses can be when history server is restarting
    if (!storageModifyingProcess || !storageQueryingProcesses) {

        // add last parameter (dontPushToQueue):
        if(dontPushToQueue === 0) args.push(1); // 1|0 for modifying DB
        else args.push(true); // true|false for querying DB

        selectQueryQueue.add(args);

        /*if(!storageModifyingProcess || !storageQueryingProcesses)*/
        setTimeout(function() {
            if (selectQueryQueue.size) childFunc.apply(this, setShift(selectQueryQueue));
        }, 2000).unref();

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
        if (selectQueryQueue.size) childFunc.apply(this, setShift(selectQueryQueue));

        //if(funcName === 'config') { log.info('Func: ', funcName, ' send: ', args); log.info('Func: ', funcName, ' receive: ', data); }
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