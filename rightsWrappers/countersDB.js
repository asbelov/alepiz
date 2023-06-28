/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
//var log = require('../lib/log')(module);
var countersDB = require('../models_db/countersDB');
var groupsDB = require('../models_db/countersGroupsDB');
var rightsDB = require('../models_db/usersRolesRightsDB');
var rightsWrappersObjectsDB = require('../rightsWrappers/objectsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');

var rightsWrapper = {};
module.exports = rightsWrapper;

/**
 * Check user rights for object that linked to the specific counter ID and get update events for counter ID
 *
 * @param {string} username username
 * @param {number} counterID counter ID
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, updateEventsRows) updateEventsRows
 * see in example
 * @example
 * updateEventsRows: [
 * {
 *      counterID:<parentCounterID>,
 *      counterName: <counterName>,
 *      expression: <updateEventExpression>,
 *      mode: <0|1|2|3>,
 *      objectID: <parentObjectID>,
 *      objectFilter: <objectsFilter> ,
 *      description: <updateEventDescription>,
 *      updateEventOrder: <updateEventOrder>
 * }, ...];
 *mode: 0 - update every time when parent counter received a new value and expression is true,
 *         1 - update once when parent counter received a new value and expression change state to true,
 *         2 - update once when expression change state to true and once when expression change state to false
 *         3 - update once when expression value is changed to false
 */
rightsWrapper.getUpdateEvents = function(username, counterID, callback) {
    checkIDs(counterID, function(err, checkedID) {
        if(err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(username),
            id: checkedID[0]
        }, function(err, checkedID){
            if(err) return callback(err);

            countersDB.getUpdateEvents(checkedID, function(err, updateEvents) {
                if(err) return callback(new Error('Error getting update events for counter ' + checkedID + ': ' + err.message));
                callback(null, updateEvents);
            });
        });
    });
};

/**
 * Get counters included in the group
 * @param {string} username username
 * @param {number} groupID group ID
 * @param {function(Error) | function() | function(null, Array<Object>)} callback callback(err, rows),
 * where rows [{id, name, collectorID, groupID, unitID, sourceMultiplier, keepHistory, keepTrends, modifyTime,
 * description, disabled, debug, taskCondition, created}, ...]
 */
rightsWrapper.getCountersForGroup = function(username, groupID, callback) {
    countersDB.getCountersForGroup(groupID, function(err, counters) {
        if(err) return callback(new Error('Can\'t get counters for groups ' + groupID + ': ' + err.message));

        rightsDB.checkCountersIDs(counters, {
            user: prepareUser(username),
            errorOnNoRights: false
        }, callback);
    })
};

/** Get all data from counters table SELECT * FROM counters allowed for username
 * @param {string} username username for check user rights for objects linked to the counters
 * @param {function(Error) | function() | function(null, Array<Object>)} callback callback(err, rows):
 * rows: [{id, name, collectorID, groupID, unitID, sourceMultiplier, keepHistory, keepTrends, modifyTime,
 * description, disabled, debug, taskCondition, created}, ...]
 */
rightsWrapper.getAllCounters = function(username, callback) {
    countersDB.getAllCounters(function(err, counters) {
        if(err) return callback(new Error('Can\'t get all counters: ' + err.message));

        rightsDB.checkCountersIDs(counters, {
            user: prepareUser(username),
            errorOnNoRights: false
        }, callback);
    })
};

/**
 * Check user rights for specific object IDs and return all linked counters for specific object IDs and group if set
 * @param {string} username username
 * @param {Array<number>} objectsIDs array of object IDs
 * @param {Array<number>|null} groupsIDs array of group IDs or null for return all counter that linked to the
 * specific object IDs
 * @param {function(Error) | function() | function(null, Array<Object>)} callback - callback(err, rows),
 * where rows: [{id:.., name:.., taskCondition:..., unitID:..., collectorID:..., debug:..., sourceMultiplier:...,
 *     groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
 */
