/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../lib/log')(module);
var async = require('async');
var countersDB = require('../models_db/countersDB');
var objectPropertiesDB = require('../models_db/objectsPropertiesDB');
var userDB = require('../models_db/usersDB');
var history = require('../serverHistory/historyClient');
const fromHuman = require('../lib/utils/fromHuman');
var calc = require('../lib/calc');
const webServerCacheExpirationTime = require('../serverWeb/webServerCacheExpirationTime');
const createObjectList = require('./createObjectList');
var Conf = require('../lib/conf');
const confObjectFilters = new Conf('config/objectFilters.json');

/** Object for convert counter names to counter IDs {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 * @type {Object}
 */
var cachedCounterNames2IDsUpdateTime = 0;
var cachedCounterNames2IDsUpdateInProgress = false;
var cachedCounterNames2IDs = new Map();

var cachedOCIDsUpdateTime = 0;
var cachedOCIDsUpdateInProgress = false;
var cachedOCID2ObjectID = new Map();
var cachedOCIDs = new Map();

var cachedObjectPropsUpdateTime = 0;
var cachedObjectPropsUpdateInProgress = false;
var cachedObjectProps = new Map();

var cachedUserRolesUpdateTime = 0;
var cachedUserRolesUpdateInProgress = false;
var cachedUserRoles = new Map();

var cachedUserFiltersUpdateTime = 0;
var cachedUserFiltersInProgress = false;
var cachedUserFilters = new Map();

var cachedHistory = new Map();
// clear history cache
setInterval(function () {
    cachedHistory.forEach((value, OCID) => {
        if(value.timestamp < Date.now() - webServerCacheExpirationTime()) cachedHistory.delete(OCID);
    });
    log.info('History data for objects filters in the cache: ', cachedHistory.size, ' OCIDs');
}, 300000)


var objectsFilter = {
    getObjectsFilterConfig: getObjectsFilterConfig,
    applyFilterToObjects: applyFilterToObjects,
}

module.exports = objectsFilter;

/**
 * Returns an array with objects with names and descriptions of filters for the user in the FILTERS menu
 * @param {string} username - username
 * @param {function(null, Array)|function()} callback - callback(null, filterNames) or callback() when filters are undefined
 * filterNames is [{name:..., description:...}, {}, ...]
 */
function getObjectsFilterConfig(username, callback) {

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
        var filterConfig = cfg.filters
            .filter(fCfg =>
                typeof fCfg.name === 'string' && typeof fCfg.expression === 'string' && fCfg.name && fCfg.expression)
            .map((fCfg) => {
                var filterObj = {
                    name: fCfg.name,
                    description: fCfg.description
                };

                if(Array.isArray(fCfg.checkedForRoles)) {
                    filterObj.checked = !fCfg.checkedForRoles.every(role => {
                        var userRoles = cachedUserRoles.get(username);
                        return !userRoles || !userRoles.has(role.toLowerCase());
                    });
                }
                return filterObj;
            });

        if(!Object.keys(filterConfig).length) {
            log.info('No filters were found for the ', username, ' user. User rules: ', cachedUserRoles.get(username))
        } else cachedUserFilters.set(username, filterConfig);

        cachedUserFiltersInProgress = false;
        cachedUserFiltersUpdateTime = Date.now();

        callback(null, filterConfig);
        log.info('Loading filters for user ', username,' to the cache: ', Object.keys(filterConfig).length, ' filters');
    });
}

