/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 25.09.2016.
 */

/*
    Code was reviewed at 07/02/2018

 */
var fs = require('fs');
var async = require('async');
var path = require('path');

var parameters = require('../models_history/historyParameters');
var log = require('../lib/log')(module);
var storage = require('../models_history/historyStorage');

var historyCache = {};
module.exports = historyCache;

var cache = {};
var dumpPath = path.join(__dirname, '..', parameters.dbPath, parameters.dumpFileName);
var cacheServiceIsRunning = 0;
var terminateCacheService = 0;
var recordsFromCacheCnt = 0;
var recordsFromStorageCnt = 0;

historyCache.terminateHousekeeper = false;

/*
load unsaved data from dump files
load records to cache from storage
starting cache service for save data to storage
 */
historyCache.init = function (initParameters, callback){

    parameters.init(initParameters);
    terminateCacheService = 0;
    cacheServiceIsRunning = 0;

    loadDataFromDumpToCache(dumpPath, function(err, _cache) {
        if(err) return callback(err); // only if can\'t close dump file

        if(typeof _cache !== 'object') _cache = {};
        storage.initStorage(_cache,function(err, _cache) {
            if(err) return callback(err);

            cache = _cache;

            setInterval(cacheService, parameters.cacheServiceInterval * 1000); // sec
            setInterval(function() {
                log.info('Records returned from cache\\storage: ', recordsFromCacheCnt, '\\', recordsFromStorageCnt);
                recordsFromCacheCnt = recordsFromStorageCnt = 0;
            }, 60000);

            callback();
        });
    });
};

historyCache.cacheServiceIsRunning = function(val) {
    if(val !== undefined) cacheServiceIsRunning = val;
    return cacheServiceIsRunning;
}
historyCache.terminateCacheService = function () {
    if(cacheServiceIsRunning) log.exit('Terminating cache service');
    terminateCacheService = 1;
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
                    var cache = JSON.parse(String(data));
                } catch (err) {
                    log.error('Can\'t parse dump data from ' + dumpPath + ' as JSON object: ' + err.message);
                    return callback();
                }

                if (!cache) return callback();

                var loadedRecords = 0;
                for (var id in cache) {
                    if(!cache[id] || !Array.isArray(cache[id].records)) delete cache[id];
                    else loadedRecords += cache[id].records.length - cache[id].savedCnt;
                }

                if (!loadedRecords) {
                    log.info('Dump has no records for cache');
                    return callback();
                }

                log.info('Loaded ', loadedRecords, ' unsaved records for ', Object.keys(cache).length,' objects.');
                callback(null, cache);
            })
        });
    });
}

/*
    add new record to the end of cache

    id: object ID
    newRecord: {timestamp: ..., record: ...}
 */
historyCache.add = function (id, newRecord){

    if(newRecord.data === undefined || newRecord.data === null) return;
    if(!newRecord.timestamp || newRecord.timestamp < 1477236595310 || newRecord.timestamp > Date.now() + 60000) { // 1477236595310 = 01/01/2000)
        log.error('Error in record timestamp ',
            (newRecord.timestamp ? new Date(newRecord.timestamp).toLocaleString() : ''), '(', newRecord, ') for object: ', id);
        return;
    }

    if(typeof newRecord.data === 'object') newRecord.data =  JSON.stringify(newRecord.data);

    //log.debug('Adding data to history: id ', id, ' newRecord: ', newRecord);

    if(!cache[id]) {
        cache[id] = {
            cachedRecords: parameters.initCachedRecords,
            savedCnt: 0, // Count of saved records, 'records' is an array of the last data returned from counters
            records: [newRecord]
        };
        //log.debug('Inserting newRecord for new object to history. id: ', id, ' newRecord: ', newRecord);
    } else {
        var recordsInCacheCnt = cache[id].records.length;

        // TODO: add throttling support in counter settings
        // if throttling is enabled for this objectID
        // Don't create new record for a new data which equal to  data from last record in a cache.
        // Only change last record timestamp
        if(cache[id].throttling && recordsInCacheCnt > 2 && cache[id].records[recordsInCacheCnt-1].data === newRecord.data && cache[id].records[recordsInCacheCnt-2].data === newRecord.data) {
            cache[id].records[recordsInCacheCnt-1].timestamp = newRecord.timestamp;
            //log.debug('Inserting new timestamp for newRecord, equal to previous to history. id: ', id, ' newRecord: ', newRecord, ' records in cache: ', cache[id].records);
        } else { // create a new record in a cache otherwise
          //log.debug('Inserting new newRecord to history. id: ', id, ' newRecord: ', newRecord);

            if(!recordsInCacheCnt || cache[id].records[recordsInCacheCnt-1].timestamp < newRecord.timestamp) cache[id].records.push(newRecord);
            else {
                if(recordsInCacheCnt === 1) cache[id].records.unshift(newRecord);
                else if(cache[id].records[0].timestamp > newRecord.timestamp) {
                    log.warn('Don\'t add record for object ', id, ' with a timestamp (',
                        new Date(newRecord.timestamp).toLocaleString(), ') less then latest record (',
                        new Date(cache[id].records[0].timestamp).toLocaleString(),
                        ') in the cache. New record: ', newRecord, ', cache: ', cache[id]);
                } else {
                    // inserting new record into the cache in position according to new record timestamp for save correct records order
                    for (var i = recordsInCacheCnt - 2; i >= 0; i--) {
                        if (cache[id].records[i].timestamp < newRecord.timestamp) {
                            cache[id].records.splice(i, 0, newRecord);
                            break;
                        }
                    }
                }
            }
        }
    }
};

