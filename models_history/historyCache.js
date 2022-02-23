/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.09.2016.
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
var countersDB = require('../models_db/countersDB'); // for init housekeeper

var historyCache = {};
module.exports = historyCache;

var cache = new Map(), functions = new Map();
var dumpPath = path.join(__dirname, '..', parameters.tempDir, parameters.dumpFileName);
var cacheServiceIsRunning = 0;
var terminateCacheService = 0;
var cacheServiceCallback = null;
var recordsFromCacheCnt = 0;
var recordsFromStorageCnt = 0;
var storageRetrievingDataComplete = 0;
var storageRetrievingDataIncomplete = 0;
var historyAddOperationsCnt = 0;
var duplicateRecordsCnt = 0;
var lateAndSkippedRecordsCnt = 0;
var lateRecordsCnt = 0;


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

    loadDataFromDumpToCache(dumpPath, function(err) {
        if(err) return callback(err); // only if can\'t close dump file

        storage.initStorage(parameters, function(err) {
            if(err) return callback(err);

            setInterval(cacheService, parameters.cacheServiceInterval * 1000); // sec
            setTimeout(printHistoryInfo, 30000);

            callback();
        });
    });

    function printHistoryInfo() {
        historyCache.getTransactionsQueueInfo(function (err, transQueue) {
            log.info('Records returned from cache\\storage: ', recordsFromCacheCnt, '\\', recordsFromStorageCnt,
                '; records new\\duplicate\\late30sec\\lateNotInserted: ',
                historyAddOperationsCnt,'\\', duplicateRecordsCnt, '\\', lateRecordsCnt, '\\', lateAndSkippedRecordsCnt,
                '; storage retrieving data complete\\incomplete: ', storageRetrievingDataComplete,
                '\\', storageRetrievingDataIncomplete,
                '; transaction queue: ', transQueue.len,
                (transQueue.timestamp ?
                    ', last transaction started at ' + (new Date(transQueue.timestamp)).toLocaleString()  +
                    '(' + transQueue.description + ')' :
                    ', no transaction in progress'));

            recordsFromCacheCnt = recordsFromStorageCnt = 0;
            storageRetrievingDataComplete = storageRetrievingDataIncomplete = 0;
            historyAddOperationsCnt = duplicateRecordsCnt = lateRecordsCnt = lateAndSkippedRecordsCnt = 0;
            setTimeout(printHistoryInfo, 40000);
        });
    }
};

historyCache.getDBPath = storage.getDbPaths;

historyCache.startCacheService = cacheService;

historyCache.addCallbackToCacheService = function (callback) {
    cacheServiceCallback = callback;
}

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
                    var cacheObj = JSON.parse(String(data));
                } catch (err) {
                    log.error('Can\'t parse dump data from ' + dumpPath + ' as JSON object: ' + err.message);
                    return callback();
                }

                if (!cacheObj) return callback();

                var loadedRecords = 0, unsavedRecords = 0;
                for (var id in cacheObj) {
                    if(cacheObj[id] && Array.isArray(cacheObj[id].records)) {
                        cache.set(Number(id), cacheObj[id]);
                        loadedRecords += cacheObj[id].records.length;
                        unsavedRecords += cacheObj[id].records.length - cacheObj[id].savedCnt;
                    }
                }

                if (!loadedRecords) {
                    log.info('Dump has no records for cache');
                    return callback();
                }

                log.info('Loaded ', loadedRecords, ' records including ', unsavedRecords,' unsaved records for ', cache.size,' objects.');
                callback();
            })
        });
    });
}

function createNewCacheObject(id) {
    cache.set(Number(id), {
        cachedRecords: parameters.initCachedRecords,
        savedCnt: 0, // Count of saved records, 'records' is an array of the last data returned from counters
        records: [],
    });
}

/*
    add new record to the end of cache

    id: object ID
    newRecord: {timestamp: ..., record: ...}
 */
