/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 03.12.2016.
 */
//var log = require('../lib/log')(module);
const async = require('async');
const fromHuman = require('./utils/fromHuman');
const toHuman = require('./utils/toHuman');

var functions = {};
var units = toHuman.getUnits;
var cache;
module.exports = functions;

/** Initializing cache for use cache data in the functions
 * @param {Object} _cache  - cache object
 * @param {Object} _cache.countersObjects - object with counters, objects and objectName2OCID
 * @param {Object} _cache.objectsProperties - objects properties {objectID: [objectID:, objectID:, name:, value:, description:, mode:], ...}
 */
functions.__initCache = function (_cache) {
    cache = _cache;
}

/**
 * Find objects like reObjectName. Depend on mode using SQL like or RegExp or case-insensitive string compare
 * @param {string} reObjectName  - object name (Sql Like or RegExp or Case insensitive object name)
 * @param {string} mode='sql' - case insensitive search mode: 'sql' - for sql like search, 're' - for RegExp search, 'str' - for case insensitive string search
 * @returns {Object} - Object {<objectName>: <objectID>, ...} with founded object names and objectIDs or throw error message
 */
function findObjectsLike(reObjectName, mode) {
    if(!cache || !cache.countersObjects || !(cache.countersObjects.objects instanceof Map)) {
        throw new Error('Cache is not initialized');
    }
    if(!reObjectName || typeof reObjectName !== 'string') throw new Error('Incorrect objectName for search');
    if(mode && typeof mode === 'string') mode = mode.toLowerCase();
    else mode = 'sql';

    var objectsNames = {};
    if(mode === 'sql' || mode === 're') {
        // Convert sqlLike to RegExp
        // SQL Like: "_" - one symbol; "%" - zero or more symbols; escape character is "\"
        if(mode === 'sql') {
            reObjectName = '^' + reObjectName.split(/\\\\/) // don't convert escaped "\"
                .map(subStrSlash => subStrSlash.split(/\\%/) // don't convert escaped "%"
                    .map(subStrPercent => subStrPercent.split(/\\_/) // don't convert escaped "_"
                        .map(subStr => subStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') // escape regExp symbols
                            .replace(/%/g, ".*") // replace sql like "%" to regExp .*
                            .replace(/_/g, ".")) // replace sql like "_" to regExp .
                        .join('_')) // join escaped "\_" and remove escape symbol "\"
                    .join('%')) // join escaped "\%" and remove escape symbol "\"
                .join('\\\\') + '$'; // join escaped "\\" and escape "\" for regExp
        }
        var re = new RegExp(reObjectName, 'gi');
        cache.countersObjects.objects.forEach((objectName, objectID) => {
            re.lastIndex = 0;
            if(re.test(objectName)) {
                //log.warn('found: "', reObjectName, '" = "', objectName, '"');
                objectsNames[objectName] = objectID;
            }
        });
        //if(!Object.keys(objectsNames).length) log.warn('re: ', reObjectName, '; ', objectsNames, '; ', Array.from(cache.countersObjects.objects.values()).sort()/*, ';', cache.countersObjects.objectName2OCID*/);

        return objectsNames;
    }

    if(mode === 'str') {
        cache.countersObjects.objects.forEach((objectName, objectID) => {
            if(reObjectName.toUpperCase() === objectName.toUpperCase()) {
                objectsNames[objectName] = objectID;
            }
        });
        return objectsNames;
    }
    throw 'Incorrect search mode. Use "sql"|"re"|"str"';
}

functions.toHuman =  function (parameters, callback) {
    if (parameters.length < 2) return callback(new Error('Not enough parameters'));

    callback(null, toHuman(parameters[0], parameters[1]));
};

functions.toHuman.description = 'toHuman(value, unitName) convert numeric value to human readable value\n\n' +
    'value: numeric value for converting to human-readable\n' +
    'unitName: unit name for convert\n' +
    '\n' +
    'unit name can be one of: "' + Object.keys(units).join('", "') + '", "TimeInterval"';

