/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const async = require("async");
const countersDB = require("../models_db/countersDB");
const objectsPropertiesDB = require("../models_db/objectsPropertiesDB");
const objectsDB = require("../models_db/objectsDB");
const checkIDs = require("../lib/utils/checkIDs");

var serverCache = {
    createCache: createCache,
    recordsFromDBCnt: recordsFromDBCnt,
};
module.exports = serverCache;

var recordsFromDBCnt = 0;


function createCache(updateMode, callback) {
    if(updateMode && (!updateMode.updateObjectsCounters && !updateMode.getHistoryVariables.length &&
        !updateMode.getVariablesExpressions.length && !updateMode.geObjectsProperties.length)) return callback();

    async.parallel({
        countersObjects: function(callback) {
            if(updateMode  && !updateMode.updateObjectsCounters) return callback();

            getDataForCheckDependencies(function(err, counters, objects, objectName2OCID) {
                callback(err, {
                    counters: counters,
                    objects: objects,
                    objectName2OCID: objectName2OCID
                });
            });
        },
        variables: function(callback) {
            if(updateMode && !updateMode.getHistoryVariables.length) return callback();
            getVariables(null, countersDB.getVariables, 'counterID', callback);
        },
        variablesExpressions: function(callback) {
            if(updateMode && !updateMode.getVariablesExpressions.length) return callback();
            getVariables(null, countersDB.getVariablesExpressions, 'counterID', callback);
        },
        objectsProperties: function(callback) {
            if(updateMode && !updateMode.geObjectsProperties.length) return callback();
            getVariables(updateMode ? updateMode.geObjectsProperties : null, objectsPropertiesDB.getProperties, 'objectID', callback);
        }
    }, callback); // function(err, cache){}
}

function getDataForCheckDependencies(callback) {
    var counters = {}, objects = {}, allObjects = {}, countersParams = {}, objectName2OCID = {};

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

                        recordsFromDBCnt += rowsOCIDs.length + rowsCounters.length + rowsUpdateEvents.length + rowsObjects.length;

                        rowsObjects.forEach(function (row) {
                            // All available hosts needs for calcFunction.js: findObjectsLike()
                            allObjects[row.id] = row.name;
                            if(!row.disabled) objects[row.id] = row.name;
                        });

                        rowsCountersParams.forEach(function (row) {
                            if(!countersParams[row.counterID]) countersParams[row.counterID] = [];
                            countersParams[row.counterID].push({
                                name: row.name,
                                value: row.value,
                            });
                        });

                        rowsCounters.forEach(function (row) {
                            if(row.disabled) return;

                            counters[row.id] = {
                                objectsIDs: {},
                                dependedUpdateEvents: {}, // {parentCounterID1: { expression, mode, parentObjectID, counterID}, ... }
                                counterID: row.id,
                                collector: row.collectorID,
                                counterName: row.name,
                                debug: row.debug,
                                taskCondition: row.taskCondition,
                                groupID: row.groupID,
                                counterParams: countersParams[row.id],
                            };
                        });

                        rowsUpdateEvents.forEach(function (row) {
                            if(!counters[row.parentCounterID] || !counters[row.counterID] ||
                                (row.parentObjectID && !objects[row.parentObjectID])) return;

                            counters[row.parentCounterID].dependedUpdateEvents[row.counterID] = {
                                counterID: row.counterID,
                                expression: row.expression,
                                mode: row.mode,
                                objectFilter: row.objectFilter,
                                parentObjectID: row.parentObjectID
                            };
                        });

                        rowsOCIDs.forEach(function (row) {
                            if(!counters[row.counterID] || !objects[row.objectID]) return;
                            counters[row.counterID].objectsIDs[row.objectID] = row.id;

                            var objectNameInUpperCase = objects[row.objectID].toUpperCase();
                            if(!objectName2OCID[objectNameInUpperCase]) objectName2OCID[objectNameInUpperCase] = {};
                            objectName2OCID[objectNameInUpperCase][row.counterID] = row.id;
                        });

                        //console.log(counters);

                        callback(null, counters, allObjects, objectName2OCID);
                    });
                });
            });
        });
    });
}

function getVariables(initIDs, func, key, callback) {
    var variables = {};

    checkIDs(initIDs, function (err, IDs) {
        //if(err) log.error(err.message);
        // when initIDs is not set, IDs will be set to []
        if(err && !IDs.length) IDs = null;

        func(IDs, function(err, rows) {
            if (err) return callback(err);
            recordsFromDBCnt += rows.length;

            rows.forEach(function (row) {
                var id = row[key];
                if(!variables[id]) variables[id] = [row];
                else variables[id].push(row);
            });

            callback(null, variables);
        });
    })
}
