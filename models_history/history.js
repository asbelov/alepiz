/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.10.2016.
 */

const path = require('path');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var parameters = require('../models_history/historyParameters');
var cache = require('../models_history/historyCache');
var functions = require('../models_history/historyFunctions');
var countersDB = require('../models_db/countersDB');

var history = {};
module.exports = history;

var clientIPC, truncateWatchDogInterval, restartInProgress = false, usedToSaveDataToHistory = false;
var houseKeeperData = {};

/** Skip to send data to history when keepHistory = 0.
 * For this set the global object houseKeeperData[<OCID with keepHistory = 0>] = 0
 * every <reloadKeepHistoryInterval> time.
 */
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

/** Connect to history. If already connected, callback will be called without connection procedure
 *
 * @param {string} id - name of connecting service for print name to the log file
 * @param {function(void)} callback - on connect return callback(). Error is not returned.
 */
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
                callback = null; // prevent run callback again on reconnect
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


/** Returning list of all history functions
 * @returns {array} - return array of objects [{name: ..., description:...}, {}, ...]
 */
history.getFunctionList = function() { return functionsArray; };

/** Starting history server and IPC system
 * @param {objects} initParameters - history parameters. Look into the historyParameters.js for default parameters
 * @param {function(Error):void} callback - Called when done
 */
