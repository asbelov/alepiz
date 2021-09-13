/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.10.2016.
 */

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var parameters = require('../models_history/historyParameters');
var cache = require('../models_history/historyCache');
var storage = require('../models_history/historyStorage');
var functions = require('../models_history/historyFunctions');
var housekeeper = require('../models_history/historyHousekeeper');
var countersDB = require('../models_db/countersDB');

var history = {};
module.exports = history;

if(module.parent) initServerCommunication();
else runServerProcess(); //standalone process

function initServerCommunication() {

    var clientIPC, truncateWatchDogInterval, restartInProgress = false, usedToSaveDataToHistory = false;
    var houseKeeperData = {};

    // used for skip sending data to history with keepHistory = 0
    function getHouseKeeperData() {
        if (!usedToSaveDataToHistory) return;
        countersDB.getKeepHistoryAndTrends(function (err, rows) {
            if (err) return log.error('Can\'t get information about data keeping period');

            var newHouseKeeperData = {}
            rows.forEach(function (row) {
                if (row.history === 0) newHouseKeeperData[row.OCID] = 0;
            });

            houseKeeperData = newHouseKeeperData;
            setTimeout(getHouseKeeperData, parameters.reloadKeepHistoryInterval);
        });
    }

    history.connect = function(id, callback) {
        if(!clientIPC) {
            if(id) {
                parameters.separateStorageByProcess = false;
                parameters.suffix = '-' + id;
            }

            clientIPC = new IPC.client(parameters, function (err, msg, isConnecting) {
                if (err) log.error(err.message);
                else if (isConnecting && typeof callback === 'function') {
                    callback();
                    callback = null; // prevent run callback on reconnect
                }
            });
        } else if(typeof callback === 'function') {
            callback();
            callback = null; // prevent run callback on reconnect
        }
    };

    // creating array with function names
    var functionsArray = [];
    // creating history.<function name> objects from historyFunctions.js
    for(var funcName in functions) {
        if (!functions.hasOwnProperty(funcName)) continue;

        functionsArray.push({
            name: funcName,
            description: functions[funcName].description
        });

        // for use funcName in closure
        (function (tmp_funcName) {
            history[tmp_funcName] = function (/* id, parameter1, parameter2, ..., callback */) {
                var args = Array.prototype.slice.call(arguments); // create array from objects of arguments

                if(!args || args.length < 2) {
                    return log.error('Try to run function with name "', tmp_funcName, '" with unexpected parameters "',
                        args, '"');
                }

                var id = args.splice(0, 1)[0];
                var callback = args.splice(-1, 1)[0];

                if (typeof callback !== 'function')
                    return log.error('Error getting value of the function ', tmp_funcName, '(', args,
                        ') for object ', id, ' from history: callback is not a function');

                if (Number(id) !== parseInt(id, 10) || !Number(id))
                    return callback(new Error('Try to run function ' + tmp_funcName + '(' + args.join(', ') +
                        ') for object in history with not integer objectCounterID: ' + id));

                clientIPC.sendAndReceive( {
                    msg: 'func',
                    id: Number(id),
                    funcName: tmp_funcName,
                    parameters: args
                }, callback);
            }
        })(funcName);
    }

/*
    function truncateWalWatchdog(initParameters, callback) {

        cache.getDBPath().forEach(function(dbPath) {
            var walPath = dbPath.replace(/\.db$/i, '.wal');
            // truncate watchdog
            var truncateCounter = 0, truncateCheckInterval = 30000;
            truncateWatchDogInterval = setInterval(function () {
                fs.stat(walPath, function (err, stat) {
                    if(err) return log.warn('Can\'t stat file ', walPath, ': ', err.message);
                    if(!stat.size) {
                        if(truncateWatchDogInterval) clearInterval(truncateWatchDogInterval);
                        log.warn('WAL file was truncated, waiting for continue execution...');
                        setTimeout(function () {
                            fs.stat(walPath, function (err, stat) {
                                if (err) log.warn('Can\'t stat file ', walPath, ': ', err.message);
                                if((!stat || !stat.size) && truncateWatchDogInterval) {
                                    log.error('WAL file was truncated, but history is halted. Restart history...');
                                    restartHistory(callback);
                                }
                            });
                        }, 10000)
                    }

                    if(truncateCounter * truncateCheckInterval > 600000) {
                        log.error('The WAL file was not truncated, but the possible history process halt. Restart history process...');
                        restartHistory(callback);
                        if(truncateWatchDogInterval) clearInterval(truncateWatchDogInterval);
                        return;
                    }

                    for(var i = 0, size = stat.size; i < 3 && size > 1024; i++) {
                        size = Math.round(size / 1024);
                    }
                    log.info('Waiting for truncation of WAL file (',
                        Math.ceil((++truncateCounter * truncateCheckInterval) / 60000) ,'min), size: ', size, ['B', 'KB', 'MB', 'GB'][i],
                        ' path: ', walPath);
                });
            }, truncateCheckInterval);
        });

        function restartHistory(callback) {
            clientIPC.kill(function() {
                setTimeout( function() {
                    history.start(initParameters, callback);
                }, 5000);
            });
        }
    }
 */


    // returning list of all functions
    history.getFunctionList = function() { return functionsArray; }; // [{name: ..., description:...}, {}, ...]

    // starting history server and IPC system
    history.start = function (initParameters, callback) {
        //parameters.init(initParameters);

        // if run history.start(), then clientIPC use proc IPC communication
        // for exchange messages to the parent process
        // in all other cases run history.connect() and use net IPC communication
        clientIPC = new proc.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            killTimeout: 1900000,
            restartAfterErrorTimeout: 10000,
            onStart: function(err) {
                if(err) return callback(new Error('Can\'t run history server: ' + err.message));
                //truncateWalWatchdog(parameters, callback);
                clientIPC.sendAndReceive({type: 'initParameters', data: initParameters}, function(err) {
                    initParameters.__restart = true;
                    if(truncateWatchDogInterval) clearInterval(truncateWatchDogInterval);
                    truncateWatchDogInterval = null;
                    if(typeof callback === 'function') callback(err);
                    restartInProgress = true;
                });
            },
            module: 'history',
        }, function(err, historyProcess) {
            if(err) return callback(new Error('Can\'t initializing history server: ' + err.message));

            history.stop = historyProcess.stop;
            historyProcess.start();
        });
    };

    history.dump = cache.dumpData;
    history.cacheServiceIsRunning = cache.cacheServiceIsRunning;

    history.add = function(initID, data) {
        // don't add empty value
        if(data === undefined || data === null) return;

        // checking for correct OCID
        var id = Number(initID);
        if(id !== parseInt(String(id), 10) || !id) {
            log.error('Try to add data to history for not integer objectCounterID: ', initID, ', data: ', data);
            return;
        }

        var record = {};
        var value = data;
        if(typeof data === 'object') {
            // data is a prepared history record {timestamp:..., value:...}
            if(data.timestamp && 'value' in data) {
                // don't add empty value
                if(data.value === undefined || data.value === null) return;

                // checking timestamp
                var timestamp = Number(data.timestamp);
                if(!timestamp || timestamp !== parseInt(String(timestamp), 10) ||
                    timestamp < 1477236595310 || timestamp > Date.now() + 60000) { // 1477236595310 01/01/2000
                    log.error('Try to add data to history with invalid timestamp or very old timestamp or timestamp ' +
                        'from a future: ', id, ', data: ', data, '; now: ', Date.now());
                    return;
                }

                value = data.value;
                record = {
                    timestamp: timestamp,
                    data: value,
                }
            } else { // stringify object and add to the history
                record = {
                    timestamp: Date.now(),
                    data: JSON.stringify(data), // do stringify once and here and skip stringify on server side
                }
            }
        } else if( typeof data === 'number' || typeof 'data' === 'string' || typeof data === 'boolean') {
            record = {
                timestamp: Date.now(),
                data: data,
            }
        } else { // data is not an object, number, string or boolean
            log.error('Can\'t add this type of data to history: ', id, ', type: ', typeof data, ', data: ', data);
            return;
        }

        if(!usedToSaveDataToHistory) {
            usedToSaveDataToHistory = true;
            getHouseKeeperData();
        }

        // send data to history only if counter.keepHistory != 0
        if(houseKeeperData[id] !== 0) {
            clientIPC.send({
                msg: 'add',
                id: id,
                record: record
            });
        }

        return {
            // !!! return value, not record.data, because record.data can be a string object and cannot be
            // !!! processed on the server when multiple values are accepted at one time as an array of values
            value: value, //  !!! not a record.data !!!
            timestamp: record.timestamp,
        };
    };

    history.createStorage = function(id, callback) {
        if(typeof callback !== 'function') return log.error('Error create new history storage for object ',id,'; type ',type,': callback is not a function');
        if(Number(id) !== parseInt(id, 10) || !Number(id)) return log.error('Can\'t create a new history storage with not integer objectCounterID: ', id);

        clientIPC.sendAndReceive( {
            msg: 'createStorage',
            id: Number(id),
        }, callback);
    };

    history.del = function(IDs, callback){
        if(typeof callback !== 'function') return log.error('Error deleting object ',IDs,' from history: callback is not a function');
        if(!Array.isArray(IDs))
            return callback(new Error('Try to delete data objects from history with not an array objects IDs'));

        clientIPC.sendAndReceive( {
            msg: 'del',
            IDs: IDs
        }, callback);
    };

    history.getLastValues = function(IDs, callback) {
        if(typeof callback !== 'function') {
            return log.error('Error getting last values for objectsCountersIDs ',IDs,' from history: callback is not a function');
        }

        if(typeof IDs === 'number') IDs = [IDs];
        if(!Array.isArray(IDs)) {
            return callback(new Error('Try to get data by function "getLastValues" when objectCounterIDs is not an array: '+ IDs));
        }

        clientIPC.sendAndReceive( {
            msg: 'getLastValues',
            IDs: IDs,
        }, callback);
    };

    history.getByIdx = function(id, offset, cnt, maxRecordsCnt, callback){
        if(typeof(maxRecordsCnt) === 'function'){
            callback = maxRecordsCnt;
            maxRecordsCnt = 0;
        } else {
            if(Number(maxRecordsCnt) !== parseInt(maxRecordsCnt, 10)) return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer "maxRecordsCnt" parameter: '+maxRecordsCnt));
        }
        if(typeof callback !== 'function') return log.error('Error getting value for object ',id,' by index from history: callback is not a function');
        if(Number(id) !== parseInt(id, 10) || !Number(id)) return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer objectCounterID: '+id));
        if(Number(offset) !== parseInt(offset, 10) || Number(offset) < 0) return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer "offset" parameter: '+offset));
        if(Number(cnt) !== parseInt(cnt, 10) || Number(cnt) < 1) return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer "cnt" parameter: '+cnt));

        clientIPC.sendAndReceive( {
            msg: 'getByIdx',
            id: Number(id),
            last: Number(offset),
            cnt: Number(cnt),
            maxRecordsCnt: Number(maxRecordsCnt),
            recordsType: 0,
        }, callback);
    };

    history.getByTime = function(id, time, interval, maxRecordsCnt, callback){
        if(typeof(maxRecordsCnt) === 'function'){
            callback = maxRecordsCnt;
            maxRecordsCnt = 0;
        } else {
            if(Number(maxRecordsCnt) !== parseInt(maxRecordsCnt, 10)) return callback(new Error('Try to get data by function "getByTime" for object from history with not integer "maxRecordsCnt" parameter: '+maxRecordsCnt));
        }
        if(typeof callback !== 'function') return log.error('Error getting value for object ',id,' by time from history: callback is not a function');
        if(Number(id) !== parseInt(id, 10)) return callback(new Error('Try to get data by function "getByTime" for object from history with not integer objectCounterID: '+id));
        if(Number(time) !== parseInt(time, 10)) return callback(new Error('Try to get data by function "getByTime" for object from history with not integer "time" parameter: '+time));
        if(Number(interval) !== parseInt(interval, 10)) return callback(new Error('Try to get data by function "getByTime" for object from history with not integer "interval" parameter: '+interval));

        clientIPC.sendAndReceive( {
            msg: 'getByTime',
            id: Number(id),
            time: Number(time),
            interval: Number(interval),
            maxRecordsCnt: Number(maxRecordsCnt),
            recordsType: 0,
        }, callback);
    };

    history.getByValue = function(id, value, callback){
        if(typeof callback !== 'function') return log.error('Error getting timestamp for object ',id,' by value from history: callback is not a function');
        if(Number(id) !== parseInt(id, 10) || !Number(id)) return callback(new Error('Try to get timestamp by function "getByValue" for object from history with not integer objectCounterID: '+id));
        if((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'undefined' )
            return callback(new Error('Try to get timestamp by function "getByValue" for object from history with undefined or not number or not string value parameter: '+ JSON.stringify(value)));

        clientIPC.sendAndReceive( {
            msg: 'getByValue',
            id: Number(id),
            value: value
        }, callback);
    };
}

