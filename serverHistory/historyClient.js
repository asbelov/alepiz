/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
/**
 * Created by Alexander Belov on 16.10.2016.
 */

const log = require('../lib/log')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const historyGet = require('./historyFunctionsGet');
const functions = require('./historyFunctions');
const countersDB = require('../models_db/countersDB');
const Conf = require('../lib/conf');
const connectToRemoteNodes = require("../lib/connectToRemoteNodes");
const parameters = require('./historyParameters');
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());

// used for historyFunction in history.get() for getting historical data
historyGet.initFunctions(getByIdx, getByTime);

var history = {
    getByIdx: getByIdx,
    getByTime: getByTime,
    getLastValues: getLastValues,
};
module.exports = history;

var clientIPC,
    allClientIPC = new Map(),
    connectionInitialized = false,
    usedToSaveDataToHistory = false;
var dontKeepHistoryOCIDs = new Set();

/** Don't send data to history when keepHistory = 0.
 * For this we get getKeepHistoryAndTrends from database and define the global
 * Set dontKeepHistoryOCIDs(<OCID with keepHistory = 0>) for all keepHistory = 0 counters
 * every parameters.reloadKeepHistoryInterval time interval.
 * @return void
 */
function getHouseKeeperData() {
    if (!usedToSaveDataToHistory) return;
    countersDB.getKeepHistoryAndTrends(function (err, rows) {
        if (err) return log.error('Can\'t get information about data keeping period');

        dontKeepHistoryOCIDs.clear();
        rows.forEach(function (row) {
            if (row.history === 0) dontKeepHistoryOCIDs.add(row.OCID);
        });

        setTimeout(getHouseKeeperData, parameters.reloadKeepHistoryInterval);
    });
}

/** Connect to history. If already connected, callback will be called without connection procedure
 *
 * @param {string|null} id the name of the connected services to identify in the log file
 * @param {function(void)} callback on connect return callback(). Error is not returned.
 * @param {Boolean} [dontConnectToRemoteInstances=false] if true, then not connect to remote Alepiz instances.
 *  used in server for history.add()
 */
history.connect = function(id, callback, dontConnectToRemoteInstances = false) {
    if(connectionInitialized) return callback();

    if(id) {
        parameters.separateStorageByProcess = false;
        parameters.suffix = '-' + id;
    }

    new IPC.client(parameters, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
        if (_clientIPC) {
            clientIPC = _clientIPC;
            log.info('Initialized connection to the history server: ',
                parameters.serverAddress, ':', parameters.serverPort);

            if(dontConnectToRemoteInstances) {
                allClientIPC.set(parameters.serverAddress + ':' + parameters.serverPort, clientIPC);
                return callback();
            }

            connectToRemoteNodes('history', (id || ''),function (err, _allClientIPC) {
                if(!_allClientIPC) {
                    log.warn('No remote nodes specified for history');
                    _allClientIPC = new Map();
                }
                _allClientIPC.set(parameters.serverAddress + ':' + parameters.serverPort, clientIPC);
                allClientIPC = _allClientIPC;
                connectionInitialized = true;
                callback();
            });
        }
    });
};

history.getSocketStatus = function() {
    var socketStatus = {};
    allClientIPC.forEach((clientIPC, hostPort) => {
        socketStatus[hostPort] = clientIPC.getSocketStatus();
    });

    return socketStatus;
}

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
        history[tmp_funcName] = function (/* (id, parameter1, parameter2, ..., callback) */) {
            var args = Array.prototype.slice.call(arguments); // create array from objects of arguments
            //log.warn('!!!!func: ', args)
            if(!args || args.length < 2) {
                return log.error('Try to run function with name "', tmp_funcName, '" with unexpected parameters "',
                    args, '"');
            }

            var id = args.shift();
            var callback = args.pop();
            //if(id === 155362) log.warn('!!!func: ', id, ': ', tmp_funcName, '(', args.join(', '), ')');

            if (typeof callback !== 'function')
                return log.error('Error getting value of the function ', tmp_funcName, '(', args,
                    ') for object ', id, ' from history: callback is not a function');

            if (Number(id) !== parseInt(id, 10) || !Number(id))
                return callback(new Error('Try to run function ' + tmp_funcName + '(' + args.join(', ') +
                    ') for object in history with not integer objectCounterID: ' + id));
            functions[tmp_funcName](Number(id), args, callback);
        }
    })(funcName);
}

