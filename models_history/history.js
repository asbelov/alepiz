/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.10.2016.
 */

var fs = require('fs');
var path = require('path');

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var parameters = require('../models_history/historyParameters');
var cache = require('../models_history/historyCache');
var storage = require('../models_history/historyStorage');
var functions = require('../models_history/historyFunctions');
var housekeeper = require('../models_history/historyHousekeeper');

var history = {};
module.exports = history;

if(module.parent) initServerCommunication();
else runServerProcess(); //standalone process

function initServerCommunication() {

    var clientIPC, truncateWatchDogInterval, restartInProgress = false;

    history.connect = function(callback) {
        if(!clientIPC) {
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


    function truncateWalWatchdog(initParameters) {
        var walPath = path.join(__dirname, '..', initParameters.dbPath, initParameters.dbFile  + '-wal');

        // truncate watchdog
        var truncateCounter = 0, truncateCheckInterval = 30000;
        truncateWatchDogInterval = setInterval(function () {
            fs.stat(walPath, function (err, stat) {
                if(err) return log.warn('Can\'t stat file ', walPath, ': ', err.message);
                if(!stat.size) {
                    clearInterval(truncateWatchDogInterval);
                    log.warn('WAL file was truncated, waiting for continue execution...');
                    setTimeout(function () {
                        fs.stat(walPath, function (err, stat) {
                            if (err) log.warn('Can\'t stat file ', walPath, ': ', err.message);
                            if((!stat || !stat.size) && truncateWatchDogInterval) {
                                log.error('WAL file was truncated, but history is halted. Restart history...');
                                restartHistory();
                            }
                        });
                    }, 10000)
                }

                if(truncateCounter * truncateCheckInterval > 600000) {
                    log.error('The WAL file was not truncated, but the possible history process halt. Restart history process...');
                    restartHistory();
                    clearInterval(truncateWatchDogInterval);
                    return;
                }

                for(var i = 0, size = stat.size; i < 3 && size > 1024; i++) {
                    size = Math.round(size / 1024);
                }
                log.info('Waiting for truncation of WAL file (',
                    (++truncateCounter * truncateCheckInterval) / 1000 ,'sec), size: ', size, ['B', 'KB', 'MB', 'GB'][i],
                    ' path: ', walPath);
            });
        }, truncateCheckInterval);

        function restartHistory() {
            clientIPC.kill(function() {
                setTimeout( function() {
                    history.start(initParameters, function(err) {
                        if(err) {
                            log.error('Error starting history: ', err.message);
                            log.exit('Error starting history: ', err.message);

                            setTimeout(process.exit, 5000, 2);
                        }

                        log.info('History server restarted successfully');
                    });
                }, 5000);
            });
        }
    }


    // returning list of all functions
    history.getFunctionList = function() { return functionsArray; }; // [{name: ..., description:...}, {}, ...]

    // starting history server and IPC system
    history.start = function (initParameters, callback) {
        clientIPC = new proc.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            killTimeout: 1900000,
            restartAfterErrorTimeout: 10000,
            onStart: function(err) {
                if(err) return callback(new Error('Can\'t run history server: ' + err.message));
                truncateWalWatchdog(initParameters);
                clientIPC.sendAndReceive({type: 'initParameters', data: initParameters}, function(err) {
                    initParameters.__restart = true;
                    clearInterval(truncateWatchDogInterval);
                    truncateWatchDogInterval = null;
                    if(!restartInProgress) callback(err);
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

                record = {
                    timestamp: timestamp,
                    data: data.value,
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

        clientIPC.send({
            msg: 'add',
            id: id,
            record: record
        }, function (err) {
            if (err) log.error(err.message);
        });

        return {
            value: record.data,
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

    var restartMode = false;

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
                    process.exit(2);
                });
            });
        },
    });

    function processMessage(message, socket, callback) {

        if(message.msg === 'add') return cache.add(message.id, message.record);

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
                callback(err, thinOutRecords(records, message.maxRecordsCnt))
            });
        }

        if(message.msg === 'getByValue') return cache.getByValue (message.id, message.value, callback);

        if(message.msg === 'func') {
            if(typeof functions[message.funcName] !== 'function')
                return log.error('Unknown history function "',message.funcName,'". Message object: ',message);

            //log.debug('Executing history function ',msg.funcName,'. Message object: ',msg);
            return functions[message.funcName](message.id, message.parameters, callback);
        }

        if (message.type === 'initParameters') {
            var sleepTime = message.data.__restart ? 2000 : 0;
            return setTimeout(function () {
                cache.init(message.data, function (err) {
                    if (err) log.error('History init error: ', err.message, '; init parameters: ', message.data);

                    // init houseKeeper at 30 minutes after start every 1 hour
                    housekeeper.run();
                    log.info('Init housekeeper for run every ', message.data.housekeeperInterval / 1000, 'sec');
                    setInterval(function () {
                        housekeeper.run();
                    }, message.data.housekeeperInterval);

                    initScheduledRestart();

                    // starting IPC after all history functions are initializing
                    log.info('Starting history storage IPC...');
                    parameters.id = 'history';
                    new IPC.server(parameters, function(err, msg, socket, messageCallback) {
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
        // dumping data two times for save data when server terminated by stop timeout
        if(restartMode) {
            var myLog = log.warn;
            cache.cacheServiceIsRunning(1);
        } else {
            myLog = log.exit;
        }

        myLog('Stopping history storage service...');
        cache.terminateHousekeeper = true;

        cache.dumpData(function() {
            if(!restartMode) {
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
                cache.dumpData(function() {
                    myLog('History server is stopped');
                    callback();
                }, restartMode);
            });
        }, restartMode);
    }

    function initScheduledRestart() {
        parameters.restartHistoryInterval = Number(parameters.restartHistoryInterval);

        if(parameters.restartHistoryInterval === parseInt(String(parameters.restartHistoryInterval), 10) &&
            parameters.restartHistoryInterval > 0
        ) {
            if(parameters.restartHistoryInterval < parameters.cacheServiceInterval * 1.5) {
                log.warn('Restart history time interval is too small (', parameters.restartHistoryInterval,
                    ' sec). Setting restart history time interval to ', parameters.cacheServiceInterval * 1.5, 'sec');
                parameters.restartHistoryInterval = parameters.cacheServiceInterval * 1.5;
            }

            log.info('Initializing scheduled restart history storage process every ', parameters.restartHistoryInterval, 'sec');
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

                if(cache.cacheServiceIsRunning() === 1) {  // 1 mean that scheduled restart in progress
                    log.warn('The previous scheduled restart time of the history storage process has expired. Restart now...');
                    cache.terminateCacheService();
                } else if(cache.cacheServiceIsRunning()) { // cache service is running now
                    log.info('It is planned to restart history storage after the end of the cache maintenance...');
                } else { // cache service is not running now
                    log.info('Saving data from cache to history storage before restart...')
                    cache.startCacheService();
                }

                restartMode = true;
                cache.cacheServiceIsRunning(1); // 1 mean that restart occurred
                if(!parameters.restartHistory && parameters.restartStorageModifier) {
                    storage.restartStorageModifierProcess(function(err) {
                        if(err) {
                            log.error('Error while restarting storage modifier process: ' + err.message);
                            historyProcess.stop(12); // exitCode: process.exit(12)
                            return;
                        }

                        setTimeout(function() {
                            cache.cacheServiceIsRunning(0);
                            cache.terminateCacheService(0);
                            restartMode = false;
                            cache.terminateHousekeeper = 0;
                            log.warn('Unpause the cache service and the housekeeper');
                        }, 180000);
                    });
                }

                if(parameters.restartHistory) historyProcess.stop(12); // exitCode: process.exit(12)

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

    return avgRecords;
}