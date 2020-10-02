/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 03.12.2016.
 */

var async = require('async');
var objectsDB = require('../models_db/objectsDB');
var objectsPropertiesDB = require('../models_db/objectsPropertiesDB');
var unitsDB = require('../models_db/countersUnitsDB');

var functions = {};
var units = {};
module.exports = functions;



functions.toHuman =  function (parameters, callback) {
    if (parameters.length < 2) return callback(new Error('Not enough parameters'));

    callback(null, convertToHuman(parameters[0], parameters[1]));
};

function convertToHuman(val, unitName) {

    var isNumber = false;
    if(!isNaN(parseFloat(val)) && isFinite(val)){
        val = Number(val);
        isNumber = true;
    }

    if((unitName === 'Time' || unitName === 'TimeInterval') && isNumber  && val > 1) return secondsToHuman(val / 1000, unitName);

    var unit = units[unitName];

    if(!unit || !unit.name) {
        if(!isNumber) return val.length > 1024 ? val.slice(0, 128) + '...' : val;
        if(val === 0) return 0;
        return Math.round(val * 100) / 100;
    }

    if(!isNumber) return val + unit.abbreviation;

    if(!unit.multiplies[0]) return String(Math.round(val * 100) / 100) + unit.abbreviation;

    // searching true multiplier index 'i'
    for (var i = 0; i < unit.multiplies.length && val / unit.multiplies[i] > 1; i++){} --i;

    if(i < 0) return String(val) + unit.abbreviation;

    var newVal = Math.round(val / unit.multiplies[i] * 100) / 100;

    if(unit.onlyPrefixes || unit.prefixes[i] === unit.abbreviation) var suffix = unit.prefixes[i];
    else suffix = unit.prefixes[i] + unit.abbreviation;

    return newVal + suffix;
}

/*
0 ' = ' '0 sec'
10.1232342 ' = ' '10.12 sec'
0.87 ' = ' '0.87 sec'
0.32 ' = ' '0.32 sec'
345213123654123 ' = ' '10946636years 124days'
12314234.232 ' = ' '142days 12hours'
36582.98 ' = ' '10hours 9min'
934 ' = ' '15min 34sec'
3678.335 ' = ' '1hour 1min'
86589 ' = ' '1day 3min'
 */
function secondsToHuman ( seconds, unitName ) {
    // 1477236595310 = 01/01/2000)
    if(seconds > 1477236595310 && unitName !== 'TimeInterval') {
        return new Date(seconds).toLocaleString().replace(/\.\d\d(\d\d),/, '.$1');
    }

    if(seconds < 86400 && unitName === 'Time') {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds - h * 3600) / 60);
        var s = seconds % 60;
        return String('0' + h + ':0' + m + ':0' + s).replace(/0(\d\d)/g, '$1');
    }

    return [   [Math.floor(seconds / 31536000), function(y) { return y === 1 ? y + 'year ' : y + 'years ' }],
        [Math.floor((seconds % 31536000) / 86400), function(y) { return y === 1 ? y + 'day ' : y + 'days ' }],
        [Math.floor(((seconds % 31536000) % 86400) / 3600), function(y) { return y + (y === 1 ? 'hour ' : 'hours ' )}],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), function(y) {return y + 'min '}],
        [(((seconds % 31536000) % 86400) % 3600) % 60, function(y) {return y + 'sec'}]
    ].map(function(level) {
        return level[0] ? level[1](level[0]) : '';
    }).join('').replace(/^([^ ]+ [^ ]+) ?.*$/, '$1').replace(/(\.\d\d)\d*/, '$1 ').trim() || '0 sec';
}

