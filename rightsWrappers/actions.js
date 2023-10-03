/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var prepareUser = require('../lib/utils/prepareUser');
var rightsDB = require('../models_db/usersRolesRightsDB');
var objectsDB = require('../models_db/objectsDB');
var objectsProperties = require('../models_db/objectsPropertiesDB');
const webServerCacheExpirationTime = require('../serverWeb/webServerCacheExpirationTime');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');

var systemUser = conf.get('systemUser') || 'system';

var rightsWrapper = {};
module.exports = rightsWrapper;

var objectPropertiesCache = new Map();

/**
 * Check user rights for specific action
 * @param {string|number} user username or userID
 * @param {string} actionIDOrFolder action ID (action dir name) or actions folder from Actions menu
 * @param {string|null} executionMode one of:
 *      null - don't check, only return rights
 *     'server' (run action);
 *     'ajax' (view action);
 *     'makeTask' (create task with specific action)
 *     'audit' (allow to view the execution log from auditDB for non-own actions)
 * @param {function(Error)|function(null, Object)} callback callback(err, rights) err when err or no rights. rights is
 * object like {view: 0|1, run: 0|1, makeTask: 0|1, audit: 0|1}
 */
rightsWrapper.checkActionRights = function (user, actionIDOrFolder, executionMode, callback) {
    if(typeof user === 'string') user = prepareUser(user);

    // the user 'system' has full rights to all actions
    if(user === systemUser || user === 0) return callback(null, {view: 1, run: 1, makeTask: 1, audit: 0});

    var actionsLayout = confActions.get('layout');
    for (var actionFolder in actionsLayout) {
        if (Object.keys(actionsLayout[actionFolder]).indexOf(actionIDOrFolder) !== -1) break;
    }

    if(!actionFolder) {
        return callback(new Error('Can\'t find action folder for action ' + actionIDOrFolder + ', user: ' + user));
    }

    rightsDB.getRightsForActions(function(err, setWithActionsRights) {
        if(err) {
            return callback(new Error('Error getting rights for all actions for check rights for action "' +
                actionIDOrFolder + '", action folder "' + actionFolder + '", user "' + user + '": ' + err.message));
        }

        var rights  = {
            view: 0,
            run: 0,
            makeTask: 0,
            audit: 0,
            priority: 0,
        };

        setWithActionsRights.forEach(row => {
            if(user !== row.username && user !== row.userID) return;

            var currentPriority = 0;
            // low priority: default user rights to all actions are set
            if (row.actionName === null) currentPriority = 1;
            // medium priority: the user rights to a actions in the action folder are set
            else if (row.actionName === actionFolder) currentPriority = 2;
            // high priority: the user rights to specific action are set
            else if (row.actionName === actionIDOrFolder) currentPriority = 3;

            if(rights.priority < currentPriority) {
                rights = {
                    view: row.view,
                    run: row.run,
                    makeTask: row.makeTask,
                    audit: row.audit,
                    priority: currentPriority,
                }
                //log.debug('!!!< action: ', actionIDOrFolder , '(', actionFolder, ') username: ', username, ', row: ', row, ', rights: ', rights)
            } else if(rights.priority === currentPriority) {
                rights = {
                    view: row.view || rights.view,
                    run: row.run || rights.run,
                    makeTask: row.makeTask || rights.makeTask,
                    audit: row.audit || rights.audit,
                    priority: currentPriority,
                }
                //log.debug('!!!== action: ', actionIDOrFolder , '(', actionFolder, ') username: ', username, ', row: ', row, ', rights: ', rights)
            }
        });

        log.debug(actionIDOrFolder, '(', actionFolder, '): execution mode: ',executionMode, '; user: ', user,
            '; rights: ', rights, {
                /**
                 * @param {{EXPECTED_USERNAME: string, USERNAME: string}} vars
                 * @return {boolean}
                 */
            func: (vars) => vars.EXPECTED_USERNAME === vars.USERNAME,
            vars: {
                "EXPECTED_USERNAME": user,
            }
        });
        delete rights.priority;

        if(executionMode === null) return callback(null, rights);

        if(executionMode === 'ajax') {
            if (!rights.view) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for view action "' +
                    actionIDOrFolder + '"'));
            } else return callback(null, rights);
        }
        if(executionMode === 'server') {
            if (!rights.run) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for run action "' +
                    actionIDOrFolder + '"'));
            } else return callback(null, rights);
        }
        if(executionMode === 'makeTask') {
            if (!rights.makeTask) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for create task with action "' +
                    actionIDOrFolder + '"'));
            } else return callback(null, rights);
        }
        if(executionMode === 'audit') {
            if (!rights.audit) {
                return callback(new Error('User "' + user + '" doesn\'t have rights to view the audit ' +
                    'of non-own action "' + actionIDOrFolder + '"'));
            } else return callback(null, rights);
        }

        callback(new Error('Can\'t check rights for action "' + actionIDOrFolder + '", user "' + user +
            '": unknown execution mode ' + executionMode));
    });
};

