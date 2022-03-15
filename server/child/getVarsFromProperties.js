/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const async = require("async");
const calc = require("../../lib/calc");

// resolve variables from objects properties
module.exports = function (properties, variables, property, variablesDebugInfo, newVariables,  callback) {

    if (!properties.length) return callback();

    async.each(properties, function (property, callback) {
        // if this property was calculated at previous loop
        if (!property.name) return callback();

        var name = property.name.toUpperCase();
        log.options('Variable name for object properties: ', name, {
            filenames: ['counters/' + property.counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });
        if (property.mode === 3) { // there is an expression, calculate it
            calc(property.value, variables, property.counterID,
                function (err, result, functionDebug, unresolvedVariables, initVariables) {
                    if (!unresolvedVariables && err) return callback(err);

                    for (var i = 0, hasUnresolved = false; unresolvedVariables && i < unresolvedVariables.length; i++) {
                        if (unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                            hasUnresolved = true;
                            break;
                        }
                    }

                    if (!hasUnresolved) {
                        variables[name] = result;
                        // if all variables are resolved, then don\'t try to recalculate this expression
                        if (!unresolvedVariables && result !== null) {
                            newVariables.push(name);
                            //property.name = null;
                        }
                    }

                    if (property.debug) {
                        variablesDebugInfo[name] = {
                            timestamp: Date.now(),
                            name: name,
                            expression: property.value,
                            variables: initVariables,
                            result: result,
                            functionDebug: functionDebug,
                            unresolvedVariables: unresolvedVariables
                        };
                    }

                    callback();
                });
        } else { // it is not an expression, just replacing variables with values

            var res = calc.variablesReplace(property.value, variables);
            if (!res || (res && !res.unresolvedVariables.length)) {
                // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing value
                variables[name] = calc.convertToNumeric((res ? res.value : property.value));
                newVariables.push(name);
                //property.name = null
            }
            log.options('Replacing variables ', property.objectName, '(', property.counterName, '): result: ', name, ' = ',
                (res ? res.value : property.value), ' unresolved variables: ',
                (res && res.unresolvedVariables.length ? res.unresolvedVariables : 'none'),
                ' variables: ', variables, {
                    filenames: ['counters/' + property.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'D'
                });

            if (property.debug) {
                variablesDebugInfo[name] = {
                    timestamp: Date.now(),
                    name: name,
                    expression: property.value,
                    result: variables[name],
                    variables: variables,
                    unresolvedVariables: res && res.unresolvedVariables.length ? res.unresolvedVariables : undefined
                };
            }

            callback();
        }
    }, callback)
}