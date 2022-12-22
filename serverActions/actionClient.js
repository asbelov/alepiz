/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');
const unique = require('../lib/utils/unique');
const IPC = require('../lib/IPC');
const prepareUser = require('../lib/utils/prepareUser');
const usersRolesRightsDB = require('../models_db/usersRolesRightsDB');
const connectToRemoteNodes = require('../lib/connectToRemoteNodes');
const path = require("path");

var actionClient = {};
module.exports = actionClient;

var systemUser = conf.get('systemUser') || 'system';
var clientIPC;
var allClientIPC = new Map(),
    connectionInitialized = false;

/**
 * Connect to the actions server and to the remote Alepiz action server instances
 * @param {string|null} id the name of the connected services to identify in the log file
 * @param {function(Error)|function()} callback callback(err)
 */
actionClient.connect = function (id, callback) {
    if(connectionInitialized) return callback();

    var cfg = confActions.get();
    if(!cfg) return callback(new Error('Action server is not configured'));

    cfg.id = id || 'actions:' + path.basename(module.parent.filename, '.js');
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
        if (_clientIPC) {
            clientIPC = _clientIPC;
            log.info('Initialized connection to the actions server: ', cfg.serverAddress, ':', cfg.serverPort);

            connectToRemoteNodes('actions', cfg.id, function (err, _allClientIPC) {
                if(!_allClientIPC) {
                    log.warn('No remote nodes specified for actions');
                    _allClientIPC = new Map();
                }
                _allClientIPC.set(cfg.serverAddress + ':' + cfg.serverPort, clientIPC);
                allClientIPC = _allClientIPC;
                connectionInitialized = true;
                callback();
            });
        }
    });
};

actionClient.disconnect = function (callback) {
    log.info('Disconnecting from action server');
    allClientIPC.forEach(clientIPC => clientIPC.disconnect())
    allClientIPC.clear();
    clientIPC = null;
    callback();
};

/**
 * Run specific in param action
 * @param {Object} param: object with action parameters
 * @param {string} param.actionID: action directory name
 * @param {string} param.executionMode="ajax"|"server"|"makeTask": one of execution modes
 * @param {string} param.user: username
 * @param {number} param.sessionID: session ID
 * @param {number} param.timestamp: timestamp when the action was started
 * @param {number} param.slowAjaxTime: print action info if ajax executed slow then slowAjaxTime (ms)
 * @param {number} param.slowServerTime: print action info if action executed slow then slowServerTime (ms)
 * @param {Boolean} param.debug: print to log additional debug information for action
 * @param {Boolean} param.applyToOwnObjects=true|false: if true then the args.o parameter is passed into action without
 *      objects that are not serviced in this instance of ALEPIZ. (default false)
 * @param {Boolean} param.runActionOnRemoteServers=true|false: run ajax on remote Alepiz instances (default true).
 * @param {Boolean} param.runAjaxOnRemoteServers=true|false: run action on remote Alepiz instances (default false).
 * @param {object} param.args - object with action arguments like {<name>: <value>, ...}
 * @param {function(Error)|function(null, actionResult:Object)} callback: callback(err, actionResult)
 * @param callback.actionResult: object like {"<serverAddress>:<serverPort>":<actionResult>, ....} if
 *      (executionMode = 'server' and runActionOnRemoteServers = true) or
 *      (executionMode = 'ajax' and  runAjaxOnRemoteServers = true).
 *      Otherwise this parameter is <actionResult>
 */
