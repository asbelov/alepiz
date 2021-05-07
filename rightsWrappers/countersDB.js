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

/*
    getting update events for counter
    user: user name
    counterID: counter ID
    callback(err, updateEvents)
    updateEvents: [{counterID:.., counterName:.., expression:.., mode: <0|1|2>, objectID: parentObjectID, name: <parentObjectName|''>}, ...]
    mode: 0 - update every time when parent counter received a new value and expression is true,
        1 - update once when parent counter received a new value and expression change state to true,
        2 - update once when expression change state to true and once when expression change state to false
 */
rightsWrapper.getUpdateEvents = function(user, counterID, callback) {
    checkIDs(counterID, function(err, checkedID) {
        if(err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(user),
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

rightsWrapper.getCountersForGroup = function(user, groupID, callback) {
    countersDB.getCountersForGroup(groupID, function(err, counters) {
        if(err) return callback(new Error('Can\'t get counters for groups ' + groupID + ': ' + err.message));

        rightsDB.checkCountersIDs(counters, {
            user: prepareUser(user),
            errorOnNoRights: false
        }, callback);
    })
};

rightsWrapper.getAllCounters = function(user, callback) {
    countersDB.getAllCounters(function(err, counters) {
        if(err) return callback(new Error('Can\'t get all counters: ' + err.message));

        rightsDB.checkCountersIDs(counters, {
            user: prepareUser(user),
            errorOnNoRights: false
        }, callback);
    })
};

/*
 return all counters for specific objects

 objectsIDs: array of objects IDs
 groupsIDs: array of counter groups IDs or skip it
 callback(err, counters)
 counters: rows: [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
 counters array sorted by fields name and objectName
 */
rightsWrapper.getCountersForObjects = function(user, objectsIDs, groupsIDs, callback){
    if(!objectsIDs) return callback();

    checkIDs(objectsIDs, function(err, checkedIDs){
        if(err && !checkedIDs) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
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

rightsWrapper.getCounterByID = function(user, id, callback) {
    checkIDs(id, function(err, checkedID){
        if(err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(user),
            id: checkedID[0]
        }, function(err, checkedID){
            if(err) return callback(err);

            countersDB.getCounterByID(checkedID, function(err, counter) {
                if(err) return callback(err);
                if(!counter) return callback();

                countersDB.getObjectCounterIDForCounter(checkedID, function(err, rows) { //rows [{id: <OCID1>, objectID:..}, ...]
                    if(err) return callback(new Error('Can\'t get objectCounterID for counterID ' + checkedID + ': ' + err.message));

                    if(!rows || !rows[0] || !rows[0].id)
                        return callback(new Error('Can\'t get objectCounterID for counterID ' + checkedID +
                            ': object to counters relations not found'));

                    callback(null, counter);
                });
            });
        });
    });
};

rightsWrapper.getCounterParameters = function(user, id, callback){
    if(!id) return callback(null, []);

    checkIDs(id, function(err, checkedID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(user),
            id: checkedID[0]
        }, function (err, checkedID) {
            if (err) return callback(err);

            countersDB.getCounterParameters(checkedID, callback);
        });
    });
};

rightsWrapper.getCounterObjects = function(user, id, callback){
    if(!id) return callback();

    checkIDs(id, function(err, checkedID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(user),
            id: checkedID[0]
        }, function (err, checkedID) {
            if (err) return callback(err);

            countersDB.getCounterObjects(checkedID, callback);
        });
    });
};

/*
    Checking user rights for specific counter and getting parameters for variables and variables with expressions

    user: user name
    counterID:counter ID
    callback(err, object), where

    object:  {
        variables: [ {
                name: <variable name>,
                objectID: <object ID for getting variable value>,
                objectName: <objectName for getting variable value>,
                parentCounterName: <counter name, linked to object for getting variable value>,
                function: <history function for applying to returned counter value>,
                functionParameters: <comma separated string with function parameters>
            }, ...
            ...]
        variablesExpression: [{name: <variable name>, expression: <variable expression>}, ...]
    }
 */
rightsWrapper.getVariables = function(user, counterID, callback){
    if(!counterID) return callback();

    checkIDs(counterID, function(err, checkedCounterID) {
        if (err) return callback(err);

        rightsDB.checkCounterID({
            user: prepareUser(user),
            id: checkedCounterID[0],
            errorOnNoRights: true
        }, function (err, checkedCounterID) {
            if (err) return callback(err);

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

rightsWrapper.getVariablesForParentCounterName = function(user, counterName, callback) {
    if(!counterName) return callback();

    countersDB.getVariables(counterName, function(err, variables) {
        if(err) return callback(new Error('Can\'t get history variables for parent counter name ' + counterName + ': ' + err.message));
        //console.log('Returned variables for parent counter "' + counterName + '": ', variables);
        if(!variables || !variables.length) return callback();

        async.eachSeries(variables, function(variable, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(user),
                id: variable.counterID,
                errorOnNoRights: true
            }, callback);
        }, function(err) {
            if(err) return callback(err);

            callback(null, variables);
        });
    });
};

/*
rightsWrapper.getObjectsCountersID = function (user, objectID, counterID, callback){
    if(!Number(objectID) || !Number(counterID)) return callback();

    checkIDs(counterID, function(err, checkedCounterID) {
        if (err) return callback(err);

        checkIDs([objectID], function(err, checkedIDs){
            if(err) return callback(err);

            user = prepareUser(user);

            rightsDB.checkObjectsIDs({
                user: user,
                IDs: checkedIDs,
                checkChange: true, // don't remove it! function used for change counters
                errorOnNoRights: true
            }, function(err, checkedObjectsIDs){
                if(err) return callback(err);

                    countersDB.getObjectCounterID(checkedObjectsIDs[0], checkedCounterID[0], function(err, obj) {
                        if(err || !obj) return callback(new Error('Can\' get objectCounterID: ' + (err ? err.message : ' not exist'));
                        callback(null, obj.id)
                    });
            });
        });
    });
};
*/

rightsWrapper.getObjectsCountersIDsForCollector = function (user, collector, callback){
    if(!collector) return callback();

    countersDB.getObjectsCountersIDsForCollector(collector, function(err, row) {
        if(!row || !row.length) return callback();

        checkIDs(row.map(function(obj) {return obj.objectID }).filter(function(id) {return id !== undefined}), function(err, checkedIDs) {

            if(!checkedIDs.length && err)
                return callback(new Error('Error getting objectsCountersIDs for collector ' + collector + ': ' + err.message));

            user = prepareUser(user);

            rightsDB.checkObjectsIDs({
                user: user,
                IDs: checkedIDs,
                checkChange: true, // don't remove it! function used for change counters
                errorOnNoRights: true
            }, function(err, checkedObjectsIDs){
                if(err) return callback(err);

                var OCIDs = row.filter(function(obj) {return checkedObjectsIDs.indexOf(obj.objectID)}).map(function(obj) {return obj.id});
                callback(null, OCIDs);
            });
        });
    });
};

/*
    getting groups for specific objects IDs

    user: user name
    IDs - objects IDs
    callback(err, groups)
    groups: [{id:.., name:...}, ...]
 */
rightsWrapper.getGroupsForObjects = function(user, IDs, callback){
    if(!IDs.length) return callback(new Error('Can\'t get counters groups for objects: objects IDs not specified'));

    rightsWrappersObjectsDB.getObjectsByIDs(user, IDs, function(err, objects){
        if(err) return callback(err);

        var IDs = objects.map(function(obj){ return obj.id});
        groupsDB.getGroupsForObjects(IDs, callback);
    });
};


rightsWrapper.getParentCountersVariables = function (user, initCountersIDs, prevCountersIDs, callback) {
    checkIDs(initCountersIDs, function (err, countersIDs ) {
        if(err && !countersIDs.length) {
            return callback(new Error('Incorrect counter ID ' + JSON.stringify(initCountersIDs) + ' for getting parent counters variables: '
                + err.message));
        }

        async.eachSeries(countersIDs, function(counterID, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(user),
                id: counterID,
                errorOnNoRights: true
            }, callback);
        }, function(err) {
            if(err) {
                return callback(new Error('You has no rights for getting parent counters variables: '
                    + err.message));
            }

            countersDB.getParentCountersVariables(countersIDs, function (err, rows) {
                if(err) return callback(new Error('Error while getting parent counters variables: ' + err.message));

                //console.log('getParentCountersVariables: ', rows);

                var parentCountersIDs = rows.map(row => row.counterID).filter(id => prevCountersIDs.indexOf(id) === -1);
                if(!parentCountersIDs.length) return callback();
                Array.prototype.push.apply(prevCountersIDs, countersIDs);
                rightsWrapper.getParentCountersVariables(user, parentCountersIDs, prevCountersIDs, function (err, rows1) {
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
};

rightsWrapper.getAllForCounter = function (user, initCountersIDs, callback) {
    if(!Array.isArray(initCountersIDs) || !initCountersIDs.length) return callback(null, []); // objects has not a linked no counters

    checkIDs(initCountersIDs, function (err, countersIDs ) {
        if (err && !countersIDs.length) {
            return callback(new Error('Incorrect counters IDs ' + JSON.stringify(initCountersIDs) +
                ' for getting counters parameters for export counters: '
                + err.message));
        }

        var countersRows = [];
        async.eachSeries(countersIDs, function(counterID, callback) {
            rightsDB.checkCounterID({
                user: prepareUser(user),
                id: counterID,
                errorOnNoRights: true
            }, function(err) {
                if(err) return callback(new Error('You has no rights for getting counter data: ' + err.message));

                countersDB.getAllForCounter(counterID, function(err, rows) {
                    if(err) return callback(new Error('Error getting counter data for counterID: ' + counterID + ': ' + err.message));

                    countersRows.push(rows);
                    callback();
                });
            });
        }, function(err) {
            if (err) {
                return callback(new Error('You has no rights for getting counter data: '
                    + err.message));
            }

            callback(null, countersRows);
        });
    });
}