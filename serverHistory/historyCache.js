/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.09.2016.
 */

const fs = require('fs');
const async = require('async');
const path = require('path');

const log = require('../lib/log')(module);
const storage = require('./historyStorage');
const countersDB = require('../models_db/countersDB'); // for init housekeeper
const parameters = require('./historyParameters');
const Conf = require("../lib/conf");
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());


var historyCache = {};
module.exports = historyCache;

/**
 * historical object ID (OCID)
 * @typedef OCID
 * @type number
 */
 /**
  * object with historical records and system data
  * @typedef cacheObj
  * @type Object
  * @property {number} savedCnt the number of records stored in the database but in the cache
  * @property {number} cachedRecords the number of records to have in the cache.
  *     In reality, there may be fewer entries in the cache
  * @property {historicalRecord|undefined} firstValue first record in the cache
  * @property {historicalRecord|undefined} lastValue last record in the cache
  * @property {Set<historicalRecord>|Set<>} records a Set of records sorted by timestamp.
  *     Not an array, because it slows down the cache
 */
/**
 * Historical record in the cache or database
 * @typedef historicalRecord
 * @type object
 * @property {number} timestamp record timestamp in ms
 * @property {number|string} data historical data
 */
/**
 * Cached historical records
 * @type {Map<OCID, cacheObj>}
 */
var cache = new Map();
var dumpPath = path.join(__dirname, '..', parameters.tempDir, parameters.dumpFileName);
var cacheServiceIsRunning = 0;
var terminateCacheService = 0;
var cacheServiceCallback = null;
var recordsFromCacheCnt = 0;
var recordsFromStorageCnt = 0;
var historyAddOperationsCnt = 0;

historyCache.terminateHousekeeper = false;

/*
load unsaved data from dump files
load records to cache from storage
starting cache service for save data to storage
 */
historyCache.init = function (callback) {

    terminateCacheService = 0;
    cacheServiceIsRunning = 0;

    loadDataFromDumpToCache(dumpPath, function(err) {
        if(err) return callback(err); // only if can\'t close dump file

        storage.initStorage(function(err) {
            if(err) return callback(err);

            setInterval(cacheService, parameters.cacheServiceInterval * 1000); // sec
            setTimeout(printHistoryInfo, 30000);

            callback();
        });
    });

    function printHistoryInfo() {
        historyCache.getTransactionsQueueInfo(function (err, transQueue) {
            log.info('Records returned from cache\\storage: ', recordsFromCacheCnt, '\\', recordsFromStorageCnt,
                '; new: ', historyAddOperationsCnt,
                '; transaction queue: ', transQueue.len,
                (transQueue.timestamp ?
                    ', last transaction started at ' + (new Date(transQueue.timestamp)).toLocaleString()  +
                    '(' + transQueue.description + ')' :
                    ', no transaction in progress'));

            recordsFromCacheCnt = recordsFromStorageCnt = 0;
            historyAddOperationsCnt = 0;
            setTimeout(printHistoryInfo, 40000);
        });
    }
};

historyCache.getDBPath = storage.getDbPaths;

historyCache.startCacheService = cacheService;

historyCache.addCallbackToCacheService = function (callback) {
    cacheServiceCallback = callback;
}

/** Set or get cacheServiceIsRunning variable
 *
 * @param {number} [val] - if val defined (must be a unix time), then set cacheServiceIsRunning variable to val.
 *  Else return cacheServiceIsRunning value
 *  @return {number} cacheServiceIsRunning value
 */
historyCache.cacheServiceIsRunning = function(val) {
    if(val !== undefined) cacheServiceIsRunning = val;
    return cacheServiceIsRunning;
}
historyCache.terminateCacheService = function (val) {
    if(cacheServiceIsRunning) log.exit('Terminating cache service');
    terminateCacheService = val === undefined ? 1 : val;
};

function loadDataFromDumpToCache(dumpPath, callback) {

    log.info('Loading unsaved data to cache from dump file ', dumpPath, '...');

    fs.open(dumpPath, 'r', function(err, fd) {
        if(err) {
            log.info('Can\'t open file for read data from dump file ' + dumpPath + ': ' + err.message);
            return callback();
        }

        fs.readFile(fd, 'utf8', function (err, data) {
            if (err) {
                log.warn('Can\'t read data from dump file ' + dumpPath + ': ' + err.message);
                return callback();
            }

            fs.close(fd, function (err) {
                if (err) return callback(new Error('Can\'t close dump file ' + dumpPath + ': ' + err.message));

                try {
                    var loadedCacheObj = JSON.parse(String(data));
                } catch (err) {
                    log.error('Can\'t parse dump data from ' + dumpPath + ' as JSON object: ' + err.message);
                    return callback();
                }

                if (!loadedCacheObj) return callback();

                var loadedRecords = 0, unsavedRecords = 0;
                for (var id in loadedCacheObj) {
                    if (loadedCacheObj[id]) {
                        var records = loadedCacheObj[id].records;
                        if (Array.isArray(records) && records.length) {
                            loadedCacheObj[id].firstValue = records[0];
                            loadedCacheObj[id].lastValue = records[records.length - 1];
                            loadedCacheObj[id].records = new Set(records);
                            cache.set(Number(id), loadedCacheObj[id]);
                            loadedRecords += loadedCacheObj[id].records.size;
                            unsavedRecords += loadedCacheObj[id].records.size - loadedCacheObj[id].savedCnt;
                        }
                    }
                }

                if (!loadedRecords) {
                    log.info('Dump has no records for cache');
                    return callback();
                }

                log.info('Loaded ', loadedRecords, ' records including ', unsavedRecords,' unsaved records for ',
                    cache.size,' objects.');
                callback();
            })
        });
    });
}

