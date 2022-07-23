/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const getVarFromHistory = require("./getVarFromHistory");
const getVarFromProperty = require("./getVarFromProperty");
const getVarFromExpression = require("./getVarFromExpression");

module.exports = initCache;

/**
 *
 * @param message {Object}
 * @param cache {Object}
 * @returns {*}
 * @example
 * cache {
 *     countersObjects: {
 *         counters: Map<counterID: Number, {
 *             objectsIDs: Map<objectID: Number, OCID: Number>,
 *             // counters[row.parentCounterID].dependedUpdateEvents[row.counterID] = {...}
 *             dependedUpdateEvents: Map<counterID: Number, {
 *                  counterID: Number,
 *                  expression: String,
 *                  mode: Number,
 *                  objectFilter: Number,
 *                  parentObjectID: Number
 *             }>,
 *             collector: String,
 *             counterName: String,
 *             debug: {0|null|1},
 *             taskCondition: {0|null|1},
 *             counterParams: [{name: String, value: String}, ... ]
 *         },
 *         OCIDs: Map<<OCID>: {objectID: Number, counterID: Number}, ...>
 *         // for getVarFromHistory.js
 *         objects: Map<objectID: Number, objectName: String>
 *         objectName2OCID: Map<objectName: Map<counterID, OCID>>
 *     },
 *     variablesDBCache: Map<counterID: Number, Map<
 *         <historicalVariableName>: {
 *              func: getVarFromHistory,
 *              prop: {
 *                  name: String,
 *                  counterID: Number,
 *                  objectID: Number,
 *                  objectName: String,
 *                  parentCounterName: String,
 *                  function: String,
 *                  functionParameters: String,
 *                  objectVariable: String|Null,
 *                  description: String,
 *                  variableOrder: String,
 *                  OCID: Number,
 *                  counterName: String,
 *                  parentCounterID: Number
 *              }
 *         }, ... ,
 *         <expressionVariableName>: {
 *              func: getVarFromExpression
 *              prop: {
 *                  id: Number,
 *                  name: String,
 *                  counterID: Number,
 *                  expression: String,
 *                  description: String,
 *                  variableOrder: Number
 *              }
 *         }, ...
 *     >>,
 *     objectsPropertiesDBCache: Map<objectID: Number: Map<
 *          <objectPropertyName>: {
 *              func: getVarFromProperty,
 *              prop: {
 *                  id: Number,
 *                  objectID: Number,
 *                  name: String,
 *                  value: String,
 *                  description: String,
 *                  mode: Number
 *              }
 *          }, ...
 *     >>
 * }
 */

function initCache(message, cache) {

    if (message.countersObjects) {
        cache.countersObjects = convertCountersObjectsToMap(message.countersObjects);
    }

    if (message.variables) {
        for (var counterID in message.variables) {
            var variables = cache.variablesDBCache.get(Number(counterID));
            if(!variables) {
                variables = new Map();
                cache.variablesDBCache.set(Number(counterID), variables);
            } else {
                variables.forEach((variable, variableName) => {
                    if (variable.prop.function) variables.delete(variableName);
                });
            }
            message.variables[counterID].forEach(variable => {
                variables.set(variable.name.toUpperCase(), {
                    func: getVarFromHistory,
                    prop: variable,
                });
            });
//if(counterID == 163) console.log('!!initCache hist: ', cache.variablesDBCache.get(Number(counterID)));
        }
    }
    if (message.variablesExpressions) {
        for (counterID in message.variablesExpressions) {
            variables = cache.variablesDBCache.get(Number(counterID));
//if(counterID == 163) console.log('!!1initCache expr: ', variables);
            if(!variables) {
                variables = new Map();
                cache.variablesDBCache.set(Number(counterID), variables);
            } else {
                variables.forEach((variable, variableName) => {
                    if (variable.prop.expression) variables.delete(variableName);
                });
            }
            message.variablesExpressions[counterID].forEach(variable => {
                variables.set(variable.name.toUpperCase(), {
                    func: getVarFromExpression,
                    prop: variable,
                });
            });
//if(counterID == 163) console.log('!!2initCache expr: ', cache.variablesDBCache.get(Number(counterID)));
        }
    }

    if (message.objectsProperties) {
        if (message.fullUpdate && typeof cache.objectsPropertiesDBCache.clear === 'function') {
            cache.objectsPropertiesDBCache.clear();
        }
        for (var objectID in message.objectsProperties) {
            var objectProperties = new Map();
            message.objectsProperties[objectID].forEach(variable => {
                objectProperties.set(variable.name.toUpperCase(), {
                    func: getVarFromProperty,
                    prop: variable,
                })
            });
            cache.objectsPropertiesDBCache.set(Number(objectID), objectProperties);
        }
    }

    return cache;
}

function convertCountersObjectsToMap(countersObjectsObj) {
    var objects = new Map(), counters = new Map(), objectName2OCID = new Map(), OCIDs = new Map();

    // objects[id] = name
    for (var id in countersObjectsObj.objects) {
        objects.set(Number(id), countersObjectsObj.objects[id]);
    }

    // countersObjectsObj.counters[id].objectsID[objectID] = OCID
    for (id in countersObjectsObj.counters) {
        var counterObj = countersObjectsObj.counters[id];
        var objectsIDs = new Map();
        for (var objectID in counterObj.objectsIDs) {
            objectsIDs.set(Number(objectID), Number(counterObj.objectsIDs[objectID]));
        }

        // countersObjectsObj.counters[id].dependedUpdateEvents[counterID] = {counterID:, expression:, mode:, objectFilter:, parentObjectID:}
        var dependedUpdateEvents = new Map();
        for (var counterID in counterObj.dependedUpdateEvents) {
            dependedUpdateEvents.set(Number(counterID), counterObj.dependedUpdateEvents[counterID]);
        }

        counterObj.objectsIDs = objectsIDs;
        counterObj.dependedUpdateEvents = dependedUpdateEvents;
        counters.set(Number(id), counterObj);
    }

    // objectName2OCID[objectNameInUpperCase][row.counterID] = OCID;
    for (var objectName in countersObjectsObj.objectName2OCID) {
        counterObj = countersObjectsObj.objectName2OCID[objectName];
        var object = new Map();
        for (counterID in counterObj) {
            if (counterID === 'objectID') object.set('objectID', Number(counterObj[counterID]));
            else object.set(Number(counterID), Number(counterObj[counterID])); // counterObj[counterID] is OCID
        }
        objectName2OCID.set(objectName, object);
    }

    for(var OCID in countersObjectsObj.OCIDs) {
        OCIDs.set(Number(OCID), {
            objectID: countersObjectsObj.OCIDs[OCID].objectID,
            counterID: countersObjectsObj.OCIDs[OCID].counterID,
        });
    }

    return {
        counters: counters,
        objects: objects,
        objectName2OCID: objectName2OCID,
        OCIDs,
    }
}