actionClient.runAction = function (param, callback) {
    if (typeof callback !== 'function') {
        return log.error('Error while running action "', param.actionID, '": callback is not a function');
    }
    if (!clientIPC) {
        actionClient.connect('actions', function () {
            log.info('Connecting to action server for run action: ', param);
            actionClient.runAction(param, callback);
        });
        return;
    }

    if(!param.sessionID) param.sessionID = unique.createID();
    param.timestamp = Date.now();

    checkObjectsRights(param.user, param.executionMode, param.args.o, function (err) {
        if (err) return callback(err);

        //log.debug('Sending parameters to action server for run action: ', param);
        var dataToSend = {
            msg: 'runAction',
            param: param,
        };

        // log when ajax or server executed slowly then slowAjaxTime or slowServerTime
        var slowAjaxTime = Number(param.slowAjaxTime) === parseInt(String(param.slowAjaxTime), 10) &&
            Number(param.slowAjaxTime) > 1 ? Number(param.slowAjaxTime) : 3000;
        var slowServerTime = Number(param.slowServerTime) === parseInt(String(param.slowServerTime), 10) &&
            Number(param.slowServerTime) > 1 ? Number(param.slowServerTime) : 15000;

        // param.runActionOnRemoteServers set to true only when action was running from browser (from routes/actions.js)
        if ((param.executionMode === 'ajax' && param.runAjaxOnRemoteServers) ||
            (param.executionMode === 'server' && param.runActionOnRemoteServers) ||
            param.executionMode === 'makeTask'
        ) {
            var actionResults = {}, actionExecutionTimes = [], startExecutionTime = Date.now();
            async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
                if (typeof clientIPC.sendAndReceive !== 'function') return callback();
                // callback(err, actionData) - returned data for ajax or action execution
                dataToSend.param.hostPort = hostPort;
                var now = Date.now();
                clientIPC.sendExt(dataToSend, {
                    sendAndReceive: param.executionMode === 'ajax' ||
                        (param.executionMode === 'server' && param.returnActionResult),
                    dontSaveUnsentMessage: param.executionMode === 'ajax' || param.executionMode === 'server',
                }, function (err, actionResult) {
                    actionExecutionTimes.push(hostPort + ':' + (Date.now() - now));
                    if(err) return callback(err);
                    if(actionResult !== undefined) {
                        actionResults[hostPort] = actionResult;
                    }

                    callback();
                });
            }, function(err) {
                if(param.user !== systemUser) {
                    var actionExecutionTime = Date.now() - startExecutionTime;
                    if (param.executionMode === 'ajax' && actionExecutionTime > slowAjaxTime) {
                        log.info('The ajax is executed slowly: ', actionExecutionTime, 'ms: ',
                            actionExecutionTimes.join('ms; '), 'ms: ', param);
                    } else if (param.executionMode === 'server' && actionExecutionTime > slowServerTime) {
                        log.info('The action is executed slowly: ', actionExecutionTime, 'ms: ',
                            actionExecutionTimes.join('ms, '), 'ms: ', param);
                    }
                    if(param.debug) {
                        log.info('Action ', param.actionID, '(', Array.from(allClientIPC.keys()).join(';'),
                            '), executionMode ', param.executionMode,
                            ', user: ', param.user, ' returned: ', actionResults,
                            ': ', param.args, (err ? ': err: ' + err.message : ''));
                    }
                }

                callback(err, actionResults);
            });
        } else {
            startExecutionTime = Date.now();
            clientIPC.sendAndReceive(dataToSend, function (err, actionResult) {
                if(param.user !== systemUser) {
                    var actionExecutionTime = Date.now() - startExecutionTime;
                    if (param.executionMode === 'ajax' && actionExecutionTime > slowAjaxTime) {
                        log.info('The ajax is executed slowly: ', actionExecutionTime, 'ms: ', param);
                    } else if (param.executionMode === 'server' && actionExecutionTime > slowServerTime) {
                        log.info('The action is executed slowly: ', actionExecutionTime, 'ms: ', param);
                    }
                    if(param.debug) {
                        log.info('Action ', param.actionID, ', executionMode ', param.executionMode,
                            ', user: ', param.user, ' returned: ', actionResult, ': ', param.args,
                            (err ? ': err: ' + err.message : ''));
                    }
                }

                // actionResult: return ajax data or action execution result
                callback(err, actionResult);
            });

        }
    });
};

/**
 * Send message for all action servers for add sessionID to database. Used only for run action from web interface
 * @param {Object} param - parameters for creating sessionID
 * @param {string} param.user - username
 * @param {string} param.actionID - action DI (action directory)
 * @param {string} param.actionName - full action name
 * @param {number} param.sessionID - unique session ID
 */
actionClient.addSessionID = function (param) {
    if (!clientIPC) {
        actionClient.connect('actions', function () {
            log.info('Connecting to action server for add sessionID: ', param);
            actionClient.addSessionID(param);
        });
        return;
    }

    log.debug('Sending parameters to action server for add sessionID: ', param);
    var dataToSend = {
        msg: 'addSessionID',
        param: param,
    }

    allClientIPC.forEach(clientIPC => {
        if (typeof clientIPC.send === 'function') clientIPC.send(dataToSend);
    });
};

/*
 load and save user action configuration
 */
actionClient.actionConfig = function (user, func, actionID, config, callback) {
    if (typeof callback !== 'function') {
        return log.error('Error while ', func, ' for "', user, '", action: ', actionID, ': callback is not a function');
    }
    if (func !== 'getActionConfig' && func !== 'setActionConfig') {
        return log.error('Unknown function for get/set actionConfig "', func, '" for "', user, '", action: ', actionID);
    }

    if (!clientIPC) {
        actionClient.connect('actions', function () {
            log.info('Connecting to action server for ', func, '. user: ', user, '; action: ', actionID);
            actionClient.actionConfig(user, func, actionID, config, callback);
        });
        return;
    }

    log.debug('Sending user ', prepareUser(user), ', actionID ', actionID, ' to action server for ', func);
    clientIPC.sendAndReceive({
        msg: func,
        user: prepareUser(user),
        actionID: actionID,
        config: config,
        sessionID: unique.createID(),
    }, callback); // getActionConfig => callback(err, {config:...}; ); setActionConfig => callback(err)
};

function checkObjectsRights(user, executionMode, objectsStr, callback) {
    if (executionMode !== 'server' || !objectsStr) return callback();

    try {
        var objects = JSON.parse(objectsStr);
    } catch (e) {
        return callback(new Error('Can\'t parse objects string ' + objectsStr + ' for checking rights for objects: ' + e.message));
    }

    usersRolesRightsDB.checkObjectsIDs({
        user: prepareUser(user),
        IDs: objects,
        checkChange: true,
        errorOnNoRights: true
    }, function (err/*, IDs*/) {
        if (err) {
            return callback(new Error('User ' + user + ' has no rights for change objects ' + objectsStr +
                ': ' + err.message));
        }
        callback();
    });
}