/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const async = require('async');
const IPC = require("../lib/IPC");
const tasks = require('../lib/tasks');
const Conf = require('../lib/conf');
const confTaskServer = new Conf('config/taskServer.json');


var taskServer = {};
module.exports = taskServer;

var clientIPC;
var allClientIPCArray = [],
    isInitConnections = false,
    reconnectInProgress = false;

taskServer.connect = function (callback) {
    if(isInitConnections) return callback();

    var cfg = confTaskServer.get();
    if(!cfg) return callback(new Error('Task server is not configured'));

    cfg.id = 'taskClient';
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
        else if (_clientIPC) {
            clientIPC = _clientIPC;

            if(!reconnectInProgress) log.info('Connected to task server');
            else return log.info('Reconnected to task server');

            var remoteServers = Array.isArray(cfg.remoteServers) ? cfg.remoteServers : [],
                remoteClientIPC = new Map();
            async.each(remoteServers, function (remoteServerCfg, callback) {
                remoteServerCfg.id = 'taskClientRmt:' + remoteServerCfg.serverAddress + ':' + remoteServerCfg.serverPort;
                if (remoteServerCfg.reconnectDelay === undefined) remoteServerCfg.reconnectDelay = 60000;
                if (remoteServerCfg.connectionTimeout === undefined) remoteServerCfg.connectionTimeout = 2000;

                log.info('Connecting to remote task server ',
                    remoteServerCfg.serverAddress, ':', remoteServerCfg.serverPort, '...');
                new IPC.client(remoteServerCfg, function (err, msg, clientIPC) {
                    if (err) {
                        // write error only first time
                        if (!remoteClientIPC.has(remoteServerCfg)) log.warn(remoteServerCfg.id, ': ', err.message);
                    } else if (clientIPC) {
                        log.info('Connected to remote task Server ',
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
                if(remoteClientIPC.size) {
                    allClientIPCArray = Array.from(remoteClientIPC.values());
                    allClientIPCArray.unshift(clientIPC);
                }
                if (!reconnectInProgress) callback();
                reconnectInProgress = true;
            });
        }
    });
};

// call from lib/server.js
taskServer.checkCondition = function(OCID, result, objectName, counterName) {
    clientIPC.send({
        OCID: OCID, // single object counters ID
        result: Boolean(result), // taskServer.js:queueCondition(): if(result) OCIDs.push(OCID);
        objectName: objectName,
        counterName: counterName,
    });
}

// call from actions/task_maker/server.js
taskServer.cancelTask = function(taskID) {
    log.info('Cancel task ', taskID);
    clientIPC.send({
        cancelTaskID: taskID,
    });
}

// call from actions/task_maker/server.js
taskServer.addTask = function(taskID, runType, workflow, conditionOCIDs) {
    if(runType > 100) log.info('Add task ', taskID, '; run at: ', new Date(runType).toLocaleString());
    else log.info('Add task ', taskID, '; runType: ', runType, '; conditionOCIDs: ', conditionOCIDs)

    clientIPC.send({
        taskID: taskID,
        runType: runType, // 0 - run permanently, 0 run once, timestamp - run by schedule
        workflow: workflow,
        conditionOCIDs: conditionOCIDs, // array of objects counters IDs
    });
}

taskServer.runTask = function (param, callback) {
    if(!clientIPC) {
        taskServer.connect(function(err) {
            if(err) return callback(err);
            taskServer.runTask(param, callback);
        });
        return;
    }

    if (!allClientIPCArray.length) return tasks.runTask(param, callback);

    var taskResults = [];
    async.each(allClientIPCArray, function (clientIPC, callback) {
        if (typeof clientIPC.sendAndReceive !== 'function') return callback();
        clientIPC.sendAndReceive(param, function(err, taskResult) {
            taskResults.push(taskResult);
            callback(err);
        });
    }, function(err) {
        return callback(err, taskResults);
    });
}