unitsDB.getUnits(function(err, rows) {
    if(rows && rows.length) {
        rows.forEach(function(unit) {
            if(unit.multiplies) {

                var multiplies = unit.multiplies.split(',');
                var prefixes = unit.prefixes.split(',');
                unit.multiplies = [];
                unit.prefixes = [];

                for (var i = 0; i < multiplies.length; i++) {
                    if ((i === 0 || multiplies[i - 1] < 1) && multiplies[i] > 1) {
                        unit.multiplies.push(1);
                        unit.prefixes.push(unit.abbreviation);
                    }
                    unit.multiplies.push(Number(multiplies[i]));
                    unit.prefixes.push(prefixes[i])
                }

                if (Number(multiplies[multiplies.length - 1]) < 1) {
                    unit.multiplies.push(1);
                    unit.prefixes.push(unit.abbreviation);
                }
            }

            units[unit.name] = unit;
        });
    }

    functions.toHuman.description = 'toHuman(value, unitName) convert numeric value to human readable value\n\n' +
        'value: numeric value for converting to human readable\n' +
        'unitName: unit name for convert\n' +
        '\n' +
        'unit name can be one of: "' + Object.keys(units).join('", "') + '", "TimeInterval"';
});

functions.fromHuman = function (parameters, callback) {
    if (parameters.length < 1) return callback(new Error('Not enough parameters'));

    return callback(null, convertToNumeric(parameters[0]));
};

function convertToNumeric(n) {
    if(!isNaN(parseFloat(n)) && isFinite(n)) return Number(n); // pure numeric

    var n1 = n.trim();
    var res = n1.match(/^([+\-]?\d*\.?\d+(?:[Ee][+\-]?\d+)?)(([KMG]b)|([smhdw]))$/); // check for abbreviation after numeric
    //log.debug(res)
    if(!res) return n; // not numeric

    var digit = Number(res[1]);
    var abr = res[2];

    if(abr === 'Kb') return digit * 1024; // convert from Kilobytes to bytes
    if(abr === 'Mb') return digit * 1048576; // convert from Megabytes to bytes
    if(abr === 'Gb') return digit * 1073741824; // convert from Gigabytes to bytes
    if(abr === 's') return digit * 1000; // convert from minutes to milliseconds
    if(abr === 'm') return digit * 60000; // convert from seconds to milliseconds
    if(abr === 'h') return digit * 3600000; // convert from hours to milliseconds
    if(abr === 'd') return digit * 86400000; // convert from days to milliseconds
    if(abr === 'w') return digit * 604800000; // convert from weeks to milliseconds
}

functions.fromHuman.convertToNumeric = convertToNumeric;
functions.toHuman.convertToHuman = convertToHuman;

functions.fromHuman.description = 'fromHuman(value) convert human readable value to numeric value\n\n' +
    'value: human readable value returned by function for converting to numeric\n' +
    '\n' +
    'Use this function for convert values of variables calculated by functions.\n' +
    'In other cases values will be converted automatically. \n' +
    'F.e. need to convert calculated value by function toHuman(): %:HOUR:% = fromHuman( toHuman(3600, "Time") ), \n' +
    'but not need to convert not calculated value %:HOUR:% = 1h\n' +
    '\n' +
    'unit name can be one of: \n' +
    '"Kb" (Kilobytes), "Mb" (Megabytes), "Gb" (Gigabytes),\n' +
    '"s" (seconds), "m" (minutes), "h" (hours), "d" (days), "w" (weeks)';

functions.date2msec = function (parameters, callback){
    if(parameters && parameters[0]) var dateStr = parameters[0];
    else {
        var now = new Date();
        return callback(null, now.getTime());
    }

    var result = timeStr.split(/[^\d]/);

    if(!result ||  result.length !== 3) return callback(new Error('date2msec: error in date string ('+dateStr+
        '). use "day<sep>month<sep>year", f.e 23.11.2016; 15-2-17; 5.05.09; 1/1/1. <sep> can be any symbol except digit'));

    var year = Number(result[2]),
        month = Number(result[1])-1,
        day = Number(result[0]);

    if(year < 100) year += 2000;

// if error occurred in month, day or year, function Date() automatically fix it. f.e 32.10.2016 -> 1.11.2016
    var date = new Date(year, month, day);
    return callback(null, date.getTime());
};
functions.date2msec.description = 'date2msec(dateString) return millisecond from 1.1.1970 for specific date\n\n' +
    'dateString - date string day<sep>month<sep>year\n' +
    '23.11.2016; 7-11-17; 1/1/1\n' +
    '\n' +
    'if dateString not specified, using current date and time';