rightsWrapper.getCountersForObjects = function(username, objectsIDs, groupsIDs, callback){
    if(!objectsIDs) return callback();

    checkIDs(objectsIDs, function(err, checkedIDs){
        if(err && !checkedIDs) return callback(err);

        username = prepareUser(username);

        rightsDB.checkObjectsIDs({
            user: username,
            IDs: checkedIDs,
            errorOnNoRights: true
        }, function(err, objectsIDs){
            if(err) return callback(err);

            countersDB.getCountersForObjectsAndGroups(objectsIDs, function (err, rows) {
                if(err) {
                    return callback(new Error('Error getting counters for objects ' + objectsIDs.join(',') +
                        (groupsIDs ? ' and groups ' + groupsIDs.join(', ') : '') + ': ' + err.message));
                }

                if(!groupsIDs) return callback(null, rows);
                groupsIDs = groupsIDs.map(groupID => Number(groupID));
                return callback(null, rows.filter( row => groupsIDs.indexOf(row.groupID) !== -1) );
            });
        });
    });
};

/**
 * Get counters by ID allowed for username
 * @param {string} username username
 * @param {number} counterID counter ID
 * @param {function(Error)|function(null, Object|undefined)} callback callback(err, row) where rows is
 * {id, name, collectorID, groupID, unitID, sourceMultiplier, keepHistory, keepTrends, modifyTime,
 * description, disabled, debug, taskCondition, created} or undefined when the counter is not found
 */
rightsWrapper.getCounterByID = function(username, counterID, callback) {
    checkIDs(counterID, function(err, checkedID){
        if(err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(username),
            id: checkedID[0]
        }, function(err, checkedID){
            if(err) return callback(err);

            countersDB.getCounterByID(checkedID, function(err, counter) {
                if(err) return callback(err);
                if(!counter) return callback();

                callback(null, counter);
            });
        });
    });
};

/**
 * Get counter parameters for the counter SELECT name, value FROM counterParameters WHERE counterID = ?
 * @param {string} username username
 * @param {number} counterID counter ID
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, rows) where rows
 * [{name:..., value:...}, ....]
 */
rightsWrapper.getCounterParameters = function(username, counterID, callback){
    if(!counterID) return callback(null, []);

    checkIDs(counterID, function(err, checkedID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(username),
            id: checkedID[0]
        }, function (err, checkedID) {
            if (err) return callback(err);

            countersDB.getCounterParameters(checkedID, callback);
        });
    });
};

/**
 * Get objects linked to the counter
 * @param {string} username username
 * @param {number} counterID counter ID
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, rows) where rows
 * [{id:<objectID>, name:<objectName>, OCID:<OCID>}, ...]
 */
rightsWrapper.getCounterObjects = function(username, counterID, callback){
    if(!counterID) return callback();

    checkIDs(counterID, function(err, checkedID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(username),
            id: checkedID[0]
        }, function (err, checkedID) {
            if (err) return callback(err);

            countersDB.getCounterObjects(checkedID, callback);
        });
    });
};

/**
 * Checking user rights for specific counter and getting parameters for variables and variables with expressions
 * @param {string} username username
 * @param {number} counterID counter ID
 * @param {function(Error)|function(null, Object)} callback callback(err, variablesObject) where variablesObject
 * described in the example
 * @example
 * variablesObject:  {
 *         variables:  [{
 *              name:<variableName>,
 *              counterID,
 *              objectID,
 *              objectName,
 *              parentCounterName,
 *              function,
 *              functionParameters,
 *              objectVariable,
 *              description,
 *              variableOrder,
 *              OCID,
 *              counterName,
 *              parentCounterID}, ...]
 *         variablesExpression: [{
 *              id,
 *              name,
 *              counterID,
 *              expression,
 *              description,
 *              variableOrder}, …]
 *     }
 */
