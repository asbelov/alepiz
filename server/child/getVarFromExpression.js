/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const calc = require("../../lib/calc");

module.exports = getVarFromExpression;

/**
 * Calculate expression and return variable value
 *
 * @param {Object} variable object with variable parameters
 * @param {string} variable.name variable name
 * @param {string} variable.expression variable expression
 * @param {Object} variables list of the variables, like {<name>: <value>, ....}
 * @param {function(string, function)} getVariableValue function for get variable value for unresolved variable
 * @param {Object} param for debug information
 * @param {string} param.objectName object name
 * @param {string} param.counterName counterName
 * @param {string} param.counterID counterID
 * @param {function(Error, *, Object)} callback callback(err, result, variablesDebugInfo)
 */
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
            result: err ? ((result === undefined ? '' : result + ': Error: ') + err.message) : result,
        };

        if (!unresolvedVariables && err) {
            return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID + '): ' +
                err.message), result, variablesDebugInfo);
        }

        // searching variables without %:?....:%
        var trueUnresolvedVariables = Array.isArray(unresolvedVariables) ?
            unresolvedVariables.filter(variableName => variableName.charAt(2) !== '?') : [];

        if(trueUnresolvedVariables.length) {
            variablesDebugInfo.result = (err ? '. Error: ' + err.message + '. ' : '') +
                'Unresolved variables: ' + trueUnresolvedVariables.join(';  ');
            return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID + '): ' +
                variablesDebugInfo.result.replace(/^. /, '')), result, variablesDebugInfo);
        }

        callback(null, result, variablesDebugInfo);
    });
}