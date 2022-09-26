/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const async = require("async");
const countersDB = require("../models_db/countersDB");
const objectsPropertiesDB = require("../models_db/objectsPropertiesDB");
const objectsDB = require("../models_db/objectsDB");
const checkIDs = require("../lib/utils/checkIDs");

var recordsFromDBCnt = 0;

module.exports = createCache;


function createCache(updateMode, alepizNames, callback) {
    if(updateMode && (!updateMode.updateObjectsCounters && !updateMode.getHistoryVariables.length &&
        !updateMode.getVariablesExpressions.length && !updateMode.geObjectsProperties.length)) return callback();

    var cache = {
        countersObjects: {},
        variablesHistory: new Map(),
        variablesExpressions: new Map(),
        objectsProperties: new Map(),
    };
    var counterObjectNames = new Map();
    var objectAlepizRelation = new Map();

    async.parallel([
        // countersObjects and counterObjectNames
        function(callback) {
            if(updateMode  && !updateMode.updateObjectsCounters) return callback();

            getDataForCheckDependencies(alepizNames,
                function(err, _counterObjectNames, countersObjects, _objectAlepizRelation) {
                counterObjectNames = _counterObjectNames;
                cache.countersObjects = countersObjects;
                objectAlepizRelation = _objectAlepizRelation;
                callback(err);
            });
        },
        // variablesHistory
        function(callback) {
            if(updateMode && !updateMode.getHistoryVariables.length) return callback();
            getVariables(null, countersDB.getVariables, 'counterID', cache.variablesHistory, callback);
        },

        // variablesExpressions
        function(callback) {
            if(updateMode && !updateMode.getVariablesExpressions.length) return callback();
            getVariables(null, countersDB.getVariablesExpressions, 'counterID',
                cache.variablesExpressions, callback);
        },
        // objectsProperties
        function(callback) {
            if(updateMode && !updateMode.geObjectsProperties.length) return callback();
            getVariables(updateMode ? updateMode.geObjectsProperties : null, objectsPropertiesDB.getProperties,
                'objectID', cache.objectsProperties, callback);
        }
    ], function(err) {
        return callback(err, cache, counterObjectNames, objectAlepizRelation, recordsFromDBCnt);
    });
}

