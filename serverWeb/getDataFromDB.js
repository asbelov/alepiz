/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const objectsDB = require('../models_db/objectsDB');
const webServerCacheExpirationTime = require('./webServerCacheExpirationTime');
const countersDB = require('../models_db/countersDB');
const objectPropertiesDB = require('../models_db/objectsPropertiesDB');
const userDB = require('../models_db/usersDB');
var Conf = require('../lib/conf');
const confObjectFilters = new Conf('config/objectFilters.json');


var loadObjectsToCacheInProgress = false;
var loadInteractionToCacheInProgress = false;

var cachedCounterNames2IDsUpdateInProgress = false;
var cachedOCIDsUpdateInProgress = false;
var cachedObjectPropsUpdateInProgress = false;

var cachedUserFiltersUpdateTime = 0;
var cachedUserFiltersInProgress = false;
var cachedUserFilters = new Map();

var cachedUserRolesUpdateTime = 0;
var cachedUserRolesUpdateInProgress = false;
var cachedUserRoles = new Map();


module.exports = {
    getAllObjects: getAllObjects,
    getAllInteractions: getAllInteractions,
    initCounterNames2IDs: initCounterNames2IDs,
    getOCID2ObjectID: getOCID2ObjectID,
    getObjectProperties: getObjectProperties,
    getObjectsFilterConfig: getObjectsFilterConfig,
}

// load user roles to the cache
getUserRoles(function () {});

/**
 * Get all object data from to the cache
 * @param {function()|function(null, {
 *     objects: Set<{id: number, name: string, description: string, sortPosition: number, color: (string | null), disabled: (0 | 1)[], created: number}>,
 *     objectNames: Map<string, {id: number, name: string, description: string, sortPosition: number, color: (string | null), disabled: (0 | 1)[], created: number}>,
 *     objectIDs: Map<number, {id: number, name: string, description: string, sortPosition: number, color: (string | null), disabled: (0 | 1)[], created: number}>,
 *     topObjects: Set<{id: number, name: string, description: string, sortPosition: number, color: (string | null), disabled: (0 | 1)[], created: number}>,
 * })} callback
 */
function getAllObjects(callback) {
    if (loadObjectsToCacheInProgress) return callback();
    var startTime = Date.now();
    var cachedObjects = new Set();
    var cacheObjectNames = new Map();
    var cacheObjectIDs = new Map();
    var topObjects = new Set();

    loadObjectsToCacheInProgress = true;
    // start to update the cache
    objectsDB.getAllObjects(function (err, rows) {
        if(err) log.error('Can\'t get object data from DB: ', err.message);
        else {
            cachedObjects = new Set(rows);
            topObjects.clear();
            cacheObjectIDs.clear();
            cacheObjectNames.clear();
            rows.forEach(row => {
                if(row.sortPosition < 10) topObjects.add(row);
                cacheObjectIDs.set(row.id, row);
                cacheObjectNames.set(row.name.toLowerCase(), row);
            });
        }
        loadObjectsToCacheInProgress = false;
        callback(null, {
            objects: cachedObjects,
            objectNames: cacheObjectNames,
            objectIDs: cacheObjectIDs,
            topObjects: topObjects,
        });
        log.info('Loading object data to the cache: ', cachedObjects.size,
            ' objects. Executed: ', Date.now() - startTime, 'ms');
    });
}

/**
 * Get all interaction data from DB to the cache
 * @param {function()|function(null, {
 *     interactions: Set<{id: number, objectID1: number, objectID2: number, type: 0|1|2}>,
 *     interactionsForInclude: Map<number, Set<number>>,
 *     interactionsForIncludeReverse: Map<number, Set<number>>,
 *     interactionsForIntersectAndExclude: Map<number, Map<number, 0|1|2>>,
 * })} callback callback()
 */
