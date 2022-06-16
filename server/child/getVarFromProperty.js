/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const calc = require("../../lib/calc");
const variablesReplace = require("../../lib/utils/variablesReplace");
const fromHuman = require("../../lib/utils/fromHuman");

module.exports = getVarFromProperty;

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