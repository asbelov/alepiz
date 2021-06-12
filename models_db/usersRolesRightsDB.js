/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var db = require('../lib/db');
var log = require('../lib/log')(module);
var conf = require('../lib/conf');
conf.file('config/conf.json');
var systemUser = conf.get('systemUser') || 'system';
var reloadRightsInterval = ( conf.get('reloadRightsIntervalSec') || 180 ) * 1000;

var rightsDB = {};
module.exports = rightsDB;

var objectsRights, callbacksQueue = [];

// reload rights from DB every reloadRightsIntervalSec milliseconds
// TODO: it's used for load changes from DB to cache, but it is not a good way
setInterval(function() {
    loadObjectsRights(function(err) {
        if(err) log.error(err.message);
    })
}, reloadRightsInterval);

function loadObjectsRights(callback) {

    callbacksQueue.push(callback);
    if(callbacksQueue.length > 1) return;

    db.all('\
SELECT users.name AS user, rightsForObjects.objectID AS objectID, rightsForObjects.view AS view, \
rightsForObjects.change AS change, rightsForObjects.makeTask AS makeTask, \
rightsForObjects.changeInteractions AS changeInteractions FROM users \
JOIN usersRoles ON users.id=usersRoles.userID \
JOIN rightsForObjects ON rightsForObjects.roleID=usersRoles.roleID \
WHERE isDeleted=0', function(err, rows) {
        if(err) {
            callbacksQueue.forEach(function (callback) {
                callback(new Error('Can\'t read rights for objects data from DB: ' + err.message));
            });
            callbacksQueue = [];
            return;
        }

        var _objectsRights = {};

        rows.forEach(function (row) {
            if(!_objectsRights[row.user]) _objectsRights[row.user] = {};
            if(row.objectID === null) row.objectID = 0;

            if(!_objectsRights[row.user][row.objectID]) {
                _objectsRights[row.user][row.objectID] = {
                    view: !!row.view,
                    change: !!row.change,
                    makeTask: !!row.makeTask,
                    changeInteractions: !!row.changeInteractions
                };
            } else {
                _objectsRights[row.user][row.objectID] = {
                    view: !!row.view || _objectsRights[row.user][row.objectID].view,
                    change: !!row.change || _objectsRights[row.user][row.objectID].change,
                    makeTask: !!row.makeTask || _objectsRights[row.user][row.objectID].makeTask,
                    changeInteractions: !!row.changeInteractions || _objectsRights[row.user][row.objectID].changeInteractions
                };
            }
        });

        objectsRights = _objectsRights;

        callbacksQueue.forEach(function (callback) {
            callback();
        });
        callbacksQueue = [];
        log.info('Loading objects rights from DB to cache is complete. Loaded ', rows.length, ' roles.');
    });
}

/*
 Checking user rights for specific objects IDs
 look at checkObjectsRightsWrapper description for other p.* values
 p.IDs - objects IDs for check, can be an array of objects IDs or array of objects, like [{id:.., name:..., ...}, {}]
 p.user - user name
 p.checkView  - check rights to view object (default, if nothing set to check)
 p.checkChange - check rights to change object
 p.checkMakeTask - check rights to make task with objects
 p.checkChangeInteractions - check rights for change interactions for objects
 p.errorOnNoRights - generate error when you has no rights for some objects
 callback(err, ids): ids is a array of the objects ids
 */
rightsDB.checkObjectsIDs = function(p, callback) {

    if(objectsRights) var myLoadObjectsRights = function(callback) { callback() };
    else myLoadObjectsRights = loadObjectsRights;

    myLoadObjectsRights(function (err) {
        if(err) return callback(err);

        var user = p.user;
        var errOnNoRights = p.errorOnNoRights ? new Error('You are not allowed to make operation with some of selected objects: ' + p.IDs.join(', ')) : null;
        if(!objectsRights[user]) return callback(errOnNoRights, []);

        if(!p.checkView && !p.checkChange && !p.checkMakeTask && !p.checkChangeInteractions) p.checkView = true;

        var uncheckedObjectsIDs = p.IDs;
        var checkedObjectsIDs = [];

        // some optimisation for users with default rights only
        if(uncheckedObjectsIDs.length > 2 && Object.keys(objectsRights[user]).length === 1 && objectsRights[user][0]) {
            uncheckedObjectsIDs = [p.IDs[0]];
            checkedObjectsIDs = p.IDs.splice(1);
        }

        for(var i = 0; i < uncheckedObjectsIDs.length; i++) {

            if(typeof uncheckedObjectsIDs[i] === 'object' && uncheckedObjectsIDs[i].id) var objectID = uncheckedObjectsIDs[i].id;
            else objectID = uncheckedObjectsIDs[i];

            var rights = objectsRights[user][objectID] ? objectsRights[user][objectID] : objectsRights[user][0];
            var hasRights = true;

            if(p.checkView && !rights.view) hasRights = false;
            if(p.checkChange && !rights.change) hasRights = false;
            if(p.checkMakeTask && !rights.makeTask) hasRights = false;
            if(p.checkChangeInteractions && !rights.changeInteractions) hasRights = false;

            if(!hasRights && p.errorOnNoRights) return callback(errOnNoRights);
            if(hasRights) checkedObjectsIDs.push(uncheckedObjectsIDs[i]);
        }
        callback(null, checkedObjectsIDs);
    })
};

/*
 Checking user rights for specific counter ID.
 If user has not rights for linked objects to counter, then user also has not rights to counter
 look at checkObjectsRightsWrapper description for other p.* values
 p.id - counters id for check
 p.errorOnNoRights - generate error when you has no rights for some objects counters
 callback(err, id): id is a counter id
 */
rightsDB.checkCounterID = function(p, callback) {

    db.all('SELECT objectID FROM objectsCounters WHERE counterID=?', p.id, function(err, rows) {

        if(err) return callback(new Error('Can\'t get objects IDs for counter ID: ' + p.id + ': ' + err.message));

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

user: user name
actionID: actionID (ie dir name for action)
actionFolder: Folder in actions menu for actions

callback(err, rights), where
rights: {view: <1|0>, run: <1|0>, makeTask: <1|0>}
*/
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


rightsDB.checkAuditsRights = function(user, sessionID, callback){
    db.get('SELECT auditUsers.timestamp AS timestamp, auditUsers.actionID AS actionID, auditUsers.actionName AS actionName ' +
        'FROM auditUsers ' +
        'JOIN users ON users.id=auditUsers.userID ' +
        'WHERE users.name=? AND auditUsers.sessionID=?', [user, sessionID], callback);
};

