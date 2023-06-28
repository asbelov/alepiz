/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require("async");
const path = require('path');
const actionsConf = require('../lib/actionsConf');
const rightsWrapperActions = require('../rightsWrappers/actions');
const tasksDB = require('../rightsWrappers/tasksDB');
const objectsDB = require('../models_db/objectsDB');
const runInThread = require('../lib/runInThread');
const thread = require('../lib/threads');
const usersRolesRightsDB = require('../models_db/usersRolesRightsDB');
const unique = require('../lib/utils/unique');

const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');
const confLaunchers = new Conf('config/launchers.json');
const confMyNode = new Conf('config/node.json');

var systemUser = conf.get('systemUser') || 'system';
var ajax = {}, launchers = {};
var objectsAlepizRelationsCache = new Set(), dataRcvTime = 0, cacheTimeout = 120000;

var serverNumber = confActions.get('serverNumber') || 0;

// if(module.parent) {} === if(require.main !== module) {}
if(serverNumber < 1 || require.main !== module) {
    module.exports = runAction;
} else {
    new thread.child({
        module: 'runAction',
        onMessage: runAction,
    });
}


/**
 * Execute action or run ajax or add action to a new task
 *
 * @param {Object} param object with action parameters
 * @param {string} param.actionID action directory name
 * @param {number} [param.taskID] taskID if action was running from the task
 * @param {number} [param.newTaskID] taskID of the not existed task when add action to the new task
 * @param {number} [param.taskSession] unique taskSession if action was running from the task
 * @param {string} param.executionMode="ajax"|"server"|"makeTask" action execution mode
 * @param {string} param.user username
 * @param {number} param.sessionID action session ID
 * @param {number} param.timestamp timestamp when the action was started
 * @param {Object} param.args object with action parameters, like {<name>: <value>, ...}
 * @param {Boolean} param.updateAction requirement to reload ajax.js and server.js
 * @param {function(Error)|function(null, *)} callback: callback(err, actionResult), where actionResult is result
 *  returned by action or data for ajax
 */