/** Get last value from a history for specified objects and counter. Set results to the
 * function parameter variable["results"][OCID]
 *
 * @param {Object} variable - variable like {"source": "history", "counter": <counterName>>, "expiration":
 * <expirationTime>, "expiredValue": <expired value>}
 * @param {string} variable.counter
 * @param {number} variable.expiration
 * @param {Array} variable.results
 * @param {string} variable.expiredValue
 * @param {Array<{id: number, name: string}>} objects an array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getHistoryResult(variable, objects, callback) {
    if(typeof variable.counter !== 'string') {
        return callback(new Error('Incorrect counter name for objects ' +
            objects.map(o => o.name + '(' + o.id + ')').join(', ') +
            ', variable: ' + JSON.stringify(variable, null, 4)));
    }

    var counterID = cachedCounterNames2IDs.get(variable.counter.toLowerCase())
    if(!counterID) {
        log.error('No counter ID in the cache for ', variable.counter, ': ', cachedCounterNames2IDs);
        return callback();
    }

    getOCID2ObjectID(function () {
        if(!cachedOCIDs.has(counterID)) {
            log.error('No counter ', variable.counter, '(', counterID, ') in the OCIDs cache: ', cachedOCIDs);
            return callback();
        }

        if(!cachedOCID2ObjectID.size) {
            log.error('Cache for OCID2ObjectID is empty');
            return callback();
        }
        var OCIDs = [];
        objects.forEach(object => {
            var OCID = cachedOCIDs.get(counterID).get(object.id);
            if (!OCID) {
                /*
                // get this error to many times
                log.debug('The counter ', variable.counter, '(', counterID, ') is not linked to the object ',
                    object.name, '(', object.id ,') in the OCIDs cache (size: ',
                    cachedOCIDs.size ,'): ', Array.from(cachedOCIDs.get(counterID)).join(';'));
                 */
                return;
            }
            var value = cachedHistory.get(OCID);
            if (value && value.timestamp > Date.now() - webServerCacheExpirationTime()) {
                if (!variable.expiration || Date.now() - variable.expiration <= value.timestamp) {
                    variable.results[object.id] = value.data;
                } else if (variable.expiredValue !== undefined &&
                    variable.expiration && Date.now() - variable.expiration > value.timestamp) {
                    variable.results[object.id] = variable.expiredValue;
                } else {
                    OCIDs.push(OCID);
                }
            } else {
                OCIDs.push(OCID);
            }
        });

        if(!OCIDs.length) {
            log.debug('Getting all historical data from the cache for ', variable.counter, '(', counterID,
                ') number of objects: ', objects.length, '; number of results: ', Object.keys(variable.results).length);
            return callback();
        }

        history.connect('mainMenu', function () {
            history.getLastValues(OCIDs, function(err, values) {
                for(var OCID in values) {
                    OCID = Number(OCID);
                    var objectID = cachedOCID2ObjectID.get(OCID);
                    if(!objectID) {
                        log.error('No object ID for OCID ', OCID, ' in the OCID2ObjectID cache')
                    } else {
                        if (!variable.expiration || Date.now() - variable.expiration <= values[OCID].timestamp) {
                            if (values[OCID]) {
                                variable.results[objectID] = values[OCID].data;
                                cachedHistory.set(OCID, values[OCID]);
                            }
                        } else if (variable.expiredValue !== undefined &&
                            variable.expiration && Date.now() - variable.expiration > values[OCID].timestamp) {
                            if (values[OCID]) {
                                variable.results[objectID] = variable.expiredValue;
                                cachedHistory.set(OCID, values[OCID]);
                            }
                        }
                    }
                }
/*
                // duplicate with  "Result for filter: ..." message
                log.debug('Getting historical data for objects ', OCIDs.length, '/', objects.length,
                    ' and counter ', variable.counter, ': values: ', Object.keys(values).length,
                    '/', Object.keys(variable.results).length);
 */
                return callback();
            });
        });
    });
}