/**
 * checking action for compatibility with selected objects according action configuration parameters:
 *  dontShowForObjects, dontShowForObjectsInGroups, showOnlyForObjects, showOnlyForObjectsInGroups
 *  checking is case-insensitive
 * @param {Object} actionCfg action configuration
 * @param {Array<{id: number, name: string}>} objects array of object names for check action compatibility
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
rightsWrapper.checkForObjectsCompatibility = function (actionCfg, objects, callback){

    if(!actionCfg || !actionCfg.actionID)
        return callback(new Error('Configuration for action is not passed check for objects compatibility'));

    var actionID = actionCfg.actionID;

    if(Array.isArray(objects)) {
        objects.filter(o =>
            o.id && o.id === parseInt(String(o.id), 10) && o.name && typeof o.name === 'string');
        var objectsNames = objects.map(o => o.name);
    } else {
        objectsNames = [];
    }

    if(!objectsNames || !objectsNames.length) {
        if (actionCfg.showWhenNoObjectsSelected) return callback();
        return callback(new Error('Action "' + actionID +
            '" don\'t showing while no one objects are selected according to showWhenNoObjectsSelected parameter'));
    }

    checkForObjectsPropertiesCompatibility(actionCfg, objects, function (err) {
        if(err) return callback(err);

        objectsNames = objectsNames.map(function(object){
            if(object) return object.toLowerCase();
            return '';
        });

        if(actionCfg.dontShowForObjects) {
            var dontShowObjectNames = actionCfg.dontShowForObjects.toLowerCase().split(/ *[,;] */);
            for (var i = 0; i < objectsNames.length; i++) {
                if (dontShowObjectNames.indexOf(objectsNames[i]) > -1)
                    return callback(new Error('Action "' + actionID + '" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to dontShowForObjects parameter'));
            }
            return callback();
        }

        if(actionCfg.dontShowForObjectsInGroups) {
            var groupsNames = actionCfg.dontShowForObjectsInGroups.toLowerCase().split(/\s*[,;]\s*/);
            objectsDB.getObjectsFromGroups(groupsNames, objectsNames, function(err, objectNamesFromGroups){
                if(err) return callback(err);
                if(!objectNamesFromGroups.length) {
                    return checkForShowOnlyForObjectsOrForObjectsInGroups(actionCfg, objectsNames, callback);
                }
                return callback(new Error('Action "' + actionID + '" is not compatible with selected objects ' +
                    objectsNames.join(', ') + ' according to dontShowForObjectsInGroups parameter'));
            });
            return;
        }

        checkForShowOnlyForObjectsOrForObjectsInGroups(actionCfg, objectsNames, callback);
    })
};

/**
 * Check for objects compatibility with specific action
 * @param {Object} actionCfg action configuration
 * @param {Array<string>} objectsNames an array with object names
 * @param {function(Error)|function()} callback
 */