function runServerProcess() {

    var server = require('../lib/server');
    server.connect();

    var restartTimestamp = 0, serverIPC, stopHistoryInProgress = false;

    var historyProcess = new proc.child({
        module: 'history',
        onDestroy: function() {
            cache.dumpData();
            cache.terminateHousekeeper = true;
            storage.kill();
        },
        onStop: stopHistory,
        onMessage: function(message, callback) {
            processMessage(message, null, callback);
        },
        onDisconnect: function() {  // exit on disconnect from parent
            log.exit('History server was disconnected from parent unexpectedly. Exiting');
            cache.terminateHousekeeper = true;
            storage.stop(function(err) {
                if(err) log.error(err.message);
                cache.dumpData(function() {
                    log.disconnect(function () { process.exit(2) });
                });
            });
        },
    });

    function processMessage(message, socket, callback) {

        if(message.msg === 'add') {
            cache.add(message.id, message.record);
            // callback used only for cleanup callback stack from IPC cluster worker
            // empty data will not be sent to history client
            return callback();
        }

        if(message.msg === 'createStorage')
            return storage.createStorage(message.id, {cachedRecords: parameters.initCachedRecords}, callback);

        if(message.msg === 'del') return cache.del(message.IDs, 0, 0,callback);

        if(message.msg === 'getLastValues') return cache.getLastValues(message.IDs, callback);

        if(message.msg === 'getByIdx') {
            return cache.getByIdx (message.id, message.last, message.cnt, message.maxRecordsCnt, message.recordsType,
                function(err, records) {
                callback(err, thinOutRecords(records, message.maxRecordsCnt))
            });
        }

        if(message.msg === 'getByTime') {
            return cache.getByTime (message.id, message.time, message.interval, message.maxRecordsCnt,
                message.recordsType, function(err, records) {
                //var isDataFromTrends = records && records.length ? records[0].isDataFromTrends : false;
                var trimmedRecords = thinOutRecords(records, message.maxRecordsCnt);
                //if(trimmedRecords.length) {
                    //trimmedRecords[0].isDataFromTrends = trimmedRecords.length !== records.length || isDataFromTrends;
                //}
                callback(err, trimmedRecords);
            });
        }

        if(message.msg === 'getByValue') return cache.getByValue (message.id, message.value, callback);

        if(message.msg === 'func') {
            if(typeof functions[message.funcName] !== 'function')
                return log.error('Unknown history function "',message.funcName,'". Message object: ',message);

            //log.info('Executing history function ',message.funcName,'. Message object: ',message);
            return functions[message.funcName](message.id, message.parameters, callback);
        }

        if (message.type === 'initParameters') {
            var sleepTime = message.data.__restart ? 2000 : 0;
            return setTimeout(function () {
                cache.init(message.data, function (err) {
                    if (err) log.error('History init error: ', err.message, '; init parameters: ', message.data);

                    // init houseKeeper at 30 minutes after start every 1 hour
                    housekeeper.run(parameters);
                    log.info('Init housekeeper for run every ', Math.ceil(message.data.housekeeperInterval / 60000), 'min');
                    setInterval(function () {
                        housekeeper.run();
                    }, message.data.housekeeperInterval);

                    initScheduledRestart();

                    // starting IPC after all history functions are initializing
                    log.info('Starting history storage IPC...');
                    parameters.id = 'history';
                    serverIPC = new IPC.cluster(parameters, function(err, msg, socket, messageCallback) {
                        if(err) log.error(err.message);

                        if(socket === -1) {
                            server.sendMsg({throttlingPause: 120000});
                            log.info('Starting history server process and initializing IPC');
                            callback(err);
                        } else if(msg) processMessage(msg, socket, messageCallback);
                    });
                });
            }, sleepTime);
        }
    }

    function stopHistory(callback) {
        if(stopHistoryInProgress) return;
        stopHistoryInProgress = true;
        // dumping data two times for save data when server terminated by stop timeout
        if(restartTimestamp) {
            // add message to log.exit to prevent server.js from restarting for 5 minutes
            log.exit('Scheduled restart of the history server...');

            var myLog = log.warn;
            cache.cacheServiceIsRunning(1);
        } else {
            myLog = log.exit;
        }

        myLog('Stopping history storage service...');
        cache.terminateHousekeeper = true;

        cache.dumpData(function() {
            if(!restartTimestamp) {
                if(cache.cacheServiceIsRunning()) {
                    setTimeout(function() {
                        myLog('Cache service is running, waiting...');
                    }, 10000);
                }
                cache.terminateCacheService();
            }
            myLog('Stopping history storage processes...');
            storage.stop(function(err) {
                if(err) myLog('Error while stopping storage processes: ' + err.message);
                else myLog('Storage processes successfully stopped');

                if(!serverIPC || typeof serverIPC.stop !== 'function') {
                    myLog('IPC is not initialized')
                    serverIPC = {
                        stop: function (callback) { callback(); }
                    }
                } else myLog('Closing IPC communication...');

                // Stops the server from accepting new connections and keeps existing connections
                serverIPC.stop(function(err) {
                    cache.dumpData(function() {
                        myLog('History server is stopped');
                        callback(err);
                    }, restartTimestamp);
                });

                setTimeout(function() {
                    cache.dumpData(function() {
                        myLog('Timeout occurred while waiting for the closing IPC communication. History server is stopped');
                        callback(err);
                    }, restartTimestamp);
                }, 60000);
            });
        }, restartTimestamp);
    }

    // run after cache service will be completed
    function waitForCacheServiceCallback(err) {
        if(err && err.message) log.error('Cache service return error:', err.message);

        if(err !== 1) log.info('Caching service is finished. Restart...');
        restartTimestamp = Date.now();
        cache.cacheServiceIsRunning(1); // 1 mean that restart occurred
        if(!parameters.restartHistory && parameters.restartStorageModifier) {
            setTimeout(afterRestartCleanup, 600000, 600000);

            storage.restartStorageModifierProcess(function(err) {
                if(err) {
                    log.error('Error while restarting storage modifier process: ' + err.message);
                    historyProcess.stop(12); // exitCode: process.exit(12)
                    return;
                }

                var resumeTime = 150000; // 3 min
                log.info('The caching service and the housekeeper is scheduled to resume in ', resumeTime / 60000,' minutes.')
                setTimeout(afterRestartCleanup, resumeTime);
            });
        }

        if(parameters.restartHistory) historyProcess.stop(12); // exitCode: process.exit(12)
    }

    function afterRestartCleanup(restartTimeout) {
        if(restartTimeout && (!restartTimestamp || Date.now() - restartTimestamp < restartTimeout)) return;
        cache.cacheServiceIsRunning(0);
        cache.terminateCacheService(0);
        restartTimestamp = 0;
        cache.terminateHousekeeper = 0;
        if(!restartTimeout) log.warn('Unpause the cache service and the housekeeper');
        else log.warn('Unpause the cache service and the housekeeper by timeout...');
        housekeeper.run();
    }

    function initScheduledRestart() {
        parameters.restartHistoryInterval = Number(parameters.restartHistoryInterval);

        if(parameters.restartHistoryInterval === parseInt(String(parameters.restartHistoryInterval), 10) &&
            parameters.restartHistoryInterval > 0
        ) {
            if(parameters.restartHistoryInterval < parameters.cacheServiceInterval * 1.5) {
                log.warn('Restart history time interval is too small (', Math.ceil(parameters.restartHistoryInterval / 60),
                    ' min). Setting restart history time interval to ',
                    Math.ceil(parameters.cacheServiceInterval * 1.5 / 60), 'min');
                parameters.restartHistoryInterval = parameters.cacheServiceInterval * 1.5;
            }

            log.info('Initializing scheduled restart history storage process every ',
                Math.ceil(parameters.restartHistoryInterval / 60), 'min');
            parameters.restartHistoryInterval *= 1000;

            setInterval(function () {
                if(!parameters.restartHistory && parameters.restartStorageQueryProcesses) {
                    log.info('Scheduled restarting history storage query processes...');
                    storage.restartStorageQueryProcesses(function(err) {
                        if(err) {
                            log.error('Error while restarting storage query processes: ' + err.message);
                            historyProcess.stop(12); // exitCode: process.exit(12)
                        }
                    });
                }

                if(!parameters.restartHistory && !parameters.restartStorageModifier) return;

                cache.terminateHousekeeper = true;
                log.info('Preparing to scheduled restart history storage process...');
                cache.addCallbackToCacheService(waitForCacheServiceCallback);

                // 1  mean that scheduled restart in progress; 2 - wait for cache service in progress
                if(cache.cacheServiceIsRunning() === 1 || cache.cacheServiceIsRunning() === 2) {
                    log.warn('The previous scheduled restart time of the history storage process has expired. Restart now...');
                    cache.terminateCacheService();
                    waitForCacheServiceCallback(1);
                } else if(cache.cacheServiceIsRunning()) { // cache service is running now
                    log.info('It is planned to restart history storage after the end of the cache maintenance...');
                    cache.cacheServiceIsRunning(2); // wait for cache service in progress
                } else { // cache service is not running now
                    log.info('Saving data from cache to history storage before restart...')
                    cache.startCacheService();
                    setTimeout(cache.cacheServiceIsRunning, 1000, 2); // wait for cache service in progress
                }
            }, Math.round(parameters.restartHistoryInterval - parameters.restartHistoryInterval / 5));
        }
    }
}

