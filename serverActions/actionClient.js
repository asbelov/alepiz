/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const Conf = require('../lib/conf');
const confActions = new Conf('config/actions.json');

const IPC = require('../lib/IPC');
const prepareUser = require('../lib/utils/prepareUser');
const usersRolesRightsDB = require('../models_db/usersRolesRightsDB');

var clientIPC;
var allClientIPCArray = [],
    isInitConnections = false,
    reconnectInProgress = false;


var actionClient = {};
module.exports = actionClient;

actionClient.connect = function (callback) {
    if(isInitConnections) return callback();

    var cfg = confActions.get();

    cfg.id = 'actionClient';
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
        if (_clientIPC) {
            clientIPC = _clientIPC;
            if(!reconnectInProgress) log.info('Connected to action server');
            else return log.info('Reconnected to action server');

            var remoteServers = Array.isArray(cfg.remoteServers) ? cfg.remoteServers : [],
                remoteClientIPC = new Map();
            async.each(remoteServers, function (remoteServerCfg, callback) {
                remoteServerCfg.id = 'actionClientRmt:' + remoteServerCfg.serverAddress + ':' + remoteServerCfg.serverPort;
                if (remoteServerCfg.reconnectDelay === undefined) remoteServerCfg.reconnectDelay = 60000;
                if (remoteServerCfg.connectionTimeout === undefined) remoteServerCfg.connectionTimeout = 2000;

                log.info('Connecting to remote action server ',
                    remoteServerCfg.serverAddress, ':', remoteServerCfg.serverPort, '...');
                new IPC.client(remoteServerCfg, function (err, msg, clientIPC) {
                    if (err) {
                        // write error only first time
                        if (!remoteClientIPC.has(remoteServerCfg)) log.warn(remoteServerCfg.id, ': ', err.message);
                    } else if (clientIPC) {
                        log.info('Connected to remote action Server ',
                            remoteServerCfg.serverAddress, ':', remoteServerCfg.serverPort);
                    }
                    // After the connection timeout expires, clientIPC will be returned and messages will be
                    // saved for sending to the remote server in the future.
                    if (clientIPC) remoteClientIPC.set(remoteServerCfg, clientIPC);
                    if (typeof callback === 'function') callback();
                    callback = null; // prevent running callback on reconnect
                });
            }, function () {
                isInitConnections = true;
                if(remoteClientIPC.size) allClientIPCArray = Array.from(remoteClientIPC.values());

                allClientIPCArray.unshift(clientIPC);
                if (!reconnectInProgress) callback();
                reconnectInProgress = true;
            });
        }
    });
};

actionClient.disconnect = function (callback) {
    log.info('Disconnecting from action server');
    allClientIPCArray.forEach(clientIPC => clientIPC.disconnect())
    allClientIPCArray = [];
    clientIPC = null;
    callback();
};

/*
 Run specific action

 param: {
 actionID: action ID,
 executionMode: ajax | server | makeTask,
 user: user name,
 args: {prm1: ..., prm2: ..., ....},
 sessionID: session ID
 }
 */
actionClient.runAction = function (param, callback) {
    if (typeof callback !== 'function') {
        return log.error('Error while running action "', param.actionID, '": callback is not a function');
    }
    if (!clientIPC) {
        actionClient.connect(function () {
            log.info('Connecting to action server for run action: ', param);
            actionClient.runAction(param, callback);
        });
        return;
    }

    checkObjectsRights(param.user, param.executionMode, param.args.o, function (err) {
        if (err) return callback(err);

        log.debug('Sending parameters to action server for run action: ', param);
        var dataToSend = {
            msg: 'runAction',
            param: param,
        };

        // runActionOnRemoteServers = true only for run action from browser
        if (param.runActionOnRemoteServers && (param.runAjaxOnRemoteServers || param.executionMode !== 'ajax')
        ) {
            var results = [];
            async.each(allClientIPCArray, function (clientIPC, callback) {
                if (typeof clientIPC.sendAndReceive !== 'function') return callback();
                // callback(err, actionData) - returned data for ajax or action execution
                clientIPC.sendAndReceive(dataToSend, function (err, result) {
                    if(err) return callback(err);
                    if(result !== undefined) results.push(result);
                    callback();
                });
            }, function(err) {
                callback(err, results);
            });
        } else {
            // callback(err, actionData) - returned data for ajax or action execution
            clientIPC.sendAndReceive(dataToSend, callback);
        }
    });
};

/**
 * Send message for all action servers for add sessionID to database. Used only for run action from web interface
 * @param {{user: {string}, sessionID: {uint}, actionID: {string}, actionName: {string}}} param -
 *      parameters for creating sessionID
 */
actionClient.addSessionID = function (param) {
    if (!clientIPC) {
        actionClient.connect(function () {
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

    allClientIPCArray.forEach(clientIPC => {
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
        actionClient.connect(function () {
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