function createNewCacheObject(id) {
    cache.set(Number(id), {
        cachedRecords: Number(parameters.initCachedRecords),
        savedCnt: 0,
        records: new Set(),
        //firstValue: undefined,
        //lastValue: undefined,
    });
}

/**
 * add new record to the end of cache. cache mast be always sorted by record.timestamp
 *
 * @param {number} id OCID - new data ID
 * @param {Object} newRecord new record {timestamp: ..., data: ...}
 * @param {number} newRecord.timestamp new record timestamp
 * @param {number|string|boolean} newRecord.data new record data
 */
historyCache.add = function (id, newRecord){
    // the record was checked on the client side using the history.add () function

    //log.debug('Adding data to history: id ', id, ' newRecord: ', newRecord);
    id = Number(id);
    ++historyAddOperationsCnt;

    // There is no data about the object in the cache, we create a new one
    if(!cache.has(id)) {
        createNewCacheObject(id);
        let cacheObj = cache.get(id);
        cacheObj.records.add(newRecord);
        cacheObj.firstValue = cacheObj.lastValue = newRecord;
    } else {
        let cacheObj = cache.get(id);
        if(!cacheObj.records.size || (cacheObj.lastValue && cacheObj.lastValue.timestamp <= newRecord.timestamp)) {
            // There is an object in the cache, but without historical data,
            // or the last timestamp is less than the one that is being added.
            // Therefore, additional sorting of data in the cache is not required

            cacheObj.records.add(newRecord);
            cacheObj.lastValue = newRecord;
            if(cacheObj.records.size === 1) cacheObj.firstValue = newRecord;
        } else {
            // There is historical data for the object in the cache
            // but the last timestamp is less than what is being added.
            // We need to sort the data by timestamp. Set does not allow sorting data.
            // We make an array, sort it and create a new Set from the sorted array

            var recordsArray = Array.from(cacheObj.records);
            recordsArray.push(newRecord)
            recordsArray.sort((a, b) => a.timestamp - b.timestamp);
            cacheObj.records = new Set(recordsArray);
            cacheObj.firstValue = recordsArray[0];
            cacheObj.lastValue = recordsArray[recordsArray.length - 1];
        }
    }

    //log.debug('Inserting newRecord for new object to history. id: ', id, ' newRecord: ', newRecord);
};

/**
 * removing history for specific object
 * @param {Array} IDs array of object IDs
 * @param {number} daysToKeepHistory number of days to keep history
 * @param {number} daysToKeepTrends number of days to keep trends
 * @param {function(Error)|function(void)} [callback] callback(err)
 */
historyCache.del = function (IDs, daysToKeepHistory, daysToKeepTrends, callback){

    if(!daysToKeepHistory) {
        var lastTimeToKeepHistory = 0;
        //log.info('Removing objects from history: ', IDs);
    } else {
        var now = new Date();
        lastTimeToKeepHistory = new Date(now.setDate(now.getDate() - daysToKeepHistory)).getTime();
    }

/*
    savedCnt = 3
    0      1      2      3      4
    12.10  13.10  14.10  15.10  16.10
    lastTimeToKeepHistory = 14.10
    recordsToDelete = 2
    3      4
    15.10  16.10
    savedCnt = 3 - 2 = 1
 */

    storage.delRecords(IDs, daysToKeepHistory, daysToKeepTrends, function (err) {
        if(err) {
            if(typeof callback === 'function') return callback(err);
            else return log.error(err.message);
        }

        // remove records from cache after commit transaction
        IDs.forEach(function (id) {
            id = Number(id);
            var cacheObj = cache.get(id);
            if(cacheObj && cacheObj.records) {
                if (!daysToKeepHistory) {
                    cache.delete(id)
                } else {
                    // save all records if the time of the first record is longer than the storage time of the records
                    if(!cacheObj.records.size ||
                        (cacheObj.firstValue && cacheObj.firstValue.timestamp > lastTimeToKeepHistory)) return;

                    // remove all records if the time of the last record is less than the storage time of the records
                    if (cacheObj.lastValue && cacheObj.lastValue.timestamp < lastTimeToKeepHistory) {
                        cacheObj.records.clear();
                        delete cacheObj.firstValue;
                        delete cacheObj.lastValue;
                        cacheObj.savedCnt = 0;
                        return;
                    }

                    // find records for removing the record time longer then the storage time of the records
                    // was for array: cacheObj.records.splice(0, recordsNumToDelete);
                    for(var record of cacheObj.records) {
                        // delete record with timestamp less than lastTimeToKeepHistory
                        if(record.timestamp < lastTimeToKeepHistory) {
                            cacheObj.records.delete(record);
                            --cacheObj.savedCnt;
                        } else {
                            // it is possible to define new firstTimestamp and break because the records were
                            // sorted by timestamp
                            cacheObj.firstValue = record;
                            break;
                        }
                    }

                    if(cacheObj.records.size === 0) {
                        delete cacheObj.firstValue
                        delete cacheObj.lastValue;
                        cacheObj.savedCnt = 0;
                    }
                    if(cacheObj.savedCnt < 0) cacheObj.savedCnt = 0;
                }
            }
        });

        if(typeof callback === 'function') callback();
    });
};

