/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const IPC = require("../lib/IPC");
const Conf = require('../lib/conf');
const confTaskServer = new Conf('config/taskServer.json');

var cfg = confTaskServer.get();

var taskServer = {};
module.exports = taskServer;

var clientIPC;

taskServer.connect = function (callback) {
    if(!cfg) return typeof callback === 'function' ? callback(new Error('Task server is not configured')) : undefined;

    cfg.id = 'taskServer';
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.error(err.message);
        else if (_clientIPC) {
            clientIPC = _clientIPC;
            if(typeof callback === 'function') {
                callback();
                callback = null; // prevent run callback again on reconnect
            }
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