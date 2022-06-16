/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../../lib/log')(module);
const async = require("async");
const getVarsFromHistory = require("./getVarsFromHistory");
const getVarsFromProperties = require("./getVarsFromProperties");
const getVarsFromExpressions = require("./getVarsFromExpressions");

module.exports = getVars;

const maxAttemptsToResolveVariables = 20;
const updateEventsMode = {
    '0': 'Update each time when expression value is true',
    '1': 'Update once when expression value is changed to true',
    '2': 'Update once when expression value is changed to true and once when changed to false',
    '3': 'Update each time when expression value is changed to true and once when changed to false'
};

/*
get variables values
property - { OCID:.., objectID:.., counterID:.., counterName:..., parentObjectName:..., parentCounter :.., collector:..., objectName:...., parentObjectValue:... }
parentVariables - variables from parent counters {name1: val1, name2: val2, ...}. Can be undefined
callback(err, variables)
variables - {name1: val1, name2: val2, ...} - variables list with values
*/
function getVars(property, parentVariables, updateEventState, data, countersObjects, callback) {

    var counterID = Number(property.counterID);
    var objectName = property.objectName;
    var counterName = property.counterName;
    var variablesDebugInfo = {};


    // !!! Don't set variables = parentVariables for save parent variables
    var variables = {};

    // !!! Don't set variables = parentVariables. It will be a reference.
    // Need to save parentVariables unchanged after add new values to variables
    if (typeof parentVariables === 'object') {
        for (var name in parentVariables) variables[name] = parentVariables[name];
    }

    // add static data about current and parent objects to variables list
    variables.PARENT_OBJECT_NAME = property.parentObjectName === undefined ? '' : property.parentObjectName;
    variables.PARENT_COUNTER_NAME = property.parentCounter === undefined ? '' : property.parentCounter;
    variables.OBJECT_NAME = objectName === undefined ? '' : objectName;
    variables.PARENT_VALUE = property.parentObjectValue === undefined ? '' : property.parentObjectValue;
    variables.COUNTER_NAME = counterName === undefined ? '' : counterName;

    if (property.parentOCID && property.expression) {
        // add 'UPDATE_EVENT_STATE' as first element of array for calculate it at first
        data.expressions.unshift({
            id: 0,
            name: 'UPDATE_EVENT_STATE',
            counterID: counterID,
            expression: property.expression
        });
    }
    /*
        Searching for equal counters variables and object properties
        If finding equal counter variable and object property then use value of object property
        Used for redefine variables from counter
        You can use this also for making hack with UPDATE_EVENT_STATE - define it as object property.
        This redefines value of UPDATE_EVENT_STATE from counter
     */
    if (data.properties && data.properties.length && (
        (data.expressions && data.expressions.length) ||
        (data.variables && data.variables.length)
    )) {

        data.properties.forEach(function (property) {
            if (!property.name) return;
            var propertyName = property.name.toUpperCase();

            for (var i = 0; data.expressions && i < data.expressions.length; i++) {
                if (data.expressions[i] && data.expressions[i].name && propertyName === data.expressions[i].name.toUpperCase()) {
                    data.expressions[i].name = null;
                    break;
                }
            }

            for (i = 0; data.variables && i < data.variables.length; i++) {
                if (data.variables[i] && data.variables[i].name && propertyName === data.variables[i].name.toUpperCase()) {
                    data.variables[i].name = null;
                    break;
                }
            }
        });
    }

    log.options('Variables data from DB for: ', objectName, '(', counterName, '): ', data,
        '; init variables: ', variables, {
            filenames: ['counters/' + counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });

    var newVariables = [],
        prevNewVariables = [],
        attempts = 1,
        whyNotNeedToCalculateCounter;

    // loop for resolve variables in expressions and from history functions
    async.doWhilst(function (callback) {
        newVariables = [];

        async.parallel([ function (callback) {
            getVarsFromHistory(data.variables, variables, property, countersObjects,
                variablesDebugInfo, newVariables, callback);
        }, function (callback)  {
            getVarsFromProperties(data.properties, variables, property, variablesDebugInfo, newVariables, callback)
        }, function (callback) {
            getVarsFromExpressions(data.expressions, variables, property, updateEventState,
                variablesDebugInfo, newVariables, function (err, _whyNotNeedToCalculateCounter) {
                    whyNotNeedToCalculateCounter = _whyNotNeedToCalculateCounter;
                    callback(err);
                });
        }], callback)
    }, function () {
        //return (newVariables.length && ++attempts < maxAttemptsToResolveVariables);

        // stop variable calculation if no new variables are calculated
        if (!newVariables.length) return false;

        // stop the calculation of variables if the number of calculation attempts is more than maxAttemptsToResolveVariables
        if (++attempts >= maxAttemptsToResolveVariables) {
            var unresolvedVariables = newVariables.filter(newVariable => prevNewVariables.indexOf(newVariable) === -1);
            log.options('Attempts: ', attempts, ': ', objectName, '(', counterName,
                '): new - prev vars: ', unresolvedVariables,
                '; vars : ', variables,
                '; new: ', newVariables, '; prev: ', prevNewVariables,
                '; source data from DB: ', data, {
                    filenames: ['counters/' + counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'W'
                });
            return false;
        }

        if (newVariables.length === prevNewVariables.length) {
            // compare previous and current variables names
            for (var i = 0; i < newVariables.length; i++) {
                if (prevNewVariables.indexOf(newVariables[i]) === -1) {
                    // copy array of newVariables to prevNewVariables
                    prevNewVariables = newVariables.slice();

                    // find different variables names. continue calculating variables
                    return true;
                }
            }
            // stop variables calculation if previous and current variable names are equal
            return false;
        }

        // copy array of newVariables to prevNewVariables
        prevNewVariables = newVariables.slice();
        return true; // continue calculating variables

    }, function (err) {
        if (err) {
            return callback(new Error('Error while calculating variables values for ' +
                objectName + '(' + counterName + '): ' + err.message));
        }

        log.options('Attempts: ', attempts, ': ', objectName, '(', counterName, '): new\\prev variables: ',
            newVariables, '\\', prevNewVariables, '; variables : ', variables, ' for data for DB: ', data, {
                filenames: ['counters/' + counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
            });

        if (variablesDebugInfo.UPDATE_EVENT_STATE) {
            if (whyNotNeedToCalculateCounter) {
                variablesDebugInfo.UPDATE_EVENT_STATE.result += ' (' + whyNotNeedToCalculateCounter + ')';
            } else variablesDebugInfo.UPDATE_EVENT_STATE.important = true;
            variablesDebugInfo.UPDATE_EVENT_STATE.result += '. Calculation cycles: ' + attempts;
            variablesDebugInfo.UPDATE_EVENT_STATE.name = 'Update event. Mode: ' + updateEventsMode[property.mode]
        }

        callback(null, whyNotNeedToCalculateCounter, variables, variablesDebugInfo);
    });
}