/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//const log = require('../../lib/log')(module);
const async = require('async');
const processUpdateEventExpressionResult = require('./processUpdateEventExpressionResult');
const variablesReplace = require("../../lib/utils/variablesReplace");
const fromHuman = require("../../lib/utils/fromHuman");

const getVarFromHistory = require("./getVarFromHistory");
const getVarFromProperty = require("./getVarFromProperty");
const getVarFromExpression = require("./getVarFromExpression");

const Conf = require('../../lib/conf');
const conf = new Conf('config/common.json');


module.exports = getVars;

const updateEventsMode = {
    '0': 'Update each time when expression value is true',
    '1': 'Update once when expression value is changed to true',
    '2': 'Update once when expression value is changed to true and once when changed to false',
    '3': 'Update each time when expression value is changed to true and once when changed to false'
};

/**
 * Get variable values
 * @param param {Object}
 * @param {Object} param.childThread
 * @param {number} param.removeCounter
 * @param {Object} param.parentVariables
 * @param {0|1} param.prevUpdateEventState
 * @param {string|number|null} param.parentObjectValue
 * @param {Object} param.variablesDebugInfo
 * @param {string} param.updateEventExpression
 * @param {0|1|2|3} param.updateEventMode
 * @param {number} param.OCID
 * @param {number} param.parentOCID
 * @param {string|undefined} param.parentObjectName
 * @param {string|undefined} param.parentCounterName
 * @param {string} param.objectName
 * @param {string} param.counterName
 * @param {number} param.objectID
 * @param {number} param.counterID
 * @param {string} param.collector
 * @param {Object} param.countersObjects
 * @param {Object} param.cache
 * @param {any|Map<any, any>} param.cache.variablesHistory
 * @param {any|Map<any, any>} param.cache.variablesExpressions
 * @param {any|Map<any, any>} param.cache.objectsProperties
 * @param {id: number, name: string} param.cache.alepizInstance
 * @param callback {function}
 */