function getDataForCheckDependencies(alepizNames, callback) {
    var counters = new Map(),
        objects = new Map(),
        objectAlepizRelation = new Map(),
        allObjects = new Map(),
        countersParams = new Map(),
        objectName2OCID = new Map(),
        OCIDs = new Map(),
        counterObjectNames = new Map();


    countersDB.getAllObjectsCounters(function(err, rowsOCIDs) {
        if (err) return callback(err);

        countersDB.getAllCounters(function(err, rowsCounters) {
            if (err) return callback(err);

            countersDB.getAllParameters(function (err, rowsCountersParams) {
                if (err) return callback(err);

                countersDB.getAllUpdateEvents(function(err, rowsUpdateEvents) {
                    if (err) return callback(err);

                    objectsDB.getAllObjects(function(err, rowsObjects) {
                        if (err) return callback(err);

                        objectsDB.getObjectsAlepizRelation(function (err, rowsAlepizRelations) {
                            if (err) return callback(err);

                            recordsFromDBCnt += rowsOCIDs.length + rowsCounters.length + rowsUpdateEvents.length +
                                rowsObjects.length + rowsAlepizRelations.length;


                            rowsAlepizRelations.forEach(function (row) {
                                if(objectAlepizRelation.has(row.objectID)) {
                                    objectAlepizRelation.get(row.objectID).push(row.alepizName);
                                } else {
                                    objectAlepizRelation.set(row.objectID, [row.alepizName]);
                                }
                            });

                            var ownerOfUnspecifiedAlepizIDs = alepizNames.indexOf(null) !== 1;
                            rowsObjects.forEach(function (row) {
                                // All available hosts are needed for calcFunction.js: findObjectsLike()
                                allObjects.set(row.id, row.name);
                                var objectsAlepizNames = objectAlepizRelation.get(row.id);
                                if (!row.disabled) {
                                    if ((objectsAlepizNames === undefined && ownerOfUnspecifiedAlepizIDs) ||
                                        objectsAlepizNames.some(name => alepizNames.indexOf(name) !== -1)
                                    ) {
                                        objects.set(row.id, row.name);
                                    }
                                }
                            });

                            rowsCountersParams.forEach(function (row) {
                                if (!countersParams.has(row.counterID)) countersParams.set(row.counterID, []);
                                countersParams.get(row.counterID).push({
                                    name: row.name,
                                    value: row.value,
                                });
                            });

                            rowsCounters.forEach(function (row) {
                                if (row.disabled) return;

                                counters.set(row.id, {
                                    objectsIDs: new Map(),
                                    // {parentCounterID1: { expression, mode, parentObjectID, counterID}, ... }
                                    dependedUpdateEvents: new Map(),
                                    //counterID: row.id,
                                    collector: row.collectorID,
                                    counterName: row.name,
                                    debug: row.debug,
                                    taskCondition: row.taskCondition,
                                    //groupID: row.groupID,
                                    counterParams: countersParams.get(row.id),
                                });
                            });

                            rowsUpdateEvents.forEach(function (row) {
                                if (!counters.has(row.parentCounterID) || !counters.has(row.counterID) ||
                                    (row.parentObjectID && !objects.has(row.parentObjectID))) return;

                                counters.get(row.parentCounterID).dependedUpdateEvents.set(row.counterID, {
                                    counterID: row.counterID,
                                    expression: row.expression,
                                    mode: row.mode,
                                    objectFilter: row.objectFilter,
                                    parentObjectID: row.parentObjectID,
                                });
                            });

                            rowsOCIDs.forEach(function (row) {
                                if (!counters.has(row.counterID) || !objects.has(row.objectID)) return;
                                counters.get(row.counterID).objectsIDs.set(row.objectID, row.id);

                                OCIDs.set(row.id, {
                                    objectID: row.objectID,
                                    counterID: row.counterID,
                                });

                                counterObjectNames.set(row.id, {
                                    objectName: allObjects.get(row.objectID),
                                    counterName: counters.get(row.counterID).counterName,
                                });

                                var objectNameInUpperCase = objects.get(row.objectID).toUpperCase();
                                if (!objectName2OCID.has(objectNameInUpperCase)) {
                                    objectName2OCID.set(objectNameInUpperCase, new Map());
                                }
                                objectName2OCID.get(objectNameInUpperCase).set(row.counterID, row.id);
                            });

                            //console.log(counters);

                            callback(null, counterObjectNames, {
                                // Map(<OCID>, <Map(<objectID>, <counterID>)>
                                OCIDs: OCIDs,
                                // Map(<objectID, objectName>)
                                objects: allObjects,
                                // Map(<objectNameInUpperCase>, <Map(<counterID>, <OCID>)>)
                                objectName2OCID: objectName2OCID,
                                // Map(<counterID>, <{objectsIDs, dependedUpdateEvents, collector, counterName,
                                // debug, taskCondition, groupID, counterParams}>)
                                counters: counters,
                            }, objectAlepizRelation);
                        });
                    });
                });
            });
        });
    });
}

function getVariables(initIDs, func, key, variables, callback) {

    checkIDs(initIDs, function (err, IDs) {
        //if(err) log.error(err.message);
        // when initIDs is not set, IDs will be set to []
        if(err && !IDs.length) IDs = null;

        func(IDs, function(err, rows) {
            if (err) return callback(err);
            recordsFromDBCnt += rows.length;

            rows.forEach(function (row) {
                var id = row[key];
                if(!variables.has(id)) variables.set(id, new Map());
                variables.get(id).set(row.name, row);
            });

            callback();
        });
    })
}