/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//const log = require('../../lib/log')(module);
const async = require("async");
const getVarFromExpression = require('./getVarFromExpression');
const processUpdateEventExpressionResult = require('./processUpdateEventExpressionResult');

module.exports = function (expressions, variables, property, updateEventState, variablesDebugInfo, newVariables,  callback) {

    if (!expressions.length) return callback();

    var whyNotNeedToCalculateCounter;
    async.each(expressions, function (variable, callback) {
        var variableName = variable.name;

        // if this variable was calculated at previous loop
        if (!variableName) return callback();

        getVarFromExpression(variable, variables, null, {}, function (err, result, _variablesDebugInfo) {
            if(err) return callback(err);

            if (property.debug || variableName === 'UPDATE_EVENT_STATE') {
                variablesDebugInfo[variable.name] = _variablesDebugInfo;
            }

            if (_variablesDebugInfo && !_variablesDebugInfo.unresolvedVariables && result !== null) {
                newVariables.push(variableName);
            }
            variables[variableName] = result;

            if (variableName === 'UPDATE_EVENT_STATE') {
                whyNotNeedToCalculateCounter = processUpdateEventExpressionResult(result, property.mode, updateEventState);
                if (updateEventState === undefined || Boolean(updateEventState) !== Boolean(result)) {
                    variables.UPDATE_EVENT_TIMESTAMP = Date.now();
                    // Can be 1 or 0. Boolean(0, -0, null, false, NaN, undefined, "") = false
                    variables.UPDATE_EVENT_STATE = (result === undefined ? 1 : Number(Boolean(result)));
                }
            }

            callback();
        });
    }, function (err) {
        callback(err, whyNotNeedToCalculateCounter);
    })
}