historyCache.getByValue = function(id, value, callback) {
    if(typeof callback !== 'function') {
        return log.error('[getByValue]: callback is not a function', (new Error()).stack);
    }

    id = Number(id);
    if(id !== parseInt(String(id), 10) || !id) {
        return callback(new Error('[getByValue] incorrect object ID '+id));
    }

    if(!isNaN(parseFloat(value)) && isFinite(value)) value = Number(value);

    var cacheObj = cache.get(id);
    if(cacheObj && cacheObj.records && cacheObj.records.size) {
        var requiredTimestamp = 0;
        cacheObj.records.forEach(record => {
            if (record.data === value && (!requiredTimestamp || requiredTimestamp >  record.timestamp) ) {
                requiredTimestamp = record.timestamp;
            }
        });

        if(requiredTimestamp) return callback(null, requiredTimestamp);
    }

    storage.getLastRecordTimestampForValue(id, value, callback);
};


/*
    get last values for IDs. Will continue getting last values even if error occurred

    IDs: array of object IDs
    callback(err, records), where
    err: new Error(errors.join('; '))
    records: {id1: {err:..., timestamp:..., data:...}, id2: {err:.., timestamp:..., data:..}, ....}
 */

historyCache.getLastValues = function(IDs, callback) {
    if(typeof callback !== 'function') {
        return log.error('[getLastValues]: callback is not a function', (new Error()).stack);
    }

    var lastValues = {}, errors = [];
    async.each(IDs, function (id, callback) {
        if(lastValues[id]) return callback();

        lastValues[id] = {};
        getLastValue(id,function (err, record/*, isGotAllRequiredRecords*/) {
            if(err) {
                if(!historyCache.terminateHousekeeper) {
                    log.warn('Can\'t get last value for ', id, ': ', err.message);
                }
                lastValues[id].err = err;
                errors.push(id + ': ' + err.message);
            }

            //log.debug('Value for ', id, ': ', record, '; err: ', err);

            if(record) {
                lastValues[id].timestamp = record.timestamp;
                lastValues[id].data = record.data;
            }
            callback();
        });
    }, function () {
        callback(errors.length ?  new Error(errors.join('; ')) : null, lastValues);
    });
}

function getLastValue (id, callback) {
    if(typeof callback !== 'function') {
        return log.error('[getLastValue]: callback is not a function: ', (new Error()).stack);
    }

    id = Number(id);
    var cacheObj = cache.get(id);

    if(cacheObj && cacheObj.lastValue) {
        //log.info('Get last value for ', id,' from history cache: ', cacheObj.lastValue);
        ++recordsFromCacheCnt;
        return callback(null, cacheObj.lastValue, true);
    }

    if(!cacheObj) {
        createNewCacheObject(id);
        cacheObj = cache.get(id);
    }
    storage.getRecordsFromStorageByIdx(id, 0, 1, 0, 0, 0, function(err, recordsFromStorage) {
        if (err) return callback(err);
        if(!Array.isArray(recordsFromStorage) || !recordsFromStorage.length) {
            //log.info('Can\'t get last value for ', id,' from history cache: ', cacheObj, ' and storage ', recordsFromStorage);
            return callback(null, null, false);
        }

        recordsFromStorageCnt += recordsFromStorage.length;
        calculateCacheSize(cacheObj, recordsFromStorage);

        // add received record to the cache
        if(!cacheObj.records.size) {
            cacheObj.records.add(recordsFromStorage[0]);
            cacheObj.savedCnt = 1;
            cacheObj.lastValue = cacheObj.firstValue = recordsFromStorage[0];
        }
        //log.info('Get last value for ', id,' from history storage: ', recordsFromStorage[0]);
        callback(null, recordsFromStorage[0], true);
    });
}
/*
    get requested records by position

    id: object ID
    offset: record position from the end of the storage, 0 - last element
    cnt: count of the requirement records from the last position. 0 - only one element with a 'last' position
    callback(err, records, isGotAllRequiredRecords(true|false)), where records: [{data:.., timestamp:..}, ....]

 */
