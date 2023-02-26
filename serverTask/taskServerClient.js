/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const async = require('async');
const IPC = require("../lib/IPC");
const Conf = require('../lib/conf');
const connectToRemoteNodes = require("../lib/connectToRemoteNodes");
const path = require("path");
const confTaskServer = new Conf('config/taskServer.json');



var taskServer = {};
module.exports = taskServer;

var clientIPC;
var allClientIPC = new Map(),
    connectionInitialized = 0;
/**
 * Connect to the task server and to the remote Alepiz task server instances
 * @param {string|null} id the name of the connected services to identify in the log file
 * @param {function(Error)|function()} callback callback(err)
 */
taskServer.connect = function (id, callback) {
    if(connectionInitialized === 2) return callback();
    if(connectionInitialized === 1) return setTimeout(taskServer.connect, 100, id, callback);
    connectionInitialized = 1;

    var cfg = confTaskServer.get();
    if(!cfg) return callback(new Error('Task server is not configured'));

    cfg.id = id || 'tasks:' + path.basename(module.parent.filename, '.js');
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
        else if (_clientIPC) {
            clientIPC = _clientIPC;
            log.info('Initialized connection to the tasks server: ', cfg.serverAddress, ':', cfg.serverPort);

            connectToRemoteNodes('tasks', cfg.id,function (err, _allClientIPC) {
                if(!_allClientIPC) {
                    log.warn('No remote nodes specified for tasks');
                    _allClientIPC = new Map();
                }
                _allClientIPC.set(cfg.serverAddress + ':' + cfg.serverPort, clientIPC);
                allClientIPC = _allClientIPC;
                connectionInitialized = 2;
                callback();
            });

        }
    });
};

/**
 * When calculating the result from the counter, check it for the fulfillment of the condition for run the task.
 * Call from server/child/getCountersValue.js:processCounterResult()
 * @param {number} OCID OCID
 * @param {string} objectName object name for log
 * @param {string} counterName counter name for log
 */
taskServer.checkCondition = function(OCID, objectName, counterName) {
    clientIPC.send({
        OCID: OCID, // single object counters ID
        objectName: objectName,
        counterName: counterName,
    });
}

/**
 * Cancel the task from the Task maker action
 * @param {number} taskID task ID
 */
taskServer.cancelTask = function(taskID) {
    log.info('Cancel task ', taskID);
    clientIPC.send({
        cancelTaskID: taskID,
    });
}

/**
 * Add a new task from Task maker action
 * @param {number} taskID task ID
 * @param {number} runType 0 - run permanently, 1 run once, timestamp - run by schedule
 * @param {Object} workflow workflow
 * @param {Array} [conditionOCIDs] array of objects counters IDs
 */
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

/**
 * Run the task
 * @param {object} param
 * @param {string} param.userName username
 * @param {number} param.taskID task ID
 * @param {object} [param.variables] object with variables for use in actions when run from
 *  task-runner collector or eventGenerator
 *  {<name>: <value>, ...}
 * @param {Array} [param.filterSessionIDs] run only filtered actions from the task (array of the sessionIDs)
 * @param {number} [param.mySessionID] sessionID for the task (for group task action in audit)
 * @param {string} param.runTaskFrom function description from which run the task (for log)
 * @param {function(Error)|function(null, Object)} callback callback(err, taskResults) where taskResults is the
 *  object like {"<host1>:<Port1>": <taskResultFromAlepizInstance1>, "<host2>:<Port2>": <taskResultFromAlepizInstance2>, ...}
 *  and <taskResultFromAlepizInstance> is an object like {"<actionID1>:<tasksActionsID>": <actionResult1>, ....}
 */
taskServer.runTask = function (param, callback) {
    if(!clientIPC) {
        taskServer.connect('taskServer:runTask', function(err) {
            if(err) return callback(err);
            taskServer.runTask(param, callback);
        });
        return;
    }

    var taskResults = {};
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        if (typeof clientIPC.sendAndReceive !== 'function') return callback();
        clientIPC.sendAndReceive(param, function(err, taskResult) {
            taskResults[hostPort] = taskResult;
            callback(err);
        });
    }, function(err) {
        return callback(err, taskResults);
    });
}