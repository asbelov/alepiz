/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require("async");
const countersDB = require("../models_db/countersDB");
const objectsPropertiesDB = require("../models_db/objectsPropertiesDB");
const objectsDB = require("../models_db/objectsDB");
const checkIDs = require("../lib/utils/checkIDs");

var recordsFromDBCnt = 0,
    lastFullUpdateTime = Date.now(),
    updateCacheInProgress = 0,
    needToUpdateCache = new Set();

var serverCache = {
    createCache: createCache,
    recordsFromDBCnt: recordsFromDBCnt,
    updateCache: updateCache,
    needToUpdateCache,
};
module.exports = serverCache;

function createCache(updateMode, objectsAndCountersForUpdate, callback) {
    if(updateMode && (!updateMode.updateObjectsCounters && !updateMode.getHistoryVariables.length &&
        !updateMode.getVariablesExpressions.length && !updateMode.geObjectsProperties.length)) return callback();

    async.parallel({
        updateMode: function (callback) { callback(null, updateMode) },
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
    }, function (err, cache) {
        callback(err, cache, updateMode, objectsAndCountersForUpdate)
    }); // function(err, cache){}
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

function updateCache(cfg, callback) {
    if((!needToUpdateCache.size &&
            (!cfg.fullUpdateCacheInterval || Date.now() - lastFullUpdateTime < cfg.fullUpdateCacheInterval) ) ||
        (updateCacheInProgress && Date.now() - updateCacheInProgress < cfg.updateCacheInterval)) return;

    if (updateCacheInProgress) {
        log.warn('The previous cache update operation was not completed in ',
            Math.round((Date.now() - updateCacheInProgress)/60000), '/', (cfg.updateCacheInterval / 60000) , 'min');
    }
    updateCacheInProgress = Date.now();
    var objectsAndCountersForUpdate = Array.from(needToUpdateCache.values());
    needToUpdateCache = new Set();
    if(cfg.fullUpdateCacheInterval && Date.now() - lastFullUpdateTime > cfg.fullUpdateCacheInterval) {
        var updateMode = null;
        lastFullUpdateTime = Date.now();
    } else {
        updateMode = {
            updateObjectsCounters: false,
            getHistoryVariables: [],
            getVariablesExpressions: [],
            geObjectsProperties: []
        };
        for (var i = 0; i < objectsAndCountersForUpdate.length; i++) {
            var message = objectsAndCountersForUpdate[i];
            if (!message.update) {
                updateMode = null;
                break;
            }
            if (message.update.objectsCounters) updateMode.updateObjectsCounters = true;
            if (message.updateCountersIDs && message.updateCountersIDs.length) {

                // remove equals counters IDs. Use Object.values for save Number type for counterID
                var countersIDs = {};
                message.updateCountersIDs.forEach(counterID => countersIDs[counterID] = counterID);
                if (message.update.historyVariables) Array.prototype.push.apply(updateMode.getHistoryVariables, Object.values(countersIDs));
                if (message.update.variablesExpressions) Array.prototype.push.apply(updateMode.getVariablesExpressions, Object.values(countersIDs));
            }
            if (message.updateObjectsIDs && message.updateObjectsIDs.length && message.update.objectsProperties) {

                // remove equals objects IDs. Use Object.values for save Number type for objectID
                var objectsIDs = {};
                message.updateObjectsIDs.forEach(objectID => objectsIDs[objectID] = objectID);
                Array.prototype.push.apply(updateMode.geObjectsProperties, Object.values(objectsIDs));
            }
        }
    }

    // Update cache for || Reload all data to cache for (added for simple search)
    /*
    log.info((updateMode ? 'Update' : 'Reload all data to') + ' cache for: ', objectsAndCountersForUpdate.length,
        '; counters for remove: ', countersForRemove.size, '; update mode: ', updateMode);

     */
    createCache(updateMode, objectsAndCountersForUpdate, callback);
}

