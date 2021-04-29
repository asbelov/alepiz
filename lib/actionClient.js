/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var conf = require('../lib/conf');
conf.file('config/conf.json');

var IPC = require('../lib/IPC');
var log = require('../lib/log')(module);
var prepareUser = require('../lib/utils/prepareUser');
var rightsWrapper = require('../models_db/usersRolesRightsDB');

var reconnectInProgress = false;
var clientIPC;

var actionClient = {};
module.exports = actionClient;

/*
Don't concatenate this file with actionServer.js because it will making circulate requirements in task.js file
 */

actionClient.connect = function(callback){
    var cfg = conf.get('actions');

    clientIPC = new IPC.client(cfg, function(err, msg, isConnected) {
        if(err) log.error(err.message);
        if(isConnected && !reconnectInProgress) callback();
        reconnectInProgress = true;
    });
};

actionClient.disconnect = function(callback) {
    log.info('Disconnecting from action server');
    clientIPC.disconnect();
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
actionClient.runAction = function(param, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error while running action "', param.actionID, '": callback is not a function');
    }
    if(!clientIPC) {
        actionClient.connect(function() {
            log.info('Connecting to action server for run action: ', param);
            actionClient.runAction(param, callback);
        });
        return;
    }

    checkObjectsRights(param.user, param.executionMode, param.args.o, function(err) {
        if(err) return callback(err);

        log.debug('Sending parameters to action server for run action: ', param);
        clientIPC.sendAndReceive({
            msg: 'runAction',
            param: param,
        }, callback);
    });
};

actionClient.getSessionID = function(param, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error while getting session ID for "', param.actionID, '": callback is not a function');
    }
    if(!clientIPC) {
        actionClient.connect(function() {
            log.info('Connecting to action server for get sessionID: ', param);
            actionClient.getSessionID(param, callback);
        });
        return;
    }

    log.debug('Sending parameters to action server for create sessionID: ', param);
    clientIPC.sendAndReceive({
        msg: 'createSession',
        param: param,
    }, callback);
};

actionClient.markTaskCompleted = function(taskID, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error while mark task completed for "', taskID, '": callback is not a function');
    }
    if(!clientIPC) {
        actionClient.connect(function() {
            log.info('Connecting to action server for mark task completed. taskID: ', taskID);
            actionClient.markTaskCompleted(taskID, callback);
        });
        return;
    }

    log.debug('Sending taskID ', taskID,' to action server for mark task completed');
    clientIPC.sendAndReceive({
        msg: 'markTaskCompleted',
        taskID: taskID,
    }, callback);
};

/*
load and save user action configuration
 */
actionClient.actionConfig = function(user, func, actionID, config, callback) {
    if(typeof callback !== 'function') {
        return log.error('Error while ', func,' for "', user, '", action: ', actionID,': callback is not a function');
    }
    if(func !== 'getActionConfig' && func !== 'setActionConfig') {
        return log.error('Unknown function for get/set actionConfig "', func,'" for "', user, '", action: ', actionID);
    }

    if(!clientIPC) {
        actionClient.connect(function() {
            log.info('Connecting to action server for ', func,'. user: ', user, '; action: ', actionID);
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
    }, callback);
};

function checkObjectsRights(user, executionMode, objectsStr, callback) {
    if(executionMode !== 'server' || !objectsStr) return callback();

    try {
        var objects = JSON.parse(objectsStr);
    } catch (e) {
        return callback(new Error('Can\'t parse objects string ' + objectsStr + ' for checking rights for objects: ' + e.message));
    }

    rightsWrapper.checkObjectsIDs({
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