functions.time2msec = function(parameters, callback){
    if(parameters && parameters[0]) var timeStr = parameters[0];
    else {
        var now = new Date();
        var time = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();
        return callback(null, time);
    }

    var result = timeStr.split(/[^0-9]/);

    if(!result ||  result.length < 2 || result.length > 4) {
        return callback(new Error('time2msec: error in time string (' + timeStr +
            '). use "24hour<sep>minutes[<sep>seconds[<sep>milliseconds]]", f.e 11:35:00; 17:30:15.100; 23:55.' +
            ' <sep> can be any symbol except digit'));
    }

    var hour = Number(result[0]),
        minutes = Number(result[1]),
        seconds = Number(result[2]) ? Number(result[2]) : 0,
        milliseconds = result[3] ? Number(result[3]) : 0;

    time = hour*3600000 + minutes*60000 + seconds*1000 + milliseconds;
    return callback(null, time);
};
functions.time2msec.description = 'time2msec(timeString) return time in milliseconds\n\n' +
    'timeString - time string hours<sep>minutes<sep>seconds[<sep>milliseconds]\n' +
    'f.e 11:55:00, 14:35:50.150, 11 50, 21.00\n' +
    '\n' +
    'if timeString not specified, use current time';

functions.isNowTimeInInterval = function(parameters, callback){
    if (parameters.length < 1) return callback(new Error('Not enough parameters'));

    async.eachOf(parameters, function(parameter, idx, callback) {
        var interval = parameter.split(/ *- */);
        if(interval.length  !== 2) {
            return callback(new Error('isNowTimeInInterval: error in time interval "' + parameter +
                '" (' + parameters.join(', ') + ')'));
        }

        functions.time2msec([interval[0]], function(err, from) {
            if(err) return callback(new Error('isNowTimeInInterval: error in the first time in the time interval "' +
                parameter + '" (' + parameters.join(', ') + ')'));

            functions.time2msec([interval[1]], function(err, to) {
                if (err) return callback(new Error('isNowTimeInInterval: error in the second time in the time interval "' +
                    parameter + '" (' + parameters.join(', ') + ')'));

                functions.time2msec(null, function(err, now) {
                    if(now > from && now < to) return callback(idx+1);
                    return callback();
                });
            });
        })
    }, function(err) {
        if(typeof err === 'number') return callback(null, err);
        return callback(err, 0);
    });
};
functions.isNowTimeInInterval.description = 'isNowTimeInInterval(<timeInterval1> [, timeInterval2, ...) whether the current time is in the specified time intervals\n\n' +
    'timeInterval is a <timeFrom>-<timeTo>' +
    'timeFrom and timeTo - time string hours<sep>minutes[<sep>seconds[<sep>milliseconds]]\n' +
    'f.e 11:55:00, 14:35:50.150, 11 50, 21.00\n' +
    'return interval number (the first is one), if the current time is in the specified time intervals. Otherwise 0';

functions.getDate = function(parameters, callback){
    var now = new Date();
    callback(null, now.getDate());
};
functions.getDate.description = 'getDate() return current date of month';

functions.getMonth = function(parameters, callback){
    var now = new Date();
    callback(null, now.getMonth()+1);
};
functions.getMonth.description = 'getMonth() return current month number (1 - Jan... 12 - Dec)';

functions.getYear = function(parameters, callback){
    var now = new Date();
    callback(null, now.getFullYear());
};
functions.getYear.description = 'getYear() return current 4-digit year';

