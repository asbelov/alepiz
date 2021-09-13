/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var countersDB = require('../models_db/countersDB');
var objectsDB = require('../models_db/objectsDB');
var objectsPropertiesDB = require('../models_db/objectsPropertiesDB');
const checkIDs = require("../lib/utils/checkIDs");
const async = require("async");

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
                    objectName2OCID: objectName2OCID,
                    OCIDs: OCIDs,
                });
            });
        },
        history: function(callback) {
            if(updateMode && !updateMode.getHistoryVariables.length) return callback();
            getVariables(null, countersDB.getVariables, 'counterID', callback);
        },
        expressions: function(callback) {
            if(updateMode && !updateMode.getVariablesExpressions.length) return callback();
            getVariables(null, countersDB.getVariablesExpressions, 'counterID', callback);
        },
        properties: function(callback) {
            if(updateMode && !updateMode.geObjectsProperties.length) return callback();
            getVariables(updateMode ? updateMode.geObjectsProperties : null, objectsPropertiesDB.getProperties, 'objectID', callback);
        }
    }, function (err, data) {
        if(err) return callback(err);

        if(typeof data.countersObjects === 'object') {
            callback(null, {
                counters: data.countersObjects.counters,
                objects: data.countersObjects.objects,
                objectName2OCID: data.countersObjects.objectName2OCID,
                OCIDs: data.countersObjects.OCIDs,
                history: data.history,
                expressions: data.expressions,
                properties: data.properties,
            });
        } else callback(null, data);
    }); // function(err, cache){}
}

function getDataForCheckDependencies(callback) {
    var counters = new Map(),
        objects = new Map(),
        countersParams = {}, // temporary object
        objectName2OCID = new Map(),
        OCIDs = new Map();

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
                            //if(row.disabled) return;
                            objects.set(row.id, row.name);
                        });

                        rowsCountersParams.forEach(function (row) {
                            if(!countersParams[row.counterID]) countersParams[row.counterID] = new Map();
                            // use Map() instead of Set() because we have a mapClone() function and we don't want to write setClone()
                            countersParams[row.counterID].set(row.name, {
                                name: row.name,
                                value: parameterName,
                            });
                        });

                        rowsCounters.forEach(function (row) {
                            //if(row.disabled) return;

                            counters.set(row.id, {
                                objectsIDs: new Map(),
                                dependedUpdateEvents: new Map(), // {parentCounterID1: { expression, mode, parentObjectID, counterID}, ... }
                                parentCounterIDs: [],
                                counterID: row.id,
                                collector: row.collectorID,
                                counterName: row.name,
                                debug: row.debug,
                                taskCondition: row.taskCondition,
                                groupID: row.groupID,
                                counterParams: countersParams[row.id],
                            });
                        });

                        rowsUpdateEvents.forEach(function (row) {
                            if(!counters.has(row.parentCounterID) || !counters.has(row.counterID) ||
                                (row.parentObjectID && !objects.has(row.parentObjectID))) return;

                            counters.get(row.parentCounterID).dependedUpdateEvents.set(row.counterID, {
                                counterID: row.counterID,
                                expression: row.expression,
                                mode: row.mode,
                                objectFilter: row.objectFilter,
                                parentObjectID: row.parentObjectID
                            });
                        });

                        rowsOCIDs.forEach(function (row) {
                            if(!counters.has(row.counterID) || !objects.has(row.objectID)) return;
                            counters.get(row.counterID).objectsIDs.set(row.objectID, row.id);

                            OCIDs.set(row.id, [row.objectID, row.counterID]);

                            var objectNameInUpperCase = objects.get(row.objectID).toUpperCase();
                            if(!objectName2OCID.has(objectNameInUpperCase)) objectName2OCID.set(objectNameInUpperCase, new Map());
                            objectName2OCID.get(objectNameInUpperCase).set(row.counterID, row.id);
                        });

                        //console.log(counters);

                        callback(null, counters, objects, objectName2OCID, OCIDs);
                    });
                });
            });
        });
    });
}

function getVariables(initIDs, func, key, callback) {
    var variables = new Map();

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
                else variables.get(id).set(row.name.toUpperCase(), row);
            });

            callback(null, variables);
        });
    })
}