function checkForShowOnlyForObjectsOrForObjectsInGroups(actionCfg, objectsNames, callback){
    if(!actionCfg.showOnlyForObjects && !actionCfg.showOnlyForObjectsInGroups) return callback();

    if(actionCfg.showOnlyForObjectsInGroups) {
        var groupsNames = actionCfg.showOnlyForObjectsInGroups.toLowerCase().split(/ *[,;] */);
        objectsDB.getObjectsFromGroups(groupsNames, objectsNames, function(err, objectNamesFromGroups){
            if(err) return callback(err);
            if(objectNamesFromGroups.length === objectsNames.length) return callback();
            if(!actionCfg.showOnlyForObjects)
                return callback(new Error('Action "' + actionCfg.actionID + '" is not compatible with selected objects ' +
                    objectsNames.join(', ') + ' according to showForObjectsInGroups parameter'));

            var objectsNotInGroups = objectsNames.filter(function(object){
                if(objectNamesFromGroups.indexOf(object) === -1) return object;
            });

            log.debug('All selected objects: ', objectsNames, ', Objects in group: ', objectNamesFromGroups, ', ' +
                'Objects not in group: ', objectsNotInGroups);
            var showOnlyForObjectNames = actionCfg.showOnlyForObjects.toLowerCase().split(/ *[,;] */);
            for (i = 0; i < objectsNotInGroups.length; i++) {
                if (showOnlyForObjectNames.indexOf(objectsNotInGroups[i]) === -1)
                    return callback(new Error('Action "' + actionCfg.actionID +
                        '" is not compatible with selected objects ' +
                        objectsNames.join(', ') + ' according to showForObjectsInGroups and showForObjects parameters'));
            }
            return callback();
        });
        return;
    }

    if(actionCfg.showOnlyForObjects) {
        var showOnlyForObjectNames = actionCfg.showOnlyForObjects.toLowerCase().split(/ *[,;] */);
        for (var i = 0; i < objectsNames.length; i++) {
            if (showOnlyForObjectNames.indexOf(objectsNames[i]) === -1)
                return callback(new Error('Action "' + actionCfg.actionID +
                    '" is not compatible with selected objects ' +
                    objectsNames.join(', ') + ' according to showForObjects parameter'));
        }
        callback();
    }
}

/**
 * Check for object properties compatibility with specific action
 * @param {Object} actionCfg action configuration
 * @param {Array<{id: number, name: string}>} objects array of the object for check action compatibility
 * @param {function(Error)|function()} callback callback(err) if err, then error occurred or checkResult is false
 */
function checkForObjectsPropertiesCompatibility(actionCfg, objects, callback) {
    var actionID = actionCfg.actionID,
        dontShowForObjectNamesWithProperties = actionCfg.dontShowForObjectsWithProperties ?
            actionCfg.dontShowForObjectsWithProperties.toLowerCase().split(/ *[,;] */) : [],
        showOnlyForObjectNamesWithProperties = actionCfg.showOnlyForObjectsWithProperties ?
            actionCfg.showOnlyForObjectsWithProperties.toLowerCase().split(/ *[,;] */) : [];

    if(!showOnlyForObjectNamesWithProperties.length && !dontShowForObjectNamesWithProperties.length) {
        return callback();
    }

    var objectsIDs = objects.map(o => o.id);

    getObjectProperties(function (err, objectProperties) {
        if(err) {
            return callback(new Error('Can\'t get objects properties for objects ' +
                objects.map(o => o.name).join(', ') +
                ' for checking action right for ' + actionID + ': ' + err.message));
        }
        for(var i = 0; i < objectProperties.length; i++) {
            if(objectsIDs.indexOf(objectProperties[i].objectID) === -1) continue;

            if(dontShowForObjectNamesWithProperties.indexOf(objectProperties[i].name.toLowerCase()) !== -1) {
                return callback(new Error('Action "' + actionID + '" is not compatible with selected objects ' +
                    objects.map(o => o.name).join(', ') +
                    ' according to dontShowForObjectsWithProperties parameter'));
            }
            if(!actionCfg.dontShowForObjectsWithProperties &&
                showOnlyForObjectNamesWithProperties.indexOf(objectProperties[i].name.toLowerCase()) !== -1) {
                return callback();
            }
        }
        if(actionCfg.dontShowForObjectsWithProperties || !actionCfg.showOnlyForObjectsWithProperties) {
            return callback();
        }

        return callback(new Error('Action "'+actionID+'" is not compatible with selected objects ' +
            objects.map(o => o.name).join(', ') +
            ' according to showOnlyForObjectsWithProperties parameter'));
    });
}

/**
 * Get properties for all objects ans save to the cache
 * @param {function(Error, Array<{
 *      id: number,
 *      objectID: number,
 *      name: string,
 *      value: string,
 *      description: string,
 *      mode: number
 *      }>)} callback callback(err, objectProperties)
 */
function getObjectProperties(callback) {
    var timestamp = objectPropertiesCache.get('timestamp');

    if(timestamp && timestamp > Date.now() - webServerCacheExpirationTime()) {
        return callback(null, objectPropertiesCache.get('data'));
    }

    objectsProperties.getProperties(null, function (err, objectProperties) {
        if(objectProperties) {
            objectPropertiesCache.set('timestamp', Date.now());
            objectPropertiesCache.set('data', objectProperties);
        }

        callback(err, objectProperties);
    });
}