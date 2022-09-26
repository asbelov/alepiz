/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.07.2015.
 */
var fs = require('fs');
var path = require('path');

var log = require('../../lib/log')(module);
var collectors = require('../../lib/collectors');
var rightsWrappersCountersDB = require('../../rightsWrappers/countersDB');
var rightsWrappersObjectsDB = require('../../rightsWrappers/objectsDB');
var counterDB = require('../../models_db/countersDB');
var groupsDB = require('../../models_db/countersGroupsDB');
var unitsDB = require('../../models_db/countersUnitsDB');
var history = require('../../models_history/history');
var functions = require('../../lib/calcFunction');
var calc = require('../../lib/calc');
var Conf = require('../../lib/conf');
const confLog = new Conf('config/log.json');
var logViewerAjax = require('../log_viewer/ajax');

module.exports = function(args, callback) {
    //log.debug('Starting ajax with parameters ', args);

    var func = args.func || args.function;

    if(!func) return callback(new Error('Ajax function is not set'));

    if(func === 'getCounterByID') return rightsWrappersCountersDB.getCounterByID(args.username, args.id, callback);

    if(func === 'getCounterParameters') return rightsWrappersCountersDB.getCounterParameters(args.username, args.id, callback);

    if(func === 'getCollectors') return collectors.getConfiguration(null, callback);

    if(func === 'getCountersGroups') return groupsDB.get(callback);

    if(func === 'getCountersUnits') return unitsDB.getUnits(callback);

    // [{counterID:.., expression:.., mode: <0|1|2|3|4>, objectID: parentObjectID, name: <parentObjectName|''>}, ...]
    // mode: 0 - update every time when parent counter received a new value and expression is true,
    // 1 - update once when parent counter received a new value and expression change state to true,
    // 2 - update once when expression change state to true and once when expression change state to false
    if(func === 'getUpdateEvents') return rightsWrappersCountersDB.getUpdateEvents(args.username, args.id, callback);

    if(func === 'getCounterObjects') return rightsWrappersCountersDB.getCounterObjects(args.username, args.id, callback);

    if(func === 'getVariables') return rightsWrappersCountersDB.getVariables(args.username, args.id, callback);

    if(func === 'getVariablesForParentCounterName') return rightsWrappersCountersDB.getVariablesForParentCounterName(args.username, args.counterName, callback);

    if(func === 'getHistoryFunctions') { return callback(null, history.getFunctionList()); }

    if(func === 'getCountersForObjects') {
        var groupID = (!args.groupID || args.groupID === '0' ? null : [Number(args.groupID)]);
        if(!args.ids) {
            if(groupID) return rightsWrappersCountersDB.getCountersForGroup(args.username, groupID, callback);
            else return rightsWrappersCountersDB.getAllCounters(args.username, callback);
        }
        return rightsWrappersCountersDB.getCountersForObjects(args.username, args.ids, groupID, callback);
    }

    if(func === 'addCounterGroup') return groupsDB.new(args.group, callback);

    if(func === 'editCounterGroup') return groupsDB.edit(args.oldGroup, args.group, callback);

    if(func === 'setDefaultCounterGroup') return groupsDB.setInitial(args.group, args.groupProp, callback);

    if(func === 'removeCounterGroup') return groupsDB.remove(args.group, callback);

    if(func === 'addCounterUnit')
        return unitsDB.new(args.unit, args.abbreviation, args.prefixes, args.multiplies, args.onlyPrefixes, callback);

    if(func === 'editCounterUnit')
        return unitsDB.edit(args.oldUnitID, args.unit, args.abbreviation, args.prefixes, args.multiplies, args.onlyPrefixes, callback);

    if(func === 'removeCounterUnit') return unitsDB.remove(args.unit, callback);

    if(func === 'getFunctionsDescription') return callback(null, getFunctionsDescription());

    if(func === 'getParentCountersVariables') return rightsWrappersCountersDB.getParentCountersVariables(args.username, [args.id], [], callback);

    if(func === 'getFilesList') return getLogFileList(args, callback);

    if(func === 'getFilePart' || func === 'getFileSize') return logViewerAjax(args, callback);

    if(func === 'getObjectsByNames') return rightsWrappersObjectsDB.getObjectsIDs(args.username, args.objectNames.split('\r'), callback);

    if(func === 'getCountersByNames') return counterDB.getCountersIDsByNames(args.counterNames.split('\r'), callback);

    callback(new Error('Unknown function ' + func));
};

function getFunctionsDescription() {

    var functionsDescription = {};

    for(var func in functions) {
        if(!functions.hasOwnProperty(func)) continue;
        functionsDescription[func] = functions[func].description;
    }

    var operatorsDescription = Object.keys(calc.operators)
        .sort(function(a,b) {
            if(calc.operators[a].priority > calc.operators[b].priority) return 1;
            else return -1;
        })
        .map(function(op) {
            return 'Operator: "' + op + '"; priority: ' + calc.operators[op].priority +
                '; unary: ' + calc.operators[op].unary + ';' +
                calc.operators[op].func.toString();
        }).join('\n');

    functionsDescription['arithmetical operators'] = 'arithmetical operators help page\n\n' + operatorsDescription;

    return functionsDescription;
}

function getLogFileList(args, callback) {
    var logPath = path.join(__dirname, '..', '..', confLog.get('dir') || 'logs', 'counters');

    fs.readdir(logPath, {withFileTypes: true}, function (err, filesObjArray) {
        if (err) return callback(new Error('Can\'t read dir ' + logPath + ': ' + err.message));

        var result = filesObjArray
            .filter(f => f.isFile() && new RegExp('^' + args.IDs + '\\.\\d{6}$').test(f.name))
            .sort((a, b) => Number(b.name.split('.')[1]) - Number(a.name.split('.')[1]))
            .map(f => '\r' + logPath + '\r' + f.name)
            .join('\n');

        callback(null,  result);
    });
}