function runAction(param, callback) {
    var actionID = param.actionID;
    var executionMode = param.executionMode;

    if(!param.sessionID) param.sessionID = unique.createID();
    module.sessionID = param.sessionID;

    // checking in parallel for objects compatibility and user action rights
    actionsConf.getConfiguration(actionID, function(err, actionCfg) {
        if(err) return callback(err);

        if(!param.args) param.args = {};

        var objects = [], objectsNames = [];
        if(executionMode !== 'ajax') {
            if(!'o' in param.args || !param.args.o || typeof param.args.o !== 'string' || actionCfg.noObjectsRequired) {
                param.args.o = '[]';
            } else {
                try {
                    objects = JSON.parse(param.args.o);
                    // checking objects
                } catch (err) {
                    return callback(new Error('Error in action '+ actionID + ' parameter "o": can\'t parse "' +
                        param.args.o + '" to JSON: ' + err.message));
                }
                for (var i = 0; i < objects.length; i++) {
                    var ID = parseInt(objects[i].id, 10);
                    if (!isNaN(ID) && ID > 0 && objects[i].name && typeof (objects[i].name) === 'string') {
                        objects[i].id = ID;
                        objectsNames.push(objects[i].name);
                        continue;
                    }
                    return callback(new Error('In action ' + actionID +
                        ' some objects are incorrect in parameter "o": ' + param.args.o));
                }
            }
        }

        async.parallel([
            function(callback) {
                // check change objects rights only for the 'server' mode
                if(executionMode !== 'server') return callback();
                usersRolesRightsDB.checkObjectsIDs({
                    user: param.user,
                    IDs: objects,
                    checkChange: true,
                    errorOnNoRights: true
                }, function (err/*, IDs*/) {
                    if (err) {
                        return callback(new Error('User ' + param.user + ' has no rights for change objects ' +
                            param.args.o + ' by action ' + actionID + ' : ' + err.message));
                    }
                    callback();
                });
            },
            function(callback) {
                // we can't control, what action send to us by ajax
                if(executionMode === 'ajax') return callback();
                rightsWrapperActions.checkForObjectsCompatibility(actionCfg, objectsNames, callback);
            },

            function(callback) {
                // callback(err, rights {view:, run:, makeTask:, audit:}). if err, then user has not required rights
                rightsWrapperActions.checkActionRights(param.user, actionID, executionMode, callback);
            }
        ], function(err /*, result*/){
            if(err) return callback(err);

            // replace passwords in parameters
            var paramWithoutPassForPrintToLog = JSON.stringify(param,null, 4)
                .replace(/"(.*?pass.*?":)"[^"]*?"/gim, '$1"****"');

            if(param.user !== systemUser && executionMode === 'server') {
                log.info('Running action: ', actionID, ', parameters: ', paramWithoutPassForPrintToLog );
            } else { // don't log action start, running by for system users (which running automatically)
                log.debug('Running action: ', actionID, ', execution mode: ', executionMode,
                    ', parameters: ', paramWithoutPassForPrintToLog, {
                        func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
                        vars: {
                            "EXPECTED_ACTION_ID": param.actionID
                        }
                    });
            }

            if(executionMode === 'makeTask') {
                log.info('Saving action ', actionID, ' to the new task: ', param.args);

                // saving action parameters
                tasksDB.saveAction(param.user, param.taskID, param.newTaskID, actionID, param.args, callback);
            } else {
                param.args.actionName = actionCfg.name;
                param.args.actionID = actionID;
                param.args.hostPort = param.hostPort;
                param.args.username = param.user;
                param.args.timestamp = param.timestamp;
                param.args.actionCfg = actionCfg;

                if(executionMode === 'ajax') {
                    if(!confActions.get('dir')) {
                        return callback(new Error('Undefined "actions:dir" parameter in main configuration for ' +
                            actionID));
                    }
                    if(!actionCfg.ajaxServer) {
                        return callback(new Error('Undefined "ajaxServer" parameter in action configuration for ' +
                            actionID));
                    }

                    var ajaxSource = path.join(__dirname, '..', confActions.get('dir'),
                        actionID, actionCfg.ajaxServer);

                    updateActionAjax(ajaxSource, param.updateAction, actionCfg.startAjaxAsThread, function (err) {
                        if(err) return callback(err);

                        //try {
                        ajax[ajaxSource].func(param.args, callback);
                        /*} catch (err) {
                            callback(new Error('Error occurred while executing ajax for action "' + actionID + '": ' +
                                err.message + '; ajax: ' + JSON.stringify(ajax[ajaxSource]) + '; ' + err.stack));
                        }*/
                    })
                } else { //executionMode === 'server'
                    getOwnObjectIDs(objects, actionCfg,function (err, filteredObjects) {
                        if(err) return callback(err);

                        if(param.args.o && Array.isArray(filteredObjects)) {
                            if(param.user !== systemUser) {
                                // there are no objects for this action in this instance of Alepiz and
                                // parameter noObjectsRequired was not set to true
                                if (!filteredObjects.length && objects.length) {
                                    log.info('There are no objects for ', actionID, ' in this instance: objects: ',
                                        filteredObjects, '; all objects: ', objects);
                                    return callback();
                                } else if (filteredObjects.length !== objects.length) {
                                    log.info('Run action ', actionID, ' for objects: ',
                                        filteredObjects, '; all objects: ', objects);
                                } else {
                                    log.info('Run action ', actionID, ' for all objects: ', filteredObjects,
                                        ', applyToOwnObjects: ', !!actionCfg.applyToOwnObjects,
                                        ', noObjectsRequired: ', !!actionCfg.noObjectsRequired);
                                }
                            }

                            param.args.o = JSON.stringify(filteredObjects);
                        }

                        var launcherName = actionCfg.launcher;
                        if(!launcherName) {
                            return callback(new Error('Undefined "launcher" parameter in action configuration for ' +
                                actionID));
                        }
                        if(!confLaunchers.get('dir')) {
                            return callback(new Error('Undefined "launchers:dir" parameter in main configuration for ' +
                                actionID));
                        }
                        if(!confLaunchers.get('fileName')) {
                            return callback(new Error('Undefined "launchers:fileName" parameter in main configuration for ' +
                                actionID));
                        }
                        var launcherSource = path.join(__dirname, '..', confLaunchers.get('dir'), launcherName,
                            confLaunchers.get('fileName'));

                        // delete old launcher from require cache for reread
                        if(param.updateAction && require.resolve(launcherSource) &&
                            require.cache[require.resolve(launcherSource)]) {
                            delete require.cache[require.resolve(launcherSource)];
                        }

                        if(!launchers[launcherSource] || param.updateAction) {
                            //try {
                            log.info('Attaching launcher file ', launcherSource,
                                (param.updateAction ?
                                    '. Required action update. Cached data was deleted.' : ' at a first time.'));
                            launchers[launcherSource] = require(launcherSource);
                            /*} catch (err) {
                                return callback(new Error('Can\'t attach launcher source file: ' + launcherSource +
                                    ' for action "' + actionID + '": ' + err.message));
                            }*/
                        }

                        actionCfg.timeout = Number(actionCfg.timeout);
                        if(actionCfg.timeout === parseInt(String(actionCfg.timeout), 10) && actionCfg.timeout > 1) {
                            var actionTimeoutWatchdog = setTimeout(function () {
                                if(typeof callback !== 'function') return;
                                var savedCallback = callback;
                                callback = null;
                                var errMessage = 'The execution time (' + actionCfg.timeout+ 's) of the "' +
                                    actionCfg.name + '" action has expired';
                                log.error(errMessage);
                                log.addSessionResult({
                                    sessionID: param.sessionID,
                                    stopTimestamp: Date.now(),
                                    error: errMessage,
                                });
                                savedCallback(new Error(errMessage));
                            }, actionCfg.timeout * 1000)
                        }

                        actionCfg.launcherPrms.actionID = actionID;
                        actionCfg.launcherPrms.updateAction = param.updateAction;
                        var startActionTimestamp = Date.now();

                        // add session with executionMode = 'server' for add log to the audit
                        var sessionParameters = {
                            username: param.user, // username
                            sessionID: param.sessionID,
                            actionID: actionID,
                            startTimestamp: Date.now(),
                            objects: filteredObjects,
                            taskID: param.taskID,
                            taskSession: param.taskSession,
                        };

                        // for create action description
                        if(actionCfg.descriptionTemplateHTML || actionCfg.descriptionTemplate) {
                            sessionParameters.descriptionTemplate =
                                actionCfg.descriptionTemplateHTML || actionCfg.descriptionTemplate;
                            sessionParameters.args = param.args;
                        }

                        log.addNewSession(sessionParameters);

                        launchers[launcherSource](actionCfg.launcherPrms, param.args, function(err, result) {
                            // add session with executionMode = 'server' for add stopTimestamp to the audit
                            if(err) {
                                log.error('The "', actionCfg.name, '" action is completed with an error: ', err.message);
                            } else {
                                log.info('The "', actionCfg.name, '" action is completed successfully with result: ',
                                    result);
                            }
                            log.addSessionResult({
                                sessionID: param.sessionID,
                                stopTimestamp: Date.now(),
                                error: err ? err.message : null,
                            });
                            clearTimeout(actionTimeoutWatchdog);

                            if(typeof callback !== 'function') {
                                log.error('Action ', actionCfg.name, ' returned after timeout ', actionCfg.timeout,
                                    'sec result: ', result, (err ? '; Error: ' + err.message : ' '), ' executing time: ',
                                    Math.round((Date.now() - startActionTimestamp)/1000), 'sec');
                            } else {
                                var savedCallback = callback;
                                callback = null;
                                savedCallback(err, result);
                            }
                        });
                    });
                }
            }
        });
    });
}

