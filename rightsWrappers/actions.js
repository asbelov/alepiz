/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var prepareUser = require('../lib/utils/prepareUser');
var rightsDB = require('../models_db/usersRolesRightsDB');
var log = require('../lib/log')(module);
var objectsDB = require('../models_db/objectsDB');
var objectsProperties = require('../models_db/objectsPropertiesDB');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');

var systemUser = conf.get('systemUser') || 'system';


var rightsWrapper = {};
module.exports = rightsWrapper;
/*
Checking user rights for specific action
  initUser - unchecked username from req.session.username
  actionID - action ID (directory name for action) or actions folder from Actions menu
  executionMode - one of:
     null - don't check, only return rights
    'server' (run action);
    'ajax' (view action);
    'makeTask' (create task using this action)
  callback(err) - if no err, then user has requirement right for action
 */
rightsWrapper.checkActionRights = function (initUser, actionID, executionMode, callback) {
    var user = prepareUser(initUser);

    // user 'system' has all rights for all actions
    if(user === systemUser) return callback(null, {view: 1, run: 1, makeTask: 1});

    var actionsLayout = confActions.get('layout');
    for (var actionFolder in actionsLayout) {
        if (Object.keys(actionsLayout[actionFolder]).indexOf(actionID) !== -1) break;
    }

    if(!actionFolder) return callback(new Error('Can\'t find action folder for action ' + actionID + ', user: ' + user));

    rightsDB.checkActionRights(user, actionID, actionFolder, function(err, rightsRows) {
        if(err) {
            return callback(new Error('Can\'t check rights for action "' + actionID + '", action folder "' +
                actionFolder + '", user "' + user + '": ' + err.message));
        }

        if(!rightsRows.length) {
            return callback(new Error('Can\'t find user "' + user + '" for checking rights for action "' + actionID + '"'));
        }

        var rights = {
            view: 0,
            run: 0,
            makeTask: 0,
            priority: 0,
        };
        // when the user has more than one role, the query will return more than one row
        // priority:
        //      1 if the action does not exist in the rightsAction table,
        //      2 if this is an action group,
        //      3 if this is an action.
        rightsRows.forEach(function (row) {
            // if the priority of the row is higher than the priority of rights, then replace the rights to the row
            if(rights.priority < row.priority) rights = row;
            else if(rights.priority === row.priority) {
                // if the priority of the row is equal to the priority of the rights, then set the lowest of the found rights
                for (var key in rights) {
                    if(rights[key] > row[key]) rights[key] = row[key];
                }
            }
        });

        delete rights.priority;

        //log.debug('Execution mode: ',executionMode, '; user: ', user, '; rights: ', rights);

        if(executionMode === null) return callback(null, rights);

        if(executionMode === 'ajax') {
            if (!rights.view) return callback(new Error('User "' + user + '" doesn\'t have rights for view action "' + actionID + '"'));
            else return callback(null, rights);
        }
        if(executionMode === 'server') {
            if (!rights.run) return callback(new Error('User "' + user + '" doesn\'t have rights for run action "' + actionID + '"'));
            else return callback(null, rights);
        }
        if(executionMode === 'makeTask') {
            if (!rights.makeTask) return callback(new Error('User "' + user + '" doesn\'t have rights for create task with action "' + actionID + '"'));
            else return callback(null, rights);
        }

        callback(new Error('Can\'t check rights for action "'+actionID+'", user "'+user+'": unknown execution mode ' + executionMode));
    });
};

/*
 checking action for compatibility with selected objects according action configuration parameters:
 dontShowForObjects, dontShowForObjectsInGroups, showOnlyForObjects, showOnlyForObjectsInGroups

 checking is case-insensitive

 cfg: action configuration
 objectsNames - array of objects names for checking compatibility

 callback(err)

 if err, then error occurred or checkResult is false

 function check compatibility using algorithm:
 1. check, is dontShowForObjects contains selected objects.
 if yes, then check not passed
 if no then continue
 2. check, is some of selected objects are included in objects in dontShowForObjectsInGroups.
 if yes then check not passed
 if no then continue
 3. check, is showOnlyForObjects contains selected objects or
 is some of selected objects are included in objects in showForObjectsInGroups
 if no then check not passed
 */