function getVars(param, callback) {
    // !!! Don't set variables = parentVariables for save parent variables
    var variables = {};

    //console.log((param.objectName + ' (' + param.counterName + ' #' + param.counterID + '). Cache: ', param.cache))

    // !!! Don't set variables = parentVariables. It will be a reference.
    // Need to save parentVariables unchanged after add new values to variables
    if (typeof param.parentVariables === 'object') {
        for (var variableName in param.parentVariables) {
            if(!param.cache.objectsProperties.has(variableName) &&
                !param.cache.variablesHistory.has(variableName) &&
                !param.cache.variablesExpressions.has(variableName)
            ) {
                variables[variableName] = param.parentVariables[variableName];
            }
        }
    }

    // add static data from current and parent objects to variable list
    variables.PARENT_OBJECT_NAME = param.parentObjectName === undefined ? '' : param.parentObjectName;
    variables.PARENT_COUNTER_NAME = param.parentCounterName === undefined ? '' : param.parentCounterName;
    variables.OBJECT_NAME = param.objectName === undefined ? '' : param.objectName;
    variables.PARENT_VALUE = param.parentObjectValue === undefined ? '' : param.parentObjectValue;
    variables.COUNTER_NAME = param.counterName === undefined ? '' : param.counterName;
    variables.ALEPIZ_NAME = param.cache.alepizInstance.name || '';
    variables.ALEPIZ_ID = param.cache.alepizInstance.id !== undefined ? param.cache.alepizInstance.id : -1;

    param.variablesDebugInfo = {};

    getUpdateEventState(variables, param, function (err, whyNotNeedToCalculateCounter) {
        if(err) return callback(err, null, variables, param.variablesDebugInfo);

        if(whyNotNeedToCalculateCounter) {
            return callback(null, whyNotNeedToCalculateCounter, variables, param.variablesDebugInfo);
        }

        getCounterParameters(param, variables,function (err, counterParameters) {
            if(err) return callback(err, null, variables, param.variablesDebugInfo, counterParameters);

            /*
            !!!! Do not remove comment bellow !!!!
            Do not check for dependent counters and always calculate all variables, because otherwise variables
            that are used in tasks will not be calculated
             */
            /*
            // checking for dependent counters'
            var parentCounterName = param.countersObjects.counters ? param.countersObjects.counters.get(param.counterID) : null;
            if(param.counterID === 4) console.log('!!getVars find dependent: counter', parentCounterName, '; dependedUpdateEvents', parentCounterName.dependedUpdateEvents.size, '; vars: ', variables);
            if (!parentCounterName || !parentCounterName.dependedUpdateEvents.size) {
                return callback(null, null, variables, param.variablesDebugInfo, counterParameters);
            }
            */

            var errors = [];
            /*
            used eachSeries to avoid calculating the same variable multiple times when it is present in an expression
            in the list of variables to calculate.
             */
            async.eachSeries(Array.from(param.cache.objectsProperties.keys()), function (variableName, callback) {
                if (variables[variableName] !== undefined) return callback();
                getVar(variableName, variables, param, function(err) {
                    // it is necessary to calculate all variables even if errors occurred during the calculation of some variables
                    if(err) errors.push(err);
                    callback();
                });
            }, function () {

                async.eachSeries(Array.from(param.cache.variablesExpressions.keys()), function (variableName, callback) {
                    if (variables[variableName] !== undefined) return callback();
                    getVar(variableName, variables, param, function(err) {
                        // it is necessary to calculate all variables even if errors occurred during the calculation
                        // of some variables
                        if(err) errors.push(err);
                        callback();
                    });
                }, function () {
                    async.eachSeries(Array.from(param.cache.variablesHistory.keys()), function (variableName, callback) {
                        if (variables[variableName] !== undefined) return callback();
                        getVar(variableName, variables, param, function(err) {
                            // it is necessary to calculate all variables even if errors occurred during the
                            // calculation of some variables
                            if(err) errors.push(err);
                            callback();
                        });
                    }, function () {
                        if(errors.length) {
                            var err = new Error(param.objectName + '(' + param.counterName + '): ' +
                                    errors.map(error => error.message).join('; '));
                        }
                        return callback(err, null, variables, param.variablesDebugInfo, counterParameters);
                    });
                });
            });
        });
    });
}

