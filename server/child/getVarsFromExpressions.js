/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const async = require("async");
const calc = require("../../lib/calc");

module.exports = function (expressions, variables, property, updateEventState, variablesDebugInfo, newVariables,  callback) {

    if (!expressions.length) return callback();

    var whyNotNeedToCalculateCounter;
    async.each(expressions, function (variable, callback) {
        var variableName = variable.name;

        // if this variable was calculated at previous loop
        if (!variableName) return callback();

        log.options('Processing variable for expression: ', variableName, ' = ', variable.expression, {
            filenames: ['counters/' + property.counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });
        calc(variable.expression, variables, property.counterID,
            function (err, result, functionDebug, unresolvedVariables, initVariables) {
            if (!unresolvedVariables && err) return callback(err);

            if (property.debug || variableName === 'UPDATE_EVENT_STATE') {
                variablesDebugInfo[variable.name] = {
                    timestamp: Date.now(),
                    name: variable.name,
                    expression: variable.expression,
                    variables: initVariables,
                    functionDebug: functionDebug,
                    unresolvedVariables: unresolvedVariables,
                    result: result,
                };
            }

            for (var i = 0, hasUnresolved = false; unresolvedVariables && i < unresolvedVariables.length; i++) {
                if (unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                    hasUnresolved = true;
                    break;
                }
            }

            if (hasUnresolved) return callback();

            // if all variables are resolved, then don\'t try to recalculate this expression
            if (!unresolvedVariables && result !== null) {
                //variable.name = null;
                newVariables.push(variableName);
            }
            variables[variableName] = result;

            if (variableName !== 'UPDATE_EVENT_STATE') return callback();

            whyNotNeedToCalculateCounter = null;

            // if variableName === 'UPDATE_EVENT_STATE'

            /*
             property.mode:
             0: Update each time when expression value is true
             1: Update once when expression value is changed to true
             2: Update once when expression value is changed to true and once when changed to false
             3: Update each time when expression value is true and once when changed to false
             4: Update once when expression value is changed to false
            */

            /*
             Below processing update event status when it was changed or not changed
             When result is true the counter will get a value if property.mode is
             0: Update each time when expression value is true and result is false
            */
            if (property.mode === 0 && !result) {
                whyNotNeedToCalculateCounter = 'Update event state was changed or not changed, and now it is false';
            }

            /*
             The updateEventState can be undefined if
             the counter does not have an update event expression or
             this is the first calculation of the update event expression or
             the previous value of the update event expression has not been saved (f.e. if process was terminated)

             Boolean(0, -0, null, false, NaN, undefined, "") = false
            */

            /*
             Below processing update event status when it changed to true or false or when status is undefined
             When update event status is changed the counter will get a value if property.mode is
             1: Update once when expression value is changed to true and result is changed to true
             2: Update once when expression value is changed to true and once when changed to false and result is changed to true or false
             3: Update each time when expression value is true and once when changed to false and result is changed to true or false
             4: Update once when expression value is changed to false and result is changed to false
            */
            if (updateEventState === undefined || Boolean(updateEventState) !== Boolean(result)) {

                variables.UPDATE_EVENT_TIMESTAMP = Date.now();
                // Boolean(0, -0, null, false, NaN, undefined, "") = false
                variables.UPDATE_EVENT_STATE = (result === undefined ? true : Boolean(result));

                /*
                 Not need to calculate the counter when property.mode is
                 1: Update once when expression value is changed to true and result is false
                */
                if (property.mode === 1 && !result) whyNotNeedToCalculateCounter = 'Update event state was changed to false';

                /*
                 Not need to calculate the counter when property.mode is
                 4: Update once when expression value is changed to false and result is true
                */
                if (property.mode === 4 && result) whyNotNeedToCalculateCounter = 'Update event state was changed to true';
            }
            /*
             Below processing update event status when it is not changed
             When update event status is NOT changed the counter will get a value if property.mode is
             3: Update each time when expression value is true and once when changed to false and result is changed to true
            */
            else {
                /*
                 Not need to calculate the counter when result is not changed and property.mode is
                 1: Update once when expression value is changed to true
                 2: Update once when expression value is changed to true and once when changed to false
                 4: Update once when expression value is changed to false
                */
                if (property.mode === 1 || property.mode === 2 || property.mode === 4) {
                    whyNotNeedToCalculateCounter = 'Update event state was not changed';
                }

                /*
                 Not need to calculate the counter when result is not changed, and it is a false, and property.mode is
                 3: Update each time when expression value is true and once when changed to false
                */
                if (property.mode === 3 && !result) {
                    whyNotNeedToCalculateCounter = 'Update event state was not changed and result is false';
                }
            }

            callback();
        });
    }, function (err) {
        callback(err, whyNotNeedToCalculateCounter);
    })
}