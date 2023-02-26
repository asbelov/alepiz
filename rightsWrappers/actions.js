/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var prepareUser = require('../lib/utils/prepareUser');
var rightsDB = require('../models_db/usersRolesRightsDB');
var objectsDB = require('../models_db/objectsDB');
var objectsProperties = require('../models_db/objectsPropertiesDB');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');

var systemUser = conf.get('systemUser') || 'system';

var rightsWrapper = {};
module.exports = rightsWrapper;

/**
 * Check user rights for specific action
 * @param {string} username username
 * @param {string} actionIDOrFolder action ID (action dir name) or actions folder from Actions menu
 * @param {string|null} executionMode one of:
 *      null - don't check, only return rights
 *     'server' (run action);
 *     'ajax' (view action);
 *     'makeTask' (create task with specific action)
 * @param {function(Error)|function(null, Object)} callback callback(err, rights) err when err or no rights. rights is
 * object like {view: 0|1, run: 0|1, makeTask: 0|1,}
 */
rightsWrapper.checkActionRights = function (username, actionIDOrFolder, executionMode, callback) {
    username = prepareUser(username);

    // the user 'system' has full rights to all actions
    if(username === systemUser) return callback(null, {view: 1, run: 1, makeTask: 1});

    var actionsLayout = confActions.get('layout');
    for (var actionFolder in actionsLayout) {
        if (Object.keys(actionsLayout[actionFolder]).indexOf(actionIDOrFolder) !== -1) break;
    }

    if(!actionFolder) {
        return callback(new Error('Can\'t find action folder for action ' + actionIDOrFolder + ', user: ' + username));
    }

    rightsDB.getRightsForActions(function(err, setWithActionsRights) {
        if(err) {
            return callback(new Error('Error getting rights for all actions for check rights for action "' +
                actionIDOrFolder + '", action folder "' + actionFolder + '", user "' + username + '": ' + err.message));
        }

        var rights  = {
            view: 0,
            run: 0,
            makeTask: 0,
            priority: 0,
        };

        setWithActionsRights.forEach(row => {
            if(username !== row.username) return;

            // low priority: default user rights to all actions are set
            var currentPriority = 1;
            // medium priority: the user rights to a actions in the action folder are set
            if (row.actionName === actionFolder) currentPriority = 2;
            // high priority: the user rights to specific action are set
            else if (row.actionName === actionIDOrFolder) currentPriority = 3;

            if(rights.priority < currentPriority) {
                rights = {
                    view: row.view,
                    run: row.run,
                    makeTask: row.makeTask,
                    priority: currentPriority,
                }
            } else if(rights.priority === currentPriority) {
                rights = {
                    view: row.view || rights.view,
                    run: row.run || rights.view,
                    makeTask: row.makeTask || rights.view,
                    priority: currentPriority,
                }
            }
        });

        log.debug('Execution mode: ',executionMode, '; user: ', username, '; rights: ', rights);
        delete rights.priority;

        if(executionMode === null) return callback(null, rights);

        if(executionMode === 'ajax') {
            if (!rights.view) return callback(new Error('User "' + username + '" doesn\'t have rights for view action "' + actionIDOrFolder + '"'));
            else return callback(null, rights);
        }
        if(executionMode === 'server') {
            if (!rights.run) return callback(new Error('User "' + username + '" doesn\'t have rights for run action "' + actionIDOrFolder + '"'));
            else return callback(null, rights);
        }
        if(executionMode === 'makeTask') {
            if (!rights.makeTask) return callback(new Error('User "' + username + '" doesn\'t have rights for create task with action "' + actionIDOrFolder + '"'));
            else return callback(null, rights);
        }

        callback(new Error('Can\'t check rights for action "' + actionIDOrFolder + '", user "' + username +
            '": unknown execution mode ' + executionMode));
    });
};

/**
 * checking action for compatibility with selected objects according action configuration parameters:
 *  dontShowForObjects, dontShowForObjectsInGroups, showOnlyForObjects, showOnlyForObjectsInGroups
 *  checking is case-insensitive
 * @param {Object} cfg action configuration
 * @param {Array|string} objectsNames array or stringified array of yhe object names for check action compatibility
 * @param {function(Error)|function()} callback callback(err) if err, then error occurred or checkResult is false
 *
 * @example
 * function check compatibility using algorithm:
 *  1. check, is dontShowForObjects contains selected objects.
 *    if yes, then check not passed
 *    if no then continue
 *  2. check, is some of selected objects are included in objects in dontShowForObjectsInGroups.
 *    if yes then check not passed
 *    if no then continue
 *  3. check, is showOnlyForObjects contains selected objects or
 *    is some of selected objects are included in objects in showForObjectsInGroups
 *  if no then check not passed
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
        return callback(new Error('Action "' + actionID +
            '" don\'t showing while no one objects are selected according to showWhenNoObjectsSelected parameter'));
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

/**
 * Check for object properties compatibility with specific action
 * @param {Object} cfg action configuration
 * @param {Array} objectsNames array of yhe object names for check action compatibility
 * @param {function(Error)|function()} callback callback(err) if err, then error occurred or checkResult is false
 */
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