function getUpdateEventState(variables, param, callback) {
    if (!param.parentOCID || !param.updateEventExpression) {
        if(!param.variablesDebugInfo.UPDATE_EVENT_STATE) {
            param.variablesDebugInfo.UPDATE_EVENT_STATE = {
                timestamp: Date.now(),
                counterID: param.counterID,
                expression: param.updateEventExpression || 'none',
                functionDebug: [],
                variables: variables,
            };
        }
        param.variablesDebugInfo.UPDATE_EVENT_STATE.result = 'Calculation is always required';
        param.variablesDebugInfo.UPDATE_EVENT_STATE.important = true;
        param.variablesDebugInfo.UPDATE_EVENT_STATE.name =
            'Update event. Mode: ' + updateEventsMode[param.updateEventMode];
        variables.UPDATE_EVENT_TIMESTAMP = Date.now();
        variables.UPDATE_EVENT_STATE = 1;
        return callback();
    }

    getVar(null, variables, param, function(err, result) {
        if(err) return callback(err);

        // Can be 1 or 0. Boolean(0, -0, null, false, NaN, undefined, "") = false
        const updateEventResult = result === undefined ? 1 : Number(Boolean(result));

        var whyNotNeedToCalculateCounter =
            processUpdateEventExpressionResult(updateEventResult, param.updateEventMode, param.prevUpdateEventState);

        variables.UPDATE_EVENT_STATE = updateEventResult;
        variables.UPDATE_EVENT_TIMESTAMP = Date.now();

        /*
        log.info('!!!!', param.objectName + ' (' + param.counterName + ' #' + param.counterID +
        '): update event ', updateEventResult, ' (', result,')',
            '; prev: ', param.prevUpdateEventState, ' for ', param.updateEventExpression,
            '; processUpdateEventExpressionResult', whyNotNeedToCalculateCounter);
         */

        if (param.prevUpdateEventState === undefined || Boolean(param.prevUpdateEventState) !== Boolean(updateEventResult)) {
            variables.UPDATE_EVENT_TIMESTAMP = Date.now();
        }

        if (param.variablesDebugInfo.UPDATE_EVENT_STATE) {
            if (whyNotNeedToCalculateCounter) {
                param.variablesDebugInfo.UPDATE_EVENT_STATE.result = param.prevUpdateEventState + '->' +
                    updateEventResult + ' (raw: ' + result + ') no calculation required: ' +
                    whyNotNeedToCalculateCounter;
            } else {
                param.variablesDebugInfo.UPDATE_EVENT_STATE.result = param.prevUpdateEventState + '->' +
                    updateEventResult + ' (raw: ' + result + ') calculation required';
                param.variablesDebugInfo.UPDATE_EVENT_STATE.important = true;
            }

            param.variablesDebugInfo.UPDATE_EVENT_STATE.name =
                'Update event. Mode: ' + updateEventsMode[param.updateEventMode];
        }
        //if(param.counterID === 172) console.log('!!getUpdateEventState end: ', param.updateEventExpression, '=', updateEventResult, '; whyNotNeedToCalculateCounter: ', whyNotNeedToCalculateCounter, '; vars: ', variables);
        callback(null, whyNotNeedToCalculateCounter);
    });
}

function getCounterParameters(param, variables, callback) {

    var counterParameters = {
        $id: param.OCID,
        $counterID: param.counterID,
        $objectID: param.objectID,
        $parentID: param.parentOCID,
        $variables: variables,
    };

    if (!param.countersObjects || !param.countersObjects.counters ||
        !param.countersObjects.counters.has(param.counterID) ||
        !Array.isArray(param.countersObjects.counters.get(param.counterID).counterParams)
    ) return callback(null, counterParameters);

    var rawCounterParameters = param.countersObjects.counters.get(param.counterID).counterParams;
    var counter = param.collector + '(' + rawCounterParameters.map(p => p.value).join(', ') + ')';
    //if(param.counterID === 166) console.log('!!getCounterParameters init vars: ', variables);
    async.each(rawCounterParameters, function (parameter, callback) {
        var res = variablesReplace(parameter.value, variables);

        var value = res ? fromHuman(res.value) : parameter.value;
        var variablesDebugName = parameter.name + ': ' + counter;
        param.variablesDebugInfo[variablesDebugName] = {
            timestamp: Date.now(),
            name: parameter.name + ': ' + counter,
            expression: parameter.value,
            variables: variables,
            result: value,
            unresolvedVariables: [],
        };

        //if(param.counterID === 166) console.log('!!getCounterParameters end1: ', parameter.name, '=', value, ';', res, '; vars: ', variables);
        // !res: parameter.value an empty string (or not a string, but that's not possible)
        if (!res || !res.allUnresolvedVariables.length) {
            counterParameters[parameter.name] = value;
            return callback();
        }

        async.each(res.allUnresolvedVariables, function (variableName, callback) {
            if(variables[variableName]) return callback();
            getVar(variableName, variables, param, callback);
        }, function (err) {
            if(err) return callback(err);

            var res = variablesReplace(value, variables);
            if(!res || res.unresolvedVariables.length) {
                return callback(new Error(param.objectName + '(' + param.counterName +
                    '): Counter parameter ' + parameter.name + ': ' + counter + ' (' +
                    parameter.value + ') ' +
                    (!res ? 'not a string' : 'has unresolved variables: ' + (res.unresolvedVariables.join(',')))));
            }
            value = res ? fromHuman(res.value) : parameter.value;
            // some time got Stack: TypeError: Cannot set property 'result' of undefined
            if (param.variablesDebugInfo[variablesDebugName]) {
                param.variablesDebugInfo[variablesDebugName].result = value;
            }
            counterParameters[parameter.name] = value;
            //if(param.counterID === 166) console.log('!!getCounterParameters end2: ', parameter.name, '=', value, ';', res, '; vars: ', variables);
            callback();
        });
    }, function (err) {
        callback(err, counterParameters);
    });
}