functions.fromHuman = function (parameters, callback) {
    if (parameters.length < 1) return callback(new Error('Not enough parameters'));

    return callback(null, fromHuman(parameters[0]));
};

functions.fromHuman.description = 'fromHuman(value) convert human readable value to numeric value\n\n' +
    'value: human-readable value returned by function for converting to numeric\n' +
    '\n' +
    'Use this function for convert values of variables calculated by functions.\n' +
    'In other cases values will be converted automatically. \n' +
    'F.e. need to convert calculated value by function toHuman(): %:HOUR:% = fromHuman( toHuman(3600, "Time") ), \n' +
    'but not need to convert not calculated value %:HOUR:% = 1h\n' +
    '\n' +
    'unit name can be one of: \n' +
    '"Kb" (Kilobytes), "Mb" (Megabytes), "Gb" (Gigabytes), "Tb" (Terabytes)\n' +
    '"s" (seconds), "m" (minutes), "h" (hours), "d" (days), "w" (weeks)';

functions.date2msec = function (parameters, callback){
    if(parameters && parameters[0]) var dateStr = parameters[0];
    else {
        var now = new Date();
        return callback(null, now.getTime());
    }

    // [^\d] = \D
    var result = timeStr.split(/\D/);

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

    // [^0-9] = \D
    var result = timeStr.split(/\D/);

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
        if(typeof parameter !== 'string') {
            return callback(new Error('isNowTimeInInterval: error in time interval "' + String(parameter) +
                '" (' + parameters.join(', ') + ')'));
        }

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
                    if((from < to && now > from && now < to) || (from > to && (now > from || now < to))) return callback(idx+1);
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

    if(parameters.length < 2) return callback(new Error('Not enough parameters'));

    if(!parameters[0] || !parameters[1]) return callback(null, 0);

    if(typeof parameters[0] !== 'string' || typeof parameters[1] !== 'string') {
        return callback(new Error('Incorrect parameters'));
    }

    try {
        var obj = JSON.parse(parameters[0]);
    } catch (err) {
        return callback(new Error('Can\'t parse JSON object "' + parameters[0] + '": ' + err.message));
    }

    // f.e. obj === null
    if(!obj) return callback(null, '');

    var keys = parameters[1].split(/ *?: *?/);
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
    'Return value for specific key. If key not found, return "". If JSONString or key are not set or unresolved, return 0.\n' +
    'For example:\n' +
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

    if(parameters[3] && typeof parameters[3] === 'string') {
        if (!/^[igm]+$/.test(parameters[3])) return callback(new Error('Incorrect flags for RegExp: ' + parameters[3]));
        var flags = parameters[3];
    } else flags = '';

    try {
        var re = new RegExp(String(parameters[1]), flags);
        var res = String(parameters[0]).replace(re, String(parameters[2]))
    } catch(err) {
        return callback(new Error('Error ' + parameters[0] +
            '.replace(/' + parameters[1] + '/' + flags + ', ' + parameters[2] + '): ' + err.message));
    }


    callback(null, res);
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
    '   s: “Dot-all” mode, allows . to match newlines\n' +
    'return replaced string';

/*

 */
functions.testRE = function(parameters, callback) {
    if(parameters.length < 2) return callback(new Error('Not enough parameters'));
    if(!parameters[0]) return callback(null, 0);

    if(parameters[2] && typeof parameters[2] === 'string') {
        if (!/^[igm]+$/.test(parameters[2])) return callback(new Error('Incorrect flags for RegExp: ' + parameters[2]));
        var flags = parameters[2];
    } else flags = '';

    try {
        var re = new RegExp(String(parameters[1]), flags);
        var res = re.test(String(parameters[0]));
    } catch(err) {
        return callback(new Error('Error: /' + parameters[1] + '/' + flags + '.test(' + parameters[0] + '): ' + err.message));
    }

    callback(null, Number(res));
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
    '   s: “Dot-all” mode, allows . to match newlines\n' +
    'return 1 or 0';

functions.isObjectExist = function(parameters, callback) {
    if(parameters.length < 1 || typeof parameters[0] !== 'string') {
        return callback(new Error('Not enough or incorrect parameter'));
    }
    if(!parameters[0]) return callback(null, 0);

    try {
        var objectsNamesObj = findObjectsLike(parameters[0], parameters[1]);
    } catch (err) {
        return callback(err);
    }

    callback(null, Object.keys(objectsNamesObj).length);
};

functions.isObjectExist.description = 'isObjectExist(objectName) checking by object name is object exist\n' +
    '\n' +
    'objectName: (SQL Like or RegExp or plain object name, mode)\n' +
    'mode: case insensitive: "sql" (default) - for sql like search, "re" - for RegExp search, "str" - for case insensitive string search\n' +
    'return count of existing objects';

functions.getObjectNameLike = function(parameters, callback) {
    if(parameters.length < 1 || typeof parameters[0] !== 'string') {
        return callback(new Error('Not enough or incorrect parameter'));
    }
    if(!parameters[0]) return callback(null, '');

    try {
        var objectsNamesObj = findObjectsLike(parameters[0], parameters[1]);
    } catch (err) {
        return callback(err);
    }
    var objectsNames = Object.keys(objectsNamesObj);
    if(objectsNames.length !== 1) {
        // found zero objects
        if(!objectsNames.length) return callback(null, '');

        // found more than one objects
        return callback(new Error('Object name like ' + parameters[0] +
            ' found more than one ('+ objectsNames.length +'); search mode ' + (parameters[1] || 'sql') +
            ': ' + objectsNames.join(',')));
    }

    callback(null, objectsNames[0]);
};
functions.getObjectNameLike.description = 'getObjectNameLike(objectName) get object name like specified\n' +
    '\n' +
    'objectName: (SQL Like or RegExp or plain object name, mode)\n' +
    'mode: case insensitive: "sql" (default) - for sql like search, "re" - for RegExp search, "str" - for case insensitive string search\n' +
    'return the name of the object or "" if not found or throw if found more than one objects';

functions.getCommaSeparatedObjectsIDs = function(parameters, callback) {
    if(parameters.length < 1 || typeof parameters[0] !== 'string') {
        return callback(new Error('Not enough or incorrect parameter'));
    }
    if(!parameters[0]) return callback(null, '');

    try {
        var objectsNamesObj = findObjectsLike(parameters[0], parameters[1]);
    } catch (err) {
        return callback(err);
    }

    callback(null, Object.values(objectsNamesObj).join(','));
};
functions.getCommaSeparatedObjectsIDs.description = 'getCommaSeparatedObjectsIDs(objectNames) getting objects IDs by objects names\n' +
    '\n' +
    'objectName: (SQL Like or RegExp or plain object name, mode)\n' +
    'mode: case insensitive: "sql" (default) - for sql like search, "re" - for RegExp search, "str" - for case insensitive string search\n' +
    'return string with comma separated objects IDs';

functions.getObjectID = function(parameters, callback) {
    if(parameters.length < 1 || typeof parameters[0] !== 'string' || !parameters[0]) {
        return callback(new Error('Not enough or incorrect parameter'));
    }

    try {
        var objectsNamesObj = findObjectsLike(parameters[0], parameters[1]);
    } catch (err) {
        return callback(err);
    }
    var objectsNames = Object.keys(objectsNamesObj);
    if(objectsNames.length !== 1) {
        return callback(new Error('Object name like ' + parameters[0] +
            ' not found or found more than one ('+ objectsNames.length +'); search mode ' + (parameters[1] || 'sql') +
            ': ' + objectsNames.join(',')));
    }

    callback(null, objectsNamesObj[objectsNames[0]]);
};
functions.getObjectID.description = 'getObjectID(objectName) getting object ID by object name\n\n' +
    'objectName: (SQL Like or RegExp or plain object name, mode)\n' +
    'mode: case insensitive: "sql" (default) - for sql like search, "re" - for RegExp search, "str" - for case insensitive string search\n' +
    'return objectID or throw error if object not found or found more than one objects';


functions.getObjectProperty = function(parameters, callback) {
    if(parameters.length < 2 || typeof parameters[0] !== 'string' || !parameters[0] ||
        typeof parameters[1] !== 'string' || !parameters[1]) {
        return callback(new Error('Not enough or incorrect parameters'));
    }

    try {
        var objectsNamesObj = findObjectsLike(parameters[0], parameters[2]);
    } catch (err) {
        return callback(err);
    }
    var objectsNames = Object.keys(objectsNamesObj);
    if(objectsNames.length !== 1) {
        // found zero objects
        if(!objectsNames.length) return callback(null, '');

        // found more than one objects
        return callback(new Error('Object name like ' + parameters[0] +
            ' found more than one ('+ objectsNames.length +'); search mode ' + (parameters[2] || 'sql') +
            ': ' + objectsNames.join(',')));
    }

    var objectProperties = cache.objectsProperties.get(objectsNamesObj[objectsNames[0]]);
    //console.log('!!!getObjectProperty', parameters, objectsNamesObj, objectProperties)
    if(objectProperties) {
        var objectProperty = objectProperties.get(parameters[1].toUpperCase());
        if (objectProperty) return callback(null, objectProperty.prop.value);
    }
    callback(null, '');
};

functions.getObjectProperty.description = 'getObjectProperty(objectName, propertyName, mode) getting object property for specific object name\n\n' +
    'objectName: object name (SQL Like or RegExp or plain object name)\n' +
    'propertyName: object property name case-insensitive\n' +
    'mode: case insensitive: "sql" (default) - for sql like search, "re" - for RegExp search, "str" - for case insensitive string search\n' +
    'return property value or ""';

functions.toUpperCase = function(parameters, callback) {
    callback(null, (typeof parameters[0] === 'string' ? parameters[0].toUpperCase() : ''));
};

functions.toUpperCase.description = 'toUpperCase(string) convert string to upper case\n\n' +
    'string: string for convert to upper case\n' +
    'return string in upper case';

functions.toLowerCase = function(parameters, callback) {
    callback(null, (typeof parameters[0] === 'string' ? parameters[0].toLowerCase() : ''));
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
        actionNumber + ' is greater than sessions count ' + sessionIDs.length + ' in task result ' + parameters[0]));


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

    callback(null, Number(!isNaN(parseFloat(parameters[0])) && isFinite(parameters[0])));
};

