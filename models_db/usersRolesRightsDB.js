/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var db = require('./db');
const webServerCacheExpirationTime = require('../serverWeb/webServerCacheExpirationTime');

var lastTimeWhenLoadedObjectRightsFromDB = 0;
var lastTimeWhenLoadedActionsRightsFromDB = 0;

var rightsDB = {};
module.exports = rightsDB;

var objectsRights = new Map(),
    actionsRights = new Set(),
    objectRightsCallbacksQueue = new Set(),
    actionsRightsCallbacksQueue = new Set();

/**
 * Load object rights to the cache
 * @param {function(err)|function()} callback callback(err)
 */
function loadObjectsRights(callback) {
    if(lastTimeWhenLoadedObjectRightsFromDB > Date.now() - webServerCacheExpirationTime()) return callback();
    lastTimeWhenLoadedObjectRightsFromDB = Date.now();

    objectRightsCallbacksQueue.add(callback);
    if(objectRightsCallbacksQueue.size > 1) return;

    db.all('\
SELECT users.name AS user, rightsForObjects.objectID AS objectID, rightsForObjects.view AS view, \
rightsForObjects.change AS change, rightsForObjects.makeTask AS makeTask, \
rightsForObjects.changeInteractions AS changeInteractions FROM users \
JOIN usersRoles ON users.id=usersRoles.userID \
JOIN rightsForObjects ON rightsForObjects.roleID=usersRoles.roleID \
WHERE isDeleted=0', function(err, rows) {
        if(err) {
            objectRightsCallbacksQueue.forEach(function (callback) {
                callback(new Error('Can\'t read rights for objects data from DB: ' + err.message));
            });
            objectRightsCallbacksQueue.clear();
            return;
        }

        rows.forEach(function (row) {
            if(!objectsRights.has(row.user)) objectsRights.set(row.user, new Map());
            var userObjectID = objectsRights.get(row.user);

            // For default rights for objects row.objectID can be null
            if(!userObjectID.has(row.objectID)) {
                userObjectID.set(row.objectID, {
                    view: !!row.view,
                    change: !!row.change,
                    makeTask: !!row.makeTask,
                    changeInteractions: !!row.changeInteractions
                });
            } else {
                userObjectID.set(row.objectID, {
                    view: !!row.view || userObjectID.get(row.objectID).view,
                    change: !!row.change || userObjectID.get(row.objectID).change,
                    makeTask: !!row.makeTask || userObjectID.get(row.objectID).makeTask,
                    changeInteractions: !!row.changeInteractions || userObjectID.get(row.objectID).changeInteractions
                });
            }
        });

        objectRightsCallbacksQueue.forEach(callback => callback());
        objectRightsCallbacksQueue.clear();
        //log.info('Loading objects rights from DB to cache is complete. Loaded ', rows.length, ' roles.');
    });
}

/**
 * Checking user rights for specific object IDs
 * @param {Object} param parameters
 * @param {string} param.user username
 * @param {Array} param.IDs array of the object IDs for check rights.
 *  Can be an array of objects IDs or array of objects, like [{id:.., name:..., ...}, {}]
 * @param {boolean} [param.checkView] check rights to view object (default, if nothing set to check)
 * @param {boolean} [param.checkChange] check rights to change object
 * @param {boolean} [param.checkMakeTask] check rights able to make a task
 * @param {boolean} [param.checkChangeInteractions] check rights for change interactions for objects
 * @param {boolean} [param.errorOnNoRights] generate an error when the user does not have rights to some objects
 * @param {function(err)|function(null, Array)} callback callback(err, checkedObjectsIDs) where
 *  checkedObjectsIDs is an array of the object IDs
 */
rightsDB.checkObjectsIDs = function(param, callback) {

    loadObjectsRights(function (err) {
        if(err) return callback(err);

        var user = param.user;
        var errOnNoRights = param.errorOnNoRights ?
            new Error('You are not allowed to make operation with some of selected objects: ' +
                JSON.stringify(param.IDs, null, 4)) :
            null;

        if(!objectsRights.has(user)) return callback(errOnNoRights, []);

        if(!param.checkView && !param.checkChange && !param.checkMakeTask && !param.checkChangeInteractions) {
            param.checkView = true;
        }

        var uncheckedObjectIDs = param.IDs;
        var checkedObjectIDs = [];
        var userObjectsRights = objectsRights.get(user);

        // some optimisation for users with default rights only (objectID === null), i.e.
        // when objectsRights for specific <user> has only default rights for all objects, like this
        // Map(<user>, Map(<null>, {..some rights..}).
        // In this case we are check rights only for the first object from an array of param.IDs,
        // because other objects has a same rights
        if(uncheckedObjectIDs.length > 2 && userObjectsRights.size === 1 && userObjectsRights.get(null)) {
            uncheckedObjectIDs = [param.IDs[0]];
            // use slice (not splice) for save an array param.IDs unchanged
            checkedObjectIDs = param.IDs.slice(1);
        }

        for(var i = 0; i < uncheckedObjectIDs.length; i++) {

            var objectID = typeof uncheckedObjectIDs[i] === 'object' && uncheckedObjectIDs[i].id ?
                uncheckedObjectIDs[i].id : uncheckedObjectIDs[i];

            var rights = userObjectsRights.get(objectID) || userObjectsRights.get(null);
            var hasRights = true;

            if(param.checkView && !rights.view) hasRights = false;
            if(param.checkChange && !rights.change) hasRights = false;
            if(param.checkMakeTask && !rights.makeTask) hasRights = false;
            if(param.checkChangeInteractions && !rights.changeInteractions) hasRights = false;

            if(!hasRights && param.errorOnNoRights) return callback(errOnNoRights);
            if(hasRights) checkedObjectIDs.push(uncheckedObjectIDs[i]);
        }
        callback(null, checkedObjectIDs);
    })
};