/*
    removing all history for specific object

    id: objectID
    daysToKeepHistory - delete only files older then this parameter (in days)
    callback(err)
 */
historyCache.del = function (IDs, daysToKeepHistory, daysToKeepTrends, callback){

    if(!daysToKeepHistory) {
        var lastTimeToKeepHistory = 0;
        log.info('Removing objects from history: ', IDs);
    }
    else {
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

    IDs.forEach(function (id) {
        if(cache[id]) {
            if (!daysToKeepHistory) delete cache[id];
            else {
                if (cache[id].records[0] && cache[id].records[0].timestamp <= lastTimeToKeepHistory) {
                    for (var recordsToDelete = 1; recordsToDelete < cache[id].records.length; recordsToDelete++) {
                        if (cache[id].records[recordsToDelete].timestamp >= lastTimeToKeepHistory) break;
                    }

                    log.debug('Removing ', recordsToDelete, ' records from the end of the cache ', id, ', records was: ', cache[id].records);
                    cache[id].records.splice(0, recordsToDelete);
                    cache[id].savedCnt -= recordsToDelete;
                    if(cache[id].savedCnt < 0) cache[id].savedCnt = 0;
                } else {
                    cache[id].records = [];
                    cache[id].savedCnt = 0;
                }
            }
        }
    });
    storage.delRecords(IDs, daysToKeepHistory, daysToKeepTrends, callback);
};

historyCache.getByValue = function(id, value, callback) {
    if(typeof callback !== 'function') return log.error('[getByValue]: callback is not a function');

    id = Number(id);
    if(id !== parseInt(String(id), 10) || !id) return callback(new Error('[getByValue] incorrect object ID '+id));

    if(!isNaN(parseFloat(value)) && isFinite(value)) value = Number(value);

    var cacheObj = cache[id];
    if(cacheObj && cacheObj.records && cacheObj.records.length) {
        for(var i = 0; i < cacheObj.records.length; i++) {
            if(cacheObj.records[i].data === value) return callback(null, cacheObj.records[i].timestamp);
        }
    }

    storage.getLastRecordTimestampForValue(id, value, callback);
};

/*
    get requested records by position or by time, depend by format of the 'shift' parameter

    id: object ID

    if format of 'num' parameter is a #<num> and\or 'shift' is #<shift>, then get records by position.
    shift: it's a last record position from the end of the storage. 0 - last element
    num: count of the requirement records from the last position. 0 - only one element with a 'last' position

    or

    if format of 'num' parameter is a <num>, then get records by time
     'shift' and 'num' parameters:
     1. if 'shift' is a timestamp (from 1970 in ms) - it interpretable as "time from". 'num' must be a timestamp too and it interpretable as "time to"
     2. if 'shift' is ms from last record. 'num' - time interval in ms from 'shift'
     you can add suffix 's', 'm', 'h' or 'd' to the end of time parameters 'shift' or 'num'.
     It means seconds for 's', minutes for 'm', hours for 'h' and days for 'd'

    callback(err, records), where records: [{data:.., timestamp:..}, ....]

 */
historyCache.get = function (id, shift, num, callback) {

    if(String(num).charAt(0) === '#') {
        var getFromHistory = historyCache.getByIdx;
        num = num.slice(1);
    }

    if(String(shift).charAt(0) === '#') {
        getFromHistory = historyCache.getByIdx;
        shift = shift.slice(1);
    }

    if(getFromHistory === undefined) getFromHistory = historyCache.getByTime;

    getFromHistory(id, shift, num, 0, function (err, records) {
        if(err || !Array.isArray(records) || !records.length) return callback(err);
        callback(null, records);
    });
};

/*
    get last values for IDs. Will continue getting last values even if error occurred

    IDs: array of object IDs
    callback(err, records), where
    err: new Error(errors.join('; '))
    records: {id1: {err:..., timestamp:..., data:...}, id2: {err:.., timestamp:..., data:..}, ....}
 */

historyCache.getLastValues = function(IDs, callback) {
    if(typeof callback !== 'function') return log.error('[getLastValues]: callback is not a function');

    var records = {}, errors = [];
    //log.debug('Getting last values for ', IDs);
    async.each(IDs, function (id, callback) {
        if(records[id]) return callback();

        records[id] = {};
        historyCache.getByIdx(id, 0, 1, 0, function (err, record) {
            if(err) {
                if(!historyCache.terminateHousekeeper) {
                    log.warn('Can\'t get last value for ', id, ': ', err.message);
                }
                records[id].err = err;
                errors.push(id + ': ' + err.message);
            }

            //log.debug('Value for ', id, ': ', record, '; err: ', err);

            if(record && record.length) {
                records[id].timestamp = record[0].timestamp;
                records[id].data = record[0].data;
            }
            callback();
        });
    }, function () {
        callback(errors.length ?  new Error(errors.join('; ')) : null, records);
    });
}
/*
    get requested records by position

    id: object ID
    offset: record position from the end of the storage. 0 - last element
    cnt: count of the requirement records from the last position. 0 - only one element with a 'last' position
    callback(err, records), where records: [{data:.., timestamp:..}, ....]

 */
historyCache.getByIdx = function(id, offset, cnt, maxRecordsCnt, callback) {
    if(typeof callback !== 'function') return log.error('[getByIdx]: callback is not a function');

    offset = Number(offset); cnt = Number(cnt); id = Number(id);
    if(cnt === 0) return callback(null, []);
    if(Number(id) !== parseInt(String(id), 10) || !id) return callback(new Error('[getByIdx] incorrect object ID '+id));
    if(Number(offset) !== parseInt(String(offset), 10) || offset < 0) return callback(new Error('[getByIdx] incorrect "offset" parameter ('+offset+') for objectID '+id));
    if(Number(cnt) !== parseInt(String(cnt), 10) || cnt < 1) return callback(new Error('[getByIdx] incorrect "cnt" parameter ('+cnt+') for objectID '+id));

    var cacheObj = cache[id];

    if(cacheObj) {
        var recordsFromCache = cacheObj.records.slice(-(offset+cnt), offset ? -offset : cacheObj.records.length);
        recordsFromCacheCnt += recordsFromCache.length;

        if(recordsFromCache.length === cnt) {
            calculateCacheSize(cacheObj, 0, recordsFromCache);
            return callback(null, recordsFromCache);
        }
    } else {
        recordsFromCache = [];
        // create new cache object cache[id] and make reference cacheObj = cache[id]
        cache[id] = {
            cachedRecords: cnt,
            savedCnt: 0,
            records: []
        };
        cacheObj = cache[id];
    }

    // set the cnt equal to the initial cnt minus the number of already found records in the cache
    var storageCnt = cnt - recordsFromCache.length;
    // records count in the cache
    var cacheRecordsCnt = cacheObj.records.length;
    /*
    don’t use the offset and look for the record according to the last timestamp taken from the last cache record,
    because the storage can be modified during the sending of the query and then the offset will be impossible to calculate

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
        if(cacheRecordsCnt) {
            storageTimestamp = cacheObj.records[0].timestamp;
            storageOffset = offset - cacheRecordsCnt;
        } else { // when cache is empty start to search in the database with initial offset and cnt
            storageTimestamp = null;
            storageOffset = offset;
        }
    }

    storage.getRecordsFromStorageByIdx(id, storageOffset, storageCnt, storageTimestamp, maxRecordsCnt, function(err, recordsFromStorage) {
        if (err || !Array.isArray(recordsFromStorage)) {
            if(!historyCache.terminateHousekeeper) {
                log.warn('Can\'t get data from storage for ', id, '; from position: ', storageOffset, ', count: ', storageCnt,
                    '; timestamp: ', (new Date(storageTimestamp)).toLocaleString(), ' (', storageTimestamp, ')',
                    ' maxRecordsCnt: ', maxRecordsCnt, ', try again. Error: ', err || 'return no data');
            }
            storage.getRecordsFromStorageByIdx(id, storageOffset, storageCnt, storageTimestamp, maxRecordsCnt, processDataFromStorage);
        } else processDataFromStorage(err, recordsFromStorage);
    });

    function processDataFromStorage(err, recordsFromStorage) {
        if (err || !Array.isArray(recordsFromStorage) || !recordsFromStorage.length) {
            if(err || !Array.isArray(recordsFromStorage)) {
                if(!historyCache.terminateHousekeeper) {
                    log.warn('Can\'t get data from storage for ', id, '; from position: ', storageOffset, ', count: ', storageCnt,
                        '; timestamp: ', (new Date(storageTimestamp)).toLocaleString(), ' (', storageTimestamp, ')',
                        ' maxRecordsCnt: ', maxRecordsCnt, ', return only data from cache. Error: ', err || 'return no data',
                        '; data from cache: ', recordsFromCache);
                }
            }
            return callback(err, recordsFromCache);
        }

        recordsFromStorageCnt += recordsFromStorage.length;
        calculateCacheSize(cacheObj, recordsFromStorage);
        addDataToCache(cacheObj, recordsFromStorage); // add records loaded from storage to cache

        Array.prototype.push.apply(recordsFromStorage, recordsFromCache);

        callback(null, recordsFromStorage);
    }
};

/*
    get requested records by time

    id: object ID
    timeShift and timeInterval:
        1. timeShift - timestamp (from 1970 in ms) - "time from". timeInterval can be a timestamp too and it interpretable as "time to" or time interval from "time from"
        2. timeShift - time in ms from last record. timeInterval - time interval in ms from timeShift
    callback(err, records), where records: [{data:.., timestamp:..}, ....]
 */
historyCache.getByTime = function (id, timeShift, timeInterval, maxRecordsCnt, callback) {

    //log.debug('[getByTime]: ',id, ', ', timeShift, ', ', timeInterval, ', ', maxRecordsCnt);
    if (typeof callback !== 'function') return log.error('[getByTime]: callback is not a function');

    id = Number(id); timeShift = Number(timeShift); timeInterval = Number(timeInterval);
    if (id !== parseInt(String(id), 10) || !id) return callback(new Error('[getByTime] incorrect ID ' + id));
    if (timeShift !== parseInt(String(timeShift), 10) || timeShift < 0) return callback(new Error('[getByTime] incorrect "timeShift" parameter (' + timeShift + ') for objectID ' + id));
    if (timeInterval !== parseInt(String(timeInterval), 10) || timeInterval < 0) return callback(new Error('[getByTime] incorrect "timeInterval" parameter (' + timeInterval + ') for objectID ' + id));

    // return last value
    if(timeInterval === 0) return historyCache.getByIdx(id, 0, 1, 0, callback);

    // return empty array for small time interval
    //if(timeInterval < 60000) return callback(null, []);

    if (timeShift > 1477236595310) { // check for timestamp: 1477236595310 = 01/01/2000
        var timeFrom = timeShift;
        if (timeInterval > 1477236595310) var timeTo = timeInterval;
        else timeTo = timeFrom + timeInterval;
    } else {
        timeTo = Date.now() - timeShift;
        timeFrom = timeTo - timeInterval;
    }

    var cacheObj = cache[id];

    //log.debug('[getByTime]: ',id, ', ', timeFrom, ' - ', timeTo, ': ', cacheObj);
    /*
    id:         0  1  2  3   4  5  6  7   8  9  10 11
    timestamps: 10 14 17 19 |23 25 28 29| 33 35 37 42
    timeFrom=20, timeTo=31
     */
    if(cacheObj && cacheObj.records) {
        // last record timestamp in cache less then required timestamp in timeFrom. History have not data for required time interval
        if(cacheObj.records.length && timeFrom > cacheObj.records[cacheObj.records.length - 1].timestamp) return callback(null, []);
        // checking for present required records in cache.
        // timestamps: [10:00, 10:05, 10:10, 10:15, 10:20]. timeTo 10:05 - present; timeTo 09:50 - not present in cache
        if(cacheObj.records.length && timeTo > cacheObj.records[0].timestamp) {
            var lastRecordIdxInCache = findRecordIdx(cacheObj.records, timeTo, 0, cacheObj.records.length - 1);
            var firstRecordIdxInCache = findRecordIdx(cacheObj.records, timeFrom, 0, lastRecordIdxInCache);
            // findRecordIdx find nearest record position to timestamp.
            // But first record timestamp must be more then timeFrom and last record timestamp must be less then timeTo.
            if (cacheObj.records[firstRecordIdxInCache].timestamp < timeFrom) ++firstRecordIdxInCache;
            if (lastRecordIdxInCache && cacheObj.records[lastRecordIdxInCache].timestamp > timeTo) --lastRecordIdxInCache;

            // lastRecordIdxInCache + 1 because slice is not include last element to result
            // var recordsFromCache = cacheObj.records.slice(firstRecordIdxInCache, lastRecordIdxInCache + 1);
            // Don\'t use slice, copy every records from cache to a new array
            for(var recordsFromCache = [], i = firstRecordIdxInCache, j = 0; i <= lastRecordIdxInCache; i++, j++) {
                recordsFromCache[j] = {
                    timestamp: cacheObj.records[i].timestamp,
                    data: cacheObj.records[i].data
                }
            }
            recordsFromCacheCnt += recordsFromCache.length;

            //log.debug(id, ': !!! records form cache: ', recordsFromCache, '; firstRecordIdxInCache: ', firstRecordIdxInCache, '; lastRecordIdxInCache: ', lastRecordIdxInCache, '; ', cacheObj);
            if (firstRecordIdxInCache) { // firstRecordIdxInCache !== 0
                calculateCacheSize(cacheObj, 0, recordsFromCache);
                return callback(null, recordsFromCache);
            }
        } else recordsFromCache = [];
    } else {
        recordsFromCache = [];
        // create new cache object cache[id] and make reference cacheObj = cache[id]
        cache[id] = {
            cachedRecords: parameters.initCachedRecords,
            savedCnt: 0,
            records: []
        };
        cacheObj = cache[id];
    }

    /*
    Use recordsFromCache[0].timestamp - 1 because the SQL BETWEEN operator is inclusive
    */
    var storageTimeTo = recordsFromCache.length ? recordsFromCache[0].timestamp - 1 : timeTo;
    storage.getRecordsFromStorageByTime(id, timeFrom, storageTimeTo, maxRecordsCnt, function(err, recordsFromStorage, isThisDataFromTrends) {
        if (err || !Array.isArray(recordsFromStorage)) {
            if(!historyCache.terminateHousekeeper) {
                log.warn('Can\'t get data from storage for ', id, ': ', (new Date(timeFrom)).toLocaleString(),
                    '-', (new Date(storageTimeTo)).toLocaleString(), ' (', timeFrom, '-', storageTimeTo, ')',
                    '; maxRecordsCnt: ', maxRecordsCnt, ', try again. Error: ', err || 'return no data');
            }
            storage.getRecordsFromStorageByTime(id, timeFrom, storageTimeTo, maxRecordsCnt, processDataFromStorage);
        } else processDataFromStorage(err, recordsFromStorage, isThisDataFromTrends);
    });

    function processDataFromStorage(err, recordsFromStorage, isThisDataFromTrends) {
        if (err || !Array.isArray(recordsFromStorage) || !recordsFromStorage.length) {
            if(err || !Array.isArray(recordsFromStorage)) {
                if(!historyCache.terminateHousekeeper) {
                    log.warn('Can\'t get data from storage for ', id, ': ', (new Date(timeFrom)).toLocaleString(),
                        '-', (new Date(storageTimeTo)).toLocaleString(), ' (', timeFrom, '-', storageTimeTo, ')',
                        '; maxRecordsCnt: ', maxRecordsCnt, ', return only data from cache. Error: ', err || 'return no data',
                        '; data from cache: ', recordsFromCache);
                }
            }
            return callback(err, recordsFromCache);
        }

        recordsFromStorageCnt += recordsFromStorage.length;
        //log.debug(id, ': !!! records form storage: ', recordsFromStorage);

        if(!isThisDataFromTrends) {
            calculateCacheSize(cacheObj, recordsFromStorage);
            addDataToCache(cacheObj, recordsFromStorage);
        }

        /* deep debug */
        if(recordsFromCache.length && recordsFromStorage[recordsFromStorage.length-1].timestamp >= recordsFromCache[0].timestamp) {
            log.warn('Timestamp in last record from storage: ', recordsFromStorage[recordsFromStorage.length-1], ' more then timestamp in first record from cache: ', recordsFromCache[0], '; storage: ...', recordsFromStorage.slice(-5), '; cache: ', recordsFromCache.slice(0, 5), '...');

            var lastRecord = recordsFromStorage.pop(), firstCachedRecordTimestamp = recordsFromCache[0].timestamp;
            while(lastRecord && lastRecord.timestamp >= firstCachedRecordTimestamp) {
                lastRecord = recordsFromStorage.pop();
            }
        }
        Array.prototype.push.apply(recordsFromStorage, recordsFromCache);
        callback(null, recordsFromStorage);
    }
};

/*
 find nearest !!! to timestamp record in a sorted by timestamp records array. used also in historyCache.js

 !!! first and last is always set to 0 and records.length-1 at first start, but it needed in recursion

 records: array with records [{timestamp:..., data:..}, ...]
 timestamp: time in ms from 1970
 first: first record position in a cache for search. Set it to 0;
 last:  last record position in a cache for search. Set it to records.length-1;

 return position to a nearest to timestamp element

 records: 10 13 17 18 20 25 30 31 35
 timestamp = 14, first = 0, last = 8
 1. f=0, l=8: m = 4 (20)
 2. f=0, l=4: m = 2 (17)
 3. f=0, l=2: m = 1 (13)
 4. f=1,l=2: - return f=1 (13)

 timestamp = 27, first = 0, last = 8
 1. f=0, l=8: m = 4 (20)
 2. f=4, l=8: m = 6 (30)
 3. f=4, l=6: m = 5 (25)
 4. f=5,l=6: - return f=5 (25)

 timestamp = 37, first = 0, last = 8
 1. f=0, l=8: m = 4 (20)
 2. f=4, l=8: m = 6 (30)
 3. f=4, l=6: m = 5 (25)
 4. f=5,l=6: - return f=5 (25)

 */
function findRecordIdx(records, timestamp, first, last) {

    if(records[first].timestamp >= timestamp) return first;
    if(records[last].timestamp <= timestamp) return last;

    if(first+1 === last) {
        if(timestamp - records[first].timestamp < records[last].timestamp - timestamp) return first;
        else return last;
    }

    var middle = first + parseInt(String((last - first) / 2), 10);

    if(records[middle].timestamp < timestamp) return findRecordIdx(records, timestamp, middle, last);
    else return findRecordIdx(records, timestamp, first, middle);
}


/*
 fill cache to requested cache size

 cacheObj: cache[id]
 records: records, returned from storage [{data:.., timestamp:..}, ...]
 */
function addDataToCache(cacheObj, recordsFromStorage) {

    if(cacheObj.cachedRecords === undefined){
        cacheObj.cachedRecords = parameters.initCachedRecords;
        return;
    }

    // return if cache has a required elements number
    if(cacheObj.cachedRecords >= cacheObj.records.length) return;

    /*
    calculate missing records in cache and add records to the cache
    ===============================================================
    records are added to the end of the cache array (cacheObj.records):
    storage: 1 2 3 4 5 6 7
    cache:                 8 9 10 11 12
    cacheObj.cachedRecords = 9; cacheObj.records.length = 5; recordsFromStorage.length = 7;
    slice(begin: 2, end: 7): begin = 7 - (9-5) - 1= 2
     */
    var begin = recordsFromStorage.length - (cacheObj.cachedRecords - cacheObj.records.length) -1;
    if(begin < 0) begin = 0;
    // add recordsFromStorage to the begin of the cache.records
    Array.prototype.unshift.apply(cacheObj.records, recordsFromStorage.slice(begin));
}

function calculateCacheSize(cacheObj, recordsFromStorage, recordsFromCache) {
    // if required records from storage, set cache size to all required records
    if(recordsFromStorage && recordsFromStorage.length) return cacheObj.cachedRecords + recordsFromStorage.length;

    // TODO: change this algorithm
    // if all required records was returned from cache, reduce cache size to 10% of extra records
    if(recordsFromCache && recordsFromCache.length && recordsFromCache.length < cacheObj.cachedRecords)
        return cacheObj.cachedRecords - Math.round((cacheObj.cachedRecords - recordsFromCache.length) / 10 );

    return cacheObj.cachedRecords;
}

/*
 save records from cache to storage
 remove unnecessary records from cache

 savedCnt = 2; cachedRecords = 4; recordsInCache = 7
 [1 2 3 4 5 6 7]
 recordsForSave = records.slice(savedCnt + 1) = [3 4 5 6 7]
 1.  after save:
     [1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]
     recordsForSave.length = 5; recordsInCache = 15
     unnecessaryCachedRecordsCnt = recordsInCache - cachedRecords = 15 - 5 = 10;
     savedRecordsCnt = savedCnt + recordsForSave.length = 2 + 5 = 7
     unnecessaryCachedRecordsCnt = savedRecordsCnt = 7
     records.splice(0, unnecessaryCachedRecordsCnt);
     [8 9 10 11 12 13 14 15]
     savedCnt = savedRecordsCnt - unnecessaryCachedRecordsCnt - 1= 7 - 7 - 1 = -1
 2.  after save:
     [1 2 3 4 5 6 7 8 9 10]
     recordsForSave.length = 5; recordsInCache = 10
     unnecessaryCachedRecordsCnt = recordsInCache - cachedRecords = 10 - 5 = 5;
     savedRecordsCnt = savedCnt + recordsForSave.length = 2 + 5 = 7
     unnecessaryCachedRecordsCnt = 5
     records.splice(0, unnecessaryCachedRecordsCnt);
     [6 7 8 9 10]
     savedCnt = savedRecordsCnt - unnecessaryCachedRecordsCnt - 1 = 7 - 5 - 1 = 1
*/

function cacheService(callback) {
    if(cacheServiceIsRunning > 0 && cacheServiceIsRunning < 100) return; // waiting for scheduled restart
    log.info('Saving cache data to database...');

    if(typeof(callback) !== 'function') {
        callback = function(err) {
            if(err) log.error(err.message);
        }
    }

    if(cacheServiceIsRunning) {
        log.warn('Cache service was running at ', (new Date(cacheServiceIsRunning)).toLocaleString(), '. Prevent to start another copy of service');
        if(Date.now() - cacheServiceIsRunning < parameters.cacheServiceExitTimeout) return callback(); // < 24 hours

        log.exit('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() + '. It\'s too long. Something was wrong. Exiting...');
        setTimeout(function() {
            process.exit(2);
        }, 2000);
    }

    if(terminateCacheService) {
        log.warn('Received command for terminating cache service. Exiting');
        return callback();
    }

    cacheServiceIsRunning = Date.now();
    var allUnnecessaryRecordsCnt = 0;
    var allSavedRecords = 0;
    var allRecordsInCacheWas = 0;
    var allRecordsInCache = 0;
    var savedObjects = 0, savedRecords = 0, savedTrends = 0, timeInterval = 60000, nextTimeToPrint = Date.now() + timeInterval;

    storage.beginTransaction(function(err) {
        if(err) return callback(err);

        async.eachSeries(Object.keys(cache), function(id, callback) {
            if(terminateCacheService) return callback();

            if(cacheServiceIsRunning > 100 && // it is not a scheduled restart
                Date.now() - cacheServiceIsRunning > parameters.cacheServiceTimeout) { // 1 hour
                log.warn('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() +
                    '. It\'s too long. Something was wrong. Terminating...');
                terminateCacheService = Date.now();
                // cache service will terminated because now this condition will be always true
                return callback();
            }

            // print progress every 1 minutes
            ++savedObjects;
            if(nextTimeToPrint < Date.now()) {
                nextTimeToPrint = Date.now() + timeInterval;
                var objectsCnt = Object.keys(cache).length;
                log.info('Saved cache to database ', Math.ceil(savedObjects * 100 / objectsCnt),
                    '% (', savedObjects, '/', objectsCnt, ' objects, ', savedRecords, ' records, ', savedTrends,' trends)');
            }

            var cacheObj = cache[id];
            // object may be removed while processing cache saving operation or nothing to save
            if(!cacheObj || !cacheObj.records || cacheObj.records.length <= cacheObj.savedCnt) return callback();
            if(!cacheObj.trends) cacheObj.trends = {};

            var callbackAlreadyCalled = false;
            var watchDogTimerID = setTimeout(function () {
                callbackAlreadyCalled = true;
                log.error('Time to saving records for object ' + id + ' form cache to database too long (',
                    parameters.cacheServiceTimeoutForSaveObjectRecords / 1000, 'sec). Stop saving records for object.');
                callback();
            }, parameters.cacheServiceTimeoutForSaveObjectRecords); // 10 min

            // savedCnt and cachedRecords parameters will saving to database
            storage.saveRecords(id, {
                savedCnt: cacheObj.savedCnt,
                cachedRecords: cacheObj.cachedRecords
            }, cacheObj.records, cacheObj.trends, function(err, savedData) {

                clearTimeout(watchDogTimerID);

                if(err) {
                    log.error('Cache service error: ', err.message);
                    return callbackAlreadyCalled ? null : callback();
                }

                // was nothing to save
                if(!savedData) return callbackAlreadyCalled ? null : callback();

                var recordsInCache = cacheObj.records.length;

                // both counters used for information
                allRecordsInCacheWas += recordsInCache;
                allSavedRecords += recordsInCache - cacheObj.savedCnt;

                var unnecessaryCachedRecordsCnt = recordsInCache - cacheObj.cachedRecords;
                savedRecords += savedData.savedRecords;
                // prevent to remove unsaved records from cache
                var savedRecordsCnt = cacheObj.savedCnt + savedData.savedRecords;
                if (savedRecordsCnt < unnecessaryCachedRecordsCnt) unnecessaryCachedRecordsCnt = savedRecordsCnt;

                if(savedData.trends) cacheObj.trends = savedData.trends;
                if(savedData.savedTrends) savedTrends += savedData.savedTrends;

                if(unnecessaryCachedRecordsCnt > 0) {
                    cacheObj.records.splice(0, unnecessaryCachedRecordsCnt);
                    allUnnecessaryRecordsCnt += unnecessaryCachedRecordsCnt;
                } else unnecessaryCachedRecordsCnt = 0;
                cacheObj.savedCnt = savedRecordsCnt - unnecessaryCachedRecordsCnt;

                allRecordsInCache += cacheObj.records.length;
                return callbackAlreadyCalled ? null : callback();
            });
        }, function(err) {
            storage.commitTransaction(err, function(err) {
                log.info('Saving cache to database is ', ( terminateCacheService ? 'terminated' : 'finished' ),
                    (err ? ' with error: ' + err.message : ''),
                    '. Records removed from cache: ', allUnnecessaryRecordsCnt,
                    '. Saving records from cache to storage: ', allSavedRecords,
                    '. Records in a cache was: ', allRecordsInCacheWas, ', now: ', allRecordsInCache);


                if(!terminateCacheService && fs.existsSync(dumpPath)) {
                    log.info('Deleting old dump file ', dumpPath);
                    try {
                        fs.unlinkSync(dumpPath);
                    } catch (err) {
                        log.warn('Can\'t delete dump file ' + dumpPath + ': ' + err.message);
                    }
                }

                // terminateCacheService = 1 when receiving external signal for terminateCacheService
                // in other cases terminateCacheService equal to Date.now()
                if(terminateCacheService === 1) log.exit('Saving cache to database was terminated');
                else terminateCacheService = 0;
                if(cacheServiceIsRunning > 100) cacheServiceIsRunning = 0; // it is not a scheduled restart
                callback();
            });
        });
    });
}


/*
Create cache dump (JSON) to file before exit.
Data from dump file will be loaded to cache on next startup
*/
historyCache.dumpData = function(callback, isScheduled) {
    cache.cacheServiceIsRunning = cacheServiceIsRunning;
    if(!callback || Object.keys(cache).length < 10) { // on fast destroy or small cache don\'t overwrite dump file
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
        //fs.writeFileSync(dumpPath, JSON.stringify(cache, null, 1));
        //log.exit('Starting to save history cache data for ' + Object.keys(cache).length + ' objects to ' + dumpPath);
        fs.writeFileSync(dumpPath, JSON.stringify(cache));
        if(!isScheduled) log.exit('Finished saving history cache data for ' + Object.keys(cache).length + ' objects to ' + dumpPath);
        else log.warn('Finished saving history cache data for ' + Object.keys(cache).length + ' objects to ' + dumpPath);
    } catch(e) {
        if(!isScheduled) log.exit('Can\'t dump history cache to file ' + dumpPath + ': ' + e.message);
        else log.warn('Can\'t dump history cache to file ' + dumpPath + ': ' + e.message);
        return setTimeout(historyCache.dumpData, 1000, callback, isScheduled);
    }
    if(typeof callback === 'function') callback();
};