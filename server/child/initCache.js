/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const getVarFromHistory = require("./getVarFromHistory");
const getVarFromProperty = require("./getVarFromProperty");
const getVarFromExpression = require("./getVarFromExpression");

module.exports = initCache;

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
                })
            })
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
                })
            })
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
    var objects = new Map(), counters = new Map(), objectName2OCID = new Map();

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
    return {
        counters: counters,
        objects: objects,
        objectName2OCID: objectName2OCID,
    }
}