historyCache.add = function (id, newRecord){
    // the record was checked on the client side using the history.add () function

    //log.debug('Adding data to history: id ', id, ' newRecord: ', newRecord);
    id = Number(id);
    ++historyAddOperationsCnt;
    if(!cache.has(id)) {
        createNewCacheObject(id);
        cache.get(id).records = [newRecord];
        //log.debug('Inserting newRecord for new object to history. id: ', id, ' newRecord: ', newRecord);
    } else {
        var cacheObj = cache.get(id), recordsInCacheCnt = cacheObj.records.length;

        // TODO: add throttling support in counter settings
        // if throttling is enabled for this objectID
        // Don't create new record for a new data which equal to  data from last record in a cache.
        // Only change last record timestamp
        if(cacheObj.throttling &&
            recordsInCacheCnt > 2 &&
            cacheObj.records[recordsInCacheCnt-1].data === newRecord.data &&
            cacheObj.records[recordsInCacheCnt-2].data === newRecord.data
        ) {
            cacheObj.records[recordsInCacheCnt-1].timestamp = newRecord.timestamp;
            //log.debug('Inserting new timestamp for newRecord, equal to previous to history. id: ', id, ' newRecord: ', newRecord, ' records in cache: ', cacheObj.records);
        } else { // add a new record to the cache otherwise
          //log.debug('Inserting new newRecord to history. id: ', id, ' newRecord: ', newRecord);

            if(!recordsInCacheCnt || cacheObj.records[recordsInCacheCnt-1].timestamp < newRecord.timestamp) {
                if(checkDuplicateRecords(recordsInCacheCnt, id, recordsInCacheCnt-1, newRecord)) return;
                cacheObj.records.push(newRecord);
            } else {
                if(recordsInCacheCnt === 1) { // one record in cache with timestamp > newRecord.timestamp
                    if(checkDuplicateRecords(recordsInCacheCnt, id, 0, newRecord)) return;
                    cacheObj.records.unshift(newRecord);
                } else if(cacheObj.records[0].timestamp > newRecord.timestamp) {
                    log.warn('Don\'t add a record for the object ', id, ' with a timestamp (',
                        new Date(newRecord.timestamp).toLocaleString() + '.' + newRecord.timestamp % 1000,
                        ') less than the latest record (',
                        new Date(cacheObj.records[0].timestamp).toLocaleString() + '.' + cacheObj.records[0].timestamp % 1000,
                        ') in the cache. New record: ', newRecord, ', latest in cache: ', cacheObj.records[0]);
                    ++lateAndSkippedRecordsCnt;
                } else {
                    // inserting new record into the cache in position according to new record timestamp for save correct records order
                    for (var i = recordsInCacheCnt - 2; i >= 0; i--) {
                        if (cacheObj.records[i].timestamp < newRecord.timestamp) {
                            if(checkDuplicateRecords(recordsInCacheCnt, id, i+1, newRecord)) return;
                            cacheObj.records.splice(i, 0, newRecord);
                            break;
                        }
                    }
                }
            }
        }
    }
};

historyCache.addFunctionResultToCache = function (id, functionName, parameters, result) {
    id = Number(id);
    if(!cache.has(id)) createNewCacheObject(id);

    var cacheObj = cache.get(id),
        key = functionName + '_' + Array.isArray(parameters) ? parameters.map(p => p.toLowerCase()).join(',') : '';
    // functions[id][<funcName>_<parameters>] = {timestamp:.., result:..}
    functions.set(id, new Map().set(key, new Map()
        .set('result', result)
        .set('timestamp', cacheObj.records && cacheObj.records.length ? cacheObj.records[cacheObj.records.length - 1].timestamp : null)));
}

