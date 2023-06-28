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
 * @param {Object} param object with action parameters
 * @param {string} param.actionID action directory name
 * @param {number} [param.taskID] task ID if action running from the task
 * @param {number} [param.newTaskID] task ID for the new task
 * @param {number} [param.taskSession] unique taskSession if action running from the task
 * @param {number} [param.taskActionID] id from the tasksActions table
 * @param {"ajax"|"server"|"makeTask"} param.executionMode="ajax"|"server"|"makeTask" one of execution modes
 * @param {string} param.user username
 * @param {number} [param.sessionID] session ID
 * @param {number} [param.timestamp] timestamp when the action was started
 * @param {number} [param.slowAjaxTime] print action info if ajax executed slow then slowAjaxTime (ms)
 * @param {number} [param.slowServerTime] print action info if action executed slow then slowServerTime (ms)
 * @param {Boolean} [param.debug] print to log additional debug information for action
 * @param {Boolean} [param.runActionOnRemoteServers]=true|false run ajax on remote Alepiz instances (default true).
 * @param {Boolean} [param.runAjaxOnRemoteServers]=true|false run action on remote Alepiz instances (default false).
 * @param {Boolean} [param.returnActionResult]=true|false is required for return action result. (default false).
 * @param {object} param.args - object with action arguments like {<name>: <value>, ...}
 * @param {Boolean} [param.updateAction] reload ajax.js and server.js
 * @param {function(Error)|function(null, actionResult:Object)} callback callback(err, actionResult)
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

    log.debug('Sending parameters to action server for run action: ', param, {
        func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
        vars: {
            "EXPECTED_ACTION_ID": param.actionID
        }
    });

    if(!param.taskID) {
        param.newTaskID = unique.createHash(JSON.stringify(param) + unique.createID());
    }
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

        log.debug('Run action ', param.actionID, ' on all Alepiz nodes. Execution mode: ', param.executionMode, {
            func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
            vars: {
                "EXPECTED_ACTION_ID": param.actionID
            }
        });

        async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
            if (typeof clientIPC.sendExt !== 'function') return callback();
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

                log.debug('Action ', param.actionID, '(', Array.from(allClientIPC.keys()).join(';'),
                    '), executionMode ', param.executionMode,
                    ', user: ', param.user, ' returned: ', actionResults,
                    ': ', param.args, (err ? ': err: ' + err.message : ''), {
                        func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
                        vars: {
                            "EXPECTED_ACTION_ID": param.actionID
                        }
                    });
            }

            callback(err, actionResults);
        });
    } else {
        log.debug('Run action ', param.actionID, ' on local Alepiz node. Execution mode: ', param.executionMode, {
            func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
            vars: {
                "EXPECTED_ACTION_ID": param.actionID
            }
        });
        startExecutionTime = Date.now();
        clientIPC.sendAndReceive(dataToSend, function (err, actionResult) {
            if(param.user !== systemUser) {
                var actionExecutionTime = Date.now() - startExecutionTime;
                if (param.executionMode === 'ajax' && actionExecutionTime > slowAjaxTime) {
                    log.info('The ajax is executed slowly: ', actionExecutionTime, 'ms: ', param);
                } else if (param.executionMode === 'server' && actionExecutionTime > slowServerTime) {
                    log.info('The action is executed slowly: ', actionExecutionTime, 'ms: ', param);
                }

                log.debug('Action ', param.actionID, '(local node), executionMode ', param.executionMode,
                    ', user: ', param.user, ' returned: ', actionResult, ': ', param.args,
                    (err ? ': err: ' + err.message : ''), {
                        func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
                        vars: {
                            "EXPECTED_ACTION_ID": param.actionID
                        }
                    });
            }

            // actionResult: return ajax data or action execution result
            callback(err, actionResult);
        });

    }
};

/**
 * Load or save username action configuration from browser to DB for specific username
 * @param {string} username username
 * @param {'getActionConfig'|'setActionConfig'} func get action config or set action config
 * @param {string} actionID action ID (action dir name)
 * @param {Object} config action configuration for save
 * @param {function(err)|function(null, Object)|function(null)} callback
 *      getActionConfig => callback(err, {config:...}; ); setActionConfig => callback(err)
 */
actionClient.actionConfig = function (username, func, actionID, config, callback) {
    if (typeof callback !== 'function') {
        return log.error('Error while ', func, ' for "', username, '", action: ', actionID, ': callback is not a function');
    }
    if (func !== 'getActionConfig' && func !== 'setActionConfig') {
        return log.error('Unknown function for get/set actionConfig "', func, '" for "', username, '", action: ', actionID);
    }

    if (!clientIPC) {
        actionClient.connect('actions', function () {
            log.info('Connecting to action server for ', func, '. username: ', username, '; action: ', actionID);
            actionClient.actionConfig(username, func, actionID, config, callback);
        });
        return;
    }

    log.debug('Sending username ', prepareUser(username), ', actionID ', actionID, ' to action server for ', func, {
        func: (vars) => vars.EXPECTED_ACTION_ID === vars.EXPECTED_ACTION_ID,
        vars: {
            "EXPECTED_ACTION_ID": actionID
        }
    });
    clientIPC.sendAndReceive({
        msg: func,
        user: prepareUser(username),
        actionID: actionID,
        config: config,
        sessionID: unique.createID(),
    }, callback); // getActionConfig => callback(err, {config:...}; ); setActionConfig => callback(err)
};
