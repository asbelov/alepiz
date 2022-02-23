/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
//var log = require('../lib/log')(module);
var async = require('async');
var countersDB = require('../models_db/countersDB');
var objectsDB = require('../models_db/objectsDB');
var objectPropertiesDB = require('../models_db/objectsPropertiesDB');
var history = require('../models_history/history');
var calc = require('../lib/calc');
var Conf = require('../lib/conf');
const confObjectFilters = new Conf('config/objectFilters.json');

/** Object for convert counter names to counter IDs {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 * @type {Object}
 */
var counterNames2IDs = {};
var objectsFilter = {
    getObjectsFilterNames: getObjectsFilterNames,
    applyFilterToObjects: applyFilterToObjects,
}

module.exports = objectsFilter;

/** Return array with objects with filter names and descriptions for init FIULTERS menu
 *
 * @param {function(null, Array)|function()} callback - callback(null, filterNames) or callback() when filters are undefined
 * filterNames is [{name:..., description:...}, {}, ...]
 */
function getObjectsFilterNames(callback) {
    confObjectFilters.reload();
    var cfg = confObjectFilters.get();
    if(typeof cfg !== 'object' || !Array.isArray(cfg.filters)) return callback();

    var filterNames = cfg.filters
        .filter(f => typeof f.name === 'string' && typeof f.expression === 'string' && f.name && f.expression)
        .map((f) => { return { name: f.name, description: f.description } });

    return callback(null, filterNames);
}

/** Initialized global counterNames2IDs object for convert counter names to counter IDs
 * {<counterName1>: <counterID1>, <counterName2>: <counterID2>, ...}
 *
 * @param {Object} cfg - config/objectFilters.json
 * @param {function(Error)|function()} callback - called when done
 */
function initCounterNames2IDs(cfg, callback) {
    if(typeof cfg.variables !== 'object') return callback();

    var newCounters = {};
    for(var variableName in cfg.variables) {
        var variable = cfg.variables[variableName];
        if (variable.expiration) variable.expiration = calc.convertToNumeric(variable.expiration);
        if (variable.counter && !counterNames2IDs[variable.counter]) newCounters[variable.counter] = 0;
    }

    if(!Object.keys(newCounters).length) return callback();

    countersDB.getCountersIDsByNames(Object.keys(newCounters), function (err, rows) {
        if(err) {
            return callback(new Error('Can\'t get counterIDs for counters ' + Object.keys(newCounters) +
                ': ' + err.message));
        }
        rows.forEach(row => counterNames2IDs[row.name] = row.id);
        //log.info('counterNames2IDs: ', counterNames2IDs);
        callback();
    });
}

/** Get last value from a history for specified objects and counter. Set results to the
 * function parameter variable["results"][OCID]
 *
 * @param {Object} variable - variable like {"source": "history", "counter": <counterName>>, "expiration":
 * <expirationTime>, "expiredValue": <expired value>}
 * @param {Array} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getHistoryResult(variable, objects, callback) {
    if(typeof variable.counter !== 'string') {
        return callback(new Error('Unknown counter name for filter ' + filterObj.name + ': ' + JSON.stringify(variable)));
    }

    if(!counterNames2IDs[variable.counter]) return callback();

    var OCID2ObjectID = {};
    async.each(objects, function (obj, callback) {
        countersDB.getObjectCounterID(obj.id, counterNames2IDs[variable.counter], function (err, row) {
            if(err) {
                return callback(new Error('Can\'t get OCID for object ' + obj.name + '(' + obj.id + ') and counter ' +
                    variable.counter + '(' + counterNames2IDs[variable.counter] + '): ' + err.message));
            }

            if(!row) return callback();

            OCID2ObjectID[row.id] = obj.id;

            callback();
        });
    }, function (err) {
        if(err) return callback(err);
        if(!Object.keys(OCID2ObjectID).length) return callback();

        history.connect('mainMenu', function () {
            history.getLastValues(Object.keys(OCID2ObjectID), function(err, values) {
                //log.info('OCID2ObjectID: ', OCID2ObjectID);
                //log.info('history values: ', values);
                for(var OCID in values) {
                    if(!variable.expiration || Date.now() - variable.expiration <= values[OCID].timestamp) {
                        if(values[OCID]) variable.results[OCID2ObjectID[OCID]] = values[OCID].data;
                    } else if(variable.expiredValue !== undefined &&
                        variable.expiration && Date.now() - variable.expiration > values[OCID].timestamp) {
                        if(values[OCID]) variable.results[OCID2ObjectID[OCID]] = variable.expiredValue;
                    }
                }

                return callback();
            });
        });
    });
}

/** Get property value of specified objects. Set results to the function parameter variable["results"][OCID]
 *
 * @param {Object} variable - variable like {"source": "property", "name": <property name>}
 * @param {Array} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getObjectPropertiesResult(variable, objects, callback) {
    if(typeof variable.name !== 'string') {
        return callback(new Error('Unknown property name for filter ' + filterObj.name + ': ' + JSON.stringify(variable)));
    }

    objectPropertiesDB.getProperties(objects.map(o => o.id), function (err, rows) {
        if(err) {
            return callback(new Error('Can\'t get object properties for objects ' +
                objects.map(o=>o.name + '(' + o.id + ')').join(', ') +': ' + err.message));
        }

        //log.info('Properties: ', rows)
        rows.forEach(row => {
            if(row.name.toLowerCase() === variable.name.toLowerCase()) variable.results[row.objectID] = row.value;
        });

        callback();
    });
}

/** Get property value from uplevel objects of specified objects. Set results to the function parameter variable["results"][OCID]
 *
 * @param {Object} variable - variable like {"source": "upLevelProperty", "name": <property name>}
 * @param {Array} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function()} callback - called when done
 */