rightsWrapper.getVariables = function(username, counterID, callback){
    if(!counterID) return callback();

    checkIDs(counterID, function(err, checkedCounterID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(username),
            id: checkedCounterID[0],
            errorOnNoRights: true
        }, function (err, checkedCounterID) {
            if (err) return callback(err);
            if(!checkedCounterID) return callback();

            async.parallel({
                variables: function(callback) {
                    countersDB.getVariables(checkedCounterID, function(err, variablesDBRows) {
                        if(err) return callback(new Error('Can\'t get variables for counter ID '+checkedCounterID+': '+err.message));
                        else callback(null, variablesDBRows);
                    })
                },

                variablesExpression: function(callback) {
                    countersDB.getVariablesExpressions(checkedCounterID, function(err, variablesExpressionsDBRows) {
                        if(err) return callback(new Error('Can\'t get variables expressions for counter ID '+counterID+': '+err.message));
                        else callback(null, variablesExpressionsDBRows);
                    })
                }
            }, callback); //(err, {variables: [..], variablesExpression:[..]})
        });
    });
};

/**
 * Get variables for the parent counter
 * @param {string} username username
 * @param {string} counterName counter name
 * @param {function(Error)|function(null, Object)} callback callback(err, rows) where rows
 *  [{name:<variableName>, counterID, objectID, objectName, parentCounterName, function, functionParameters,
 *  objectVariable, description, variableOrder, OCID, counterName, parentCounterID}]
 */
rightsWrapper.getVariablesForParentCounterName = function(username, counterName, callback) {
    if(!counterName) return callback();

    countersDB.getVariables(counterName, function(err, variables) {
        if(err) return callback(new Error('Can\'t get history variables for parent counter name ' + counterName + ': ' + err.message));
        //console.log('Returned variables for parent counter "' + counterName + '": ', variables);
        if(!variables || !variables.length) return callback();

        async.eachSeries(variables, function(variable, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(username),
                id: variable.counterID,
                errorOnNoRights: true
            }, callback);
        }, function(err) {
            if(err) return callback(err);

            callback(null, variables);
        });
    });
};

/**
 * Getting object groups data for the specific object IDs
 * @param {string} username username
 * @param {Array<number>} objectIDs an array with object IDs
 * @param {function(Error)|function(null, Object)} callback callback(err, rows) where rows is [{id:.., name:...}, ...]
 */
rightsWrapper.getGroupsForObjects = function(username, objectIDs, callback){
    if(!objectIDs.length) return callback(new Error('Can\'t get counters groups for objects: objects IDs not specified'));

    rightsWrappersObjectsDB.getObjectsByIDs(username, objectIDs, function(err, objects){
        if(err) return callback(err);

        var IDs = objects.map(function(obj){ return obj.id});
        groupsDB.getGroupsForObjects(IDs, callback);
    });
};

/**
 * Get variables for the parent counters
 * @param {string} username username
 * @param {Array<number>} counterIDs an array with the counter IDs
 * @param {function(Error)|function(null, Object)} callback callback(err, rows) where rows is
 * [{counterID:<parentCounterID>, counterName:<parentCounterName>, variableName:<variableName>,
 * variableExpression:<variableExpression>, variableDescription: <variableDescription>},…]
 */
rightsWrapper.getParentCountersVariables = function (username, counterIDs, callback) {
    getParentCountersVariables(username, counterIDs, [], callback)
};

/**
 * Get variables for the parent counters
 * @param {string} username username
 * @param {Array<number>} initCountersIDs an array with the counter IDs
 * @param {Array<number>} prevCountersIDs an array with the parent counter IDs used in recursion
 * @param {function(Error)|function(null, Object)} callback callback(err, rows) where rows is
 * [{counterID:<parentCounterID>, counterName:<parentCounterName>, variableName:<variableName>,
 * variableExpression:<variableExpression>, variableDescription: <variableDescription>},…]
 */