historyCache.getFunctionResultFromCache = function (id, functionName, parameters) {
    id = Number(id);
    if(!cache.has(id) || !functions.has(id)) return;

    // functions[id][<funcName>_<parameters>] = {timestamp:.., result:..}
    var func = functions.get(id), records = cache.get(id).records;

    var key = functionName + '_' + Array.isArray(parameters) ? parameters.map(p => p.toLowerCase()).sort().join(',') : '';
    if(!func.has(key)) return;

    var funcResult = func.get(key);
    var timestamp = records && records.length ? records[records.length - 1].timestamp : null;
    if(funcResult.get('timestamp') === timestamp) {
        // return objects for make possible return undefined function result and make possible for difference between
        // undefined result and not present result in the cache
        return {
            result: funcResult.get('result'),
        };
    }

    func.delete(key);
}

function checkDuplicateRecords(recordsInCacheCnt, id, idx, newRecord) {
    var cacheObj  = cache.get(id);
    if(recordsInCacheCnt && cacheObj.records[idx].timestamp === newRecord.timestamp &&
        cacheObj.records[idx].data === newRecord.data) {
        log.debug('Received duplicate record ', id, ' with a timestamp ',
            new Date(newRecord.timestamp).toLocaleString() + '.' + newRecord.timestamp % 1000,
            ': ', newRecord.data);
        ++duplicateRecordsCnt;

        return true;
    }
    if(Date.now() - newRecord.timestamp > 30000) ++lateRecordsCnt;
    return false
}

/*
    removing all history for specific object

    id: objectID
    daysToKeepHistory - delete only files older than this parameter (in days)
    callback(err)
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
        if(err) return callback(err);

        // remove records from cache after commit transaction
        IDs.forEach(function (id) {
            id = Number(id);
            var cacheObj = cache.get(id);
            if(cacheObj !== undefined) {
                if (!daysToKeepHistory) {
                    cache.delete(id)
                    functions.delete(id)
                } else {
                    // save all records if the time of the first record is longer than the storage time of the records
                    if(!cacheObj.records.length ||
                        (cacheObj.records[0] && cacheObj.records[0].timestamp > lastTimeToKeepHistory)) return;

                    // remove all records if the time of the last record is less than the storage time of the records
                    var lastRecord = cacheObj.records[cacheObj.records.length - 1];
                    if (lastRecord && lastRecord.timestamp < lastTimeToKeepHistory) {
                        cacheObj.records = [];
                        cacheObj.savedCnt = 0;
                        return;
                    }

                    // find records for removing the record time longer then the storage time of the records
                    for (var recordsToDelete = 1; recordsToDelete < cacheObj.records.length; recordsToDelete++) {
                        if (cacheObj.records[recordsToDelete].timestamp > lastTimeToKeepHistory) break;
                    }

                    cacheObj.records.splice(0, recordsToDelete);
                    cacheObj.savedCnt -= recordsToDelete;
                    if(cacheObj.savedCnt < 0) cacheObj.savedCnt = 0;
                }
            }
        });

        callback();
    });
};

historyCache.getByValue = function(id, value, callback) {
    if(typeof callback !== 'function') return log.error('[getByValue]: callback is not a function', (new Error()).stack);

    id = Number(id);
    if(id !== parseInt(String(id), 10) || !id) return callback(new Error('[getByValue] incorrect object ID '+id));

    if(!isNaN(parseFloat(value)) && isFinite(value)) value = Number(value);

    var cacheObj = cache.get(id);
    if(cacheObj && cacheObj.records && cacheObj.records.length) {
        for(var i = 0; i < cacheObj.records.length; i++) {
            if(cacheObj.records[i].data === value) return callback(null, cacheObj.records[i].timestamp);
        }
    }

    storage.getLastRecordTimestampForValue(id, value, callback);
};

/*
    get requested records by position or by time, depend on format of the 'shift' parameter

    id: object ID

    if format of 'num' parameter is a #<num> and\or 'shift' is #<shift>, then get records by position.
    shift: it's a last record position from the end of the storage. 0 - last element
    num: count of the requirement records from the last position. 0 - only one element with a 'last' position

    or

    if format of 'num' parameter is a <num>, then get records by time
     'shift' and 'num' parameters:
     1. if 'shift' is a timestamp (from 1970 in ms) - it interpretable as "time from". 'num' must be a timestamp too, and it is interpretable as "time to"
     2. if 'shift' is ms from last record. 'num' - time interval in ms from 'shift'
     you can add suffix 's', 'm', 'h' or 'd' to the end of time parameters 'shift' or 'num'.
     It means seconds for 's', minutes for 'm', hours for 'h' and days for 'd'

    callback(err, records), where records: [{data:.., timestamp:..}, ....]

 */