function getUplevelObjectPropertiesResult(variable, objects, callback) {
    if(typeof variable.name !== 'string') {
        return callback(new Error('Unknown property name for filter ' + filterObj.name + ': ' + JSON.stringify(variable)));
    }

    var objectIDs = objects.map(o => o.id);
    objectsDB.getInteractions(objectIDs, function (err, interactions) {
        if(err) {
            return callback(new Error('Can\'t get objects interactions for get uplevel object IDs: ' + err.message));
        }
        
        var upLevelObjectIDs = {};
        interactions.forEach(interaction => {
            if(interaction.type === 0 && objectIDs.indexOf(interaction.id2) !== -1) {
                if(!upLevelObjectIDs[interaction.id1]) upLevelObjectIDs[interaction.id1] = [];
                upLevelObjectIDs[interaction.id1].push(interaction.id2);
            }
        });
        //log.info('upLevelObjectIDs: ', upLevelObjectIDs);
        var upLevelObjetIDsArr = Object.keys(upLevelObjectIDs).map(objectID => Number(objectID));
        if(!upLevelObjetIDsArr.length) return callback();

        objectPropertiesDB.getProperties(upLevelObjetIDsArr, function (err, rows) {
            if(err) {
                return callback(new Error('Can\'t get up level object properties for objects ' +
                    upLevelObjetIDsArr.join(', ') +': ' + err.message));
            }

            //log.info('Properties: ', rows)
            rows.forEach(row => {
                if(row.name.toLowerCase() === variable.name.toLowerCase()) {
                    upLevelObjectIDs[row.objectID].forEach(objectID => {
                        variable.results[objectID] = row.value;
                    });
                }
            });
            //log.info('!!!variable: ', variable)
            callback();
        });
    });
}

/** Filter objects and return new objects list with filtered objects
 *
 * @param {string} filterNamesStr - comma separated filer names for filotering objects
 * @param {string} filterExpression - filters logical expression if selected some filters
 * @param {Array} objects - array of objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @param {function(Error)|function(null, Array)} callback - callback(err, newObjects) - newObjects
 * array of filtered objects [{name: <objectName> id: <objectID>}, {...}, ...]
 * @returns {*}
 */
function applyFilterToObjects(filterNamesStr, filterExpression, objects, callback) {
    if(!filterNamesStr || typeof filterNamesStr !== 'string') return callback(null, objects);
    var filterNames = filterNamesStr.split(',');

    confObjectFilters.reload();
    var cfg = confObjectFilters.get();
    if(typeof cfg !== 'object' || !Array.isArray(cfg.filters)) return callback();
    var filters = cfg.filters.filter(filterObj => filterNames.indexOf(filterObj.name) !== -1);
    //log.info('filters, filterNames, filterExpression, objects: ', filters, '; ', filterNamesStr, '; ', filterExpression, '; ', objects);
    if(!filters.length) return callback(null, objects);

    initCounterNames2IDs(cfg, function (err) {
        if(err) return callback(err);

        var variables = cfg.variables;

        async.eachOf(variables, function (variable, variableName, callback) {
            variable.results = {};
            if(variable.source === 'history') getHistoryResult(variable, objects, callback);
            else if(variable.source === 'property') getObjectPropertiesResult(variable, objects, callback);
            else if(variable.source === 'upLevelProperty') getUplevelObjectPropertiesResult(variable, objects, callback);
            else callback(new Error('Unknown source ' + variable.source + ' for variable ' + variableName));
        }, function (err) {
            if(err) return callback(err);

            //log.info('variables: ', variables);
            var newObjects = [];
            async.each(filters, function (filterObj, callback) {
                if(typeof filterObj.expression !== 'string') return callback();
                filterObj.results = {};

                async.each(objects, function(obj, callback) {
                    var initVariables = {
                        OBJECT_NAME: obj.name,
                    };
                    for(var variableName in variables) {
                        initVariables[variableName.toUpperCase()] = variables[variableName].results[obj.id];
                    }

                    calc(filterObj.expression, initVariables, 0,
                        function (err, result, functionDebug, unresolvedVariables) {
                        if(err) {
                            return callback(new Error('Can\'t calculate ' + filterObj.expression +
                                ' for object filter ' + filterObj.name + ': ' + err.message));
                        }

                        //log.info('filterObj.expression: ', filterObj.expression, ' = ', result, '; unresolvedVariables: ', unresolvedVariables, '; initVars: ', initVariables)
                        //if unresolved variables are present, the result is always true.
                        //This will allow not to hide objects that are not related to the filter.
                        filterObj.results[obj.id] = unresolvedVariables && unresolvedVariables.length ? undefined : result;
                        callback();
                    });
                }, callback);
            }, function (err) {
                if(err) return callback(err);

                async.each(objects, function(obj, callback) {
                    var initVariables = {};
                    filters.forEach(filterObj => {
                        if(filterObj.results) initVariables[filterObj.name.toUpperCase()] = filterObj.results[obj.id];
                    })

                    calc(filterExpression, initVariables, 0,
                        function (err, result, functionDebug, unresolvedVariables) {
                        if(err) {
                            return callback(new Error('Can\'t calculate ' + filterExpression +
                                ' for object filters : ' + err.message));
                        }

                        //log.info('filterExpression: ', filterExpression, ' = ', result, '; unresolvedVariables: ', unresolvedVariables, '; initVars: ', initVariables)
                        //if unresolved variables are present, the object is always added to show.
                        //This will allow not to hide objects that are not related to the filter.
                        if(result || (unresolvedVariables && unresolvedVariables.length)) newObjects.push(obj);
                        callback();
                    });
                }, function(err) {
                    callback(err, newObjects);
                });
            });
        });
    });
}