history.start = function (initParameters, callback) {
    //parameters.init(initParameters);

    // if run history.start(), then clientIPC use proc IPC communication
    // for exchange messages to the parent process
    // in all other cases run history.connect() and use net IPC communication
    clientIPC = new proc.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'historyServer.js'),
        killTimeout: 1900000,
        restartAfterErrorTimeout: 10000,
        onStart: function(err) {
            if(err) return callback(new Error('Can\'t run history server: ' + err.message));
            //truncateWalWatchdog(parameters, callback);
            clientIPC.sendAndReceive({type: 'initParameters', data: initParameters}, function(err) {
                initParameters['__restart'] = true;
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

/** Dumps the cached historical data to a file before exiting.
 * The data from the dump file will be loaded into the cache on next startup
 * @type {function(callback, boolean): void}
 * @param {function(void): void} callback - Called when done
 * @param {boolean|undefined} [isScheduled=undefined] - the function is called when the history is scheduled to restart
 */
history.dump = cache.dumpData;

/** Set or get cacheServiceIsRunning variable
 *
 * @type {function(number|void): number}
 * @param {number|void} val - if val defined (must be a unix time), then set cacheServiceIsRunning variable to val. Else return cacheServiceIsRunning value
 */
history.cacheServiceIsRunning = cache.cacheServiceIsRunning;

/** Add new data to history storage and return value like {timestamp:…, value:…}
 *
 * @param {number} initID - object counter ID (OCID) will be set as a history ID
 * @param {object|?number|string|boolean|undefined} data - data to add to history.
 * Must be an object like {timestamp:…, value:…} or a simple value.
 * If no timestamp is set, a timestamp is created using Date.now().
 * If the timestamp is incorrect, then no data is added to the history and return undefined.
 * If the value is an object, JSON.stringify(value) runs before adding the value into history.
 * If the value is undefined or null then no value is added to history and return undefined.
 * @param {number} data.timestamp - timestamp of the value
 * @param {object|number|string|boolean} data.value - value. the JSON.stringify(value) will be applied if the value
 * type is object
 * @returns {{value: number|string|boolean, timestamp: number}|undefined} - will return the stored value
 * {timestamp:…, value:…} or undefined on error
 */
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

/** Remove data from history for specified history IDs (OCIDs)
 *
 * @param {array} IDs - array of history IDs (OCIDs) for remove
 * @param {function(Error): void} callback - called when done
 * @returns {void}
 */
history.del = function(IDs, callback){
    if(typeof callback !== 'function') return log.error('Error deleting object ',IDs,' from history: callback is not a function');
    if(!Array.isArray(IDs))
        return callback(new Error('Try to delete data objects from history with not an array objects IDs'));

    clientIPC.sendAndReceive( {
        msg: 'del',
        IDs: IDs
    }, callback);
};

/** Get last value for specified history IDs (OCIDs)
 *
 * @param {array} IDs - array of history IDs (OCIDs)
 * @param {function(null, object)|function(Error): void} callback - called when done. Return Error or records wit last values for IDs
 * like {id1: {err:..., timestamp:..., data:...}, id2: {err:..., timestamp:..., data:...}, ....}
 */
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

/** Get the specified amount of data from history for the specified history identifier (OCID)
 *
 * @param {number} id - history ID (OCID)
 * @param {number} offset - offset from last value in history
 * @param {number} cnt - the number of values from history to get
 * @param {number} maxRecordsCnt - the maximum number of values from history that can be obtained.
 * If more values are obtained, the values will be obtained from trends or averaged.
 * @param {function(null, array)|function(Error): void } [callback] - called when done. Return Error or an array of records like
 * [{timestamp:..., data:...}, {timestamp:..., data:...}, ...]
 */
history.getByIdx = function(id, offset, cnt, maxRecordsCnt, callback){

    if(typeof callback !== 'function') {
        return log.error('Error getting value for object ',id,' by index from history: callback is not a function');
    }
    if(Number(id) !== parseInt(String(id), 10) || !Number(id)) {
        return callback(new Error('Try to get data by function "getByIdx" for object from history with not ' +
            'integer objectCounterID: '+id));
    }
    if(Number(offset) !== parseInt(String(offset), 10) || Number(offset) < 0) {
        return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer ' +
            '"offset" parameter: '+offset));
    }
    if(Number(cnt) !== parseInt(String(cnt), 10) || Number(cnt) < 1) {
        return callback(new Error('Try to get data by function "getByIdx" for object from history with not integer ' +
            '"cnt" parameter: '+cnt));
    }

    clientIPC.sendAndReceive( {
        msg: 'getByIdx',
        id: Number(id),
        last: Number(offset),
        cnt: Number(cnt),
        maxRecordsCnt: Number(maxRecordsCnt),
        recordsType: 0,
    }, callback);
};

/** Get data from history for a specified time for a specified history identifier (OCID)
 *
 * @param {number} id - history ID (OCID)
 * @param {number} time - timestamp (since 1970 in ms) - "time from". <interval> will also be a timestamp and can be
 * interpreted as "time to" or a time interval from <time> parameter. Or time in ms from the last record. In this case
 * <interval> is a time interval in ms from <time>
 * @param {number} interval - depending on the <time> parameters can be interpreted as "time to" or a time interval
 * from <time> parameter
 * @param {number} maxRecordsCnt - the maximum number of values from history that can be obtained.
 * If more values are obtained, the values will be obtained from trends or averaged.
 * @param {function(null, array)|function(Error): void } callback - called when done. Return Error or an array of records like
 * [{timestamp:..., data:...}, {timestamp:..., data:...}, ...]
 */
history.getByTime = function(id, time, interval, maxRecordsCnt, callback){

    if(Number(maxRecordsCnt) !== parseInt(String(maxRecordsCnt), 10)) {
        return callback(new Error('Try to get data by function "getByTime" for object from history with not ' +
            'integer "maxRecordsCnt" parameter: '+maxRecordsCnt));
    }
    if(typeof callback !== 'function') {
        return log.error('Error getting value for object ',id,' by time from history: callback is not a function');
    }
    if(Number(id) !== parseInt(String(id), 10)) {
        return callback(new Error('Try to get data by function "getByTime" for object from history with not integer ' +
            'objectCounterID: '+id));
    }
    if(Number(time) !== parseInt(String(time), 10)) {
        return callback(new Error('Try to get data by function "getByTime" for object from history with not integer ' +
            '"time" parameter: '+time));
    }
    if(Number(interval) !== parseInt(String(interval), 10)) {
        return callback(new Error('Try to get data by function "getByTime" for object from history with not integer ' +
            '"interval" parameter: '+interval));
    }

    clientIPC.sendAndReceive( {
        msg: 'getByTime',
        id: Number(id),
        time: Number(time),
        interval: Number(interval),
        maxRecordsCnt: Number(maxRecordsCnt),
        recordsType: 0,
    }, callback);
};

/** Tries to find the closest specified value in the history data for a specific history identifier (OCID) and return
 * the timestamp of the desired value
 *
 * @param {number} id - history ID (OCID)
 * @param {number|string} value - desired value
 * @param {function(null, number)|function(Error): void } callback - called when done. Return Error or
 * timestamp for desired value
 */
history.getByValue = function(id, value, callback){
    if(typeof callback !== 'function') {
        return log.error('Error getting timestamp for object ',id,' by value from history: callback is not a function');
    }
    if(Number(id) !== parseInt(String(id), 10) || !Number(id)) {
        return callback(new Error('Try to get timestamp by function "getByValue" for object from history with not ' +
            'integer objectCounterID: '+id));
    }
    if((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'undefined' ) {
        return callback(new Error('Try to get timestamp by function "getByValue" for object from history with ' +
            'undefined or not number or not string value parameter: '+ JSON.stringify(value)));
    }

    clientIPC.sendAndReceive( {
        msg: 'getByValue',
        id: Number(id),
        value: value
    }, callback);
};