functions.getDayOfWeek = function(parameters, callback){
    var now = new Date();
    callback(null, now.getDay()+1);
};
functions.getDayOfWeek.description = 'getDayOfWeek() return current day of week number (1-Sun... 7-Sat)';

functions.getHours = function(parameters, callback){
    var now = new Date();
    callback(null, now.getHours());
};
functions.getHours.description = 'getHours() return current hours according to local time in (1-23)';

functions.getMinutes = function(parameters, callback){
    var now = new Date();
    callback(null, now.getMinutes());
};
functions.getMinutes.description = 'getMinutes() return current minutes according the local time (1-59)';

functions.getSeconds = function(parameters, callback){
    var now = new Date();
    callback(null, now.getSeconds());
};
functions.getSeconds.description = 'getSeconds() return current seconds according the local time (1-59)';

functions.getMilliseconds = function(parameters, callback){
    var now = new Date();
    callback(null, now.getMilliseconds());
};
functions.getMilliseconds.description = 'getMilliseconds() return current milliseconds according the local time (1-999)';

functions.getValueFromJSONStr = function(parameters, callback) {

    if(parameters.length < 2 || parameters[1] === undefined) return callback(new Error('Not enough or incorrect parameters'));
    if(!parameters[0]) return callback(null, 0);

    try {
        var obj = JSON.parse(parameters[0]);
    } catch (err) {
        return callback(new Error('Can\'t parse JSON object "' + parameters[0] + '": ' + err.message));
    }

    // f.e. obj === null
    if(!obj) return callback(null, '');

    var keys = parameters[1].split(/[ ]*?:[ ]*?/);
    for(var i = 0; i < keys.length; i++) {
        if(keys[i] in obj) obj = obj[keys[i]];
        else return callback(null, ''); // if not found, return ''
    }

    if(typeof obj === 'object') return callback(null, JSON.stringify(obj));

    callback(null, obj);
};
functions.getValueFromJSONStr.description = 'getValueFromJSONStr(JSONString, keys) getting value for a specific key from stringify JSON object\n\n' +
    'JSONString - Stringify JSON objects\n' +
    'keys - separated by \':\' list of JSON keys\n' +
    'Return value for specific key. If key not found, return "", f.e.\n' +
    '  OBJ: {\n' +
    '    parameters: {\n' +
    '        prm1Obj: {\n' +
    '            key1: val1,\n' +
    '            key2: val2\n' +
    '        },\n' +
    '\n' +
    '        keyPrm1: valPrm1\n' +
    '    },\n' +
    '\n' +
    '    commonKey1: commonVal1,\n' +
    '    commonKey2: commonVal2\n' +
    ' },\n' +
    ' STR: "string"\n' +
    '\n' +
    ' getValueFromJSONStr(%:OBJECT:%, \'OBJ:parameters:prm1Obj:key2\') return \'val2\'\n' +
    ' getValueFromJSONStr(%:OBJECT:%, \'OBJ:parameters:prm1Obj:key5\') return \'\'\n' +
    ' getValueFromJSONStr(%:OBJECT:%, \'OBJ:commonKey2\') return \'commonVal2\'\n' +
    ' getValueFromJSONStr(%:OBJECT:%, \'STR\') return \'string\'';

