/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var db = require('./db');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');

//var systemUser = conf.get('systemUser') || 'system';
var reloadRightsInterval = ( conf.get('reloadRightsIntervalSec') || 180 ) * 1000;
var lastTimeWhenLoadedObjectRightsFromDB = 0;
var lastTimeWhenLoadedActionsRightsFromDB = 0;

var rightsDB = {};
module.exports = rightsDB;

var objectsRights = new Map(),
    actionsRights = new Set(),
    objectRightsCallbacksQueue = new Set(),
    actionsRightsCallbacksQueue = new Set();

// TODO: it's used for load changes from DB to cache, but it is not a good way
/**
 * Load object rights to cache
 * @param {function(err)|function()} callback callback(err)
 */
function loadObjectsRights(callback) {

    if(Date.now() - lastTimeWhenLoadedObjectRightsFromDB < reloadRightsInterval) return callback();
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
 * Checking user rights for specific objects IDs
 * @param {Object} param parameters
 * @param {string} param.user username
 * @param {Array} param.IDs array of the object IDs for check rights.
 *  Can be an array of objects IDs or array of objects, like [{id:.., name:..., ...}, {}]
 * @param {boolean} param.checkView check rights to view object (default, if nothing set to check)
 * @param {boolean} param.checkChange check rights to change object
 * @param {boolean} param.checkChangeInteractions check rights for change interactions for objects
 * @param {boolean} param.errorOnNoRights generate an error when the user does not have rights to some objects
 * @param {function(err)|function(null, Array)} callback callback(err, checkedObjectsIDs) where
 *  checkedObjectsIDs is an array of the object IDs
 */
rightsDB.checkObjectsIDs = function(param, callback) {

    loadObjectsRights(function (err) {
        if(err) return callback(err);

        var user = param.user;
        var errOnNoRights = param.errorOnNoRights ?
            new Error('You are not allowed to make operation with some of selected objects: ' + param.IDs.join(', ')) :
            null;

        if(!objectsRights.has(user)) return callback(errOnNoRights, []);

        if(!param.checkView && !param.checkChange && !param.checkMakeTask && !param.checkChangeInteractions) {
            param.checkView = true;
        }

        var uncheckedObjectIDs = param.IDs;
        var checkedObjectIDs = [];
        var userObjectsRights = objectsRights.get(user);

        // some optimisation for users with default rights only (objectID === null)
        if(uncheckedObjectIDs.length > 2 && userObjectsRights.size === 1 && userObjectsRights.get(null)) {
            uncheckedObjectIDs = [param.IDs[0]];
            checkedObjectIDs = param.IDs.splice(1);
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

/*
 Checking user rights for specific counter ID.
 If user has not rights for linked objects to counter, then user also has not rights to counter
 look at checkObjectsRightsWrapper description for other p.* values
 p.id - counter id for check
 p.errorOnNoRights - generate error when you have no rights for some objects counters
 callback(err, id): id is a counter id
 */
rightsDB.checkCounterID = function(p, callback) {
    if(!p.id) return callback();

    db.all('SELECT objectID FROM objectsCounters WHERE counterID=?', p.id, function(err, rows) {
        if(err) return callback(new Error('Can\'t get objects IDs for counter ID: ' + p.id + ': ' + err.message));

        // Cant find objects linked to the counter
        if(!rows.length) return callback(null, p.id);

        p.IDs = rows.map(function (row) {
            return row.objectID;
        });

        rightsDB.checkObjectsIDs(p, function(err, objectsIDs) {
            if(err) return callback(err);

            if(objectsIDs.length) return callback(null, p.id);

            callback();
        })
    });
};

/*
counters: array of counter IDs or array of objects {[id:...,..], [id:...,...], ...}
p: parameters
callback(err, checkedCounters), where checkedCounters created from counters array elements
 */
rightsDB.checkCountersIDs = function(counters, p, callback) {

    var checkedCountersIDs = [];
    async.each(counters, function(counter, callback) {
        p.id = counter.id ? counter.id : counter;
        rightsDB.checkCounterID(p, function(err, counterID) {
            if(err) return callback(err);
            if(counterID) checkedCountersIDs.push(counter);
            callback();
        });
    }, function(err) {
        if(err) return callback('Get error while checking rights for counters: ' + err.message);
        callback(null, checkedCountersIDs);
    });
};

/*
Get user rights for specific action

user: username
actionID: actionID (ie dir name for action)
actionFolder: Folder in actions menu for actions

callback(err, rights), where
rights: {view: <1|0>, run: <1|0>, makeTask: <1|0>}
rightsDB.checkActionRights = function(user, actionID, actionFolder, callback){

    // user 'system' has all rights for all actions
    if(user === systemUser) return callback(null, {view: 1, run: 1, makeTask: 1});

    db.all('\
SELECT rightsForActions.view AS view, rightsForActions.run AS run, rightsForActions.makeTask AS makeTask,\
CASE WHEN EXISTS (SELECT * FROM rightsForActions ra WHERE ra.actionName = $actionID AND usersRoles.roleID=ra.roleID) THEN 3 \
WHEN EXISTS (SELECT * FROM rightsForActions ra WHERE ra.actionName =  $actionFolder AND usersRoles.roleID=ra.roleID) THEN 2 \
ELSE 1 \
END AS priority \
FROM rightsForActions \
JOIN usersRoles ON usersRoles.roleID=rightsForActions.roleID \
JOIN users ON users.id=usersRoles.userID \
WHERE users.name = $user AND users.isDeleted = 0 AND \
CASE WHEN EXISTS (SELECT * FROM rightsForActions ra WHERE ra.actionName = $actionID AND usersRoles.roleID=ra.roleID) THEN \
rightsForActions.actionName = $actionID \
WHEN EXISTS (SELECT * FROM rightsForActions ra WHERE ra.actionName = $actionFolder AND usersRoles.roleID=ra.roleID) THEN \
rightsForActions.actionName = $actionFolder \
ELSE \
rightsForActions.actionName IS NULL \
END',
        {
            $user: user,
            $actionID: actionID,
            $actionFolder: actionFolder,
        },
        callback
    );
};
*/

/**
 * Get rights for all actions for users
 * @param {function(err)|function(null, Set)} callback callback(err, actionsRights), where actionsRights is an Set()
 * of the objects like
 * [{username: <username>, actionName: <actionID or actionFolder or null>, view: [0|1], run: [0|1], makeTask: [0|1]}, ...]
 */
rightsDB.getRightsForActions = function(callback) {
    if(Date.now() - lastTimeWhenLoadedActionsRightsFromDB < reloadRightsInterval) {
        return callback(null, actionsRights);
    }
    lastTimeWhenLoadedActionsRightsFromDB = Date.now();

    actionsRightsCallbacksQueue.add(callback);
    if(actionsRightsCallbacksQueue.size > 1) return;

    db.all('\
SELECT users.name AS username, rightsForActions.actionName AS actionName, rightsForActions.view AS view, \
rightsForActions.run AS run, rightsForActions.makeTask AS makeTask \
FROM rightsForActions \
JOIN usersRoles ON usersRoles.roleID=rightsForActions.roleID \
JOIN users ON users.id=usersRoles.userID \
WHERE users.isDeleted = 0', function(err, rows) {
        if(Array.isArray(rows) && rows.length) actionsRights = new Set(rows);

        actionsRightsCallbacksQueue.forEach(callback => callback(err, actionsRights));
        actionsRightsCallbacksQueue.clear();
    });
}