historyCache.getByIdx = function(id, offset, cnt, maxRecordsCnt, recordsType, callback) {
    if(typeof callback !== 'function') {
        return log.error('[getByIdx]: callback is not a function: ', (new Error()).stack);
    }

    if(recordsType === undefined) recordsType = 0;
    offset = Number(offset); cnt = Number(cnt); id = Number(id);
    if(cnt === 0) return callback(null, [], false);
    if(Number(id) !== parseInt(String(id), 10) || !id) {
        return callback(new Error('[getByIdx] incorrect object ID '+id));
    }
    if(Number(offset) !== parseInt(String(offset), 10) || offset < 0) {
        return callback(new Error('[getByIdx] incorrect "offset" parameter ('+offset+') for objectID '+id));
    }
    if(Number(cnt) !== parseInt(String(cnt), 10) || cnt < 1) {
        return callback(new Error('[getByIdx] incorrect "cnt" parameter ('+cnt+') for objectID '+id));
    }

    var cacheObj = cache.get(id);

    if(cacheObj && cacheObj.records && cacheObj.records.size) {
        var recordsArray = Array.from(cacheObj.records);
        var recordsFromCache =
            recordsArray.slice( -(offset + cnt), offset ? -offset : cacheObj.records.size);
        recordsFromCacheCnt += recordsFromCache.length;

        if(recordsFromCache.length === cnt) {
            calculateCacheSize(cacheObj, 0, recordsFromCache);
            return callback(null, recordsFromCache, true);
        }
    } else {
        recordsFromCache = [];
        // create new cache object cache[id] and make reference cacheObj = cache[id]
        createNewCacheObject(id);
        // since we are creating a new object, we need to get it from the Set again
        cacheObj = cache.get(id);
        // do not use parameters.initCachedRecords because you will read only 'cnt' records to the cache
        cacheObj.cachedRecords = cnt;
    }

    // set the cnt equal to the initial cnt minus the number of already found records in the cache
    var storageCnt = cnt - recordsFromCache.length;
    /*
    don’t use the offset and look for the record according to the last timestamp taken from the last cache record,
    because the storage can be modified during the sending of the query and then the offset will be impossible to
    calculate

    Query will be
    SELECT .. WHERE timestamp < $storageTimestamp ORDER BY timestamp DESC LIMIT $storageCnt OFFSET $storageOffset

    Found several values in the cache. Set timestamp equal to the last timestamp of found value in the cache and
    offset to 0 and begin to search in the database
    */
    if(recordsFromCache.length) {
        var storageTimestamp = recordsFromCache[0].timestamp;
        var storageOffset = 0;
    } else {
        /*
        If we did not find anything in the cache, but the cache is not empty. Set the timestamp equal to the timestamp
        of the last record in the cache and offset equal to the initial offset minus number of records in the cache
        and begin to search in the database
         */
        if(cacheObj.records.size && cacheObj.firstValue) {
            storageTimestamp = cacheObj.firstValue.timestamp;
            storageOffset = offset - cacheObj.records.size;
        } else { // when cache is empty start to search in the database with initial offset and cnt
            storageTimestamp = null;
            storageOffset = offset;
        }
    }

    storage.getRecordsFromStorageByIdx(id, storageOffset, storageCnt, storageTimestamp, maxRecordsCnt, recordsType,
        function(err, recordsFromStorage) {
        if (err) return callback(err);
        if(!Array.isArray(recordsFromStorage) || !recordsFromStorage.length) {
            return callback(err, recordsFromCache, false);
        }

        recordsFromStorageCnt += recordsFromStorage.length;
        calculateCacheSize(cacheObj, recordsFromStorage);

        Array.prototype.push.apply(recordsFromStorage, recordsFromCache);
        if(recordsFromStorage.length) {
            recordsFromStorage[0].recordsFromCache = recordsFromCache.length;
        }
        callback(null, recordsFromStorage, true);
    });
};

/*
    get requested records by time

    id: object ID
    timeShift and timeInterval:
        1. timeShift - timestamp (from 1970 in ms) - "time from". timeInterval can be a timestamp too, and it is interpretable as "time to" or time interval from "time from"
        2. timeShift - time in ms from last record. timeInterval - time interval in ms from timeShift
    callback(err, records, isGotAllRequiredRecords(true|false)), where records: [{data:.., timestamp:..}, ....]
 */