/** Returning list of all history functions. Can be used without history.connect
 * @returns {array} - return array of objects [{name: ..., description:...}, {}, ...]
 */
history.getFunctionList = function() { return functionsArray; };

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
 * @returns {{value: null|number|string|boolean|undefined, timestamp: number}|undefined} - will return the stored value
 * {timestamp:…, value:…} or undefined on error
 */
history.add = function(initID, data) {
    log.debug('history.add(initID: ', initID, ', data: ', data, ')', {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": initID
            }
        });
    // don't add empty value
    if(data === undefined || data === null) return;

    // checking for correct OCID
    var id = Number(initID);
    if(id !== parseInt(String(id), 10) || id < 1) {
        log.error('Try to add data to history for not unsigned integer objectCounterID: ', initID, ', data: ', data);
        return;
    }

    var record = {}, value = data, now = Date.now();
    if(typeof data === 'object') {
        // data is a prepared history record {timestamp:..., value:...}
        if(data.timestamp && 'value' in data) {
            value = data.value;
            // don't add empty value
            if(value === undefined || value === null || (typeof value === 'object' && !Object.keys(value).length)) {
                return;
            }

            // checking timestamp
            var timestamp = Number(data.timestamp);
            if(!timestamp || timestamp !== parseInt(String(timestamp), 10) ||
                timestamp < 1477236595310 || timestamp > now + 60000) { // 1477236595310 = 01/01/2000
                log.warn('Try to add data to history with invalid timestamp or very old timestamp or timestamp ' +
                    'from a future for id: ', id, '; data: ', data, '; now: ', now, '; now - timestamp = ', now - timestamp);
                timestamp = now;
            }

            record = {
                timestamp: timestamp,
                data: typeof value === 'object' ? JSON.stringify(value) : value,
            }
        } else {
            if(!Object.keys(data).length) return;
            // stringify object and add to the history
            record = {
                timestamp: now,
                data: JSON.stringify(data), // do stringify once and here and skip stringify on server side
            }
        }
    } else if( typeof data === 'number' || typeof 'data' === 'string' || typeof data === 'boolean') {
        record = {
            timestamp: now,
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
    if(!dontKeepHistoryOCIDs.has(id)) {
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
 * @param {function(Error)|function()} callback - callback(err)
 */
history.del = function(IDs, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error deleting object ',IDs,' from history: callback is not a function');
    }
    if(!Array.isArray(IDs)) {
        return callback(new Error('Try to delete data objects from history with not an array objects IDs'));
    }

    if(!IDs.length) return callback();

    allClientIPC.forEach(clientIPC => {
        if(!clientIPC.isConnected()) return;

        clientIPC.sendExt({
            msg: 'del',
            IDs: IDs
        }, {
            dontSaveUnsentMessage: true,
        })
    });

    callback();
};

/** Get last value for specified history IDs (OCIDs)
 *
 * @param {array} IDs - array of history IDs (OCIDs)
 * @param {function(null, object)|function(Error): void} callback - called when done. Return Error or records
 * with last values for IDs like
 * {id1: {timestamp:..., data:..., err:...}, id2: {timestamp:..., data:..., err:...}, ....}
 */
function getLastValues(IDs, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error getting last values for objectsCountersIDs ', IDs,
            ' from history: callback is not a function');
    }

    if(typeof IDs === 'number') IDs = [IDs];
    if(!Array.isArray(IDs)) {
        return callback(new Error('Try to get data by function "getLastValues" ' +
            'when objectCounterIDs is not an array: ' + IDs));
    }

    var results = {};
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        clientIPC.sendExt( {
            msg: 'getLastValues',
            IDs: IDs,
        }, {
            sendAndReceive: true,
            dontSaveUnsentMessage: true,
        }, function(err, result) {
            if(err) log.warn('Can\'t get last values from ', hostPort, ': ', err.message)

            if(typeof result === 'object' && Object.keys(result).length) {
                for(var id in result) {
                    if(result[id] && result[id].timestamp) results[id] = result[id];
                }
            }

            callback();
        });
    }, function() {
        callback(null, results);
    });
}

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
function getByIdx (id, offset, cnt, maxRecordsCnt, callback) {

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
    var results = [], isGotAllRequiredRecords;
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        if(!clientIPC.isConnected()) return callback();

        clientIPC.sendExt({
            msg: 'getByIdx',
            id: Number(id),
            last: Number(offset),
            cnt: Number(cnt),
            maxRecordsCnt: Number(maxRecordsCnt),
            recordsType: 0,
        }, {
            sendAndReceive: true,
            dontSaveUnsentMessage: true,
        }, function (err, result) {
            log.debug(hostPort, ': getByIdx(id: ', id, ', offset: ', offset, ', cnt: ', cnt,
                ', maxRecordsCnt: ', maxRecordsCnt, '): result: ', result, ', err: ', err, {
                expr: '%:RECEIVED_OCID:% == %:OCID:%',
                vars: {
                    "RECEIVED_OCID": id
                }
            });

            if (err && !result) {
                log.warn('Can\'t getByIdx from ', hostPort, ': ', err.message);
                return callback();
            }
            if (!result) return callback();

            isGotAllRequiredRecords = isGotAllRequiredRecords === undefined ?
                Boolean(result.all) : isGotAllRequiredRecords && Boolean(result.all);
            // result.records is [{timestamp:, data:}, ...]
            Array.prototype.push.apply(results, result.records);
            callback();
        });
    }, function () {
        // sorted by ascending timestamp and
        // removing unnecessary elements from the records received from different instances
        results.sort((a, b) => a.timestamp - b.timestamp).splice(0, results.length - cnt);
        callback(null, results, isGotAllRequiredRecords);
    });
}

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
 * @param {function(null, array, isGotAllRequiredRecords: Boolean)|function(Error): void } callback -
 * called when done. Return Error or an array of records like [{timestamp:..., data:...}, {timestamp:..., data:...}, ...]
 * If all required records were found in the history, isGotAllRequiredRecords will be true. Otherwise false
 */
