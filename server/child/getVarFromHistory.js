/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const async = require("async");
const fromHuman = require('../../lib/utils/fromHuman');
const variablesReplace = require('../../lib/utils/variablesReplace');
const history = require("../../serverHistory/historyClient");

/**
 * List of historical function names to check if the function name exists
 * @type {Set<any>}
 */
const historyFunctionList = new Set(history.getFunctionList().map(func => func.name));

module.exports = getVarFromHistory;

/**
 * Calculate historical variable and return variable value
 * @param {Object} historyVariable object with historical variable parameters
 * @param {string} historyVariable.name historical variable name
 * @param {string} historyVariable.function historical variable function
 * @param {string} historyVariable.functionParameters historical variable function parameters
 * @param {string} historyVariable.OCID OCID for get historical data
 * @param {string} historyVariable.objectName object name for get historical data
 * @param {string} historyVariable.objectVariable variable with the object name for get historical data
 * @param {string} historyVariable.parentCounterName parent counter name for get historical data
 * @param {string} historyVariable.parentCounterID parent counter ID for get historical data
 * @param {Object} variables list of the variables, like {<name>: <value>, ....}
 * @param {function(string, function)} getVariableValue function for get variable value for unresolved variable
 * @param {Object} param for debug information
 * @param {string} param.objectName object name
 * @param {string} param.counterName counterName
 * @param {string} param.counterID counterID
 * @param {function(Error, *, Object)} callback callback(err, result, variablesDebugInfo)
 */
function getVarFromHistory(historyVariable, variables, getVariableValue, param, callback) {

    var functionParametersStr = historyVariable.functionParameters;
    var variablesDebugInfo = {
        timestamp: Date.now(),
        name: historyVariable.name,
        expression: (historyVariable.objectVariable || param.objectName) +
            '(' + historyVariable.parentCounterName + '): ' + historyVariable.function + '(' +
            functionParametersStr + ')',
        variables: variables,
        result: '',
    };

    // historyFunctionList = new Set()
    if (!historyVariable.function || !historyFunctionList.has(historyVariable.function)) {
        variablesDebugInfo.result = 'Unknown history function: ' + historyVariable.function + '(' + functionParametersStr + ')';
        return callback(new Error(param.objectName + '(' + param.counterName + ' #' + param.counterID +
            '): Unknown history function: "' + historyVariable.function + '(' + functionParametersStr +
            ')" for get data for variable ' + historyVariable.name), null, variablesDebugInfo);
    }

    calcFunctionParameters(functionParametersStr, variables, getVariableValue, function (err, funcParameters) {
        if(err) {
            variablesDebugInfo.result = err.message;
            return callback(new Error(param.objectName + '(' + param.counterName +
                ' #' + param.counterID + '): ' + err.message), null, variablesDebugInfo);
        }

        variablesDebugInfo.expression = (historyVariable.objectVariable || param.objectName) +
            '(' + historyVariable.parentCounterName + '): ' + historyVariable.function + '(' +
            funcParameters.join(', ') + ')';

        // getting the OCID for getting the history data
        calcOCID(historyVariable, variables, getVariableValue, param,
            function(err, OCID, variableObjectName) {

            if(err) {
                variablesDebugInfo.result = err.message;
                log.options(param.objectName, '(', param.counterName, ' #', param.counterID, '): ', err.message, {
                    filenames: ['counters/' + param.counterID, 'counters'],
                    level: 'I'
                });
                // Do not return an error if the OCID for getting history data cannot be found
                return callback(null, null, variablesDebugInfo);

                /*
                return callback(new Error(param.objectName + '(' + param.counterName +
                    ' #' + param.counterID + '): ' + err.message), null, variablesDebugInfo);
                */
            }

            funcParameters.unshift(OCID);

            // add callback as last parameter to history function
            (function (_historyVariable, _param, _callback) {
                funcParameters.push(function (err, _result) {
                    funcParameters.pop(); // remove callback for debugging
                    funcParameters.shift();

                    var result = _result ? (_result.data === undefined ? null : _result.data) : null;

                    var variablesDebugInfo = {
                        timestamp: Date.now(),
                        name: _historyVariable.name,
                        expression: variableObjectName + '(' + _historyVariable.parentCounterName + '): ' +
                            _historyVariable.function + '(' + funcParameters.join(', ') + ')',
                        variables: variables,
                        functionDebug: _result ? _result.records : undefined,
                        result: JSON.stringify(result),
                    };

                    if (err) {
                        variablesDebugInfo.result += ': Error: ' + err.message
                        return _callback(new Error(_param.objectName + '(' + _param.counterName +
                            ' #' + _param.counterID + '): ' + err.message), result, variablesDebugInfo);
                    }

                    _callback(null, result, variablesDebugInfo);
                });
            }) (historyVariable, param, callback);

            // send array as a function parameters, i.e. func.apply(this, [prm1, prm2, prm3, ...]) = func(prm1, prm2, prm3, ...)
            // funcParameters = [objectCounterID, prm1, prm2, prm3,..., callback]; callback(err, result, variablesDebugInfo), where result = [{data:<data>, }]
            history[historyVariable.function].apply(this, funcParameters);
        })
    });
}

/**
 * Calculate historical function parameters
 * @param {string} functionParametersStr string with comma separate function parameters
 * @param {Object} variables list of the variables, like {<name>: <value>, ....}
 * @param {function(string, function)} getVariableValue function for get variable value for unresolved variable
 * @param {function(Error)|function(null, Array)} callback callback(err, arrayOfFunctionParameters)
 */