functions.isNumber.description = 'isNumber(value) return 1 if first parameter is numeric, otherwise return 0\n\n' +
    'value: something for checking to number\n';

functions.isDefined = function(parameters, callback) {
    callback(null, Number(parameters.length && parameters[0] !== undefined && parameters[0] !== null));
};

functions.isDefined.description = 'isDefined(%:?<VARIABLE>:%) return 0 if variable value is undefined or null or not present, otherwise return 1.\n' +
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

    if((lowValue > highValue && value > lowValue) || (lowValue < highValue && value < lowValue)) {
        return callback(null, lowImportant);
    }
    if((lowValue > highValue && value < highValue) || (lowValue < highValue && value > highValue)) {
        return callback(null, highImportant);
    }

    callback(null, Math.abs(Math.round(value * (lowImportant - highImportant + 1) / (highValue - lowValue) )));
};

functions.calcImportant.description = 'Calculate "important" according variable thresholds for event-generator collector\n\n' +
    'value: current value for calculate event importance\n' +
    'lowValue: threshold for update event with low importance\n' +
    'highValue: threshold for update event with the highest importance\n' +
    'lowImportant: important value for lowValue\n' +
    'highImportant: important value for highValue\n\n' +
    'f.e. for memory if set lowValue is 4096Mb, highValue is 100Mb, lowImportant is 4, highImportant is 1, then for:\n' +
    'from 4096Mb and higher to 3097Mb importance will set to 4\n' +
    'from 3096Mb to 2098Mb importance will set to 3\n' +
    'from 2097Mb to 1099Mb importance will set to 2\n' +
    'from 1098Mb to 100Mb and lower importance will set to 1\n';