rightsWrapper.checkForObjectsCompatibility = function (cfg, objectsNames, callback){

    if(!cfg || !cfg.actionID)
        return callback(new Error('Configuration for action is not passed check for objects compatibility'));

    var actionID = cfg.actionID;

    if(typeof (objectsNames) === 'string'){
        if(objectsNames) {
            try {
                var objects = JSON.parse(objectsNames);
            }
            catch (err) {
                objects = objectsNames.split(',');
            }
        } else objectsNames = [];
        objectsNames = objects;
    }

    if(Array.isArray(objectsNames)) {
        objectsNames = objectsNames.map(function (object) {
            return typeof object === 'string' ? object : object.name
        });
    } else objectsNames = [];

    // filter undefined, null or "" objects names from array
    objectsNames = objectsNames.filter(function(objectName) {
        return objectName;
    });
    if(!objectsNames || !objectsNames.length) {
        if (cfg.showWhenNoObjectsSelected) return callback();
        return callback(new Error('Action "' + actionID + '" don\'t showing while no one objects are selected according to showWhenNoObjectsSelected parameter'));
    }

    checkForObjectsPropertiesCompatibility(cfg, objectsNames, function (err) {
        if(err) return callback(err);

        objectsNames = objectsNames.map(function(object){
            if(object) return object.toLowerCase();
            return '';
        });

        if(cfg.dontShowForObjects) {
            objects = cfg.dontShowForObjects.toLowerCase().split(/\s*[,;]\s*/);
            for (var i = 0; i < objectsNames.length; i++) {
                if (objects.indexOf(objectsNames[i]) > -1)
                    return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to dontShowForObjects parameter'));
            }
            return callback();
        }

        if(cfg.dontShowForObjectsInGroups) {
            var groupsNames = cfg.dontShowForObjectsInGroups.toLowerCase().split(/\s*[,;]\s*/);
            objectsDB.getObjectsFromGroups(groupsNames, objectsNames, function(err, objects){
                if(err) return callback(err);
                if(!objects.length) return checkForShowOnlyForObjectsOrForObjectsInGroups(callback);
                return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                    objectsNames.join(', ') + ' according to dontShowForObjectsInGroups parameter'));
            });
            return;
        }

        checkForShowOnlyForObjectsOrForObjectsInGroups(callback);
    })

    // function, because check it two times in a different places
    function checkForShowOnlyForObjectsOrForObjectsInGroups(callback){
        if(!cfg.showOnlyForObjects && !cfg.showOnlyForObjectsInGroups) return callback();

        if(cfg.showOnlyForObjectsInGroups){
            var groupsNames = cfg.showOnlyForObjectsInGroups.toLowerCase().split(/\s*[,;]\s*/);
            objectsDB.getObjectsFromGroups(groupsNames, objectsNames, function(err, objects){
                if(err) return callback(err);
                if(objects.length === objectsNames.length) return callback();
                if(!cfg.showOnlyForObjects)
                    return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to showForObjectsInGroups parameter'));

                var objectsNotInGroups = objectsNames.filter(function(object){
                    if(objects.indexOf(object) === -1) return object;
                });

                log.debug('All selected objects: ', objectsNames, ', Objects in group: ', objects, ', ' +
                    'Objects not in group: ', objectsNotInGroups);
                objects = cfg.showOnlyForObjects.toLowerCase().split(/\s*[,;]\s*/);
                for (i = 0; i < objectsNotInGroups.length; i++) {
                    if (objects.indexOf(objectsNotInGroups[i]) === -1)
                        return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                            objectsNames.join(', ') + ' according to showForObjectsInGroups and showForObjects parameters'));
                }
                return callback();
            });
            return;
        }

        if(cfg.showOnlyForObjects) {
            var objects = cfg.showOnlyForObjects.toLowerCase().split(/\s*[,;]\s*/);
            for (var i = 0; i < objectsNames.length; i++) {
                if (objects.indexOf(objectsNames[i]) === -1)
                    return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to showForObjects parameter'));
            }
            callback();
        }
    }
};

function checkForObjectsPropertiesCompatibility(cfg, objectsNames, callback) {
    var actionID = cfg.actionID,
        dontShowForObjectsWithProperties = cfg.dontShowForObjectsWithProperties ?
            cfg.dontShowForObjectsWithProperties.toLowerCase().split(/\s*[,;]\s*/) : [],
        showOnlyForObjectsWithProperties = cfg.showOnlyForObjectsWithProperties ?
            cfg.showOnlyForObjectsWithProperties.toLowerCase().split(/\s*[,;]\s*/) : [];

    if(!showOnlyForObjectsWithProperties.length && !dontShowForObjectsWithProperties.length) return callback();

    objectsDB.getObjectsByNames(objectsNames, function (err, rows) {
        if(err) {
            return callback(new Error('Can\'t get objects by names ' + objectsNames.join(', ') +
                ' for checking action right for ' + actionID + ': ' + err.message));
        }
        var objectsIDs = rows.map(function (obj) {
            return obj.id;
        });

        objectsProperties.getProperties(objectsIDs, function (err, rows) {
            if(err) {
                return callback(new Error('Can\'t get objects properties for objects ' + objectsNames.join(', ') +
                    ' for checking action right for ' + actionID + ': ' + err.message));
            }
            for(var i = 0; i < rows.length; i++) {
                if(dontShowForObjectsWithProperties.indexOf(rows[i].name.toLowerCase()) !== -1) {
                    return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to dontShowForObjectsWithProperties parameter'));
                }
                if(!cfg.dontShowForObjectsWithProperties &&
                    showOnlyForObjectsWithProperties.indexOf(rows[i].name.toLowerCase()) !== -1) return callback();
            }
            if(cfg.dontShowForObjectsWithProperties || !cfg.showOnlyForObjectsWithProperties) return callback();

            return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
                objectsNames.join(', ') + ' according to showOnlyForObjectsWithProperties parameter'));
        });
    });
}