function updateActionAjax(ajaxSource, updateAction, startAjaxAsThread, callback) {
    waitingForUpdateAjax(ajaxSource, function () {
        if(ajax[ajaxSource] && !updateAction) return callback();

        if(startAjaxAsThread) {
            if(updateAction && ajax[ajaxSource]) {
                if(typeof ajax[ajaxSource].exit === 'function') {
                    log.warn('Try to update ajax ', ajaxSource, ', exiting...')
                    ajax[ajaxSource].exit();
                } else {
                    log.error('ajax[ajaxSource].exit is not a function: ', Object.keys(ajax[ajaxSource]),
                        ' for ', ajaxSource);
                }
            }
            ajax[ajaxSource] = {};

            log.info('Starting ajax ', ajaxSource, ' as a thread',
                (updateAction ? '. Required action update. Previous thread will be terminated.' : ' at a first time'));
            runInThread(ajaxSource, {module: module},function (err, ajaxObj) {
                if(err) return callback(new Error('Can\'t start ajax : ' + ajaxSource + '  as a thread: ' + err.message));

                ajax[ajaxSource] = ajaxObj;
                callback();
            });
        } else {
            ajax[ajaxSource] = {};
            //try {
                // delete old javaScript from require cache for reread
                if(updateAction && require.resolve(ajaxSource) && require.cache[require.resolve(ajaxSource)]) {
                    delete require.cache[require.resolve(ajaxSource)];
                }

                log.info('Attaching ajax ', ajaxSource,
                    (updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));

                ajax[ajaxSource] = {
                    func: require(ajaxSource),
                };
                return callback();
            /*} catch (err) {
                return callback(new Error('Can\'t attach ajax ' + ajaxSource + ': ' + err.message));
            }*/
        }
    });
}

