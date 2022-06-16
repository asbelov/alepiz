/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require("async");
const fromHuman = require('../../lib/utils/fromHuman');
const variablesReplace = require('../../lib/utils/variablesReplace');
const history = require("../../models_history/history");

/**
 * List of historical function names to check if the function name exists
 * @type {Set<any>}
 */
const historyFunctionList = new Set(history.getFunctionList().map(func => func.name));

module.exports = getVarFromHistory;

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

        calcObjectName(historyVariable, variables, getVariableValue, param,
            function(err, OCID, variableObjectName) {

            if(err) {
                variablesDebugInfo.result = err.message;
                return callback(new Error(param.objectName + '(' + param.counterName +
                    ' #' + param.counterID + '): ' + err.message), null, variablesDebugInfo);
            }

            funcParameters.unshift(OCID);

            // add callback function as last parameter to history function
            (function (_historyVariable, _param, _callback) {
                funcParameters.push(function (err, _result) {
                    funcParameters.pop(); // remove callback for debugging
                    funcParameters.shift();

                    var result = _result ? _result.data : _result;

                    var variablesDebugInfo = {
                        timestamp: Date.now(),
                        name: _historyVariable.name,
                        expression: variableObjectName + '(' + _historyVariable.parentCounterName + '): ' + _historyVariable.function + '(' +
                            funcParameters.join(', ') + ')',
                        variables: variables,
                        functionDebug: result ? result.records : undefined,
                        result: JSON.stringify(result),
                    };

                    if (err) {
                        variablesDebugInfo.result += ': err: ' + err.message
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

function parameterValueFromHuman(parameter) {
    // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing parameter
    if (String(parameter).charAt(0) !== '!') return fromHuman(parameter);
    return '!' + fromHuman(parameter.slice(1));
}

function calcObjectName(historyVariable, variables, getVariableValue, param, callback) {

    // calculate and add objectCounterID as first parameter for history function
    if (historyVariable.objectVariable) { // objectVariable is right, not param.objectName

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
                    if(!res) return callback(null, String(historyVariable.objectVariable).toUpperCase());

                    if (res.unresolvedVariables.length) {
                        return callback(new Error('Found unresolved variables while calculating object name from ' +
                            historyVariable.objectVariable + ': ' + res.unresolvedVariables.join(', ')));
                    }
                    variableObjectName = String(res.value).toUpperCase();

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