function getAllInteractions(callback) {
    if(loadInteractionToCacheInProgress) return callback();

    var startTime = Date.now();
    var cachedInteractionsForIntersectAndExclude = new Map();
    var cacheInteractionsForInclude = new Map();
    var cacheInteractionsForIncludeReverse = new Map();

    loadInteractionToCacheInProgress = true;
    // start to update the cache
    objectsDB.getAllInteractions(function (err, rows) {
        if(err) log.error('Can\'t get interactions data from DB: ', err.message);
        else {
            cacheInteractionsForInclude.clear();
            cacheInteractionsForIncludeReverse.clear();
            cachedInteractionsForIntersectAndExclude.clear();
            rows.forEach(function (row) {
                if(row.type === 0) {
                    if(!cacheInteractionsForInclude.has(row.objectID1)) {
                        cacheInteractionsForInclude.set(row.objectID1, new Set());
                    }

                    if(!cacheInteractionsForIncludeReverse.has(row.objectID2)) {
                        cacheInteractionsForIncludeReverse.set(row.objectID2, new Set());
                    }

                    cacheInteractionsForInclude.get(row.objectID1).add(row.objectID2);
                    cacheInteractionsForIncludeReverse.get(row.objectID2).add(row.objectID1);
                } else {
                    if(!cachedInteractionsForIntersectAndExclude.has(row.objectID1)) {
                        cachedInteractionsForIntersectAndExclude.set(row.objectID1, new Map());
                    }
                    if(!cachedInteractionsForIntersectAndExclude.has(row.objectID2)) {
                        cachedInteractionsForIntersectAndExclude.set(row.objectID2, new Map());
                    }

                    cachedInteractionsForIntersectAndExclude.get(row.objectID1).set(row.objectID2, row.type);
                    cachedInteractionsForIntersectAndExclude.get(row.objectID2).set(row.objectID1, row.type);
                }
            });
        }
        loadInteractionToCacheInProgress = false;
        callback(null, {
            interactionsForInclude: cacheInteractionsForInclude,
            interactionsForIncludeReverse: cacheInteractionsForIncludeReverse,
            interactionsForIntersectAndExclude: cachedInteractionsForIntersectAndExclude,
        });
        log.info('Loading interaction data to the cache: ', cacheInteractionsForInclude.size,
            ' interactions for include, ', cachedInteractionsForIntersectAndExclude.size,
            ' interactions for intersect and exclude. Executed: ', Date.now() - startTime, 'ms');
    });
}


/** Initialized global cachedCounterNames2IDs Map for convert counter names to counter IDs
 * {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 *
 * @param {function()|function(Map<string, number>)} callback - called when done
 */
function initCounterNames2IDs(callback) {
    var startTime = Date.now();

    var cfg = confObjectFilters.get();
    if(typeof cfg.variables !== 'object' || cachedCounterNames2IDsUpdateInProgress) return callback();

    var cachedCounterNames2IDs = new Map();

    cachedCounterNames2IDsUpdateInProgress = true;

    countersDB.getAllCounters(function (err, rows) {
        cachedCounterNames2IDs.clear();
        rows.forEach(row => {
            cachedCounterNames2IDs.set(row.name.toLowerCase(), row.id);
        });
        cachedCounterNames2IDsUpdateInProgress = false;
        callback(null, cachedCounterNames2IDs);
        log.info('Loading cachedCounterNames2IDs to the cache: ', cachedCounterNames2IDs.size,
            ' counters are used in the object filters. Executed: ', Date.now() - startTime, 'ms');
    });
}

/**
 * Get cachedOCIDs and cachedOCID2ObjectID
 * @param {function()|function(null, {
 *     cachedOCIDs: Map<>,
 *     cachedOCID2ObjectID: Map<>,
 * })} callback
 * @return {*}
 */
function getOCID2ObjectID(callback) {
    var startTime = Date.now();

    if (cachedOCIDsUpdateInProgress) return callback()
    var cachedOCID2ObjectID = new Map();
    var cachedOCIDs = new Map();


    cachedOCIDsUpdateInProgress = true;
    countersDB.getAllObjectsCounters(function (err, rows) {
        if(err) log.error('Error getting all OCIDs to the cache: ', err.message);
        else {
            cachedOCID2ObjectID.clear();
            cachedOCIDs.clear();
            rows.forEach(row => {
                cachedOCID2ObjectID.set(row.id, row.objectID);

                if(!cachedOCIDs.has(row.counterID)) {
                    cachedOCIDs.set(row.counterID, new Map([[row.objectID, row.id]]));
                } else cachedOCIDs.get(row.counterID).set(row.objectID, row.id);
            });
        }
        cachedOCIDsUpdateInProgress = false;
        callback(null, {
            OCIDs: cachedOCIDs,
            OCID2ObjectID: cachedOCID2ObjectID,
        });
        log.info('Loading OCIOs for counters to the cache: ', cachedOCIDs.size, ' counters, ',
            cachedOCID2ObjectID.size, ' OCIDs. Executed: ', Date.now() - startTime, 'ms');

    });
}

/**
 * Get cachedObjectProps
 * @param {function()|function(null, Map<number, Map<string, string>>)} callback
 */