historyCache.getByTime = function (id, timeShift, timeInterval, maxRecordsCnt, recordsType, callback) {
    //log.debug('[getByTime]: ',id, ', ', timeShift, ', ', timeInterval, ', ', maxRecordsCnt);
    if (typeof callback !== 'function') {
        return log.error('[getByTime]: callback is not a function', (new Error()).stack);
    }

    // return last value
    if (timeInterval === 0) return historyCache.getByIdx(id, 0, 1, 0, 0, callback);

    if (recordsType === undefined) recordsType = 0;
    id = Number(id); timeShift = Number(timeShift); timeInterval = Number(timeInterval);
    if (id !== parseInt(String(id), 10) || !id) {
        return callback(new Error('[getByTime] incorrect ID ' + id));
    }

    if (timeShift !== parseInt(String(timeShift), 10) || timeShift < 0) {
        return callback(new Error('[getByTime] incorrect "timeShift" parameter (' + timeShift +
            ') for objectID ' + id));
    }

    if (timeInterval !== parseInt(String(timeInterval), 10) || timeInterval < 0) {
        return callback(new Error('[getByTime] incorrect "timeInterval" parameter (' + timeInterval +
            ') for objectID ' + id));
    }

    if (timeShift > 1477236595310) { // check for timestamp: 1477236595310 = 01/01/2000
        var timeFrom = timeShift;
        if (timeInterval > 1477236595310) var timeTo = timeInterval;
        else timeTo = timeFrom + timeInterval;
    } else {
        timeTo = Date.now() - timeShift;
        timeFrom = timeTo - timeInterval;
    }

    var cacheObj = cache.get(id);

    //log.debug('[getByTime]: ',id, ', ', timeFrom, ' - ', timeTo, ': ', cacheObj);
    /*
    id:         0  1  2  3   4  5  6  7   8  9  10 11
    timestamps: 10 14 17 19 |23 25 28 29| 33 35 37 42
    timeFrom=20, timeTo=31
     */
    var recordsFromCache = [];
    if (cacheObj && cacheObj.records && cacheObj.records.size && cacheObj.firstValue && cacheObj.lastValue) {
        // last record timestamp in cache less than required timestamp in timeFrom.
        // History have no data for required time interval
        if (timeFrom > cacheObj.lastValue.timestamp) {
            return callback(null, [], false);
        }

        // checking for present required records in cache.
        // timestamps: [10:00, 10:05, 10:10, 10:15, 10:20].
        // timeTo 10:05 - present;
        // timeTo 09:50 - not present in cache
        if (timeTo > cacheObj.firstValue.timestamp) {

            for (let record of cacheObj.records) {
                if (record.timestamp > timeFrom && record.timestamp < timeTo) {
                    recordsFromCache.push({
                        timestamp: record.timestamp,
                        data: record.data,
                    });
                    ++recordsFromCacheCnt;
                }
                if(record.timestamp >= timeTo) break;
            }
            if (recordsFromCache.length) {
                recordsFromCache[0].isDataFromTrends = false;
                recordsFromCache[0].recordsFromCache = recordsFromCache.length;
            }

            if (cacheObj.firstValue.timestamp <= timeFrom) {
                calculateCacheSize(cacheObj, 0, recordsFromCache);
                return callback(null, recordsFromCache, true);
            }
        }
    } else {
        // create new cache object cache[id] and make reference cacheObj = cache.get(id)
        createNewCacheObject(id);
        // since we are creating a new object, we need to get it from the Set again
        cacheObj = cache.get(id);
    }
    /*
    Use recordsFromCache[0].timestamp - 1 because the SQL BETWEEN operator is inclusive
    */
    var storageTimeTo = recordsFromCache.length ? recordsFromCache[0].timestamp - 1 : timeTo;
    storage.getRecordsFromStorageByTime(id, timeFrom, storageTimeTo, maxRecordsCnt, recordsType,
        function(err, recordsFromStorage) {
//            log.debug(id, ': !!! records form storage err: ', err, '; time: ', (new Date(timeFrom)).toLocaleString(), '-', (new Date(storageTimeTo)).toLocaleString(), ';', timeFrom,'-', storageTimeTo, ': ', recordsFromStorage);

            if (err) return callback(err);
            if (!Array.isArray(recordsFromStorage) || !recordsFromStorage.length) {
                return callback(err, recordsFromCache, false);
            }

            recordsFromStorageCnt += recordsFromStorage.length;

            var isDataFromTrends = recordsFromStorage.length ? recordsFromStorage[0].isDataFromTrends : false;

            if (!isDataFromTrends) {
                calculateCacheSize(cacheObj, recordsFromStorage);
            }

            if (recordsFromCache.length &&
                recordsFromStorage[recordsFromStorage.length-1].timestamp >= recordsFromCache[0].timestamp) {
                log.warn('Timestamp in last record from storage: ', recordsFromStorage[recordsFromStorage.length-1],
                    ' more than timestamp in first record from cache: ', recordsFromCache[0], '; storage: ...',
                    recordsFromStorage.slice(-5), '; cache: ', recordsFromCache.slice(0, 5), '...');

                var lastRecord = recordsFromStorage.pop(), firstCachedRecordTimestamp = recordsFromCache[0].timestamp;
                while(lastRecord && lastRecord.timestamp >= firstCachedRecordTimestamp) {
                    lastRecord = recordsFromStorage.pop();
                }
            }
            Array.prototype.push.apply(recordsFromStorage, recordsFromCache);
            if(recordsFromStorage.length) {
                recordsFromStorage[0].isDataFromTrends = isDataFromTrends;
                recordsFromStorage[0].recordsFromCache = recordsFromCache.length;
            }
            callback(null, recordsFromStorage, true);
    });
};

