/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const async = require("async");
const calc = require("../../lib/calc");
const history = require("../../models_history/history");

var historyFunctionList = new Set(); // to check if the function name exists
history.getFunctionList().forEach(function (func) {
    historyFunctionList.add(func.name);
});

module.exports = function (historyVariables, variables, property, countersObjects, variablesDebugInfo, newVariables, callback) {

    if (!historyVariables.length) return callback();
    async.each(historyVariables, function (variable, callback) {
        // if this variable was calculated at previous loop
        if (!variable.name) return callback();

        /* I don't understand this condition
        if(!property.parentOCID) {
            return callback(new Error('Variable ' + variable.name + ' for objectID ' + property.objectID +
                ' and counterID ' + property.counterID + ': ' +
                property.objectName + '(' + property.counterName + ') did not have an object to counter relation objectCounterID'));
        }
         */

        var res = calc.variablesReplace(variable.functionParameters, variables);
        if (res) {
            log.options('Replacing variables in func parameters ', property.objectName,
                '(', property.counterName, '): ', variable.name, ' = ', variable.function,
                '(', variable.functionParameters, ' => ', res.value, '); ', variables, {
                    filenames: ['counters/' + property.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'D'
                });
            variable.functionParameters = res.value;

            if (res.unresolvedVariables.length) return callback();
        }

        // historyFunctionList = new Set()
        if (!variable.function || !historyFunctionList.has(variable.function)) {
            return callback(new Error('Unknown history function: "' + variable.function +
                '" for get data for variable ' + variable.name + ', ' +
                property.objectName + '(' + property.counterName + ')'));
        }

        var funcParameters = [];
        if (variable.functionParameters)
            if (typeof (variable.functionParameters) === 'string') {
                funcParameters = variable.functionParameters.split(/[ ]*,[ ]*/).map(function (parameter) {
                    // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing parameter
                    var hasExclamation = false;
                    if (String(parameter).charAt(0) === '!') {
                        parameter = parameter.slice(1);
                        hasExclamation = true;
                    }
                    return hasExclamation ? '!' + String(calc.convertToNumeric(parameter)) : calc.convertToNumeric(parameter);
                });
            } else funcParameters.push(variable.functionParameters);

        // calculate and add objectCounterID as first parameter for history function
        if (variable.objectVariable) { // objectVariable is right, not property.objectName
            res = calc.variablesReplace(variable.objectVariable, variables);
            if (res) {
                if (res.unresolvedVariables.length) return callback();
                //try {
                var variableObjectName = String(res.value).toUpperCase();
                //} catch(e) {
                //    log.error('Error calc objectCounterID as first parameter for history function: ', e.message,
                //        ': typeof res.value: ', typeof(res.value), '; res.value: ', res.value);
                //}
            } else variableObjectName = String(variable.objectVariable).toUpperCase();

            var OCID = countersObjects.objectName2OCID.has(variableObjectName) ?
                countersObjects.objectName2OCID.get(variableObjectName).get(Number(variable.parentCounterID)) : null;
            if (!OCID) return callback();
        } else {
            if (variable.OCID) {
                variableObjectName = variable.objectName;
                OCID = variable.OCID;
            } else {
                variableObjectName = property.objectName;
                OCID = countersObjects.counters.has(Number(variable.parentCounterID)) ?
                    countersObjects.counters.get(Number(variable.parentCounterID)).objectsIDs.get(Number(property.objectID)) : null;
                if (!OCID) {
                    log.options('CounterID: ', variable.parentCounterID, ' is not linked to the objectID: ',
                        property.objectID, ' for getting historical data for variable: ', variableObjectName,
                        '(', variable.parentCounterName + '): ', variable.name, ' = ', variable.function,
                        '(`', funcParameters.join('`, `'), '`)', {
                            filenames: ['counters/' + property.counterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'D'
                        });
                    return callback();
                }
            }
        }

        // add callback function as last parameter to history function
        log.options('Processing history variable: ', variableObjectName,
            '(', variable.parentCounterName + '): ', variable.name, ' = ', variable.function,
            '(`', funcParameters.join('`, `'), '`), OCID:', OCID, ' variable: ', variable, {
                filenames: ['counters/' + property.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
            });
        funcParameters.unshift(OCID);

        (function (_variable, _property, _callback) {
            funcParameters.push(function (err, result) {
                if (err) return _callback(err);

                if (result !== undefined && result !== null) {
                    variables[_variable.name] = result ? result.data : result;
                    newVariables.push(_variable.name);
                }

                funcParameters.pop(); // remove callback for debugging
                log.options('History variable value for ', _property.objectName,
                    '(', _property.counterName, '): ', variableObjectName + '(' + _variable.parentCounterName + '): ',
                    _variable.name, ': ', _variable.function, '(', funcParameters.join(', '), ') = ', result, {
                        filenames: ['counters/' + _property.counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'D'
                    });

                funcParameters.shift();
                if (_property.debug) {
                    var initVariables = {};
                    for (var name in variables) {
                        initVariables[name] = variables[name];
                    }
                    variablesDebugInfo[_variable.name] = {
                        timestamp: Date.now(),
                        name: _variable.name,
                        expression: variableObjectName + '(' + _variable.parentCounterName + '): ' + _variable.function + '(' + funcParameters.join(', ') + ')',
                        variables: initVariables,
                        functionDebug: result ? result.records : undefined,
                        result: result ? result.data : result
                    };
                }
                _variable.name = null;
                _callback();
            });
        }) (variable, property, callback);

        // send array as a function parameters, i.e. func.apply(this, [prm1, prm2, prm3, ...]) = func(prm1, prm2, prm3, ...)
        // funcParameters = [objectCounterID, prm1, prm2, prm3,..., callback]; callback(err, result), where result = [{data:<data>, }]
        history[variable.function].apply(this, funcParameters);

    }, callback)

    // resolve variables from objects properties
}