/**
 * Get property value of specified objects. Set results to the function parameter variable["results"][OCID]
 *
 * @param {Object} variable variable like {"source": "property", "name": <property name>}
 * @param {Array<{id: number, name: string}>} objects array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getObjectPropertiesResult(variable, objects, callback) {
    if(!objects || !objects.length) return callback();

    if(typeof variable.name !== 'string') {
        return callback(new Error('Unknown property name for objects ' +
            objects.map(o=> o.name + '(' + o.id + ')').join(', ') +
            ', variable: ' + JSON.stringify(variable, null, 4)));
    }

    getObjectProperties(function () {
        objects.forEach(object => {
            var objectProp = cachedObjectProps.get(object.id);
            if(objectProp) {
                var objectPropValue = objectProp.get(variable.name.toLowerCase());
                if(objectPropValue !== undefined) variable.results[object.id] = objectPropValue;
            }
        });
        callback();
    });
}

/** Get property value from uplevel objects of specified objects. Set results to the function parameter variable["results"][OCID]
 *
 * @param {Object} variable - variable like {"source": "upLevelProperty", "name": <property name>}
 * @param {Array<{id: number, name: string}>} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getUplevelObjectPropertiesResult(variable, objects, callback) {
    if(!objects || !objects.length) return callback();

    if(typeof variable.name !== 'string') {
        return callback(new Error('Unknown property name for objects ' +
            objects.map(o => o.name + '(' + o.id + ')').join(', ') +
            ', variable: ' + JSON.stringify(variable, null, 4)));
    }

    if(!createObjectList.cacheInteractionsForIncludeReverse.size) {
        return callback(new Error('no interaction in the cache'));
    }

    getObjectProperties(function () {
        objects.forEach(object => {
            var upLevelObjectIDsSet = createObjectList.cacheInteractionsForIncludeReverse.get(object.id);
            if(upLevelObjectIDsSet) {
                upLevelObjectIDsSet.forEach(upLevelObjectID => {
                    var objectProp = cachedObjectProps.get(upLevelObjectID);
                    if(objectProp) {
                        var objectPropValue = objectProp.get(variable.name.toLowerCase());
                        if(objectPropValue !== undefined) variable.results[object.id] = objectPropValue;
                    }
                });
            }
        })
        callback();
    });
}

/** Filter objects and return new objects list with filtered objects
 *
 * @param {Array|String} filterNamesStr - comma separated filer names for filtering objects
 * @param {string} filterExpression - filters logical expression if selected several filters
 * @param {Array} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function(null, Array)} callback - callback(err, newObjects) - newObjects
 * array of filtered objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @returns {*}
 */
function applyFilterToObjects(filterNamesStr, filterExpression, objects, callback) {
    var startTime = Date.now()
    if(!filterNamesStr || typeof filterNamesStr !== 'string') return callback(null, objects);
    var filterNames = filterNamesStr.split(',');

    var cfg = confObjectFilters.get();
    if(typeof cfg !== 'object' || !Array.isArray(cfg.filters)) return callback();
    var variables = cfg.variables;
    var filters = cfg.filters.filter(filterObj => filterNames.indexOf(filterObj.name) !== -1);
    if(!filters.length) return callback(null, objects);

    initCounterNames2IDs(cfg, function (err) {
        if(err) return callback(err);


        log.debug('Starting apply filters: ', filterNamesStr, '; expr: ', filterExpression, '; objects: ', objects.length);

        //log.info('variables: ', variables);
        var newObjects = [];
        async.each(filters, function (filterObj, callback) {
            if(typeof filterObj.expression !== 'string') return callback();
            filterObj.results = {};

            async.each(objects, function(object, callback) {
                var initVariables = {
                    OBJECT_NAME: object.name,
                };

                calc(filterObj.expression, initVariables, function (variableName, callback) {
                        getVariableValue(variableName, variables, objects, object, callback);
                    }, function (err, result, functionDebug, unresolvedVariables) {

                    if(err) {
                        // expression is present in the error message
                        log.debug('Result for filter: ', filterObj.name, '(' ,object.name ,'): ', err.message);
                        return callback();
                    } else {
                        log.debug('Result for filter: ', filterObj.name, '(' ,object.name ,'): ', filterObj.expression,
                            ' = ', result);
                    }

                    filterObj.results[object.id] =
                        unresolvedVariables && unresolvedVariables.length ? undefined : result;

                    callback();
                    });
                }, callback);
            }, function (err) {
                if(err) return callback(err);

            async.each(objects, function(object, callback) {
                var initVariables = {};
                filters.forEach(filterObj => {
                    if(filterObj.results) initVariables[filterObj.name.toUpperCase()] = filterObj.results[object.id];
                })

                calc(filterExpression, initVariables, null,
                    function (err, result, functionDebug, unresolvedVariables) {

                    if(err) {
                        log.info('Can\'t calculate filters ', filterNamesStr, '(' ,object.name ,'): ',
                            filterExpression, ': ' + err.message);
                        return callback();
                    }
                    // if unresolved variables are present, the object is always added to show.
                    // this will allow not to hide objects that are not related to the filter.
                    // if the result is === 0, then the object is not added to show
                    if(result || (unresolvedVariables && unresolvedVariables.length)) {
                        log.debug('Result for filters: ', filterNamesStr, '(' ,object.name ,'): ',
                            filterExpression, ' = ', !!result, '; unresolved ', unresolvedVariables);
                        newObjects.push(object);
                    } else {
                        log.debug('Result for filters: ', filterNamesStr, '(' ,object.name ,'): ',
                            filterExpression, ' = false');
                    }

                    callback();
                });
            }, function(err) {
               log.debug('Filter ', filterNamesStr, '; expr: ', filterExpression, ' execution time: ',
                    Date.now() - startTime, ' objects: ', objects.length, ' => ', newObjects.length);
                callback(err, newObjects);
            });
        });
    });
}