function getObjectProperties(callback) {
    var startTime = Date.now();
    if(cachedObjectPropsUpdateInProgress) return callback();

    var cachedObjectProps = new Map();
    cachedObjectPropsUpdateInProgress = true;

    objectPropertiesDB.getProperties(null, function (err, rows) {
        if(err) log.error('Can\'t load object properties from DB to the cache: ', err.message);
        else {
            cachedObjectProps.clear();
            rows.forEach(row => {
                if(!cachedObjectProps.has(row.objectID)) {
                    cachedObjectProps.set(row.objectID, new Map([[row.name.toLowerCase(), row.value]]));
                } else {
                    cachedObjectProps.get(row.objectID).set(row.name.toLowerCase(), row.value);
                }
            });
        }
        cachedObjectPropsUpdateInProgress = false;
        callback(null, cachedObjectProps);
        log.info('Loading object properties to the cache: ', cachedObjectProps.size,
            ' objects. Executed: ', Date.now() - startTime, 'ms');
    });
}

/**
 * Returns an array with objects with names and descriptions of filters for the user in the FILTERS menu
 * @param {string} username - username
 * @param {function(null, Array)|function()} callback - callback(null, filterNames) or callback() when filters are undefined
 * filterNames is [{name:..., description:...}, {}, ...]
 */
function getObjectsFilterConfig(username, callback) {
    var startTime = Date.now();
    var userFilters = cachedUserFilters.get(username);
    if(userFilters &&
        (cachedUserFiltersInProgress || cachedUserFiltersUpdateTime > Date.now() - webServerCacheExpirationTime())) {
        return callback(null, userFilters);
    }
    cachedUserFiltersInProgress = true;

    /**
     * Object filter configuration
     * @type {{
     *     name: string,
     *     description: string,
     *     expression: string
     *     filters: Array,
     *     checkedForRoles: Array,
     * }}
     */
    var cfg = confObjectFilters.get();
    if(typeof cfg !== 'object' || !Array.isArray(cfg.filters)) {
        cachedUserFiltersInProgress = false;
        return callback();
    }


    getUserRoles(function () {
        cachedUserFiltersUpdateTime = Date.now();
        var filterConfig = [];
        // use forEach instead of map for skipping incorrect filters
        cfg.filters.forEach(fCfg => {
            // skipping incorrect filters
            if(typeof fCfg.name !== 'string' || typeof fCfg.expression !== 'string' || !fCfg.name || !fCfg.expression) {
                return;
            }

            var filterObj = {
                name: fCfg.name,
                description: fCfg.description,
            };

            if(Array.isArray(fCfg.checkedForRoles)) {
                filterObj.checked = !fCfg.checkedForRoles.every(role => {
                    var userRoles = cachedUserRoles.get(username);
                    if(!userRoles) log.warn('User ', username, ' has no roles in the cache cachedUserRoles');
                    return !userRoles || !userRoles.has(role.toLowerCase());
                });
            }
            filterConfig.push(filterObj);

        });

        if(!filterConfig.length) {
            log.info('No filters were found for the ', username, ' user. User rules: ', cachedUserRoles.get(username))
        } else cachedUserFilters.set(username, filterConfig);

        cachedUserFiltersInProgress = false;

        callback(null, filterConfig);
        log.info('Loading filters for user ', username,' to the cache: ',
            filterConfig.length, ' filters. Executed: ', Date.now() - startTime, 'ms');
    });
}

/**
 * Get users roles to the cache
 * @param {function()} callback
 */
function getUserRoles(callback) {
    var callbackAlreadyCalled = false;
    var startTime = Date.now();
    if (cachedUserRolesUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(cachedUserRolesUpdateInProgress || cachedUserRolesUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
    }

    cachedUserRolesUpdateInProgress = true;

    userDB.getUsersInformation(null, function (err, rows) {
        cachedUserRolesUpdateTime = Date.now();
        if(err) log.error('Can\'t get user roles data from DB: ', err.message);
        else {
            cachedUserRoles.clear();
            rows.forEach(row => {
                if(!cachedUserRoles.has(row.name)) {
                    cachedUserRoles.set(row.name, new Set([row.roleName.toLowerCase()]));
                } else cachedUserRoles.get(row.name).add(row.roleName.toLowerCase());
            });
        }
        cachedUserRolesUpdateInProgress = false;
        if(!callbackAlreadyCalled) callback();
        log.info('Loading users roles to the cache: ', cachedUserRoles.size,
            ' roles. Executed: ', Date.now() - startTime, 'ms');
    });
}