functions.replaceRE = function(parameters, callback) {
    if(parameters.length < 3) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, ''); // if nothing to replace return ''


    if(parameters[3]) {
        if (!/^[igm]+$/.test(parameters[3])) return callback(new Error('Incorrect flags for RegExp: ' + parameters[3]));
        var flags = parameters[3];
    } else flags = '';

    try {
        var re = new RegExp(parameters[1], flags);
    } catch(err) {
        return callback(new Error('Error in RegExp '+parameters[1]+': ' + err.message));
    }

    parameters[0] = String(parameters[0]);
    parameters[2] = String(parameters[2]);
    callback(null, parameters[0].replace(re, parameters[2]));
};
functions.replaceRE.description = 'replaceRE(initString, regExp, stringForReplace[, flags]) replace string\n' +
    '\n' +
    'initString - string for replace\n' +
    'regExp - regular expression\n' +
    'stringForReplace - string, which replace initString using regExp. You use special characters in it:\n' +
    '   $$: "$"\n' +
    '   $&: the whole match\n' +
    '   $`: a part of the string before the match\n' +
    '   $\': a part of the string after the match\n' +
    '   $n: if n is a 1-2 digit number, then it means the contents of n-th parentheses\n' +
    '       counting from left to right, otherwise it means a parentheses with the given name\n' +
    'flags - flags for regular expression:\n' +
    '   g: search looks for all matches, without it – only the first one\n' +
    '   i: search is case-insensitive\n' +
    '   m: Multiline mode\n' +
    '   u: Enables full unicode support. The flag enables correct processing of surrogate pairs\n' +
    '   s: “Dotall” mode, allows . to match newlines\n' +
    'return replaced string';

/*

 */
functions.testRE = function(parameters, callback) {
    if(parameters.length < 2) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, 0);

    if(parameters[2]) {
        if (!/^[igm]+$/.test(parameters[2])) return callback(new Error('Incorrect flags for RegExp: ' + parameters[2]));
        var flags = parameters[2];
    } else flags = '';

    try {
        var re = new RegExp(parameters[1], flags);
    } catch(err) {
        return callback(new Error('Error in RegExp '+parameters[1]+': ' + err.message));
    }

    callback(null, re.test(parameters[0]));
};
functions.testRE.description = 'testRE(testString, regExp[, flags]) string comparison with regExp\n' +
    '\n' +
    'testString - string for test\n' +
    'regExp - regular expression\n' +
    'flags - flags for regular expression:\n' +
    '   g: search looks for all matches, without it – only the first one\n' +
    '   i: search is case-insensitive\n' +
    '   m: Multiline mode\n' +
    '   u: Enables full unicode support. The flag enables correct processing of surrogate pairs\n' +
    '   s: “Dotall” mode, allows . to match newlines\n' +
    'return 1 or 0';

functions.isObjectExist = function(parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, 0);

    objectsDB.getObjectsLikeNames([parameters[0]], function(err, rows) {
        if(err) return callback(new Error('Can\'t checking object "'+ parameters[0] +'" for existence: ' + err.message));

        callback(null, rows.length);
    });
};
functions.isObjectExist.description = 'isObjectExist(objectName) checking by object name is object exist\n' +
    '\n' +
    'objectName: object name for search in SQL "LIKE" format. You can use escape character "\\" if you need to escape "_" and "%"\n' +
    'return count of existing objects';

functions.getObjectNameLike = function(parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, '');

    objectsDB.getObjectsLikeNames([parameters[0]], function(err, rows) {
        if(err) return callback(new Error('Can\'t get object name like "'+ parameters[0] +'": ' + err.message));

        callback(null, rows.length ? rows[0].name : '');
    });
};
functions.getObjectNameLike.description = 'getObjectNameLike(objectName) get object name like specified\n' +
    '\n' +
    'objectName: object name for search in SQL "LIKE" format. You can use escape character "\\" if you need to escape "_" and "%"\n' +
    'return the name of the first object or ""';

functions.getCommaSeparatedObjectsIDs = function(parameters, callback) {
    if(parameters.length < 1) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, '');

    objectsDB.getObjectsLikeNames(parameters[0].split(/[ ]*?,[ ]*?/), function(err, rows) {
        if(err) return callback(new Error('Can\'t getting objects IDs for objects names "'+ parameters.join(',') +'": ' + err.message));
        callback(null, rows.map(function(row) { return row.id; }).join(','));
    });
};
functions.getCommaSeparatedObjectsIDs.description = 'getCommaSeparatedObjectsIDs(objectNames) getting objects IDs by objects names\n' +
    '\n' +
    'objectNames: comma separated objects names in SQL "LIKE" format. You can use escape character "\\" if you need to escape "_" and "%"\n' +
    'return string with comma separated objects IDs';