/** Initialized global cachedCounterNames2IDs Map for convert counter names to counter IDs
 * {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 *
 * @param {Object} cfg - config/objectFilters.json
 * @param {function()} callback - called when done
 */
function initCounterNames2IDs(cfg, callback) {
    if(typeof cfg.variables !== 'object') return callback();

    var callbackAlreadyCalled = false;
    if(cachedCounterNames2IDsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if (cachedCounterNames2IDsUpdateInProgress ||
            cachedCounterNames2IDsUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
    }


    cachedCounterNames2IDsUpdateInProgress = true;
    var newCounters = {};
    for(var variableName in cfg.variables) {
        var variable = cfg.variables[variableName];
        if (variable.expiration) variable.expiration = fromHuman(variable.expiration);
        if (variable.counter && !cachedCounterNames2IDs.has(variable.counter.toLowerCase())) newCounters[variable.counter] = 0;
    }

    if(!Object.keys(newCounters).length) {
        if(!callbackAlreadyCalled) callback();
        return;
    }

    countersDB.getCountersIDsByNames(Object.keys(newCounters), function (err, rows) {
        if(err) log.error('Can\'t get counterIDs for counters ', Object.keys(newCounters), ': ', err.message);
        else {
            rows.forEach(row => cachedCounterNames2IDs.set(row.name.toLowerCase(), row.id));
        }
        cachedCounterNames2IDsUpdateInProgress = false;
        cachedCounterNames2IDsUpdateTime = Date.now();
        if(!callbackAlreadyCalled) callback();
        log.info('Loading cachedCounterNames2IDs to the cache: ', cachedCounterNames2IDs.size,
            ' counters are used in the object filters');
    });
}


function getOCID2ObjectID(callback) {
    var callbackAlreadyCalled = false;
    if (cachedOCIDsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if (cachedOCIDsUpdateInProgress || cachedOCIDsUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
    }

    cachedOCIDsUpdateInProgress = true;
    countersDB.getAllObjectsCounters(function (err, rows) {
        if(err) log.error('Error getting all OCIDs to the cache: ', err.message);
        else {
            var counterIDs = {};
            cachedCounterNames2IDs.forEach(counterID => counterIDs[counterID] = true)
            rows.forEach(row => {
                cachedOCID2ObjectID.set(row.id, row.objectID);

                if(!counterIDs[row.counterID]) return;
                if(!cachedOCIDs.has(row.counterID)) {
                    cachedOCIDs.set(row.counterID, new Map([[row.objectID, row.id]]));
                } else cachedOCIDs.get(row.counterID).set(row.objectID, row.id);
            });
        }
        cachedOCIDsUpdateInProgress = false;
        cachedOCIDsUpdateTime = Date.now();
        if(!callbackAlreadyCalled) callback();
        log.info('Loading OCIOs for counters to the cache: ', cachedOCIDs.size, ' counters');

    });
}


function getObjectProperties(callback) {
    var callbackAlreadyCalled = false;
    if(cachedObjectPropsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(cachedObjectPropsUpdateInProgress ||
            cachedObjectPropsUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
    }

    cachedObjectPropsUpdateInProgress = true;

    objectPropertiesDB.getProperties(null, function (err, rows) {
        if(err) log.error('Can\'t load object properties from DB to the cache: ', err.message);
        else {
            rows.forEach(row => {
                if(!cachedObjectProps.has(row.objectID)) {
                    cachedObjectProps.set(row.objectID, new Map([[row.name.toLowerCase(), row.value]]));
                } else {
                    cachedObjectProps.get(row.objectID).set(row.name.toLowerCase(), row.value);
                }
            });
        }
        cachedObjectPropsUpdateInProgress = false;
        if(!err) cachedObjectPropsUpdateTime = Date.now();
        if(!callbackAlreadyCalled) callback();
        log.info('Loading object properties to the cache: ', cachedObjectProps.size, ' objects');
    });
}

function getUserRoles(callback) {
    var callbackAlreadyCalled = false;
    if (cachedUserRolesUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(cachedUserRolesUpdateInProgress || cachedUserRolesUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
    }

    cachedUserRolesUpdateInProgress = true;

    userDB.getUsersInformation(null, function (err, rows) {
        if(err) log.error('Can\'t get user roles data from DB: ', err.message);
        else {
            rows.forEach(row => {
                if(!cachedUserRoles.has(row.name)) {
                    cachedUserRoles.set(row.name, new Set([row.roleName.toLowerCase()]));
                } else cachedUserRoles.get(row.name).add(row.roleName.toLowerCase());
            });
        }
        cachedUserRolesUpdateInProgress = false;
        cachedUserRolesUpdateTime = Date.now();
        if(!callbackAlreadyCalled) callback();
        log.info('Loading users roles to the cache: ', cachedUserRoles.size, ' roles');
    });
}

function getVariableValue(initVariableName, variables, objects, object, callback) {
    for (var variableName in variables) {
        if (variableName.toLowerCase() === initVariableName.toLowerCase()) {
            var variable = variables[variableName];
            variable.results = {};
            break;
        }
    }
    if(!variable) {
        return callback(new Error('undefined variable ' + initVariableName));
    }
    if(variable.results[object.id] !== undefined) {
        log.debug('Variable (from cache) %:', initVariableName, ':%(', object.name,') = ', variable.results[object.id]);
        return callback(null, variable.results[object.id]);
    }

    if(variable.source === 'history') var getVariableFunc = getHistoryResult;
    else if(variable.source === 'property') getVariableFunc = getObjectPropertiesResult;
    else if(variable.source === 'upLevelProperty') getVariableFunc = getUplevelObjectPropertiesResult;
    else {
        return callback(new Error('unknown source ' + variable.source + ' for ' + initVariableName));
    }

    getVariableFunc(variable, objects, function(err) {
        if(err) return callback(err);

        if(variable.results[object.id] === undefined) {
            return callback(new Error('no data for ' + initVariableName));
        }

        log.debug('Variable (from func) %:', initVariableName, ':%(', object.name,') = ', variable.results[object.id]);
        return callback(null, variable.results[object.id]);
    });
}