function calcFunctionParameters(functionParametersStr, variables, getVariableValue, callback) {
    var functionParameters = [];
    if(!functionParametersStr) return callback(null, functionParameters);
    if(typeof functionParametersStr !== 'string') return callback(null, [functionParametersStr]);

    var rawFuncParameters = functionParametersStr.split(/ *, */);

    async.eachSeries(rawFuncParameters, function(functionParameter, callback) {
        var res = variablesReplace(functionParameter, variables);
        if(!res) {
            functionParameters.push('');
            return callback();
        }

        if(!res.allUnresolvedVariables.length) {
            functionParameters.push(parameterValueFromHuman(res.value));
            return callback();
        }

        async.eachSeries(res.allUnresolvedVariables, function(variableName, callback) {
            if(variables[variableName]) return callback();
            getVariableValue(variableName, callback);
        }, function(err) {
            if(err) return callback(err);

            var res = variablesReplace(functionParameter, variables);
            if(!res) {
                functionParameters.push('');
                return callback();
            }

            if (res.unresolvedVariables.length) {
                return callback(new Error('Found unresolved variables in function parameters: ' +
                    res.unresolvedVariables.join(', ')));
            }

            functionParameters.push(parameterValueFromHuman(res.value));
            callback();
        });
    }, function(err) {
        if(err) return callback(err);

        callback(null, functionParameters);
    });
}

/**
 * Convert human readable parameter to the number
 * @param {*} parameter
 * @return {number|*|undefined|string}
 */
function parameterValueFromHuman(parameter) {
    // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing parameter
    if (String(parameter).charAt(0) !== '!') return fromHuman(parameter);
    return '!' + fromHuman(parameter.slice(1));
}

/**
 * Get OCID for getting historical data
 * @param {Object} historyVariable object with historical variable parameters
 * @param {string} historyVariable.name historical variable name
 * @param {string} historyVariable.function historical variable function
 * @param {string} historyVariable.functionParameters historical variable function parameters
 * @param {string} historyVariable.OCID OCID for get historical data
 * @param {string} historyVariable.objectName object name for get historical data
 * @param {string} historyVariable.objectVariable variable with the object name for get historical data
 * @param {string} historyVariable.parentCounterName parent counter name for get historical data
 * @param {string} historyVariable.parentCounterID parent counter ID for get historical data
 * @param {Object} variables list of the variables, like {<name>: <value>, ....}
 * @param {function(string, function)} getVariableValue function for get variable value for unresolved variable
 * @param {Object} param for debug information
 * @param {string} param.objectName object name
 * @param {string} param.counterName counterName
 * @param {string} param.counterID counterID
 * @param {function(Error)|function(null, number, string)} callback callback(err, OCID, variableObjectName)
 */
function calcOCID(historyVariable, variables, getVariableValue, param, callback) {

    if (historyVariable.objectVariable) { // use the objectVariable, do not use param.objectName

        var res = variablesReplace(historyVariable.objectVariable, variables);
        if (res) {
            if (res.allUnresolvedVariables.length) {
                var variableObjectName = '';
                async.each(res.allUnresolvedVariables, function(variableName, callback) {
                    if(variables[variableName]) return callback();
                    getVariableValue(variableName, callback);
                }, function(err) {
                    if(err) return callback(err);

                    var res = variablesReplace(historyVariable.objectVariable, variables);

                    if(!res) {
                        return callback(new Error('Can\'t get OCID for object variable "' +
                            historyVariable.objectVariable + '" and counterID: ' + historyVariable.parentCounterName));
                    }
                    else {
                        if (res.unresolvedVariables.length) {
                            return callback(new Error('Found unresolved variables while calculating object name from ' +
                                historyVariable.objectVariable + ': ' + res.unresolvedVariables.join(', ')));
                        }
                        variableObjectName = String(res.value).toUpperCase();
                    }

                    var OCID = param.countersObjects.objectName2OCID.has(variableObjectName) ?
                        param.countersObjects.objectName2OCID.get(variableObjectName).get(Number(historyVariable.parentCounterID)) : null;
                    if (!OCID) {
                        return callback(new Error('Can\'t get OCID for object ' + variableObjectName +
                            ' and counterID: ' + historyVariable.parentCounterName));
                    }

                    callback(null, OCID, variableObjectName);
                });

                return;
            } else variableObjectName = String(res.value).toUpperCase();
        } else variableObjectName = String(historyVariable.objectVariable).toUpperCase();

        var OCID = param.countersObjects.objectName2OCID.has(variableObjectName) ?
            param.countersObjects.objectName2OCID.get(variableObjectName).get(Number(historyVariable.parentCounterID)) : null;
        if (!OCID) {
            return callback(new Error('Can\'t get OCID for object ' + variableObjectName +
                ' and counterID: ' + historyVariable.parentCounterName));
        }
    } else {
        if (historyVariable.OCID) {
            variableObjectName = historyVariable.objectName;
            OCID = historyVariable.OCID;
        } else {
            variableObjectName = param.objectName;
            OCID = param.countersObjects.counters.has(Number(historyVariable.parentCounterID)) ?
                param.countersObjects.counters.get(Number(historyVariable.parentCounterID)).objectsIDs.get(Number(param.objectID)) : null;
            if (!OCID) {
                return callback(new Error('Can\'t get OCID for object ' + variableObjectName +
                    ' and counter: ' + historyVariable.parentCounterName));
            }
        }
    }

    callback(null, OCID, variableObjectName);
}