function getByTime (id, time, interval, maxRecordsCnt, callback) {

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

    var results = [], isGotAllRequiredRecords;
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        if(!clientIPC.isConnected()) return callback();

        clientIPC.sendExt( {
            msg: 'getByTime',
            id: Number(id),
            time: Number(time),
            interval: Number(interval),
            maxRecordsCnt: Number(maxRecordsCnt),
            recordsType: 0,
        }, {
            sendAndReceive: true,
            dontSaveUnsentMessage: true,
        }, function(err, result) {
            log.debug(hostPort, ': getByTime(id: ', id, ', time: ', time, ', interval: ', interval,
                ', maxRecordsCnt: ', maxRecordsCnt, '): result: ', result, ', err: ', err, {
                    expr: '%:RECEIVED_OCID:% == %:OCID:%',
                    vars: {
                        "RECEIVED_OCID": id
                    }
                });
            if (err && !result) {
                log.warn('Can\'t getByTime from ', hostPort, ': ', err.message);
                return callback();
            }
            if (!result) return callback();

            isGotAllRequiredRecords = isGotAllRequiredRecords === undefined ?
                Boolean(result.all) : isGotAllRequiredRecords && Boolean(result.all);
            // result.records is [{timestamp:, data:}, ...]
            Array.prototype.push.apply(results, result.records);
            callback();
        });
    }, function () {
        //sorted by ascending timestamp
        results.sort((a, b) => a.timestamp - b.timestamp);
        callback(null, results, isGotAllRequiredRecords);
    });
}

/** Tries to find the closest specified value in the history data for a specific history identifier (OCID) and return
 * the timestamp of the desired value
 *
 * @param {number} id - history ID (OCID)
 * @param {number|string} value - desired value
 * @param {function(null, timestamp: number)|function(Error): void } callback - called when done. Return Error or
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

    var minTimestamp;
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        if(!clientIPC.isConnected()) return callback();

        clientIPC.sendExt( {
        msg: 'getByValue',
        id: Number(id),
        value: value
        }, {
            sendAndReceive: true,
            dontSaveUnsentMessage: true,
        }, function(err, timestamp) {
            if(err) log.warn('Can\'t getByValue from ', hostPort, ': ', err.message);
            if(timestamp && (!minTimestamp || timestamp < minTimestamp)) minTimestamp = timestamp;
        });
    }, function () {
        callback(null, minTimestamp);
    });
};