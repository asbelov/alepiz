/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var conf = require('../lib/conf');
conf.file('config/conf.json');

var IPC = require('../lib/IPC');
var log = require('../lib/log')(module);

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
    if(typeof callback !== 'function') return log.error('Error while running action "', param.actionID, '": callback is not a function');
    if(!clientIPC) {
        actionClient.connect(function() {
            log.info('Connecting to action server for run action: ', param);
            actionClient.runAction(param, callback);
        });
        return;
    }

    log.debug('Sending parameters to action server for run action: ', param);
    clientIPC.sendAndReceive({
        msg: 'runAction',
        prms: param
    }, callback);
};

actionClient.getSessionID = function(param, callback) {
    if(typeof callback !== 'function') return log.error('Error while getting session ID for "', param.actionID, '": callback is not a function');
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
        prms: param
    }, callback);
};

actionClient.markTaskCompleted = function(taskID, callback) {
    if(typeof callback !== 'function') return log.error('Error while mark task completed for "', taskID, '": callback is not a function');
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
        taskID: taskID
    }, callback);
};
