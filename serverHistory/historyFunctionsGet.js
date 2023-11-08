/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);

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


/**
 * Return requested records by position or by time, depend of the <num> or <shift> parameters
 *
 * @param {number} id OCID
 * @param {string|number} shift records or initial timestamp or time shift from the last record
 * @param {string|number} num records number or final timestamp or time period from the <shift>
 * @param {0|1|2|null} recordsType 0 - any, 1 - number, 2 - string.
 *  When recordsType is null, return received records in any cases
 * @param {function(Error)|function(null, Array<{data: *, timestamp: number}>)} callback
 *  callback(err, records), where records: [{data:.., timestamp:..}, ....]
 * @example
 *
 * if the parameter <num> or <shift> is passed with the prefix "#" (#<num>, #<shift>),, then records will be returned
 * according to their location in the database.
 *      <num>: the number of records to be returned, starting from the <shift> position.
 *      <shift>: this is the shift relative to the last record from the end of the storage.
 *          0 - there is no shift and the last element is used
 *     or
 *
 * if the parameter <num> or <shift> is passed without the prefix "#" (<num>, <shift>), then these parameters are
 * interpreted as time.
 *      if <shift> is a timestamp (since 1970 in ms), then <shift> is interpreted as the initial timestamp,
 *      and <num> is the final timestamp. And data will be received starting from the time <shift>, ending with the time <num>.
 *
 *      if <shift> is the number of milliseconds from the last record, then <num> is the time period for
 *      which data is required. To specify the time, you can add the suffixes 's' (seconds), 'm' (minutes),
 *      'h' (hours) or 'd' (days) after <shift> or <num>.
 */
function getFromHistory(id, shift, num, recordsType, callback) {

    var isRequiredAllRecords = false,
        clearNum = num,
        clearShift = shift;

    if(String(clearNum).charAt(0) === '!') {
        clearNum = clearNum.slice(1);
        isRequiredAllRecords = true;
    }

    if(String(clearNum).charAt(0) === '#') {
        var getFromHistory =getByIdx;
        clearNum = clearNum.slice(1);
        var isTime = false;
    }

    if(String(clearShift).charAt(0) === '#') {
        getFromHistory = getByIdx;
        clearShift = clearShift.slice(1);
        isTime = false;
    }

    if(getFromHistory === undefined) {
        getFromHistory = getByTime;
        isTime = true;
    }

    if(String(clearNum).charAt(0) === '!') {
        clearNum = clearNum.slice(1);
        isRequiredAllRecords = true;
    }

    getFromHistory(id, clearShift, clearNum, 0, function (err, rawRecords, isGotAllRecords) {
        log.debug('getFromHistory(id: ', id, ', shift: ', shift, '=>', clearShift, ', num: ', num, '=>', clearNum,
            ', maxRecordCnt: 0): rawRecords: ', rawRecords, ', isGotAllRecords: ', isGotAllRecords,
            ', recordsType: ', recordsType, ', err: ', err, {
                func: (vars) => vars.EXPECTED_OCID === vars.OCID,
                vars: {
                    "EXPECTED_OCID": id
                }
            });
        if(err) {
            Array.isArray(rawRecords) ? rawRecords.push(err.message) : rawRecords = err.message;
            return callback(err, null, rawRecords);
        }

        // may occur when disconnecting
        if(!Array.isArray(rawRecords)) return callback();

        // convert stringified Number to the Number for recordType 0(any) or 1(number)
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
            rawRecords.push('Not all required data were received from the DB: ' + records.length + '/' + num);
            return callback(null, null, rawRecords);
        }

        if(!isTime) {
            // Less than 90% of the required records were returned
            if(!clearNum || records.length / clearNum < 0.9) {
                rawRecords.push('Less than 90% of the required records were returned: ' + records.length + '/' + num);
                return callback(null, null, rawRecords);
            }
            return callback(null, records, records);
        } else {
            if(records.length < 2) {
                rawRecords.push('Less then 2 records were returned: ' + records.length +  '/' + num);
                return callback(null, null, rawRecords);
            }

            // calculating an avg time interval between the record timestamps
            for(var i = 2, avgTimeInterval = records[1].timestamp - records[0].timestamp;
                i < records.length; i++) {
                avgTimeInterval = (avgTimeInterval + records[i].timestamp - records[i-1].timestamp) / 2;
            }

            // checking for the 1477236595310 = 01/01/2000. shift is a timeFrom or timeShift; num is a timeTo or
            // timeInterval
            var timeFrom = clearShift > 1477236595310 ? clearShift : Date.now() - clearShift - clearNum;

            // checking for the first record timestamp is near the timeFrom timestamp
            // r.timestamp = 14:05:00, avgInterval = 30, timeFrom = 14:04:25
            if(records[0].timestamp - avgTimeInterval * 1.2 > timeFrom) {
                rawRecords.push('Timestamp of the first record differs by more than 20% from the timeFrom: ' +
                    'avgInterval + 20%: ' + Math.round(avgTimeInterval * 1.2 / 1000) +
                    '; timestamp - timeFrom: ' + Math.round((records[0].timestamp - timeFrom) / 1000));
                return callback(null, null, rawRecords);
            }
            return callback(null, records, records);
        }
    });
}