/*
    thin out records: decrease count of returned records to maxRecordsCnt records

    allRecords: array of records
    maxRecordsCnt: required maximum count of records
    return thin out array of records
 */
function thinOutRecords(allRecords, maxRecordsCnt) {

    if(!allRecords || !allRecords.length) return [];
    var recordsCnt = allRecords.length;

    maxRecordsCnt = parseInt(String(maxRecordsCnt), 10);

    var stepTimestamp = (Number(allRecords[recordsCnt - 1].timestamp) - Number(allRecords[0].timestamp)) / (maxRecordsCnt - 1);
    if(!maxRecordsCnt || maxRecordsCnt === 1 || stepTimestamp < 1 || recordsCnt <= maxRecordsCnt) return allRecords;

    var nextTimestamp = Number(allRecords[0].timestamp); // also adding first record to returned array
    var avgRecords = [], avgData = null, avgTimestamp = null;

    allRecords.forEach(function (record) {
        // if record.data is number
        if(!isNaN(parseFloat(record.data)) && isFinite(record.data)) {
            if(avgData === null) {
                avgData = Number(record.data);
                avgTimestamp = Number(record.timestamp);
            } else {
                avgData = (avgData + Number(record.data)) / 2;
                avgTimestamp = Math.round((avgTimestamp + Number(record.timestamp)) / 2);
            }

            if(Number(record.timestamp) >= nextTimestamp) {
                avgRecords.push({
                    data: avgData,
                    timestamp: avgTimestamp
                });
                nextTimestamp += stepTimestamp;
                avgData = null; avgTimestamp = null;
            }
        } else { // if record.data not a number
            if(avgData !== null) avgRecords.push({ // add previous numbers to array
                data: avgData,
                timestamp: avgTimestamp
            });
            avgRecords.push(record); // add record to array
            nextTimestamp += stepTimestamp;
            avgData = null; avgTimestamp = null;
        }
    });

    if(avgData !== null) avgRecords.push({ // add last record to array
        data: avgData,
        timestamp: avgTimestamp
    });

    // add isDataFromTrends and recordsFromCache information
    if(typeof avgRecords[0] === 'object') {
        for(var key in allRecords[0]) {
            if(key !== 'data' && key !== 'timestamp') avgRecords[0][key] = allRecords[0][key];
        }
        avgRecords[0].notTrimmedRecordsNum = allRecords.length;
    }

    return avgRecords;
}