historyCache.get = function (id, shift, num, recordsType, callback) {

    var isRequiredAllRecords = false;
    if(String(num).charAt(0) === '!') {
        num = num.slice(1);
        isRequiredAllRecords = true;
    }

    if(String(num).charAt(0) === '#') {
        var getFromHistory = historyCache.getByIdx;
        num = num.slice(1);
        var isTime = false;
    }

    if(String(shift).charAt(0) === '#') {
        getFromHistory = historyCache.getByIdx;
        shift = shift.slice(1);
        isTime = false;
    }

    if(getFromHistory === undefined) {
        getFromHistory = historyCache.getByTime;
        isTime = true;
    }

    if(String(num).charAt(0) === '!') {
        num = num.slice(1);
        isRequiredAllRecords = true;
    }

    getFromHistory(id, shift, num, 0, recordsType, function (err, rawRecords, isGotAllRecords) {
        //if(id === 155103) log.info(id, ': shift: ', shift, '; num: ', num, '; isRequiredAllRecords: ', isRequiredAllRecords, '; rawRecords: ', rawRecords, '; isGotAllRecords: ', isGotAllRecords);
        if(err) {
            ++storageRetrievingDataIncomplete;
            Array.isArray(rawRecords) ? rawRecords.push(err.message) : rawRecords = err.message;
            return callback(err, null, rawRecords);
        }

        // convert numeric to Number
        if(recordsType < 2) {
            var records = rawRecords.map(function (record) {
                if (!isNaN(parseFloat(record.data)) && isFinite(record.data)) {
                    return {
                        timestamp: record.timestamp,
                        data: Number(record.data),
                    }
                } else return record;
            });
        } else records = rawRecords;

        // when recordsType is null, return received records in any cases
        if(recordsType === null || !isRequiredAllRecords) {
            ++storageRetrievingDataComplete;
            return callback(null, records, records);
        }

        // used in a history functions, if not got all required records, return nothing
        if(!isGotAllRecords) {
            ++storageRetrievingDataIncomplete;
            rawRecords.push('No data from the database');
            return callback(null, null, rawRecords);
        }

        if(!isTime) {
            // return less the 90% of requirement records
            if(!num || records.length / num < 0.9) {
                ++storageRetrievingDataIncomplete;
                rawRecords.push('records: ' + records.length + '; num: ', num);
                return callback(null, null, rawRecords);
            }
            ++storageRetrievingDataComplete;
            return callback(null, records, records);
        } else {
            if(records.length < 2) {
                ++storageRetrievingDataIncomplete;
                rawRecords.push('Returned ' + records.length + ' records');
                return callback(null, null, rawRecords);
            }
/*
            if(records.length === 1) {
                ++storageRetrievingDataComplete;
                return callback(null, records, records);
            }
*/

            // calculating an avg time interval between the record timestamps
            for(var i = 2, avgTimeInterval = records[1].timestamp - records[0].timestamp; i < records.length; i++) {
                avgTimeInterval = (avgTimeInterval + records[i].timestamp - records[i-1].timestamp) / 2;
            }

            // checking for the 1477236595310 = 01/01/2000. shift is a timeFrom or timeShift; num is a timeTo or
            // timeInterval
            var timeFrom = shift > 1477236595310 ? shift : Date.now() - shift - num;

            // checking for the last record timestamp is near the timeFrom timestamp
            // r.timestamp = 14:05:00, avgInterval = 30, timeFrom = 14:04:25
            if(records[0].timestamp - avgTimeInterval * 1.2 > timeFrom) {
                ++storageRetrievingDataIncomplete;
                rawRecords.push('avgInterval + 20%: ' + Math.round(avgTimeInterval * 1.2 / 1000) +
                    '; timestamp - timeFrom: ' + Math.round((records[0].timestamp - timeFrom) / 1000));
                return callback(null, null, rawRecords);
            }
            ++storageRetrievingDataComplete;
            return callback(null, records, records);
        }
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
    if(typeof callback !== 'function') return log.error('[getLastValues]: callback is not a function', (new Error()).stack);

    var records = {}, errors = [];
    //log.debug('Getting last values for ', IDs);
    async.each(IDs, function (id, callback) {
        if(records[id]) return callback();

        records[id] = {};
        historyCache.getLastValue(id,function (err, record) {
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

historyCache.getLastValue = function (id, callback) {
    if(typeof callback !== 'function') return log.error('[getLastValue]: callback is not a function: ', (new Error()).stack);

    id = Number(id);
    var cacheObj = cache.get(id);

    if(cacheObj && cacheObj.records && cacheObj.records.length) {
        return callback(null, [cacheObj.records[cacheObj.records.length - 1]], true);
    }

    //log.warn('Can\'t get last value for ', id,' from history cache: ', cache.get(id));
    historyCache.getByIdx(id, 0, 1, 0, 0, callback);
}
/*
    get requested records by position

    id: object ID
    offset: record position from the end of the storage. 0 - last element
    cnt: count of the requirement records from the last position. 0 - only one element with a 'last' position
    callback(err, records, isGotAllRequiredRecords(true|false)), where records: [{data:.., timestamp:..}, ....]

 */
historyCache.getByIdx = function(id, offset, cnt, maxRecordsCnt, recordsType, callback) {
    if(typeof callback !== 'function') return log.error('[getByIdx]: callback is not a function: ', (new Error()).stack);

    if(recordsType === undefined) recordsType = 0;
    offset = Number(offset); cnt = Number(cnt); id = Number(id);
    if(cnt === 0) return callback(null, [], false);
    if(Number(id) !== parseInt(String(id), 10) || !id) return callback(new Error('[getByIdx] incorrect object ID '+id));
    if(Number(offset) !== parseInt(String(offset), 10) || offset < 0) return callback(new Error('[getByIdx] incorrect "offset" parameter ('+offset+') for objectID '+id));
    if(Number(cnt) !== parseInt(String(cnt), 10) || cnt < 1) return callback(new Error('[getByIdx] incorrect "cnt" parameter ('+cnt+') for objectID '+id));

    var cacheObj = cache.get(id);

    if(cacheObj && cacheObj.records && cacheObj.records.length) {
        var recordsFromCache = cacheObj.records.slice(-(offset+cnt), offset ? -offset : cacheObj.records.length);
        recordsFromCacheCnt += recordsFromCache.length;

        if(recordsFromCache.length === cnt) {
            calculateCacheSize(cacheObj, 0, recordsFromCache);
            return callback(null, recordsFromCache, true);
        }
    } else {
        recordsFromCache = [];
        // create new cache object cache[id] and make reference cacheObj = cache[id]
        createNewCacheObject(id);
        cache.get(id).cachedRecords = cnt; // not parameters.initCachedRecords because you will read only cnt records to the cache
        cacheObj = cache.get(id);
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

    storage.getRecordsFromStorageByIdx(id, storageOffset, storageCnt, storageTimestamp, maxRecordsCnt, recordsType,
        function(err, recordsFromStorage) {
        if (err) return callback(err);
        if(!Array.isArray(recordsFromStorage) || !recordsFromStorage.length) return callback(err, recordsFromCache, false);

        recordsFromStorageCnt += recordsFromStorage.length;
        calculateCacheSize(cacheObj, recordsFromStorage);
        addDataToCache(cacheObj, recordsFromStorage); // add records loaded from storage to cache

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
    if (typeof callback !== 'function') return log.error('[getByTime]: callback is not a function', (new Error()).stack);

    if(recordsType === undefined) recordsType = 0;
    id = Number(id); timeShift = Number(timeShift); timeInterval = Number(timeInterval);
    if (id !== parseInt(String(id), 10) || !id) return callback(new Error('[getByTime] incorrect ID ' + id));
    if (timeShift !== parseInt(String(timeShift), 10) || timeShift < 0) {
        return callback(new Error('[getByTime] incorrect "timeShift" parameter (' + timeShift + ') for objectID ' + id));
    }
    if (timeInterval !== parseInt(String(timeInterval), 10) || timeInterval < 0) {
        return callback(new Error('[getByTime] incorrect "timeInterval" parameter (' + timeInterval + ') for objectID ' + id));
    }

    // return last value
    if(timeInterval === 0) return historyCache.getByIdx(id, 0, 1, 0, 0, callback);

    // return empty array for small-time interval
    //if(timeInterval < 60000) return callback(null, []);

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
    if(cacheObj && cacheObj.records) {
        // last record timestamp in cache less than required timestamp in timeFrom. History have no data for required time interval
        if(cacheObj.records.length && timeFrom > cacheObj.records[cacheObj.records.length - 1].timestamp) {
            return callback(null, [], false);
        }
        // checking for present required records in cache.
        // timestamps: [10:00, 10:05, 10:10, 10:15, 10:20]. timeTo 10:05 - present; timeTo 09:50 - not present in cache
        if(cacheObj.records.length && timeTo > cacheObj.records[0].timestamp) {
            var lastRecordIdxInCache = findRecordIdx(cacheObj.records, timeTo, 0, cacheObj.records.length - 1);
            var firstRecordIdxInCache = findRecordIdx(cacheObj.records, timeFrom, 0, lastRecordIdxInCache);
            // findRecordIdx find the nearest record position to timestamp.
            // But first record timestamp must be more than timeFrom and last record timestamp must be less than timeTo.
            if (cacheObj.records[firstRecordIdxInCache].timestamp < timeFrom) ++firstRecordIdxInCache;
            if (lastRecordIdxInCache && cacheObj.records[lastRecordIdxInCache].timestamp > timeTo) --lastRecordIdxInCache;

            // lastRecordIdxInCache + 1 because slice is not include last element to result
            // var recordsFromCache = cacheObj.records.slice(firstRecordIdxInCache, lastRecordIdxInCache + 1);
            // Don\'t use slice, copy every record from cache to a new array
            for(var recordsFromCache = [], i = firstRecordIdxInCache; i <= lastRecordIdxInCache; i++) {
                recordsFromCache.push({
                    timestamp: cacheObj.records[i].timestamp,
                    data: cacheObj.records[i].data
                });
            }
            recordsFromCacheCnt += recordsFromCache.length;
            if(recordsFromCache.length) {
                recordsFromCache[0].isDataFromTrends = false;
                recordsFromCache[0].recordsFromCache = recordsFromCache.length;
            }

            //log.debug(id, ': !!! records form cache: ', recordsFromCache, '; firstRecordIdxInCache: ', firstRecordIdxInCache, '; lastRecordIdxInCache: ', lastRecordIdxInCache, '; ', cacheObj);
            if (firstRecordIdxInCache) { // firstRecordIdxInCache !== 0
                calculateCacheSize(cacheObj, 0, recordsFromCache);
                return callback(null, recordsFromCache, true);
            }
        } else recordsFromCache = [];
    } else {
        recordsFromCache = [];
        // create new cache object cache[id] and make reference cacheObj = cache.get(id)
        createNewCacheObject(id);
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
            if(!Array.isArray(recordsFromStorage) || !recordsFromStorage.length) return callback(err, recordsFromCache, false);

            recordsFromStorageCnt += recordsFromStorage.length;

            var isDataFromTrends = recordsFromStorage.length ? recordsFromStorage[0].isDataFromTrends : false;

            if(!isDataFromTrends) {
                calculateCacheSize(cacheObj, recordsFromStorage);
                addDataToCache(cacheObj, recordsFromStorage);
            }

            if(recordsFromCache.length &&
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

 cacheObj: cache.get(id)
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
    cache:                  8 9 10 11 12
    cacheObj.cachedRecords = 9; cacheObj.records.length = 5; recordsFromStorage.length = 7;
    slice(begin: 2, end: 7): begin = 7 - (9-5) - 1= 2
     */
    var begin = recordsFromStorage.length - (cacheObj.cachedRecords - cacheObj.records.length) -1;
    if(begin < 0) begin = 0;
    // add recordsFromStorage to the beginning of the cache.records
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

/** Saving history cache to database
 *
 * @param {function(Error)|function(): void} [callback] - call when done. Can return error
 */
function cacheService(callback) {
    if(cacheServiceIsRunning > 0 && cacheServiceIsRunning < 100) return; // waiting for scheduled restart
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
            log.warn('Cache service was running at ', (new Date(cacheServiceIsRunning)).toLocaleString(), '. Prevent to start another copy of service');
            if (parameters.cacheServiceExitTimeout && Date.now() - cacheServiceIsRunning < parameters.cacheServiceExitTimeout) return callback(); // < 24 hours

            log.exit('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() + '. It\'s too long. Something was wrong. Exiting...');
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

                // cacheObj = {savedCnt:, cachedRecords:, records: [{data:, timestamp:},...]}
                async.eachSeries(Array.from(cache.keys()), function (id, callback) {
                    if (terminateCacheService) return callback();

                    // don\'t save history for keepHistory = 0
                    if(!houseKeeperData[id] || !houseKeeperData[id].history) {
                        //log.info ('Skipping to save obj ', id, ': ', houseKeeperData[id])
                        return callback();
                    }

                    if (cacheServiceIsRunning > 100 && parameters.cacheServiceTimeout &&// it is not a scheduled restart
                        Date.now() - cacheServiceIsRunning > parameters.cacheServiceTimeout) { // 1 hour
                        log.warn('Cache service was running at ' + (new Date(cacheServiceIsRunning)).toLocaleString() +
                            '. It\'s too long. Something was wrong. Terminating...');
                        terminateCacheService = Date.now();
                        // cache service will be terminated because now if(terminateCacheService) condition will be always true
                        return callback();
                    }

                    // print progress every 1 minutes
                    ++savedObjects;
                    if (nextTimeToPrint < Date.now()) {
                        nextTimeToPrint = Date.now() + timeInterval;
                        var objectsCnt = cache.size;
                        log.info('Saved cache to database ', Math.ceil(savedObjects * 100 / objectsCnt),
                            '% (', savedObjects, '/', objectsCnt, ' objects, ', savedRecords, ' records, ', savedTrends, ' trends)');
                    }

                    // object may be removed while processing cache saving operation or nothing to save
                    var cacheObj = cache.get(id);

                    // cacheObj.records.length <= cacheObj.savedCnt - are all records saved in the DB?
                    if (!cacheObj || !cacheObj.records || cacheObj.records.length <= cacheObj.savedCnt) return callback();

                    var callbackAlreadyCalled = false;
                    if(parameters.cacheServiceTimeoutForSaveObjectRecords) {
                        var watchDogTimerID = setTimeout(function () {
                            callbackAlreadyCalled = true;
                            terminateCacheService = Date.now();
                            log.error('Time to saving records for OCID ' + id + ' (counter: ', houseKeeperData[id].name,
                                ') form cache to database too long (',
                                (parameters.cacheServiceTimeoutForSaveObjectRecords / 60000),
                                'min). Stop waiting to save records for an object and terminating cache service');
                            callback();
                        }, parameters.cacheServiceTimeoutForSaveObjectRecords); // 5 min
                    }

                    var startTime = cacheObj.records[0].timestamp,
                        endTime = cacheObj.records[cacheObj.records.length - 1].timestamp;
                    // more than one record per second
                    if(endTime - startTime > 30000 &&
                        cacheObj.records.length > 100 &&
                        cacheObj.records.length / ((endTime - startTime)  / 1000) > 1
                    ) {
                        log.warn('For OCID ', id ,' (counter: ', houseKeeperData[id].name,
                            ') a large amount of data will be saved: ', cacheObj.records.length,
                            ' records in ', Math.round((endTime - startTime) / 1000 ),' seconds: ',
                            Math.round(cacheObj.records.length / ((endTime - startTime)  / 1000)), ' records/sec');
                    }

                    // savedCnt - Number of saved records (3)
                    // copy to recordsForSave 0 to end (9) - savedCnt (3)
                    var recordsForSave = cacheObj.records.slice(cacheObj.savedCnt);
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
                            !!! BE ATANTION !!!
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

                                if(savedData[0].result.id) {
                                    var cacheObj = cache.get(savedData[0].result.id);
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
                        // removing records from cache after commit transactions
                        // and calculate records number
                        if (!err) { // error will include async error
                            var allRecordsInCache = 0, allRecordsInCacheWas = 0, allUnnecessaryRecordsCnt = 0;
                            for (var id of cache.keys()) {
                                var cacheObj = cache.get(id);
                                if (!Array.isArray(cacheObj.records)) continue;
                                allRecordsInCacheWas += cacheObj.records.length;

                                var unnecessaryCachedRecordsCnt = cacheObj.records.length - cacheObj.cachedRecords;
                                if (unnecessaryCachedRecordsCnt < 0) unnecessaryCachedRecordsCnt = 0;

                                var recordsForRemoveFromCache = unnecessaryCachedRecordsCnt > cacheObj.savedCnt ?
                                    cacheObj.savedCnt : unnecessaryCachedRecordsCnt;
                                //log.info('ID: ', id, ' recordsLen:', cacheObj.records.length, ' cachedRecords:', cacheObj.cachedRecords, ' savedCnt:', cacheObj.savedCnt, ' unnecessary:', unnecessaryCachedRecordsCnt, ' removed:', recordsForRemoveFromCache)
                                if (recordsForRemoveFromCache) {

                                    // [0,1,2,3,4,5]; recordsForRemoveFromCache = 3
                                    // slice(3) = [3,4,5]; splice(0, 3) = [3,4,5]
                                    // slice used for create a new array and cleanup memory
                                    cacheObj.records = cacheObj.records.slice(recordsForRemoveFromCache);
                                    //cacheObj.records.splice(0, recordsForRemoveFromCache);

                                    cacheObj.savedCnt = cacheObj.savedCnt > recordsForRemoveFromCache ?
                                        cacheObj.savedCnt - recordsForRemoveFromCache : 0;
                                    allUnnecessaryRecordsCnt += recordsForRemoveFromCache;
                                } else if(recordsForRemoveFromCache === undefined) {
                                    allUnnecessaryRecordsCnt += cacheObj.records.length;
                                    cacheObj.records = [];
                                }

                                allRecordsInCache += cacheObj.records.length;
                            }
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
                        if (cacheServiceIsRunning > 100) cacheServiceIsRunning = 0; // it is not a scheduled restart
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
 * @type {function(callback, boolean): void}
 * @param {function(void): void} callback - Called when done
 * @param {boolean|undefined} [isScheduled=undefined] - the function is called when the history is scheduled to restart
 */

historyCache.dumpData = function(callback, isScheduled) {

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
        fs.writeFileSync(dumpPath, JSON.stringify(Object.fromEntries(cache.entries())));
        if(!isScheduled) log.exit('Finished dumping history cache data for ' + cache.size + ' objects to ' + dumpPath);
        else log.warn('Finished dumping history cache data for ' + cache.size + ' objects to ' + dumpPath);
    } catch(e) {
        if(!isScheduled) log.exit('Can\'t dump history cache to file ' + dumpPath + ': ' + e.message);
        else log.warn('Can\'t dump history cache to file ' + dumpPath + ': ' + e.message);
        return setTimeout(historyCache.dumpData, 1000, callback, isScheduled);
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