function getParentCountersVariables(username, initCountersIDs, prevCountersIDs, callback) {
    checkIDs(initCountersIDs, function (err, countersIDs ) {
        if(err && !countersIDs.length) {
            return callback(new Error('Incorrect counter IDs ' + JSON.stringify(initCountersIDs, null, 4) +
                ' for getting parent counters variables: ' + err.message));
        }

        async.eachSeries(countersIDs, function(counterID, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(username),
                id: counterID,
                errorOnNoRights: true
            }, callback);
        }, function(err) {
            if(err) {
                return callback(new Error('You are not allowed for getting parent counter variables: '
                    + err.message));
            }

            countersDB.getParentCountersVariables(countersIDs, function (err, rows) {
                if(err) return callback(new Error('Error while getting parent counters variables: ' + err.message));

                //console.log('getParentCountersVariables: ', rows);

                var parentCounterIDs = rows.map(row => row.counterID).filter(id => prevCountersIDs.indexOf(id) === -1);
                if(!parentCounterIDs.length) return callback();
                Array.prototype.push.apply(prevCountersIDs, countersIDs);
                getParentCountersVariables(username, parentCounterIDs, prevCountersIDs,
                    function (err, rows1) {
                        if(err) return callback(new Error('Error while getting parent counters variables: ' + err.message));

                        //console.log('getParentCountersVariables2: ', rows1);

                        var variablesNames = rows.map(row => (row.variableName ? row.variableName.toUpperCase() : ''));
                        if(rows1 && rows1.length) {
                            Array.prototype.push.apply(rows, rows1.filter(function (row) {
                                if (!row.variableName) return true;
                                if (variablesNames.indexOf(row.variableName.toUpperCase()) === -1) return true;
                            }));
                        }
                        callback(null, rows);
                    })
            });
        });
    });
}

/**
 * Get data for counters
 * @param {string} username username
 * @param {Array<number>} initCountersIDs an array with the counter IDs
 * @param {function(Error)|function(null, Array)} callback callback(err, countersData) where counterData is
 * described in the example
 * @example
 * countersData: [{
 *      counters: SELECT * FROM counters WHERE counters.id=?
 *      counterParameters: SELECT * FROM counterParameters WHERE counterParameters.counterID=?
 *      countersUpdateEvents: SELECT * FROM countersUpdateEvents WHERE countersUpdateEvents.counterID=?
 *      variables: SELECT * FROM variables WHERE variables.counterID=?
 *      variablesExpressions: SELECT * FROM variablesExpressions WHERE variablesExpressions.counterID=?
 *      countersGroups: SELECT * FROM countersGroups WHERE countersGroups.id=?
 *      countersUnits: SELECT * FROM countersUnits WHERE countersUnits.id=?
 * }, ...]
 */
rightsWrapper.getAllForCounter = function (username, initCountersIDs, callback) {
    // objects has not a linked counters
    if(!Array.isArray(initCountersIDs) || !initCountersIDs.length) return callback(null, []);

    checkIDs(initCountersIDs, function (err, countersIDs ) {
        if (err && !countersIDs.length) {
            return callback(new Error('Incorrect counters IDs ' + JSON.stringify(initCountersIDs) +
                ' for getting counters parameters for export counters: '
                + err.message));
        }

        var countersRows = [];
        async.eachSeries(countersIDs, function(counterID, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(username),
                id: counterID,
                errorOnNoRights: true
            }, function(err) {
                if(err) return callback(new Error('You have no rights for getting counter data: ' + err.message));

                countersDB.getAllForCounter(counterID, function(err, rows) {
                    if(err) return callback(new Error('Error getting counter data for counterID: ' + counterID + ': ' + err.message));

                    countersRows.push(rows);
                    callback();
                });
            });
        }, function(err) {
            if (err) {
                return callback(new Error('You have no rights for getting counter data: '
                    + err.message));
            }

            callback(null, countersRows);
        });
    });
}