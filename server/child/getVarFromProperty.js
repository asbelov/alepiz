/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const calc = require("../../lib/calc");
const variablesReplace = require("../../lib/utils/variablesReplace");
const fromHuman = require("../../lib/utils/fromHuman");

module.exports = getVarFromProperty;

/**
 * Calculate object property and return variable value
 *
 * @param {Object} property object with property parameters
 * @param {0|1|2|3} property.mode variable mode. If mode == 3 then require for calculate property from expression
 * @param {string} property.value property value
 * @param {Object} variables list of the variables, like {<name>: <value>, ....}
 * @param {function(string, function)} getVariableValue function for get variable value for unresolved variable
 * @param {Object} param for debug information
 * @param {string} param.objectName object name
 * @param {string} param.counterName counterName
 * @param {string} param.counterID counterID
 * @param {function(Error, *, Object)} callback callback(err, result, variablesDebugInfo)
 */

function getVarFromProperty(property, variables, getVariableValue, param, callback) {
    var name = property.name.toUpperCase();
    if (property.mode === 3) { // there is an expression, calculate it
        calc(property.value, variables, getVariableValue,
    function (err, result, functionDebug, unresolvedVariables) {
                var variablesDebugInfo = {
                    timestamp: Date.now(),
                    name: name,
                    expression: property.value,
                    variables: variables,
                    result: err ? result || '' + err.message : result,
                    functionDebug: functionDebug,
                    unresolvedVariables: unresolvedVariables
                };
                if (!unresolvedVariables && err) {
                    return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID +
                        '): ' + err.message), result, variablesDebugInfo);
                }
                callback(null, result, variablesDebugInfo);
            });
    } else { // there is not an expression, just replacing variables with values

        var rawResult = variablesReplace(property.value, variables);
        if (!rawResult || (rawResult && !rawResult.unresolvedVariables.length)) {
            // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing value
            var result = fromHuman(rawResult ? rawResult.value : property.value);
        }
        var variablesDebugInfo = {
            timestamp: Date.now(),
            name: name,
            expression: property.value,
            result: result,
            variables: variables,
            functionDebug: rawResult ? rawResult.value : undefined,
            unresolvedVariables: rawResult && rawResult.unresolvedVariables.length ? rawResult.unresolvedVariables : undefined
        };

        callback(null, result, variablesDebugInfo);
    }
}