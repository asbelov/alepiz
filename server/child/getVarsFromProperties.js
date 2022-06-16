/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require("async");
const getVarFromProperty = require('./getVarFromProperty');

// resolve variables from objects properties
module.exports = function (properties, variables, property, variablesDebugInfo, newVariables,  callback) {

    if (!properties.length) return callback();

    async.each(properties, function (property, callback) {
        // if this property was calculated at previous loop
        if (!property.name) return callback();

        getVarFromProperty(property, variables, null, {}, function (err, result, _variablesDebugInfo) {
            if (err) return callback(err);

            if (_variablesDebugInfo && !_variablesDebugInfo.unresolvedVariables && result !== null) {
                newVariables.push(property.name);
            }
            variables[property.name] = result;

            if (property.debug) {
                variablesDebugInfo[property.name] = _variablesDebugInfo;
            }

            callback();
        });
    }, callback);
}