/**
 * It is used only in various actions and does not need caching
 * Checking user rights for a specific counter.
 * If the user does not have rights to the linked objects with the counter, then the user also does not have
 * rights to the counter.
 * @param {Object} param parameters
 * @param {string} param.user username
 * @param {number} param.id counterID
 * @param {boolean} [param.checkView] check rights to view object (default, if nothing set to check)
 * @param {boolean} [param.checkChange] check rights to change object
 * @param {boolean} [param.checkChangeInteractions] check rights for change interactions for objects
 * @param {boolean} [param.errorOnNoRights] generate an error when the user does not have rights to some objects
 *  linked with a specific counter
 * @param {function(Error)|function()|function(null, number)} callback callback(err, counterID) counterID will be
 *      undefined if check failed
 * @return {*}
 */
rightsDB.checkCounterID = function(param, callback) {
    if(!param.id) return callback();

    db.all('SELECT objectID FROM objectsCounters WHERE counterID=?', param.id, function(err, rows) {
        if(err) return callback(new Error('Can\'t get objects IDs for counter ID: ' + param.id + ': ' + err.message));

        // Cant find objects linked to the counter
        if(!rows.length) return callback(null, param.id);

        var newParams = {};
        for(var key in param) newParams[key] = param[key];
        newParams.IDs = rows.map(row => row.objectID);

        rightsDB.checkObjectsIDs(newParams, function(err, objectsIDs) {
            if(err) return callback(err);

            if(objectsIDs.length) return callback(null, param.id);

            callback();
        })
    });
};

/**
 * Checking user rights for counters.
 * If the user does not have rights to the linked objects with the counters, then the user also does not have
 * rights to the counters.
 * @param {Array} counters counters array like [{id:..,... }, ...] or [<counterID1>, <counterID2>,...]
 * @param {Object} param parameters
 * @param {string} param.user username
 * @param {boolean} [param.checkView] check rights to view object (default, if nothing set to check)
 * @param {boolean} [param.checkChange] check rights to change object
 * @param {boolean} [param.checkChangeInteractions] check rights for change interactions for objects
 * @param {boolean} [param.errorOnNoRights] generate an error when the user does not have rights to some objects
 *  linked with a specific counter
 * @param {function(Error)|function()|function(null, Array)} callback callback(err, checkedCountersIDs), where
 *     checkedCountersIDs is an array with counters elements or undefined if check failed
 */
rightsDB.checkCountersIDs = function(counters, param, callback) {

    var checkedCountersIDs = [];
    async.eachSeries(counters, function(counter, callback) {
        var newParams = {};
        for(var key in param) newParams[key] = param[key];
        newParams.id = counter.id ? counter.id : counter;
        rightsDB.checkCounterID(newParams, function(err, counterID) {
            if(err) return callback(err);
            if(counterID) checkedCountersIDs.push(counter);
            callback();
        });
    }, function(err) {
        if(err) return callback(new Error('Error occurred while checking rights for counters : ' + err.message +
            '; counters for check: ' + JSON.stringify(counters, null, 4)));
        callback(null, checkedCountersIDs);
    });
};

/**
 * Get rights for all actions for users
 * @param {function(err)|function(null, Set)} callback callback(err, actionsRights), where actionsRights is an Set()
 * of the objects like
 * [{username: <username>, userID: <userID>, actionName: <actionID or actionFolder or null>,
 * view: [0|1], run: [0|1], makeTask: [0|1], audit: [0|1]}...]
 */
rightsDB.getRightsForActions = function(callback) {
    if(lastTimeWhenLoadedActionsRightsFromDB > Date.now() - webServerCacheExpirationTime()) {
        return callback(null, actionsRights);
    }
    lastTimeWhenLoadedActionsRightsFromDB = Date.now();

    actionsRightsCallbacksQueue.add(callback);
    if(actionsRightsCallbacksQueue.size > 1) return;

    db.all('\
SELECT users.name AS username, users.id AS userID, rightsForActions.actionName AS actionName, rightsForActions.view AS view, \
rightsForActions.run AS run, rightsForActions.makeTask AS makeTask, rightsForActions.audit AS audit \
FROM rightsForActions \
JOIN usersRoles ON usersRoles.roleID=rightsForActions.roleID \
JOIN users ON users.id=usersRoles.userID \
WHERE users.isDeleted = 0', function(err, rows) {
        if(Array.isArray(rows) && rows.length) actionsRights = new Set(rows);

        actionsRightsCallbacksQueue.forEach(callback => callback(err, actionsRights));
        actionsRightsCallbacksQueue.clear();
    });
}