function calculateCacheSize(cacheObj, recordsFromStorage, recordsFromCache) {

    // if it was necessary to get records from the storage, add the number of received records from the storage
    //  plus 10% to the cache size
    if(recordsFromStorage && recordsFromStorage.length) {
        cacheObj.cachedRecords += recordsFromStorage.length + Math.round(recordsFromStorage.length / 10);
        return cacheObj.cachedRecords;
    }

    // TODO: change this algorithm
    // if all the necessary records were obtained from the cache, reduce the cache size by 10% of the number
    // of unnecessary records
    if(recordsFromCache && recordsFromCache.length && recordsFromCache.length < cacheObj.cachedRecords) {
        cacheObj.cachedRecords -= Math.round((cacheObj.cachedRecords - recordsFromCache.length) / 10);
        if(cacheObj.cachedRecords < parameters.initCachedRecords) cacheObj.cachedRecords = parameters.initCachedRecords;
        return cacheObj.cachedRecords;
    }

    return cacheObj.cachedRecords;
}

/** Saving history cache to database
 *
 * @param {function(Error)|function(): void} [callback] - call when done. Can return error
 */
function cacheService(callback) {
    if(cacheServiceIsRunning > 0 && cacheServiceIsRunning < 100) return;
    historyCache.getTransactionsQueueInfo(function (err, transQueue) {
        log.info('Saving cache data to database... Transaction queue length: ', transQueue.len,
            (transQueue.timestamp ?
                ', last transaction started at ' + (new Date(transQueue.timestamp)).toLocaleString() +
                '(' + transQueue.description + ')' :
                ', no transaction in progress')
        );

        if (typeof (callback) !== 'function') {
            callback = function (err) {
                if (err) log.error(err.message);
            }
        }

        if (cacheServiceIsRunning) {
            log.warn('Cache service was running at ', (new Date(cacheServiceIsRunning)).toLocaleString(),
                '. Prevent to start another copy of service');
            if (parameters.cacheServiceExitTimeout && Date.now() - cacheServiceIsRunning <
                parameters.cacheServiceExitTimeout) { // < 24 hours
                return callback();
            }

            log.exit('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() +
                '. It\'s too long. Something was wrong. Exiting...');
            log.disconnect(function () {
                process.exit(2)
            });
        }

        if (terminateCacheService) {
            log.warn('Received command for terminating cache service. Exiting');
            if (typeof cacheServiceCallback === 'function') {
                cacheServiceCallback(new Error('Cache service was terminated'));
                cacheServiceCallback = null;
            }
            return callback();
        }

        cacheServiceIsRunning = Date.now();

        /*
            SELECT objectsCounters.id AS OCID, counters.keepHistory AS history, counters.keepTrends AS trends
            FROM counters JOIN objectsCounters ON counters.id=objectsCounters.counterID
             */
        countersDB.getKeepHistoryAndTrends(function(err, rows) {
            if(err) return callback(new Error('Can\'t get information about data keeping period'));

            var houseKeeperData = {};
            rows.forEach(function (row) {
                houseKeeperData[row.OCID] = {
                    history: row.history,
                    trends: row.trends,
                    name: row.name, // counterName
                }
            });

            var savedObjects = 0, savedRecords = 0, savedTrends = 0,
                timeInterval = 60000, nextTimeToPrint = Date.now() + timeInterval;
            storage.beginTransaction('Saving cache data to database', function (err) {
                if (err) {
                    if (typeof cacheServiceCallback === 'function') {
                        cacheServiceCallback(err);
                        cacheServiceCallback = null;
                    }
                    return callback(err);
                }

                // cacheObj = {savedCnt:, cachedRecords:, firstTimestamp:, lastTimestamp:,
                // records: [{data:, timestamp:},...]}
                async.eachOfSeries(Object.fromEntries(cache), function (cacheObj, id, callback) {
                    if (terminateCacheService) return callback();
                    //log.info('ID: ', id, cacheObj);
                    // don't save history for keepHistory = 0
                    if(!houseKeeperData[id] || !houseKeeperData[id].history) {
                        //log.info ('Skipping to save obj ', id, ': ', houseKeeperData[id])
                        return callback();
                    }

                    if (cacheServiceIsRunning > 100 && parameters.cacheServiceTimeout &&
                        Date.now() - cacheServiceIsRunning > parameters.cacheServiceTimeout) { // 1 hour
                        log.warn('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() +
                            '. It\'s too long. Something was wrong. Terminating...');
                        terminateCacheService = Date.now();
                        // cache service will be terminated because now if(terminateCacheService) condition
                        // will be always true
                        return callback();
                    }

                    // print progress every 1 minutes
                    ++savedObjects;
                    if (nextTimeToPrint < Date.now()) {
                        nextTimeToPrint = Date.now() + timeInterval;
                        log.info('Saved cache to database ', Math.ceil(savedObjects * 100 / cache.size),
                            '% (', savedObjects, '/', cache.size, ' objects, ', savedRecords, ' records, ',
                            savedTrends, ' trends)');
                    }

                    // object may be removed while processing cache saving operation or nothing to save
                    // cacheObj.records.length <= cacheObj.savedCnt - are all records saved in the DB?
                    if (!cacheObj || !cacheObj.records || cacheObj.records.size <= cacheObj.savedCnt) {
                        return callback();
                    }

                    var callbackAlreadyCalled = false;
                    if(parameters.cacheServiceTimeoutForSaveObjectRecords) {
                        var watchDogTimerID = setTimeout(function () {
                            callbackAlreadyCalled = true;
                            terminateCacheService = Date.now();
                            log.error('Time to saving records for OCID ' + id + ' (counter: ',
                                houseKeeperData[id].name, ') form cache to database too long (',
                                (parameters.cacheServiceTimeoutForSaveObjectRecords / 60000),
                                'min). Stop waiting to save records for an object and terminating cache service');
                            callback();
                        }, parameters.cacheServiceTimeoutForSaveObjectRecords); // 5 min
                    }

                    var startTime = cacheObj.firstValue ? cacheObj.firstValue.timestamp : 0,
                        endTime = cacheObj.lastValue ? cacheObj.lastValue.timestamp : 0;
                    // more than one record per second
                    if(endTime - startTime > 30000 &&
                        cacheObj.records.size > 100 &&
                        cacheObj.records.size / ((endTime - startTime)  / 1000) > 1
                    ) {
                        log.warn('For OCID ', id ,' (counter: ', houseKeeperData[id].name,
                            ') a large amount of data will be saved: ', cacheObj.records.size,
                            ' records in ', Math.round((endTime - startTime) / 1000 ),' seconds: ',
                            Math.round(cacheObj.records.size / ((endTime - startTime)  / 1000)), ' records/sec');
                    }

                    // savedCnt - Number of saved records (3)
                    // copy to recordsForSave 0 to end (9) - savedCnt (3)
                    var recordsArray = Array.from(cacheObj.records);
                    var recordsForSave = recordsArray.slice(cacheObj.savedCnt);
                    storage.saveRecordsForObject(id, {
                        savedCnt: cacheObj.savedCnt,
                        cachedRecords: cacheObj.cachedRecords,
                        keepTrends: houseKeeperData[id] ? (houseKeeperData[id].trends || 0) : 0,
                    }, recordsForSave, function (err, savedData) {

                        clearTimeout(watchDogTimerID);
                        if (err) {
                            log.error('Error while saving records for ', id, ' (counter: ', houseKeeperData[id].name,
                            '): ', err.message);
                            return callbackAlreadyCalled ? null : callback();
                        }

                        /*
                            !!! BE ATTENTION !!!
                            savedData for 2 running storage servers can be:
                            savedData: [
                              {
                                id: 1,
                                timestamp: 1611082763939,
                                result: { id: 10, savedRecords: 3, savedTrends: 0 }
                              },
                              {
                                id: 0,
                                timestamp: 1611082763984,
                                result: { id: 11, savedRecords: 3, savedTrends: 0 }
                              }
                            ]

                        */
                        //console.log('savedData:', savedData);
                        //log.info('savedData:', savedData);
                        if (savedData && savedData[0] && savedData[0].result) {
                            if(savedData[0].result.savedRecords) {
                                savedRecords += savedData[0].result.savedRecords;

                                if(Number(savedData[0].result.id)) {
                                    var cacheObj = cache.get(Number(savedData[0].result.id));
                                    if(cacheObj && cacheObj.savedCnt !== undefined) {
                                        cacheObj.savedCnt += savedData[0].result.savedRecords;
                                    }
                                }
                            }
                            if(savedData[0].result.savedTrends) savedTrends += savedData[0].result.savedTrends;
                        }

                        return callbackAlreadyCalled ? null : callback();
                    });
                }, function (err) {
                    storage.commitTransaction(err, function (err) {

                        if (!err) { // error will include async error
                            var allRecordsInCache = 0, allRecordsInCacheWas = 0, allUnnecessaryRecordsCnt = 0;

                            // removing records from cache after commit transactions
                            // and calculate records number
                            cache.forEach((cacheObj) => {
                                if (!cacheObj.records instanceof Set) return;
                                allRecordsInCacheWas += cacheObj.records.size;

                                var unnecessaryCachedRecordsCnt = cacheObj.records.size - cacheObj.cachedRecords;
                                if (unnecessaryCachedRecordsCnt < 0) unnecessaryCachedRecordsCnt = 0;

                                var recordsForRemoveFromCache = unnecessaryCachedRecordsCnt > cacheObj.savedCnt ?
                                    cacheObj.savedCnt : unnecessaryCachedRecordsCnt;
                                //log.info('ID: ', id, ' recordsLen:', cacheObj.records.size, ' cachedRecords:', cacheObj.cachedRecords, ' savedCnt:', cacheObj.savedCnt, ' unnecessary:', unnecessaryCachedRecordsCnt, ' removed:', recordsForRemoveFromCache)
                                if (recordsForRemoveFromCache) {

                                    allUnnecessaryRecordsCnt += recordsForRemoveFromCache;

                                    // [0,1,2,3,4,5]; recordsForRemoveFromCache = 3
                                    // slice(3) = [3,4,5]; splice(0, 3) = [3,4,5]
                                    for(let record of cacheObj.records) {
                                        if(recordsForRemoveFromCache-- < 1) {
                                            cacheObj.firstValue = record;
                                            break;
                                        }
                                        cacheObj.records.delete(record);
                                        --cacheObj.savedCnt;
                                    }
                                    if(!cacheObj.records.size) {
                                        delete cacheObj.firstValue;
                                        delete cacheObj.lastValue;
                                        cacheObj.savedCnt = 0;
                                    } else if (cacheObj.savedCnt < 0) cacheObj.savedCnt = 0;

                                }

                                allRecordsInCache += cacheObj.records.size;
                            });
                        }

                        log.info('Saving cache to database is ', (terminateCacheService ? 'terminated' : 'finished'),
                            (err ? ' with error: ' + err.message : ''),
                            '. Records removed from cache: ', allUnnecessaryRecordsCnt,
                            '. Saving from cache to storage: records: ', savedRecords, ', trends: ', savedTrends,
                            '. Records in a cache was: ', allRecordsInCacheWas, ', now: ', allRecordsInCache);


                        if (!terminateCacheService && fs.existsSync(dumpPath)) {
                            log.info('Deleting old dump file ', dumpPath);
                            try {
                                fs.unlinkSync(dumpPath);
                            } catch (err) {
                                log.warn('Can\'t delete dump file ' + dumpPath + ': ' + err.message);
                            }
                        }

                        // terminateCacheService = 1 when receiving external signal for terminateCacheService
                        // in other cases terminateCacheService equal to Date.now()
                        if (terminateCacheService === 1) log.exit('Saving cache to database was terminated');
                        else terminateCacheService = 0;
                        if (cacheServiceIsRunning > 100) cacheServiceIsRunning = 0;
                        callback();
                        if (typeof cacheServiceCallback === 'function') {
                            cacheServiceCallback();
                            cacheServiceCallback = null;
                        }
                    });
                });
            });
        });
    });
}


