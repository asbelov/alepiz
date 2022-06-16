/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const async = require("async");
const getVarFromHistory = require('./getVarFromHistory');

module.exports = function (historyVariables, variables, property, countersObjects, variablesDebugInfo, newVariables, callback) {

    if (!historyVariables.length) return callback();

    async.each(historyVariables, function (historyVariable, callback) {
        // if this historyVariable was calculated at previous loop
        if (!historyVariable.name) return callback();

        getVarFromHistory(historyVariable, variables, null, {
            countersObjects: countersObjects,
            objectID: property.objectID,
            objectName: property.objectName,
        }, function(err, result, _variablesDebugInfo) {
            if(err) return callback(new Error(err.message + ', ' + property.objectName + '(' + property.counterName + ')'));
            if (result !== undefined && result !== null) {
                variables[historyVariable.name] = result;
                newVariables.push(historyVariable.name);
            }

            if (property.debug) variablesDebugInfo[historyVariable.name] = _variablesDebugInfo;

            //log.info('!!!!: ', property.objectName + '(' + property.counterName + ') ', result, ': ', _variablesDebugInfo, ': ', variables)
            callback();
        });
    }, callback);
}