/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const calc = require("../../lib/calc");

module.exports = getVarFromExpression;

function getVarFromExpression(variable, variables, getVariableValue, param, callback) {

    calc(variable.expression, variables, getVariableValue,
        function (err, result, functionDebug, unresolvedVariables) {

            var variablesDebugInfo = {
                timestamp: Date.now(),
                name: variable.name,
                expression: variable.expression,
                variables: variables,
                functionDebug: functionDebug,
                unresolvedVariables: unresolvedVariables,
                result: err ? result || '' + ': err: ' + err.message: result,
            };

        if (!unresolvedVariables && err) {
            return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID + '): ' +
                err.message), result, variablesDebugInfo);
        }
        for (var i = 0; unresolvedVariables && i < unresolvedVariables.length; i++) {
            if (unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                variablesDebugInfo.result = 'Found unresolved variable: ' + unresolvedVariables[i];
                return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID + '): ' +
                    variablesDebugInfo.result), result, variablesDebugInfo);
            }
        }
        callback(null, result, variablesDebugInfo);
    });
}