functions.getObjectID = function(parameters, callback) {
    if(parameters.length < 1 || !parameters[0]) return callback(new Error('Not enough or incorrect parameters'));

    objectsDB.getObjectsLikeNames([parameters[0]], function(err, rows) {
        if(err) return callback(new Error('Can\'t get object ID for "'+ parameters[0] +'": ' + err.message));

        if(!rows.length) return callback(new Error('Object ID for "'+ parameters[0] +'" not found'));
        if(rows.length > 1) return callback(new Error('Found more then one object ID for "'+ parameters[0] +'"'));

        callback(null, rows[0].id);
    });
};
functions.getObjectID.description = 'getObjectID(objectName) getting object ID by object name\n\n' +
    'objectName: object name in SQL "like" format. You can use escape character "\\" if you need to escape "_" and "%"\n' +
    'return objectID';


functions.getObjectProperty = function(parameters, callback) {
    if(parameters.length < 2 || !parameters[0] || parameters[1] === undefined) return callback(new Error('Not enough or incorrect parameters'));

    functions.getObjectID(parameters, function(err, objectID) {
        if(err) return callback(err);

        objectsPropertiesDB.getProperties(objectID, function(err, properties) {
            if(err) return callback(new Error('Can\'t get properties for object ' + parameters[0] + ': ' + err.message));

            for(var i = 0; i < properties.length; i++) {
                if(properties[i].name === parameters[1].toUpperCase()) return callback(null, properties[i].value);
            }

            callback();
        });
    });
};

functions.getObjectProperty.description = 'getObjectProperty(objectName, propertyName) getting object property for specific object name\n\n' +
    'objectName: object name in SQL "like" format. You can use escape character "\\" if you need to escape "_" and "%"\n' +
    'propertyName: object property name case insensitive\n' +
    'return property value or undefined';

functions.toUpperCase = function(parameters, callback) {
    callback(null, (parameters[0] ? parameters[0].toUpperCase() : ''));
};

functions.toUpperCase.description = 'toUpperCase(string) convert string to upper case\n\n' +
    'string: string for convert to upper case\n' +
    'return string in upper case';

functions.toLowerCase = function(parameters, callback) {
    callback(null, (parameters[0] ? parameters[0].toLowerCase() : ''));
};

functions.toLowerCase.description = 'toLowerCase(string) convert string to lower case\n\n' +
    'string: string for convert to lower case\n' +
    'return string in lower case';

functions.getTaskResult = function(parameters, callback) {
    if(parameters.length < 1 || !parameters[0]) return callback(new Error('Not enough parameters'));

    try {
        var taskResult = JSON.parse(parameters[0]);
    } catch(err) {
        return callback(new Error('Can\'t parse task result ' + parameters[0] + ' as JSON object: ' + err.message));
    }

    if(typeof taskResult !== 'object' || !Object.keys(taskResult).length)
        return callback(new Error('Task result is not an object or empty: ' + JSON.stringify(parameters[0])));

    var sessionIDs = Object.keys(taskResult),
        actionNumber = parameters[1];

    if(actionNumber === undefined) actionNumber = 1; // undefined or 0
    else {
        if(!actionNumber || Number(actionNumber) !== parseInt(String(actionNumber), 10))
            return callback(new Error('Incorrect action number parameter: ' + actionNumber + ' for getting task result from ' + parameters[0]));
    }

    if(actionNumber > sessionIDs.length) return callback(new Error('Action number parameters ' +
        actionNumber + ' is greater then sessions count ' + sessionIDs.length + ' in task result ' + parameters[0]));


    var sessionID = sessionIDs[actionNumber - 1];
    if(Number(sessionID) !== parseInt(String(sessionID), 10))
        return callback(new Error('Incorrect session ID "' + sessionID + '" for getting task result from ' + parameters[0]));

    callback(null, taskResult[sessionID]);
};

