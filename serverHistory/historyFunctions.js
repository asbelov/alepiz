/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var history = require('./historyFunctionsGet');

var functions = {};
module.exports = functions;

/*
    all functions return
    callback(err, result), where result is a result of function execution

    see functions.XXX.description for help
 */

functions.avg = function(id, parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Error in parameters for "avg('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;

    history.get(id, shift, num, 1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "avg('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        for(var i = 0, sum = 0, count = 0; i < records.length; i++) {
            sum += records[i].data;
            count++;
        }

        var result = sum / count;
        log.debug('FUNC: avg(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.avg.description = 'Average value of an item within the defined evaluation period.\n' +
    '\n' +
    'avg(<period>, [<timeShift>])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'avg(<timestampFrom>, <timestampTo>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    '\n' +
    'avg(#<recordsCnt>, [#<recordsShift>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n';


functions.change = function(id, parameters, callback) {

    var num = parameters[0] ? parameters[0] : '#2';
    var shift = parameters[1] ? parameters[1] : 0;
    var recordsType = parameters[2] ? 2: 1;
    var isAbs = parameters[3];

    if(String(num).charAt(0) === '#' && Number(num.slice(1)) < 2) {
        return callback(null, {records: 'require only one record: ' + num});
    }

    history.get(id, shift, num, recordsType, function(err, records, rawRecords) {
        if(err) {
            return callback(new Error('Error occurred while getting data from history for "change(' +
                parameters.join(', ') + ')" function for objectID: ' + id + ': ' + err.message));
        }

        if(!records) return callback(null, {records: rawRecords});

        if(records.length < 2 || !records[0] || !records[records.length - 1] ||
            records[0].data === undefined || records[records.length - 1].data === undefined) {
            /*
            return callback(new Error('No first or last records returned for "change(' + parameters.join(', ') +
            ')" function for objectID: ' + id), {records: rawRecords});
             */
            return callback(null, {records: rawRecords});
        }

        var first = records[0].data;
        var last = records[records.length - 1].data;

        var result;
        if(typeof first === 'number' && typeof last === 'number') {
            result = isAbs ? Math.abs(last - first) : last - first;
        } else if(isAbs && typeof last === 'string' && typeof first === 'string') {
                result = last.toUpperCase() === first.toUpperCase() ? 0: 1;
        } else result = last === first ? 0: 1;

        log.debug('FUNC: [abs]change(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.change.description = 'The amount of difference between first and last values in specific interval.\n' +
    '\n' +
    'change([<period>], [<timeShift>], [<dataType>])\n' +
    'period: evaluation period in milliseconds, default #2 records\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'change(<timestampFrom>, <timestampTo>, [<dataType>])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'change([#<recordsCnt>], [#<recordsShift>], [<dataType>])\n' +
    'recordsCnt: count of records from the recordsShift, , default #2 records\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'if parameters are not specified, then will be comparing last and previous values\n' +
    'For strings used case-sensitive (for case-insensitive use absChange) compare and return:\n' +
    ' 0 - values are equal\n' +
    ' 1 - values differ';

functions.absChange = function(id, parameters, callback){
    parameters[3] = 'absolute';
    functions.change(id, parameters, callback);
};

functions.absChange.description = 'The amount of absolute difference between first and last values in specific interval.\n' +
    '\n' +
    'absChange([<period>], [<timeShift>], [<dataType>])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'abschange(<timestampFrom>, <timestampTo>, [<dataType>])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'abschange([#<recordsCnt>], [#<recordsShift>], [<dataType>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'dataType: [0|1] data type for compare: number(0) - default or string(1)\n' +
    '\n' +
    'if parameters are not specified, then will be comparing last and previous values\n' +
    'For strings used case-insensitive (for case-sensitive use change()) compare and return:\n' +
    ' 0 - values are equal\n' +
    ' 1 - values differ';

var compare  = {
    'eq': function(x,y) {return x === y},
    'ne': function(x,y) {return x !== y},
    'gt': function(x,y) {return x > y},
    'ge': function(x,y) {return x >= y},
    'lt': function(x,y) {return x < y},
    'le': function(x,y) {return x <= y},
    'eqstr': function(x,y) {return x === y},
    'ieqstr': function(x,y) {return x.toUpperCase() === y.toUpperCase()},
    'like': function(x,y) {return String(x).indexOf(String(y)) !== -1},
    'ilike': function(x,y) {return String(x).toUpperCase().indexOf(String(y).toUpperCase()) !== -1},
    'regexp': function(x,y) { return (new RegExp(y)).test(x); },
    'iregexp': function(x,y) { return (new RegExp(y, 'i')).test(x); },
    'nearest': function(x,y,z) { return !isNaN(parseFloat(String(x))) && isFinite(x) && Number(x) > y-z && Number(x) < y+z }
};

functions.count = function(id, parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Error in parameters for "count('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var pattern = parameters[2];
    var operator = parameters[3];

    if(!operator) operator = 'eq';
    else if(!isNaN(parseFloat(String(operator))) && isFinite(operator)) {
        if(!isNaN(parseFloat(String(pattern))) && isFinite(pattern)) {
            var outlier = Number(operator);
            pattern = Number(pattern);
            operator = 'nearest';
        } else return callback(new Error('Error occurred while getting data from history for "count('+parameters.join(', ')+')" function for objectID: '+ id +': <pattern> is not a number'));
    } else {
        operator = operator.toLowerCase();
        if(!(operator in compare)) return callback(new Error('Invalid compare operator "'+operator+'" in function count('+parameters.join(', ')+') for objectID '+id));
    }

    var recordsType = ['eqstr', 'ieqstr', 'like', 'ilike', 'regexp', 'iregexp'].indexOf(operator) === -1 ? 1 : 2;

    history.get(id, shift, num, recordsType, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "count('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(records && records.length) {
            var result = 0;
            if (pattern === undefined || pattern === null) result = records.length;
            else {
                records.forEach(function (record) {
                    try {
                        result += Number(compare[operator](record.data, pattern, outlier));
                    } catch (e) {
                        log.error('Error occurred while calculating data from history for "count(' + parameters.join(', ') + ')" function for objectID: ' + id + ': ' + e.message);
                    }
                });
            }
        }

        log.debug('FUNC: count(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.count.description = 'Number of values within the defined evaluation period.\n' +
    '\n' +
    'count(<period>, [<timeShift>, [<pattern>, [<operator>]]])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'count(<timestampFrom>, <timestampTo>, [<pattern>, [<operator>]])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    '\n' +
    'count(#<recordsCnt>, [#<recordsShift>, [<pattern>, [<operator>]]])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    '\n' +
    'pattern: required pattern. if undefined, then calculate count of returned values\n' +
    'operator:\n' +
    'eq - equal (default, if operator undefined)\n' +
    'ne - not equal\n' +
    'gt - greater\n' +
    'ge - greater or equal\n' +
    'lt - less\n' +
    'le - less or equal\n' +
    'eqstr - strings are equal (case-sensitive)\n' +
    'ieqstr - strings are equal (case-insensitive)\n' +
    'like - matches if contains pattern (case-sensitive)\n' +
    'ilike - matches if contains pattern (case-insensitive)\n' +
    'regexp - case-sensitive match of regular expression given in pattern\n' +
    'iregexp - case-insensitive match of regular expression given in pattern\n' +
    '<number> - return count of values which more then <pattern>-<number> and less then <pattern>+<number>\n';


functions.delta = function(id, parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Error in parameters for "delta('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;

    history.get(id, shift, num, 1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "delta('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var max = null, min = null;
        records.forEach(function(record) {
            if (max === null || max < record.data) max = record.data;
            if (min === null || min > record.data) min = record.data;
        });

        var result = min !== null && max !== null ? max - min : 0;
        log.debug('FUNC: delta(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.delta.description = 'Difference between the maximum and minimum values within the defined evaluation period (\'max()\' minus \'min()\').\n' +
    '\n' +
    'delta(<period>, [<timeShift>])\n' +
    'period: evaluation period in milliseconds\n' +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'delta(<timestampFrom>, <timestampTo>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n' +
    '\n' +
    'delta(#<recordsCnt>, [#<recordsShift>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n';



functions.last = function(id, parameters, callback) {
    if(!parameters || (!parameters[0] && !parameters[1])) { // last() = last(#0)
        var shift = 0;
        var num = '#1'; // getByIdx
    } else {
        shift = parameters[0];
        num = String(parameters[0]).charAt(0) === '#' ? 1 : parameters[1] || parameters[0];
    }

    // set recordsType to null for get last record in any cases (see cache.get())
    history.get(id, shift, num, null, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "last('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records || !records.length) return callback(null, {records: rawRecords});

        //if(!records[0]) return callback(new Error('Error in records returned for "last('+parameters.join(', ')+')" function for objectID: '+ id + ': ' + JSON.stringify(records)));

        var result = records[records.length - 1].data;
        log.debug('FUNC: last(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.last.description = 'Return a last value.\n' +
    'if a time interval is specified, then returns the last value for this time interval\n' +
    '\n' +
    'last([#<recordsShift>])\n' +
    'recordsShift: evaluation point is moved the number of records back. Default #0\n' +
    '\n' +
    'last(<timeShift>, [<period>])\n' +
    'timeShift: evaluation point is moved the number of milliseconds.\n' +
    'period: evaluation period in milliseconds. If omitted, then <period> will be equal to <timeShift>\n';

functions.max = function(id, parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Error in parameters for "max('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;

    history.get(id, shift, num, 1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "max('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var result = null;
        records.forEach(function(record) {
            if(result === null || result < record.data) result = record.data;
        });

        log.debug('FUNC: max(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.max.description = 'Highest value of an item within the defined evaluation period.\n' +
    '\n' +
    'max(<period>, [<timeShift>])\n' +
    'period: evaluation period in milliseconds\n' +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'max(<timestampFrom>, <timestampTo>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n' +
    '\n' +
    'max(#<recordsCnt>, [#<recordsShift>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n';

functions.min = function(id, parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Error in parameters for "min('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;

    history.get(id, shift, num, 1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "min('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var result = null;
        records.forEach(function(record) {
            if(result === null || result > record.data) result = record.data;
        });

        log.debug('FUNC: min(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.min.description = 'Lowest value of an item within the defined evaluation period.\n' +
    '\n' +
    'min(<period>, [<timeShift>])\n' +
    'period: evaluation period in milliseconds\n' +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'min(<timestampFrom>, <timestampTo>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n' +
    '\n' +
    'min(#<recordsCnt>, [#<recordsShift>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n';

functions.nodata = function(id, parameters, callback, prevResult) {
    if(parameters && parameters[0]) {
        var period = Number(parameters[0]);

        if (period !== parseInt(String(period), 10))
            return callback(new Error('Error in parameters for "nodata(' + period +
                ')" function for objectID: ' + id + ': parameter mast be a pure time interval without "#"'));
    }
    // get last history record
    history.get(id, 0, '#1', 0, function (err, records) {
        log.debug('nodata: history.get(', id, ', 0, #1, 0) parameters: ', parameters, '; records: ', records,
            ', err: ', err, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
            if(err) {
            return callback(new Error('Error occurred while getting data from history for "nodata('+ (period || '') +
                ')" function for objectID: '+ id +': ' + err.message));
        }

        var result = records && records[0] ? Date.now() - records[0].timestamp : Date.now();

        // some times nodata returned large value
        if(result > 3600000) { // 1 hour
            // try to get nodata again after 30 sec
            if(!prevResult) return setTimeout(functions.nodata, 30000, id, parameters, callback, result);

            var difference = result - prevResult;
            // the difference should be about 30 seconds
            if(records && records[0] && (difference < 20000 || difference > 40000)) {
                log.warn('Nodata for ', id, ' more than ', Math.ceil(result / 3600000),
                    'hours, prev result 30 sec ago was: ', Math.ceil(prevResult / 3600000), ' hours, difference: ',
                    result - prevResult, ' milliseconds, now: ', Date.now(), ' records: ', records);
            }
        }

        if(period) result = result > period ? 1 : 0;
        log.debug('FUNC: nodata() = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: records
        });
    });
};

functions.nodata.description = 'Checking for no data received.\n' +
    '\n' +
    'nodata([period])\n' +
    'period: : evaluation period in milliseconds. \n' +
    'If no period is specified, the timestamp of the last record is returned\n\n' +
    'Returns:\n' +
    '1 - if period specified and NO data received during the defined period of time\n' +
    '0 - if the period is specified and the data was received in the specified period\n' +
    '<time> - if the period is not specified, the time until the last record is returned\n' +
    '         if no record found return time before 01.01.1970';

functions.regexp =  function(id, parameters, callback) {
    if(parameters.length < 2) return callback(new Error('Error in parameters for "regexp('+parameters.join(', ')+')" function for objectID: '+ id));

    var pattern = parameters[0];
    var num = parameters[1];
    var shift = parameters[2] ? parameters[2] : 0;
    var flags = parameters[3] ? parameters[3] : 'gmi';

    try {
        var regExp = new RegExp(pattern, flags);
    } catch (err) {
        return callback(new Error('Incorrect regular expression "'+pattern+'" in "regexp('+parameters.join(', ')+')" function for objectID: '+ id + ': ' + err.message))
    }

    history.get(id, shift, num, 2,function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "regexp('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        for(var i = 0, result = 0; i < records.length; i++) {
            var record = records[i];

            if(regExp.test(record.data)) {
                result = 1;
                break
            }
        }

        log.debug('FUNC: regexp(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.regexp.description = 'Checking if the latest (most recent) value matches regular expression.\n' +
    '\n' +
    'regexp(<pattern>, <period>, [<timeShift>], [<flags>])\n' +
    'period: evaluation period in milliseconds\n' +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'regexp(<pattern>, <timestampFrom>, <timestampTo>, [<flags>])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n' +
    '\n' +
    'regexp(<pattern>, #<recordsCnt>, [#<recordsShift>], [<flags>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    '\n' +
    'pattern -  regular expression, JavaScript PCRE style.\n' +
    'flags - flags for javascript regular expression, can be a "g", "i", "m", "y". if skipped, then used "gmi" flags\n' +
    '\n' +
    'Returns:\n' +
    '1 - found\n' +
    '0 - otherwise\n' +
    '\n' +
    'If more than one value is processed, "1" is returned if there is at least one matching value.';


functions.sum = function(id, parameters, callback){
    if(parameters.length < 1) return callback(new Error('Error in parameters for "sum('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;

    history.get(id, shift, num, 1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "sum('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var result = 0;
        records.forEach(function(record) {
            result += record.data;
        });

        log.debug('FUNC: sum(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.sum.description = 'Sum of collected values within the defined evaluation period.\n' +
    '\n' +
    'sum(<period>, [<timeShift>])\n' +
    'period: evaluation period in milliseconds\n' +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    '\n' +
    'sum(<timestampFrom>, <timestampTo>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n' +
    '\n' +
    'sum(#<recordsCnt>, [#<recordsShift>])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n';

functions.outliersBrd = function(id, parameters, callback) {
    // https://en.wikipedia.org/wiki/Outlier
    // https://ru.m.wikihow.com/%D0%B2%D1%8B%D1%87%D0%B8%D1%81%D0%BB%D0%B8%D1%82%D1%8C-%D0%B2%D1%8B%D0%B1%D1%80%D0%BE%D1%81%D1%8B

    if(parameters.length < 1) return callback(new Error('Error in parameters for "outliersBrd('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var borderType = parameters[2] ? String(parameters[2]).toLowerCase() : 'min';

    if(borderType !== 'min' && borderType !== 'max')
        return callback(new Error('Error in parameters for "outliersBrd('+parameters.join(', ')+')" function for objectID: '+
            id + ': ' + parameters[2] + ' can be "min" or "max"'));

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "borderTF('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records || !records.length || records.length < 3) return callback(null, {records: rawRecords});

        var numericRecords = records.sort(function(a, b) {
            return a.data - b.data; // inc sort
        });

        var len = numericRecords.length,
            I1 = len * 0.25, I1_floor = Math.floor(I1), I1_ceil = Math.ceil(I1),
            I3 = len * 0.75, I3_floor = Math.floor(I3), I3_ceil = Math.ceil(I3);

        if(!numericRecords[I1_ceil] || !numericRecords[I1_floor] || !numericRecords[I3_ceil] || !numericRecords[I3_floor])
            return callback(null, {records: rawRecords});

        var Q1 = I1 !== I1_ceil ? numericRecords[I1_ceil].data : ( numericRecords[I1_floor].data + numericRecords[I1_ceil].data ) / 2,
            Q3 = I3 !== I3_ceil ? numericRecords[I3_ceil].data : ( numericRecords[I3_floor].data + numericRecords[I3_ceil].data ) / 2,
            result = borderType === 'min' ? Q1 - (Q3 - Q1) * 1.5 : Q3 + (Q3 - Q1) * 1.5;

        log.debug('FUNC: outliersBrd(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.outliersBrd.description = 'Min or max outliers border value of an item within the defined evaluation period.\n' +
    '\n' +
    'https://en.wikipedia.org/wiki/Outlier\n' +
    'Use Tukey\'s fences algorithm for records: [71, 70, 73, 70, 69, 70, 72, 71, _300_, 71, 69]\n' +
    'Sorting records: [69, 69, 70, 70, 70, 70, 71, 71, 71, 72, 73, 300], recordsLength = 12\n' +
    'first quartile Q1 = avg of 2 records or record in position at (recordsLength * 1/4) = (70 + 70) / 2 = 70\n' +
    'third quartile Q3 = avg of 2 records or record in position at (recordsLength * 3/4) = (71 + 72) / 2 = 71.5\n' +
    'min outliers border is Q1 - 1.5 * (Q3 - Q1) = 67.75\n' +
    'max outliers border is Q3 + 1.5 * (Q3 - Q1) = 73.75\n' +
    '\n' +
    'outliersBrd(<period>[, <timeShift>[, borderType]])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'borderType: "min" or "max" border. default "min"\n' +
    '\n' +
    'outliersBrd(<timestampFrom>, <timestampTo>[, borderType])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'borderType: "min" or "max" border. default "min"\n' +
    '\n' +
    'outliersBrd(#<recordsCnt>[, #<recordsShift>[, borderType]])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'borderType: "min" or "max" border. default "min"\n';


functions.lastRob = function(id, parameters, callback) {
    // https://en.wikipedia.org/wiki/Outlier
    // https://ru.m.wikihow.com/%D0%B2%D1%8B%D1%87%D0%B8%D1%81%D0%BB%D0%B8%D1%82%D1%8C-%D0%B2%D1%8B%D0%B1%D1%80%D0%BE%D1%81%D1%8B

    if(parameters.length < 1) return callback(new Error('Error in parameters for "lastRob('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var recordIdx = Number(parameters[2]) === parseInt(String(parameters[2]), 10) ? Number(parameters[2]) : 0;

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "lastRob('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records || !records.length || records.length < 3) return callback(null, {records: rawRecords});

        var numericRecords = records.sort(function(a, b) {
            return a.data - b.data; // inc sort
        });

        var len = numericRecords.length,
            I1 = len * 0.25, I1_floor = Math.floor(I1), I1_ceil = Math.ceil(I1),
            I3 = len * 0.75, I3_floor = Math.floor(I3), I3_ceil = Math.ceil(I3);

        if(!numericRecords[I1_ceil] || !numericRecords[I1_floor] || !numericRecords[I3_ceil] || !numericRecords[I3_floor])
            return callback(null, {records: rawRecords});

        var Q1 = I1 !== I1_ceil ? numericRecords[I1_ceil].data : ( numericRecords[I1_floor].data + numericRecords[I1_ceil].data ) / 2,
            Q3 = I3 !== I3_ceil ? numericRecords[I3_ceil].data : ( numericRecords[I3_floor].data + numericRecords[I3_ceil].data ) / 2,
            interval = (Q3 - Q1) * 1.5,
            max = Q3 + interval,
            min = Q1 - interval,
            count = 0, result;

        for(var i = records.length-1; i >= 0; i--) {
            var data = records[i].data;
            if(data > min && data < max) {
                if(count === recordIdx) {
                    result = data;
                    break;
                }
                ++count;
            }
        }


        log.debug('FUNC: lastRob(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.lastRob.description = 'Getting robustness value of an item within the defined evaluation period excluding outliers.\n' +
    '\n' +
    'https://en.wikipedia.org/wiki/Outlier\n' +
    'Using Tukey\'s fences algorithm for records: [71, 70, 73, 70, 69, 70, 72, 71, _300_, 71, 69]\n' +
    'Sorting records: [69, 69, 70, 70, 70, 70, 71, 71, 71, 72, 73, 300], recordsLength = 12\n' +
    'first quartile Q1 = avg of 2 records or record in position at (recordsLength * 1/4) = (70 + 70) / 2 = 70\n' +
    'third quartile Q3 = avg of 2 records or record in position at (recordsLength * 3/4) = (71 + 72) / 2 = 71.5\n' +
    'min outliers border is Q1 - 1.5 * (Q3 - Q1) = 67.75\n' +
    'max outliers border is Q3 + 1.5 * (Q3 - Q1) = 73.75\n' +
    '3rd record index (first index is 0, and it is the last record) excluding outliers (300) will be 72\n' +
    '\n' +
    'lastRob(<period>[, <timeShift>[, <recordIdx>]])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'recordIdx: index of last record excluding outliers. Default 0\n' +
    '\n' +
    'lastRob(<timestampFrom>, <timestampTo>[, <recordIdx>])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'recordIdx: index of last record excluding outliers. Default 0\n' +
    '\n' +
    'lastRob(#<recordsCnt>[, #<recordsShift>[, <recordIdx>]])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'recordIdx: index of last record excluding outliers. Default 0\n';


functions.avgTF = function(id, parameters, callback) {
    // https://en.wikipedia.org/wiki/Outlier
    // https://ru.m.wikihow.com/%D0%B2%D1%8B%D1%87%D0%B8%D1%81%D0%BB%D0%B8%D1%82%D1%8C-%D0%B2%D1%8B%D0%B1%D1%80%D0%BE%D1%81%D1%8B

    if(parameters.length < 1) return callback(new Error('Error in parameters for "avgTF('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var avgCnt= Number(parameters[2]) === parseInt(String(parameters[2]), 10) ? Number(parameters[2]) : 0;

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "avgTF('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        if(records.length < 3) return functions.avg(id, parameters, callback);

        var numericRecords = records.sort(function(a, b) {
            return a.data - b.data; // inc sort
        });

        var len = numericRecords.length,
            I1 = len * 0.25, I1_floor = Math.floor(I1), I1_ceil = Math.ceil(I1),
            I3 = len * 0.75, I3_floor = Math.floor(I3), I3_ceil = Math.ceil(I3);

        if(!numericRecords[I1_ceil] || !numericRecords[I1_floor] || !numericRecords[I3_ceil] || !numericRecords[I3_floor])
            return functions.avg(id, parameters, callback);

        var Q1 = I1 !== I1_ceil ? numericRecords[I1_ceil].data : ( numericRecords[I1_floor].data + numericRecords[I1_ceil].data ) / 2,
            Q3 = I3 !== I3_ceil ? numericRecords[I3_ceil].data : ( numericRecords[I3_floor].data + numericRecords[I3_ceil].data ) / 2,
            interval = (Q3 - Q1) * 1.5,
            max = Q3 + interval,
            min = Q1 - interval,
            sum = 0, count = 0;

        if(!avgCnt) {
            numericRecords.forEach(function (record) {
                var data = Number(record.data);
                if (data > min && data < max) {
                    count++;
                    sum += data;
                }
            });
        } else {
            for(var i = records.length - 1; i >= 0 && count < avgCnt; i--) {
                var data = Number(records[i].data);
                if (!isNaN(parseFloat(String(data))) && isFinite(data) && data > min && data < max) {
                    count++;
                    sum += data;
                }
            }
        }

        var result = sum / count;
        log.debug('FUNC: avgTF(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.avgTF.description = 'Robustness average value of an item within the defined evaluation period excluding outliers using Tukey\'s fences algorithm.\n' +
    '\n' +
    'https://en.wikipedia.org/wiki/Outlier\n' +
    'Algorithm for records: [71, 70, 73, 70, 69, 70, 72, 71, _300_, 71, 69]\n' +
    'Sorting records: [69, 69, 70, 70, 70, 70, 71, 71, 71, 72, 73, 300], recordsLength = 12\n' +
    'first quartile Q1 = avg of 2 records or record in position at (recordsLength * 1/4) = (70 + 70) / 2 = 70\n' +
    'third quartile Q3 = avg of 2 records or record in position at (recordsLength * 3/4) = (71 + 72) / 2 = 71.5\n' +
    'border for outliers [min, max] is [Q1 - 1.5 * (Q3 - Q1), Q3 + 1.5 * (Q3 - Q1)] = [67.75, 73.75]\n' +
    'data without outliers [69, 69, 70, 70, 70, 70, 71, 71, 71, 72, 73];\n' +
    'avg for all records excluding outliers (recordsCntForAvg is undefined) = \n' +
    '   (69 + 69 + 70 + 70 + 70 + 70 + 71 + 71 + 71 + 72 + 73) / 11 = 70.5454; \n' +
    'avg for last 5 records excluding outliers (recordsCntForAvg = 5) = \n' +
    '   (69 + 71 + 71 + 72 + 70) / 5 = 70.6; \n' +
    '\n' +
    'avgTF(<period>[, <timeShift> [, <recordsCntForAvg>]])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'recordsCntForAvg: count of last records excluding outliers for calculate average. Default - all records\n' +
    '\n' +
    'avgTF(<timestampFrom>, <timestampTo> [, <recordsCntForAvg>])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'recordsCntForAvg: count of last records excluding outliers for calculate average. Default - all records\n' +
    '\n' +
    'avgTF(#<recordsCnt>[, #<recordsShift> [, <recordsCntForAvg>]])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'recordsCntForAvg: count of last records excluding outliers for calculate average. Default - all records\n';


functions.avgMed = function(id, parameters, callback) {
    if(parameters.length < 3) return callback(new Error('Error in parameters for "avgMed('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1];
    var outliersPercent = Number(parameters[2]);

    if(isNaN(parseFloat(String(outliersPercent))) || !isFinite(outliersPercent) || outliersPercent > 99 || outliersPercent < 1)
        return callback(new Error('Error in parameters for "avgMed('+parameters.join(', ')+')" function for objectID: '+
            id + ': outliersPercent not number or less than 1% or more than 99%'));

    history.get(id, shift, num,1,function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "avgMed('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records || !records.length || records.length < 3) return callback(null, {records: rawRecords});

        var outliersCount = Math.round(records.length / 100 * outliersPercent),
            sum = 0,
            count = 0;

        records.sort(function(a, b) {
            return a.data - b.data; // inc sort
        });

        for(var i = outliersCount; i < records.length - outliersCount; i++) {
            var record = records[i];
            sum += record.data;
            count++;
        }

        var result = sum / count;
        log.debug('FUNC: avgMedustness(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.avgMed.description = 'Robustness average value of an item within the defined evaluation period excluding outliers using median algorithm.\n' +
    '\n' +
    'F.e. records: [1, 3, 4, 2, 6, 5, 7, 9, 8, 10]; outliersPercent=20\n' +
    'outliers count is 10(records count) / 100 * 20(outliersPercent) = 2; result will be (3 + 4 + 6 + 5 + 7 + 8) / 6 = 5.5\n' +
    '\n' +
    'avgMed(<period>, <timeShift>, <outliersPercent>)\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'outliersPercent: percentage of outliers (maximum and minimum values) that is not involved in averaging\n' +
    '\n' +
    'avgMed(<timestampFrom>, <timestampTo>, <outlierPercent>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'outliersPercent: percentage of outliers (maximum and minimum values) that is not involved in averaging\n' +
    '\n' +
    'avgMed(#<recordsCnt>, #<recordsShift>, <outlierPercent>)\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'outliersPercent: percentage of outliers (maximum and minimum values) that is not involved in averaging\n';


functions.avgNear = function(id, parameters, callback) {
    if(parameters.length < 3) return callback(new Error('Error in parameters for "avgNear('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1];
    var patternValue = Number(parameters[2]);
    var outliers = Number(parameters[3]);
    var count = Number(parameters[4]) || 0;
    var direction = Number(parameters[5]) || 0;

    if(isNaN(parseFloat(String(patternValue))) || !isFinite(patternValue)) {
        return callback(new Error('Error in parameters for "avgNear(' + parameters.join(', ') + ')" function for objectID: ' +
            id + ': patternValue is not number: ' + patternValue));
    }

    if(isNaN(parseFloat(String(outliers))) || !isFinite(outliers) || outliers < 0) {
        return callback(new Error('Error in parameters for "avgNear(' + parameters.join(', ') + ')" function for objectID: ' +
            id + ': outliers is negative or not number: ' + outliers));
    }

    if(count && count < 0) {
        return callback(new Error('Error in parameters for "avgNear('+parameters.join(', ')+')" function for objectID: '+
            id + ': num is negative: ' + count));
    }

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) {
            return callback(new Error('Error occurred while getting data from history for "avgNear('+
                parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));
        }

        if(!records) return callback(null, {records: rawRecords});

        var maxValue = patternValue + outliers,
            minValue = patternValue - outliers,
            sum = 0;

        if(count) {
            var len = records.length;
            if(len < count) return callback(null, {records: rawRecords});

            // by default used String sort(). Sorting by Number
            var sortedRecords = records.map(r => Number(r.data)).sort((a, b) => {return a - b});

            for(var minIdx, maxIdx, i = 0; i < len && maxIdx === undefined; i++) {
                var record = sortedRecords[i];
                if (record <= patternValue && i - count + 1 >= 0 && sortedRecords[i - count + 1] >= record - outliers) {
                // 31/03/21 was: if (record <= patternValue && i > count && sortedRecords[i - count + 1] >= record - outliers) {
                    minIdx = i;
                }
                if (record >= patternValue && i + count - 1 < len && sortedRecords[i + count - 1] <= record + outliers) {
                // 31/03/21 was: if (record >= patternValue && i <= len - count && sortedRecords[i + count - 1] <= record + outliers) {
                    maxIdx = i;
                }
            }

            if(direction > 0) nearestIdx = maxIdx;
            else if(direction < 0) nearestIdx = minIdx;
            else if(minIdx === undefined) {
                var nearestIdx = maxIdx;
                direction = 1;
            } else if(maxIdx === undefined) {
                nearestIdx = minIdx;
                direction = -1;
            } else if(patternValue - sortedRecords[minIdx] < sortedRecords[maxIdx] - patternValue) {
                nearestIdx = minIdx;
                direction = -1;
            } else {
                nearestIdx = maxIdx;
                direction = 1;
            }
            if(nearestIdx === undefined) return callback(null, {records: rawRecords});

            var nearestValue = sortedRecords[nearestIdx];
            count = 0;
            if(direction > 0) {
                for(i=nearestIdx; i < len; i++) {
                    if(sortedRecords[i] <= nearestValue + outliers) {
                        sum += sortedRecords[i];
                        count++;
                    } else break;
                }
            } else {
                for(i=nearestIdx; i >= 0; i--) {
                    if(sortedRecords[i] >= nearestValue - outliers) {
                        sum += sortedRecords[i];
                        count++;
                    } else break;
                }
            }
        } else {
            records.forEach(function (record) {
                if (record.data >= minValue && record.data <= maxValue) {
                    sum += record.data;
                    count++;
                }
            });
        }

        var result = count ? sum / count : null;
        log.debug('FUNC: avgNear(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });
        callback(null, {
            data: result,
            records: records || rawRecords
        });
    });
};

functions.avgNear.description = 'Average value of an items with values nearest to specific value within the defined evaluation period.\n' +
    '\n' +
    'ex#1. records: [1, 3, 4, 2, 6, 5, 7, 9, 8, 10]; patternValue=3; outliers=2\n' +
    'minimum value 3-2=1; maximum value 3+2=5; result will be (1 + 3 + 4 + 2 + 5) / 5 = 3\n' +
    'ex#2. records:  [31,42,55,61,33,44,55,60,39,44,51,69,34,57,44,62,30,40,50,60]; patternValue=52; outliers=4, num=3, direction=-1\n' +
    'sorted records: [30,31,33,34,39,40,42,44,44,44,50,51,55,55,57,60,60,61,62,69];\n' +
    'nearest value less than 52 taking into account outliers = 44,\n' +
    'minimum value 40; maximum value 44; result will be (44 + 44 + 44 + 42 + 40) / 5 = 42.8\n' +
    '\n' +
    'avgNear(<period>, <timeShift>, <patternValue>, <outliers>[, num, [direction]])\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'patternValue: around this value we will calculate an average\n' +
    'outliers: outliers around of the nearest value (maximum and minimum values) that is involved in averaging\n' +
    'num: if specified, then first look for the value closest to the pattern, which repeats the number of times ' +
    'specified here, taking into account outliers, and calculate the average around the value found.\n' +
    'direction: if negative, look for a value less than the pattern. if positive, look for a value greater ' +
    'than the pattern. if 0 or unspecified, look for the nearest value\n' +
    '\n' +
    'avgNear(<timestampFrom>, <timestampTo>, <patternValue>, <outliers>[, num, [direction]])\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'patternValue: around this value we will calculate an average\n' +
    'outliers: outliers around of the nearest value (maximum and minimum values) that is involved in averaging\n' +
    'num: if specified, then first look for the value closest to the pattern, which repeats the number of times ' +
    'specified here, taking into account outliers, and calculate the average around the value found.\n' +
    'direction: if negative, look for a value less than the pattern. if positive, look for a value greater ' +
    'than the pattern. if 0 or unspecified, look for the nearest value\n' +
    '\n' +
    'avgNear(#<recordsCnt>, #<recordsShift>, <patternValue>, <outliers>[, num, [direction]])\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'patternValue: around this value we will calculate an average\n' +
    'outliers: outliers around of the nearest value (maximum and minimum values) that is involved in averaging\n' +
    'num: if specified, then first look for the value closest to the pattern, which repeats the number of times ' +
    'specified here, taking into account outliers, and calculate the average around the value found.\n' +
    'direction: if negative, look for a value less than the pattern. if positive, look for a value greater ' +
    'than the pattern. if 0 or unspecified, look for the nearest value\n';


/*
 https://prog-cpp.ru/mnk/
 y = a * x + b (threshold = a * time + b)
 try to find a and b
 */
function linearApprox(records, time, threshold) {
    var sumX = 0, sumY = 0, sumX2 = 0, sumXY = 0, len = 0;

    records.forEach(function (record) {
        ++len;
        var timestamp = record.timestamp;
        sumX += timestamp;
        sumY += record.data;
        sumX2 += timestamp * timestamp;
        sumXY += timestamp * record.data;
    });

    if(!len) return;

    var a = (len * sumXY - (sumX * sumY)) / (len * sumX2 - sumX * sumX);
    var b = (sumY - a * sumX) / len;

    //log.debug('y =', a, '* x +', b, '; x=', time, 'y=', threshold);
    if (time) return (a * time + b);
    return (threshold - b) / a;
}

functions.forecast = function(id, parameters, callback){
    if(parameters.length < 2) return callback(new Error('Error in parameters for "forecast('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var forecastTime = parameters[2] + Date.now();

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "forecast('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var result = linearApprox(records, forecastTime);
        log.debug('FUNC: forecast(', parameters.join(', '), ') = ', result, '; records: ', records, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": id
            }
        });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.forecast.description = 'Future value of the item.\n' +
    '\n' +
    'Using linear approximation (threshold = a * time + b)\n' +
    'forecast(<period>, <timeShift>, <time>)\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'time: forecasting horizon in milliseconds from 1970\n' +
    '\n' +
    'forecast(<timestampFrom>, <timestampTo>, <time>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'time: forecasting horizon in milliseconds from 1970\n' +
    '\n' +
    'forecast(#<recordsCnt>, #<recordsShift>, <time>)\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'time: forecasting horizon in milliseconds from 1970\n';

functions.timeLeft = function(id, parameters, callback){
    if(parameters.length < 2) return callback(new Error('Error in parameters for "timeLeft('+parameters.join(', ')+')" function for objectID: '+ id));

    var num = parameters[0];
    var shift = parameters[1] ? parameters[1] : 0;
    var threshold = parameters[2];

    history.get(id, shift, num,1, function(err, records, rawRecords) {
        if (err) return callback(new Error('Error occurred while getting data from history for "timeLeft('+parameters.join(', ')+')" function for objectID: '+ id +': ' + err.message));

        if(!records) return callback(null, {records: rawRecords});

        var result = Math.round(linearApprox(records, null, threshold));
        log.debug('FUNC: timeLeft(', parameters.join(', '), ') = ', result, '(',
            (new Date(result)).toLocaleString(), '); records: ', records, {
                expr: '%:RECEIVED_OCID:% == %:OCID:%',
                vars: {
                    "RECEIVED_OCID": id
                }
            });

        callback(null, {
            data: result,
            records: rawRecords
        });
    });
};

functions.timeLeft.description = 'Time in milliseconds needed for an item to reach a specified threshold.\n' +
    '\n' +
    'Using linear approximation (threshold = a * time + b)\n' +
    'timeLeft(<period>, <timeShift>, <threshold>)\n' +
    'period: evaluation period in milliseconds\n'  +
    'timeShift: evaluation point is moved the number of milliseconds\n' +
    'threshold: value to reach\n' +
    '\n' +
    'timeLeft(<timestampFrom>, <timestampTo>, <threshold>)\n' +
    'timestampFrom: timestamp in milliseconds from 1970 - begin of time\n' +
    'timestampTo: timestamp in milliseconds from 1970 - end of time\n'  +
    'threshold: value to reach\n' +
    '\n' +
    'timeLeft(#<recordsCnt>, #<recordsShift>, <threshold>)\n' +
    'recordsCnt: count of records from the recordsShift\n' +
    'recordsShift: evaluation point is moved the number of records back\n' +
    'threshold: value to reach\n';