function waitingForUpdateAjax(ajaxSource, callback) {
    if(ajax[ajaxSource] && typeof ajax[ajaxSource].func !== 'function') {
        setTimeout(waitingForUpdateAjax, 100, ajaxSource, callback);
    } else callback();
}

/**
 * Filters objects and returns objects served by the current instance of ALEPIZ
 * @param {Array} objects - array of objects like [{id:. name:}, ... ]
 * @param {Object} actionCfg - if false, then do not filter an objects
 * @param {Boolean} actionCfg.applyToOwnObjects - if false, then do not filter an objects
 * @param {Boolean} actionCfg.noObjectsRequired - if true, then do not filter an objects
 * @param {function(Error, Array) | function(null, Array)} callback - callback(err, filteredObjects) where
 *  filteredObjects is objects served by the current instance of ALEPIZ like [{id:. name:}, ... ]
 */
function getOwnObjectIDs(objects, actionCfg, callback) {
    if(actionCfg.noObjectsRequired || !actionCfg.applyToOwnObjects || !Array.isArray(objects) || !objects.length) {
        return callback(null, objects);
    }

    var cfg = confMyNode.get();
    var indexOfOwnNode = cfg.indexOfOwnNode;
    var ownerOfUnspecifiedAlepizIDs = cfg.serviceNobodyObjects;

    var allRelatedObjectIDs = new Set(), filteredObjects = [];
    getObjectsAlepizRelation(function (err, objectsAlepizRelationsRows) {
        if(err) log.warn(err.message);
        objectsAlepizRelationsRows.forEach(row => {
            for(var i = 0; i < objects.length; i++) {
                if(indexOfOwnNode === row.alepizID && objects[i].id === row.objectID) {
                    filteredObjects.push(objects[i]);
                    break;
                }
            }
            allRelatedObjectIDs.add(row.objectID);
        });

        if(ownerOfUnspecifiedAlepizIDs) {
            objects.forEach(obj => {
                if (!allRelatedObjectIDs.has(obj.id)) filteredObjects.push(obj);
            });
        }
        callback(null, filteredObjects);
    });
}

/**
 * Get all the objects that are processed by the specified instances of ALEPIZ.
 * Data is returned from the database or from the cache.
 * The cache will be updated from the database no longer than the cacheTimeout of ms
 *
 * @param {function(Error, Set)| function(null, Set)} callback - callback(err, objectsAlepizRelationsCache), where
 *  objectsAlepizRelationsCache is new Set([{objectID:, alepizID:}, ...])
 */
function getObjectsAlepizRelation(callback) {
    if(Date.now() - dataRcvTime < cacheTimeout) return callback(null, objectsAlepizRelationsCache);

    dataRcvTime = Date.now();
    objectsDB.getObjectsAlepizRelation(function (err, objectsAlepizRelationsRows) {
        if (err) {
            return callback(new Error('Can\'t get objectsAlepizRelations from DB: ' + err.message),
                objectsAlepizRelationsCache);
        }
        objectsAlepizRelationsCache = new Set(objectsAlepizRelationsRows);
        callback(null, objectsAlepizRelationsCache);
    });
}