functions.getTaskResult.description = 'getTaskResult(task, JSONString, actionNum) get result for specific action from task result object\n' +
    'task result object have format: {"sessionID1", "action1Result", "sessionID2", "action2Result", ...}\n\n' +
    'JSONString: stringify JSON object of task result (f.e. %:PARENT_VALUE:%)\n' +
    'actionNum - action number in the task. If not set, then return result from first action.\n' +
    '               First action has number 1 (not 0)'+
    'return result for specific action.\n';


functions.ifElse = function(parameters, callback) {
    if (parameters.length < 2) return callback(new Error('Not enough parameters'));

    if(parameters[0]) return callback(null, parameters[1]);
    else return callback(null, parameters[2])
};

functions.ifElse.description = 'ifElse(condition, trueResult, falseResult) return second parameter, if first parameter is true, otherwise return third parameter\n\n' +
    'condition: condition\n' +
    'trueResult: return this if condition is TRUE\n' +
    'falseResult: return this if condition is FALSE\n';

functions.isNumber = function(parameters, callback) {
    if (parameters.length < 1) return callback(new Error('Not enough parameters'));

    callback(null, !isNaN(parseFloat(parameters[0])) && isFinite(parameters[0]));
};

functions.isNumber.description = 'isNumber(value) return true if first parameter is numeric, otherwise return false\n\n' +
    'value: something for checking to number\n';

functions.isDefined = function(parameters, callback) {
    callback(null, parameters.length && parameters[0] !== undefined && parameters[0] !== null);
};

functions.isDefined.description = 'isDefined(%:?<VARIABLE>:%) return false if variable value is undefined or null or not present, otherwise return true.\n' +
    'Use variable with "?" character (i.e. %:?<VARIABLE>:%) for pass undefined variable to the function.\n' +
    'In other case the expression with undefined variable will not be calculated.\n\n' +
    'value: something for checking.\n';

functions.calcImportant = function(parameters, callback) {

    var value = Number(parameters[0]);
    var lowValue = Number(parameters[1]);
    var highValue = Number(parameters[2]);
    var lowImportant = Number(parameters[3]);
    var highImportant = Number(parameters[4]);

    if(parameters.length < 5 ||
        isNaN(parseFloat(String(lowValue))) || !isFinite(lowValue) ||
        isNaN(parseFloat(String(highValue))) || !isFinite(highValue) ||
        lowImportant < 0 || lowImportant > 10 ||
        highImportant < 0 || highImportant > 10
    ) return callback(new Error('Not enough or incorrect parameters: calcImportant(' + parameters.join(', ') + ')'));

    if((lowValue > highValue && value > lowValue) || (lowValue < highValue && value < lowValue)) return callback(null, lowImportant);
    if((lowValue > highValue && value < highValue) || (lowValue < highValue && value > highValue)) return callback(null, highImportant);

    callback(null, Math.abs(Math.round(value * (lowImportant - highImportant + 1) / (highValue - lowValue) )));
};

functions.calcImportant.description = 'Calculate "important" according variable thresholds for event-generator collector\n\n' +
    'value: current value for calculate event importance\n' +
    'lowValue: threshold for update event with low importance\n' +
    'highValue: threshold for update event with highest importance\n' +
    'lowImportant: important value for lowValue\n' +
    'highImportant: important value for highValue\n\n' +
    'f.e. for memory if set lowValue is 4096Mb, highValue is 100Mb, lowImportant is 4, highImportant is 1, then for:\n' +
    'from 4096Mb and higher to 3097Mb importance will set to 4\n' +
    'from 3096Mb to 2098Mb importance will set to 3\n' +
    'from 2097Mb to 1099Mb importance will set to 2\n' +
    'from 1098Mb to 100Mb and lower importance will set to 1\n';
