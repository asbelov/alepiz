/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//var log = require('../lib/log')(module);

var getByIdx = function () {};
var getByTime = function () {};

function initFunctions(_getByIdx, _getByTime) {
    getByIdx = _getByIdx;
    getByTime = _getByTime;
}

var historyGet = {
    initFunctions: initFunctions,
    get: getFromHistory,
};

module.exports = historyGet;


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
function getFromHistory(id, shift, num, recordsType, callback) {

    var isRequiredAllRecords = false;
    if(String(num).charAt(0) === '!') {
        num = num.slice(1);
        isRequiredAllRecords = true;
    }

    if(String(num).charAt(0) === '#') {
        var getFromHistory =getByIdx;
        num = num.slice(1);
        var isTime = false;
    }

    if(String(shift).charAt(0) === '#') {
        getFromHistory = getByIdx;
        shift = shift.slice(1);
        isTime = false;
    }

    if(getFromHistory === undefined) {
        getFromHistory = getByTime;
        isTime = true;
    }

    if(String(num).charAt(0) === '!') {
        num = num.slice(1);
        isRequiredAllRecords = true;
    }

    getFromHistory(id, shift, num, 0, function (err, rawRecords, isGotAllRecords) {
        //if(id === 155103) log.warn(id, ': shift: ', shift, '; num: ', num, '; isRequiredAllRecords: ', isRequiredAllRecords, '; rawRecords: ', rawRecords, '; isGotAllRecords: ', isGotAllRecords);
        //if(id === 155362) log.warn(id, ': shift: ', shift, '; num: ', num, '; isRequiredAllRecords: ', isRequiredAllRecords, '; rawRecords: ', rawRecords, '; isGotAllRecords: ', isGotAllRecords);
        if(err) {
            Array.isArray(rawRecords) ? rawRecords.push(err.message) : rawRecords = err.message;
            return callback(err, null, rawRecords);
        }

        // can be on disconnect
        if(!Array.isArray(rawRecords)) return callback();

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
            return callback(null, records, records);
        }

        // used in a history functions, if not got all required records, return nothing
        if(!isGotAllRecords) {
            rawRecords.push('No data from the database');
            return callback(null, null, rawRecords);
        }

        if(!isTime) {
            // return less the 90% of requirement records
            if(!num || records.length / num < 0.9) {
                rawRecords.push('records: ' + records.length + '; num: ', num);
                return callback(null, null, rawRecords);
            }
            return callback(null, records, records);
        } else {
            if(records.length < 2) {
                rawRecords.push('Returned ' + records.length + ' records');
                return callback(null, null, rawRecords);
            }

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
                rawRecords.push('avgInterval + 20%: ' + Math.round(avgTimeInterval * 1.2 / 1000) +
                    '; timestamp - timeFrom: ' + Math.round((records[0].timestamp - timeFrom) / 1000));
                return callback(null, null, rawRecords);
            }
            return callback(null, records, records);
        }
    });
}