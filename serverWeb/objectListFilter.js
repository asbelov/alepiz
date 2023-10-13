/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../lib/log')(module);
const async = require('async');
const history = require('../serverHistory/historyClient');
const fromHuman = require('../lib/utils/fromHuman');
const calc = require('../lib/calc');
const webServerCacheExpirationTime = require('./webServerCacheExpirationTime');
const objectListCreate = require('./objectListCreate');
const Conf = require('../lib/conf');
const confObjectFilters = new Conf('config/objectFilters.json');

/** Object for convert counter names to counter IDs {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 * @type {Object}
 */
var cachedCounterNames2IDsUpdateTime = 0;
var cachedCounterNames2IDs = new Map();

var cachedOCIDsUpdateTime = 0;
var cachedOCID2ObjectID = new Map();
var cachedOCIDs = new Map();

var cachedObjectPropsUpdateTime = 0;
var cachedObjectProps = new Map();

var cacheThread;

var objectListFilter = {
    applyFilterToObjects: applyFilterToObjects,
}

module.exports = objectListFilter;

/**
 * Load data from DB to the cache
 * @param {Object} initCacheThread cache thread for communication
 */
objectListFilter.initCacheThread = function(initCacheThread) {
    cacheThread = initCacheThread;

    // load data to the local cache first time
    initCounterNames2IDs(function () {});
    getOCID2ObjectID(function () {});
    getObjectProperties(function (){});

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

    initCounterNames2IDs(function (err) {
        if (err) return callback(err);
        if (!cachedCounterNames2IDs.size) {
            log.error('No cachedCounterNames2IDs in the cache');
            return callback();
        }

        var counterID = cachedCounterNames2IDs.get(variable.counter.toLowerCase())
        if (!counterID) {
            log.error('No counter ID in the cache for ', variable.counter, ': ', cachedCounterNames2IDs);
            return callback();
        }

        var variableExpiration = variable.expiration ? fromHuman(variable.expiration) : 0;

        getOCID2ObjectID(function () {
            if (!cachedOCIDs.has(counterID)) {
                log.error('No counter ', variable.counter, '(', counterID, ') in the OCIDs cache: ', cachedOCIDs);
                return callback();
            }

            if (!cachedOCID2ObjectID.size) {
                log.error('Cache for OCID2ObjectID is empty');
                return callback();
            }

            cacheThread.sendAndReceive('history', function (err, cachedHistory) {

                var OCIDs = [];
                objects.forEach(object => {
                    var OCID = cachedOCIDs.get(counterID).get(object.id);
                    if (!OCID) {
                        /*
                        // you will get this error to many times
                        log.debug('The counter ', variable.counter, '(', counterID, ') is not linked to the object ',
                            object.name, '(', object.id ,') in the OCIDs cache (size: ',
                            cachedOCIDs.size ,'): ', Array.from(cachedOCIDs.get(counterID)).join(';'));
                         */
                        return;
                    }
                    var value = cachedHistory.get(OCID);
                    if (value && value.timestamp > Date.now() - webServerCacheExpirationTime()) {
                        if (!variableExpiration || Date.now() - variableExpiration <= value.timestamp) {
                            variable.results[object.id] = value.data;
                        } else if (variable.expiredValue !== undefined &&
                            variableExpiration && Date.now() - variableExpiration > value.timestamp) {
                            variable.results[object.id] = variable.expiredValue;
                        } else {
                            OCIDs.push(OCID);
                        }
                    } else OCIDs.push(OCID);
                });

                if (!OCIDs.length) {
                    log.debug('Getting all historical data from the cache for ', variable.counter, '(', counterID,
                        ') number of objects: ', objects.length, '; number of results: ', Object.keys(variable.results).length);
                    return callback();
                }

                history.connect('objectListFilterServer', function () {
                    history.getLastValues(OCIDs, function (err, values) {
                        if (err) {
                            log.error('Error getting last values for counter ', variable.counter, ': ', err.message,
                                ' Objects: ', objects.map(o => o.name).join(', '), ',  OCIDs: ',
                                OCIDs.join(', '));
                            return callback();
                        }
                        if (!Object.keys(values).length) {
                            log.debug('No last values for counter ', variable.counter,
                                ' objects: ', objects.map(o => o.name).join(', '), ',  OCIDs: ',
                                OCIDs.join(', '));
                            return callback();
                        }

                        for (var OCID in values) {
                            OCID = Number(OCID);
                            var objectID = cachedOCID2ObjectID.get(OCID);
                            if (!objectID) {
                                log.error('No object ID for OCID ', OCID, ' in the OCID2ObjectID cache')
                            } else {
                                if (values[OCID]) {
                                    if (!variableExpiration || Date.now() - variableExpiration <= values[OCID].timestamp) {
                                        variable.results[objectID] = values[OCID].data;
                                        cacheThread.send({
                                            OCID: OCID,
                                            value: values[OCID],
                                        });
                                    } else if (variable.expiredValue !== undefined &&
                                        variableExpiration && Date.now() - variableExpiration > values[OCID].timestamp) {

                                        variable.results[objectID] = variable.expiredValue;
                                        cacheThread.send({
                                            OCID: OCID,
                                            value: values[OCID],
                                        });
                                    }
                                } else {
                                    // to get data from the cache next time
                                    cacheThread.send({
                                        OCID: OCID,
                                        value: {
                                            timestamp: Date.now(),
                                            data: null,
                                        },
                                    });
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
        return callback(new Error('Incorrect property name for objects ' +
            objects.map(o=> o.name + '(' + o.id + ')').join(', ') +
            ', variable: ' + JSON.stringify(variable, null, 4)));
    }

    getObjectProperties(function () {
        if(!cachedObjectProps.size) {
            log.error('No object properties cachedObjectProps in the cache');
            return callback();
        }
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
        return callback(new Error('Incorrect property name for objects ' +
            objects.map(o => o.name + '(' + o.id + ')').join(', ') +
            ', variable: ' + JSON.stringify(variable, null, 4)));
    }

    objectListCreate.getAllInteractions(function () {
        var cacheInteractionsForIncludeReverse = objectListCreate.getCacheInteractionsForIncludeReverse();
        if(!cacheInteractionsForIncludeReverse.size) {
            log.error('No interaction cacheInteractionsForIncludeReverse in the cache');
            return callback();
        }

        getObjectProperties(function () {
            if(!cachedObjectProps.size) {
                log.error('No object properties cachedObjectProps in the cache')
                return callback();
            }
            objects.forEach(object => {
                var upLevelObjectIDsSet = cacheInteractionsForIncludeReverse.get(object.id);
                if(upLevelObjectIDsSet) {
                    upLevelObjectIDsSet.forEach(upLevelObjectID => {
                        var objectProp = cachedObjectProps.get(upLevelObjectID);
                        if(objectProp) {
                            var objectPropValue = objectProp.get(variable.name.toLowerCase());
                            if(objectPropValue !== undefined) variable.results[object.id] = objectPropValue;
                        }
                    });
                }
            });
            callback();
        });
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
            var executionTime = Date.now() - startTime;
            var _log = executionTime > 2000 ? log.info : log.debug
            _log('Filter ', filterNamesStr, ' execution time: ', executionTime,
                'ms. Objects: ', objects.length, ' => ', newObjects.length);
            callback(err, newObjects);
        });
    });
}


/** Initialized global cachedCounterNames2IDs Map for convert counter names to counter IDs
 * {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 *
 * @param {function()} callback - called when done
 */
function initCounterNames2IDs(callback) {
    var cfg = confObjectFilters.get();
    if(typeof cfg.variables !== 'object') return callback();

    var callbackAlreadyCalled = false;
    if(cachedCounterNames2IDsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if (cachedCounterNames2IDsUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
        // set the time here for getting data from the database once when data was received to the cache before
        cachedCounterNames2IDsUpdateTime = Date.now();
    }

    cacheThread.sendAndReceive('initCounterNames2IDs', function (err, initCachedCounterNames2IDs) {
        // first time getting data from DB
        cachedCounterNames2IDsUpdateTime = Date.now();
        if(initCachedCounterNames2IDs) cachedCounterNames2IDs = initCachedCounterNames2IDs;
        if(!callbackAlreadyCalled) callback();
    });
}

/**
 * getOCID2ObjectID to the cache
 * @param {function()} callback
 */
function getOCID2ObjectID(callback) {
    var callbackAlreadyCalled = false;
    if (cachedOCIDsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if (cachedOCIDsUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
        // set the time here for getting data from the database once when data was received to the cache before
        cachedOCIDsUpdateTime = Date.now();
    }

    cacheThread.sendAndReceive('getOCID2ObjectID', function (err, data) {
        // first time getting data from DB
        cachedOCIDsUpdateTime = Date.now();
        if(data) {
            cachedOCIDs = data.OCIDs;
            cachedOCID2ObjectID = data.OCID2ObjectID
        }
        if(!callbackAlreadyCalled) callback();
    });
}

/**
 * getObjectProperties to the cache
 * @param {function()} callback
 */
function getObjectProperties(callback) {
    var callbackAlreadyCalled = false;
    if(cachedObjectPropsUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(cachedObjectPropsUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
        // set the time here for getting data from the database once when data was received to the cache before
        cachedObjectPropsUpdateTime = Date.now();
    }

    cacheThread.sendAndReceive('getObjectProperties', function (err, initCachedObjectProps) {
        // first time getting data from DB
        cachedObjectPropsUpdateTime = Date.now();
        if(initCachedObjectProps) cachedObjectProps = initCachedObjectProps;
        if(!callbackAlreadyCalled) callback();
    });
}

/**
 * Get variable value for calc filter
 * @param {string} initVariableName
 * @param {Object} variables
 * @param {Array<Object>} objects
 * @param {{id: number, name: string}} object
 * @param {function(Error)|function(null, string|number)} callback
 */
function getVariableValue(initVariableName, variables, objects, object, callback) {
    for (var variableName in variables) {
        if (variableName.toLowerCase() === initVariableName.toLowerCase()) {
            var variable = variables[variableName];
            if(variable.results === null || typeof variable.results !== 'object') variable.results = {};
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