/** Dumps the cached historical data to a file before exiting.
 * The data from the dump file will be loaded into the cache on next startup
 * @param {function(void): void} [callback] - Called when done
 */

historyCache.dumpData = function(callback) {

    if(!callback || cache.size < 10) { // on fast destroy or small cache don\'t overwrite dump file
        try {
            var stat = fs.statSync(dumpPath);
        } catch (e) {}
        if (stat && stat.size > 1024) {
            if(typeof callback === 'function') return callback();
            else return;
        }
    }

    try {
        // default flag: 'w' - file created or truncated if exist
        // convert from map to object: Object.fromEntries(cache.entries()))
        //fs.writeFileSync(dumpPath, JSON.stringify(Object.fromEntries(cache.entries())), null, 1));
        //log.exit('Starting to save history cache data for ' + cache.size + ' objects to ' + dumpPath);

        fs.writeFileSync(dumpPath, JSON.stringify(Object.fromEntries(cache.entries()),
            function(key, value) {
                if(key === 'records') return Array.from(value); // Set() to array
                else return value;
        }));

        log.exit('Finished dumping history cache data for ' + cache.size + ' objects to ' + dumpPath);
    } catch(e) {
        log.exit('Can\'t dump history cache to file ' + dumpPath + ': ' + e.message);
        return setTimeout(historyCache.dumpData, 1000, callback);
    }
    if(typeof callback === 'function') callback();
};