function getVar(initVariableName, variables, param, callback) {
    var varCalcDepth = 0;

    return getVariableValue(initVariableName, callback);

    function getVariableValue(variableName, callback) {

        // variable was already calculated
        if(variables[variableName] !== undefined) return callback(null, variables[variableName]);

        // too mach depth for variable calculation
        var maxVarCalcDepth = conf.get('maxVarCalcDepth') || 20;
        if(++varCalcDepth > maxVarCalcDepth) {
            return callback(new Error('The maximum calculation depth (' + maxVarCalcDepth +
                ') of the variable ' + variableName +
                ' has been reached. Perhaps the calculation of the variable is looped.'));
        }

        /*
        If the variable received from the parent counter is overridden and
        the variable received from the parent counter is used in an expression to evaluate the variable,
        then return the value of the parent counter variable
         */
        if (varCalcDepth > 1 &&
            variableName === initVariableName &&
            typeof param.parentVariables === 'object' &&
            param.parentVariables[variableName] !== undefined) {
            return callback(null, param.parentVariables[variableName]);
        }


        // get variable properties from cache for calculate variable value
        if(variableName) {
            var variable = param.cache.objectsProperties.get(variableName);
            var getVariableFunc = getVarFromProperty;
            if(!variable) {
                variable = param.cache.variablesExpressions.get(variableName);
                getVariableFunc = getVarFromExpression;
            }
            if(!variable) {
                variable = param.cache.variablesHistory.get(variableName);
                getVariableFunc = getVarFromHistory;
            }
            if(!variable) {
                return callback(new Error('Variable name ' + variableName + ' is not defined. Cache props: ' +
                    [...param.cache.objectsProperties.keys()].join(', ') +
                    '; vars expr: ' + [...param.cache.variablesExpressions.keys()].join(', ') +
                    '; vars hist: ' + [...param.cache.variablesHistory.keys()].join(', ')
                ));
            }
        } else {
            variableName = 'UPDATE_EVENT_STATE';
            variable = {
                    id: 0,
                    name: variableName,
                    counterID: param.counterID,
                    expression: param.updateEventExpression
            };
            getVariableFunc = getVarFromExpression;
        }
        //if(param.counterID === 243) console.log('!!getVariableValue init: ', variableName, variable, ';Cache props: ' + [...param.cache.objectsProperties.keys()] + '; vars: ' + [...param.cache.variablesExpressions.keys()] + [...param.cache.variablesHistory.keys()]);

        getVariableFunc(variable, variables, getVariableValue, {
            countersObjects: param.countersObjects,
            objectName: param.objectName,
            objectID: param.objectID,
            counterName: param.counterName,
            counterID: param.counterID,
            childThread: param.childThread,
        }, function(err, result, variablesDebugInfo) {

            //if(param.counterID === 243) console.log('!!getVariableValue: ', variableName, '=', result, variable, '; debug:', variablesDebugInfo, ';Cache props: ' + [...param.cache.objectsProperties.keys()] + '; vars: ' + [...param.cache.variablesExpressions.keys()] + [...param.cache.variablesHistory.keys()]);
            if(variablesDebugInfo) param.variablesDebugInfo[variableName] = variablesDebugInfo;
            if(result === undefined) result = null;

            variables[variableName] = result;
            callback(err, result);
        });
    }
}