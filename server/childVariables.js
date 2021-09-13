/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
const calc = require("../lib/calc");

module.exports = CalcVars;

function CalcVars(counter, variablesDebugInfo, cache, history, callback) {

    var historyVars = new Map(),
        expressions = new Map(),
        objectProperties = new Map(),
        variables = counter.parentVariables || {}; // {name: value, ...}

    checkAndSetCounterProperties(function (err) {
        if(err) return callback(err);

        addDefaultVariables();
        mergeVariablesAndProperties();

        calcCounterParameters(function (err, collector, counterParameters) {
            if(err) return callback(err);

            calcUpdateEvent(function (err, result, needToReturnUpdateExpression) {
                if(err) return callback(err);

                if(!needToReturnUpdateExpression) callback();
                else calcVariables(function (err) {  // callback() || callback(err)
                    if(err) return callback(err);

                    counterParameters.$variables = variables;
                    callback(null, counter, counterParameters, variables);
                });
            });
        });
    });

    function checkAndSetCounterProperties(callback) {
        var OCID = cache.OCIDs.get(counter.OCID); // [objectID, counterID]

        if (!Array.isArray(OCID)) return callback(new Error('Can\'t find OCID ' + counter.OCID + ' in cache'));

        counter.objectID = cache.OCIDs.get(counter.OCID)[0];
        counter.counterID = cache.OCIDs.get(counter.OCID)[1];
        counter.objectName = cache.objects.get(OCID[0]);
        counter.properties = cache.counters.get(OCID[1]);
        counter.collector = counter.properties.collector;

        if (!counter.objectID || !counter.counterID || !counter.objectName || typeof counter.properties !== 'object') {
            return callback(new Error('Can\'t find object or counter in cache'));
        }

        counter.counterName = counter.properties.counterName;

        var parentOCID = cache.OCIDs.get(counter.parentOCID) || [];
        counter.parentObjectName = cache.objects.get(parentOCID[0]) || '';
        counter.parentCounter = cache.counters.get(parentOCID[1]);
        counter.parentCounterName = counter.parentCounter ? counter.parentCounter.counterName : '';

        callback();
    }

    function addDefaultVariables() {

        variables.PARENT_OBJECT_NAME = counter.parentObjectName;
        variables.PARENT_COUNTER_NAME = counter.parentCounterName;
        variables.OBJECT_NAME = counter.objectName;
        variables.COUNTER_NAME = counter.counterName;
        variables.PARENT_VALUE = counter.parentValue === undefined ? '' : counter.parentValue;
    }

    function mergeVariablesAndProperties() {

        var globalExpressions = cache.expressions.get(counter.counterID);
        if(globalExpressions) expressions = mapClone(globalExpressions);

        var globalHistoryVars = cache.history.get(counter.counterID);
        if(globalHistoryVars) historyVars = mapClone(globalHistoryVars);

        var globalProperties = cache.properties.get(counter.counterID);
        if (globalProperties) {
            objectProperties = mapClone(globalProperties);
            globalProperties.forEach(function (property, propertyName) {
                if (property.mode === 3) { // calculated expression
                    expressions.set(propertyName, {
                        name: property.name,
                        expression: property.value,
                    });
                    objectProperties.delete(propertyName);
                } else expressions.delete(propertyName);

                historyVars.delete(propertyName);
            });
        }
    }

    function mapClone(mapSrc) {
        var mapDst = new Map();
        mapSrc.forEach(function (val, key) {
            if(typeof val === 'object') {
                var newVal = {};
                for(var objKey in val) {
                    newVal[objKey] = val[objKey];
                }
            } else newVal = val;
            mapDst.set(key, newVal);
        });

        return mapDst;
    }

    function calcCounterParameters(callback) {
        // counter.properties.counterParams = new Map(name: {name:, value:})
        var parameters = counter.properties.counterParams ? mapClone(counter.properties.counterParams) : new Map();

        if(!parameters || !parameters.size) return callback();
        var counterParameters = {
            $id: objectCounterID,
            $counterID: property.counterID,
            $objectID: property.objectID,
            $parentID: property.parentOCID,
            //$variables: variables
        };
        async.each(parameters.values(), function (parameter, callback) {
            calcProperties(parameter, function (err, result) {
                if(err) return callback(err);
                counterParameters[parameter] = result;
            })
        }, function (err) {
            if(err) return callback(err);
            callback(null, counter.collector, counterParameters);
        });
    }

    function calcUpdateEvent(callback) {
        if (!counter.parentCounter || !counter.parentCounter.dependedUpdateEvents ||
            !counter.parentCounter.dependedUpdateEvents.has(counter.counterID)) {
            returnUpdateEvent(true, callback);
        }

        var updateEvent = counter.parentCounter.dependedUpdateEvents.get(counter.counterID);
        var updateEventMode = updateEvent.mode;
        var updateEventVar = {
            name: 'UPDATE_EVENT_STATE',
            expression: updateEvent.expression,
        };

        /*
        '0': 'Update each time when expression value is true',
        '1': 'Update once when expression value is changed to true',
        '2': 'Update once when expression value is changed to true and once when changed to false',
        '3': 'Update each time when expression value is changed to true and once when changed to false'
         */
        calcExpression(updateEventVar, function (err, result) {
            if(err) return callback(err);
            if(result) {
                // 0 - Update each time when expression value is true
                // 3 - Update each time when expression value is changed to true and once when changed to false
                if (updateEventMode === 0 || updateEventMode === 3) {
                    return returnUpdateEvent(result, callback);
                }
                // 1 - Update once when expression value is changed to true
                // 2 - Update once when expression value is changed to true and once when changed to false
                else if(updateEventMode === 1 || updateEventMode === 2) {
                    if(counter.prevUpdateEventExpressionResult) {
                        counter.prevUpdateEventExpressionResult = result;
                        callback();
                    } else returnUpdateEvent(result, callback);
                }
            } else {
                // 0 - Update each time when expression value is true
                // 1 - Update once when expression value is changed to true
                if(updateEventMode === 0 || updateEventMode === 1) {
                    counter.prevUpdateEventExpressionResult = result;
                    return callback();
                }
                // 2 - Update once when expression value is changed to true and once when changed to false
                // 3 - Update each time when expression value is changed to true and once when changed to false
                // 4 - Update once when expression value is changed to false
                else if(updateEventMode === 2 || updateEventMode === 3 || updateEventMode === 4) {
                    if(counter.prevUpdateEventExpressionResult) returnUpdateEvent(result, callback);
                    else {
                        counter.prevUpdateEventExpressionResult = result;
                        return callback();
                    }
                }
            }
        });
    }

    function returnUpdateEvent(result, callback) {
        variables.UPDATE_EVENT_TIMESTAMP = Date.now();
        counter.prevUpdateEventExpressionResult = variables.UPDATE_EVENT_STATE = result;
        callback(null, result, true);
    }

    function calcVariables(callback) {
        async.each(objectProperties.values(), calcProperties, function(err) {
            if(err) return callback(err);
            async.each(historyVars.values(), calcHistoricalVariable, function (err) {
                if(err) return callback(err);
                async.each(expressions.values(), calcExpression, function (err) {
                    if(err) return callback(err);

                    callback();
                });
            });
        });
    }

    function returnResult(err, variable, expression, variables, functionDebug, unresolvedVariables, result, callback) {
        if (counter.debug || variable.name === 'UPDATE_EVENT_STATE') {
            variablesDebugInfo[variable.name] = {
                timestamp: Date.now(),
                name: variable.name,
                expression: expression,
                variables: variables,
                functionDebug: functionDebug,
                unresolvedVariables: unresolvedVariables,
                result: err ? err.message : result,
            };
        }

        if(typeof callback === 'function') callback(err, result);
    }

    function calcExpression(variable, callback) {
        if(!variable.calcAttempts) variable.calcAttempts = 0;
        ++variable.calcAttempts;

        calc(variable.expression, variables, counter.counterID,
            function (err, result, functionDebug, unresolvedVariables, initVariables) {

            if (!unresolvedVariables && err) {
                return returnResult(err, initVariables, variable.expression, variables, functionDebug,
                    unresolvedVariables, result, callback);
            }

            if (!unresolvedVariables.length) {
                variables[variable.name] = result;
                expressions.delete(variable.name);
                return returnResult(null, initVariables, variable.expression, variables, functionDebug,
                    unresolvedVariables, result, callback);
            }

            if(variable.calcAttempts > 2) {
                return returnResult(new Error('Error calculate ' + counter.objectName + '(' +
                    counter.counterName + '):' + variable.name + ':(' + variable.expression + ') unresolved: ' +
                    unresolvedVariables.join(', ')),
                    initVariables, variable.expression, variables, functionDebug, unresolvedVariables, result, callback);
            }

            calcUnresolvedVars(unresolvedVariables, function(err) {
                if(err) return callback(err);
                calcExpression(variable, callback);
            });
        });
    }

    function calcProperties(property, callback) {
        if(!property.calcAttempts) property.calcAttempts = 0;
        ++property.calcAttempts;

        var res = calc.variablesReplace(property.value, variables);
        if(!res || (res && !res.unresolvedVariables.length)) {
            // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing value
            variables[property.name] = calc.convertToNumeric(res ? res.value : property.value);

            objectProperties.delete(property.name);
            return returnResult(null, variable, property.value, variables, undefined,
                res && res.unresolvedVariables.length ? res.unresolvedVariables : undefined,
                variables[property.name], callback);
        }

        if(property.calcAttempts > 2) {
            return returnResult(new Error('Error calculate ' + counter.objectName + '(' +
                    counter.counterName + '):' + property.name + ':(' + property.value + ') unresolved: ' +
                    res.unresolvedVariables.join(', ')),
                variable, property.value, variables, undefined,
                res && res.unresolvedVariables.length ? res.unresolvedVariables : undefined,
                variables[property.name], callback);
        }

        calcUnresolvedVars(res.unresolvedVariables, function(err) {
            if(err) return callback(err);
            calcProperties(property, callback);
        });
    }

    function calcHistoricalVariable(variable, callback) {
        // historyFunctionList = new Set()
        if(!variable.function || !history.historyFunctionList.has(variable.function)) {
            return returnResult(new Error('Unknown history function: "' + variable.function +
                    '" for get data for variable ' + variable.name + ', ' +
                    counter.objectName + '(' + counter.counterName + ')'), variable,
                variable.objectVariable + '(' + variable.parentCounterName + '): ' + variable.function +
                '(' + variable.functionParameters + ')',
                variables, undefined, undefined,undefined, callback);
        }

        // replace variables with values in parameters of historical function
        var res = calc.variablesReplace(variable.functionParameters, variables);
        if(res) {
            if(typeof res.value === 'string') variable.functionParameters = res.value.toUpperCase();

            if(res.unresolvedVariables.length) {
                if(variable.calcAttempts > 3) {
                    return returnResult(new Error('Error calculate ' + counter.objectName + '(' +
                            counter.counterName + '):' + variable.name + ':' + variable.function +
                            '('+ variable.functionParameters + ') unresolved: ' + res.unresolvedVariables.join(', ')),
                        variable,
                        variable.objectVariable + '(' + variable.parentCounterName + '): ' + variable.function +
                        '(' + variable.functionParameters + ')',
                        variables, undefined, res.unresolvedVariables, variable.functionParameters, callback);
                }

                calcUnresolvedVars(res.unresolvedVariables, function (err) {
                    if(err) return callback(err);
                    return calcHistoricalVariable(variable, callback);
                });
            }
        }

        // getting OCID
        // replace variables with values in the object name when the object name is set using a variable
        // if set variable.objectVariable - it can be a variable or object name
        // objectVariable is right, not objectName: SELECT variables.objectName AS objectVariable....
        if(variable.objectVariable) {
            variable.objectVariable = variable.objectVariable.toUpperCase();
            res = cacl.variablesReplace(variable.objectVariable, variables);
            if(res) {
                var variableObjectName = res.value ? res.value.toUpperCase() : variable.objectVariable;

                if(res.unresolvedVariables.length) {
                    if(variable.calcAttempts > 3) {
                        return returnResult(new Error('Error calculate ' + counter.objectName + '(' +
                                counter.counterName + '):' + variable.name + ': object: ' + variableObjectName + ':' +
                                variable.function + '('+ variable.functionParameters + ') unresolved: ' +
                                res.unresolvedVariables.join(', ')),
                            variable,
                            variable.objectVariable + '(' + variable.parentCounterName + '): ' + variable.function +
                            '(' + variable.functionParameters + ')',
                            variables, undefined, res.unresolvedVariables, variableObjectName, callback);
                    }

                    calcUnresolvedVars(res.unresolvedVariables, function (err) {
                        if(err) return callback(err);
                        return calcHistoricalVariable(variable, callback);
                    });
                }
            }
            var OCID = cache.objectName2OCID.has(variableObjectName) ?
                cache.objectName2OCID.get(variableObjectName).get(Number(variable.parentCounterID)) : null;
        } else  {
            if(variable.OCID) {
                variableObjectName = variable.objectName;
                OCID = variable.OCID;
            } else {
                variableObjectName = counter.objectName;
                OCID = cache.counters.has(Number(variable.parentCounterID)) ?
                    cache.counters.get(Number(variable.parentCounterID)).objectsIDs.get(counter.objectID) : null;
            }
        }

        if(!OCID) {
            return returnResult(new Error('Error calculate ' + counter.objectName + '(' +
                    counter.counterName + '):' + variable.name + ':' +
                    variable.function + '('+ variable.functionParameters + ') can\'t get OCID for : ' +
                    variableObjectName),
                variable,
                variableObjectName + '(' + variable.parentCounterName + '): ' + variable.function +
                '(' + variable.functionParameters + ')',
                variables, undefined, undefined, OCID, callback);
        }

        var funcParameters = [];
        if(variable.functionParameters) {
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
        }

        funcParameters.unshift(OCID);
        // add callback function as last parameter to history function
        funcParameters.push(function(err, result) {
            funcParameters.pop(); // remove callback for debugging
            funcParameters.shift(); // remove OCID for debugging

            if (err) {
                return returnResult(err, variable,
                    variableObjectName + '(' + variable.parentCounterName + '): ' + variable.function +
                    '(' + funcParameters.join(',') + ')',
                    variables, result ? result.records : undefined, undefined,
                    result ? result.data : result, callback);
            }

            var res = result ? result.data : result;
            if(result !== undefined && result !== null) {
                variables[variable.name] = res;
                historyVars.delete(variable.name);
            }

            variable.name = null;
            return returnResult(err, variable,
                variableObjectName + '(' + variable.parentCounterName + '): ' + variable.function +
                '(' + funcParameters.join(',') + ')',
                variables, result ? result.records : undefined, undefined,
                res, callback);
        });

        // send array as a function parameters, i.e. func.apply(this, [prm1, prm2, prm3, ...]) = func(prm1, prm2, prm3, ...)
        // funcParameters = [objectCounterID, prm1, prm2, prm3,..., callback]; callback(err, result), where result = [{data:<data>, }]
        history[variable.function].apply(this, funcParameters);
    }

    function calcUnresolvedVars(unresolvedVariables, callback) {
        async.each(unresolvedVariables, function (variableName, callback) {
            variableName = variableName.replace(/^%:[?!]{0,2}(.+):%$/, '$1'); // variable is always in upperCase()
            if (objectProperties.has(variableName)) return calcProperties(objectProperties.get(variableName), callback);
            if (historyVars.has(variableName)) return calcHistoricalVariable(historyVars.get(variableName), callback);
            if (expressions.has(variableName)) return calcExpression(expressions.get(variableName), callback);
        }, callback);
    }
}