historyCache.getTransactionsQueueInfo = function(callback) {
    storage.getTransactionsQueueInfo(function (err, transQueueArr) {
        //log.info('getTransactionsQueueInfo: ', transQueueArr);
        if(err) return callback(err, {});
        var transQueue = {description: ''}, desc = {};
        if (Array.isArray(transQueueArr)) {
            transQueueArr.forEach(function (data) {
                if (!transQueue.len || transQueue.len < data.result.len) transQueue.len = data.result.len;
                if (!transQueue.timestamp || transQueue.timestamp > data.result.timestamp) {
                    transQueue.timestamp = data.result.timestamp
                }
                if(data.result.description) desc[data.result.description] = true;
            });
            transQueue.description = Object.keys(desc).join('; ');
        }

        return callback(null, transQueue);
    });
};

/** Thin out records: decrease count of returned records to maxRecordsNum records
 * @param {Array} allRecords: array of records [{timestamp:..., data:...}, ...]
 * @param {uint} maxRecordsNum: required maximum number of records
 * @return thin out array of records [{timestamp:..., data:...}, ...]
 */
historyCache.thinOutRecords = function (allRecords, maxRecordsNum) {

    if(!allRecords || !allRecords.length) return [];
    var recordsCnt = allRecords.length;

    maxRecordsNum = parseInt(String(maxRecordsNum), 10);

    var stepTimestamp = (Number(allRecords[recordsCnt - 1].timestamp) -
        Number(allRecords[0].timestamp)) / (maxRecordsNum - 1);
    if(!maxRecordsNum || maxRecordsNum === 1 || stepTimestamp < 1 || recordsCnt <= maxRecordsNum) return allRecords;

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