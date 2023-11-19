/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

module.exports = initCache;

/**
 *
 * @param message {Object}
 * @param cache {Object}
 * @returns {*}
 * @example
 * cache {
 *     alepizInstance: {
 *         id: <alepizInstanceID>,
 *         name: <alepizInstanceName>
 *     },
 *     countersObjects: {
 *          OCIDs: Map<<OCID>: {objectID: Number, counterID: Number}, ...>
 *         // for getVarFromHistory.js
 *         objects: Map<objectID: Number, objectName: String>
 *         objectName2OCID: Map<objectName: Map<counterID, OCID>>
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
 *         }
 *     },
 *     variablesHistory: Map<counterID: Number, Map<
 *         <historicalVariableName>: {
 *              name: String,
 *              counterID: Number,
 *              objectID: Number,
 *              objectName: String,
 *              parentCounterName: String,
 *              function: String,
 *              functionParameters: String,
 *              objectVariable: String|Null,
 *              description: String,
 *              variableOrder: String,
 *              OCID: Number,
 *              counterName: String,
 *              parentCounterIDs: Set<number>
 *         }, ... ,
 *    variablesExpressions: Map<counterID: Number, Map<
 *         <expressionVariableName>: {
 *              id: Number,
 *              name: String,
 *              counterID: Number,
 *              expression: String,
 *              description: String,
 *              variableOrder: Number
 *         }, ...
 *     >>,
 *     objectsProperties: Map<objectID: Number: Map<
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
    if (message.alepizInstance) cache.alepizInstance = message.alepizInstance;
    if (message.countersObjects && message.countersObjects.counters) cache.countersObjects = message.countersObjects;
    if (message.variablesHistory.size) cache.variablesHistory = message.variablesHistory;
    if (message.variablesExpressions.size) cache.variablesExpressions = message.variablesExpressions;

    if (message.objectsProperties.size) {
        if (message.fullUpdate) cache.objectsProperties = message.objectsProperties;
        else {
            message.objectsProperties.forEach((objectProperties, objectID) => {
                cache.objectsProperties.set(objectID, objectProperties);
            });
        }
    }

    return cache;
}