/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const thread = require('../lib/threads');
const async = require('async');
const tasksDB = require('../models_db/tasksDB');
const tasks = require('./tasks');
const actionClient = require('../serverActions/actionClient');
const Conf = require('../lib/conf');
const confTaskServer = new Conf('config/taskServer.json');

var serverIPC,
    conditionsQueue = new Map(),
    scheduledTasks = new Map();

processConditionsQueue();

tasks.startCheckConditions(function (err) {
    if(err) return log.warn('Error starting to check conditions: ', err.message);

    const cfg = confTaskServer.get();
    cfg.id = 'taskServer';
    serverIPC = new IPC.server(cfg, function (err, message, socket, callback) {
        if(err) log.error(err.message);

        if (socket === -1) { // server starting listening
            new thread.child({
                module: 'taskServer',
                onDisconnect: destroy,
                onDestroy: destroy,
                onStop: stop,
            });
        }

        if (message) {
            log.debug('Received message ', message);

            var taskID = Number(message.taskID);

            // run task from server|eventGenerator|taskMaker
            if(taskID && message.runTaskFrom) return tasks.runTask(message, callback);

            // add new task running on time by schedule (runType is a timestamp)
            if(taskID && message.runType > 100) return scheduleTask(taskID, message.runType, message.workflow);

            // add new task running by condition runType 0 - run permanently, 1 - run once
            if(taskID && Array.isArray(message.conditionOCIDs) &&
                (message.runType === 0 || message.runType === 1)) return addConditionTask(taskID, message)

            // task is canceled
            if(Number(message.cancelTaskID)) return cancelTask(Number(message.cancelTaskID));

            // add condition for OCID to queue and process queue after
            if(Number(message.OCID)) queueCondition(message);
        }
    });

    log.info('Task Server is running. Connecting to action server');
    actionClient.connect('actions:taskServer', function () {

        tasksDB.getApprovedTasks(function (err, rows) {
            if (err) return log.error('Can\'t get approved tasks from DB: ' + err.message);

            if(!rows.length) return log.info('Can\'t find approved tasks for load form database');

            var tasksRunConditions = {};
            rows.forEach(function (row) {
                if(!tasksRunConditions[row.taskID]) {
                    tasksRunConditions[row.taskID] = {
                        runType: row.runType,
                        username: row.username,
                        OCIDs: row.OCID !== null ? [row.OCID] : [],
                    }
                } else tasksRunConditions[row.taskID].OCIDs.push(row.OCID);
            });

            //log.info('Loading tasks data for approved tasks: ', rows);
            async.each(Object.keys(tasksRunConditions), function (taskID, callback) {

                var tasksRunCondition = tasksRunConditions[taskID];
                tasks.getWorkflow(tasksRunCondition.username, function(err, workflow) {
                    if(err) return callback(err);

                    if (tasksRunCondition.runType > 100) {
                        scheduleTask(taskID, tasksRunCondition.runType, workflow);
                        return callback();
                    }
                    if(tasksRunCondition.runType !== 0 && tasksRunCondition.runType !== 1) callback();

                    log.info('Loading task ID ', taskID, '. runType: run ',
                        (tasksRunCondition.runType ? 'once' : 'every time'),
                        ' when update event occurred, for OCIDs: ', tasksRunCondition.OCIDs,
                        '; approved user: ', tasksRunCondition.username);

                    tasks.runTask({
                        taskID: taskID,
                        conditionOCIDs: tasksRunCondition.OCIDs,
                        runType: tasksRunCondition.runType,
                    }, function (err, taskResult, username) {
                        if(err) log.error('Error running task ', taskID, ', by conditions : ', err.message);
                        tasks.processWorkflows(username, taskID, workflow, 'execute', err, callback);
                    });
                });
            }, function (err) {
                if(err) log.error(err.message);
            });
        });
    });
});

/**
 * Destroy task server (disconnect from log server) and exit
 */
function destroy() {
    log.exit('Task server was stopped or destroyed or client was disconnected. Saving task information and exiting');
    log.disconnect(function () { process.exit(2) });
}

/**
 * Stop task server (Stop IPC system)
 * @param {function()} callback callback()
 */
function stop(callback) {
    serverIPC.stop(function(err) {
        if (err) log.exit('Can\'t stop IPC system: ' + err.message);

        callback();
    });
}

/**
 * Add scheduled task
 * @param {number} taskID task ID
 * @param {number} timestamp time to run the scheduled task
 * @param {Array} workflow workflow array with workflow objects, like [{action: "execute", message: ...}, ....]
 */
function scheduleTask(taskID, timestamp, workflow) {
    var runTime = timestamp - Date.now();
    if(runTime < 30000) {
        log.info('Run schedule task ', taskID, ' now, because the time for the run has expired: ',
            new Date(timestamp).toLocaleString());

        tasks.runTask({
            taskID: taskID,
        }, function (err, taskResult, username) {
            if(err) log.error('Error running task ', taskID, ' at ', new Date(timestamp).toLocaleString(), ': ', err.message);
            tasks.processWorkflows(username, taskID, workflow, 'execute', err, function() {});
        });
        return;
    }

    if (scheduledTasks.has(taskID)) {
        log.info('Task ', taskID, ' has been scheduled previously. Skip scheduling this task twice.');
        return;
    }
    log.info('Schedule task ', taskID, ' to run at ', new Date(timestamp).toLocaleString());
    var scheduledTaskTimer = setTimeout(function () {
        scheduledTasks.delete(taskID);
        tasks.runTask({
            taskID: taskID,
        }, function (err, taskResult, username) {
            if (err) log.error('Error running task ', taskID, ' at ', new Date(timestamp).toLocaleString(), ': ', err.message);
            tasks.processWorkflows(username, taskID, workflow, 'execute', err, function() {});
        });
    }, runTime);
    scheduledTasks.set(taskID, scheduledTaskTimer);
}

/**
 * Add condition task
 * @param {number} taskID task ID
 * @param {Object} message message object
 * @param {string} message.username username who approve the task
 * @param {Array} message.conditionOCIDs Array with condition OCIDs
 * @param {0|1} message.runType 0 - run permanently, 1 - run once
 * @param {Array} message.workflow workflow
 */
function addConditionTask(taskID, message) {
    log.info('Queuing task ', taskID, ' username: ', message.username, ', runType: ', message.runType,
        ' for waiting conditions ', message.conditionOCIDs);

    tasks.runTask({
        taskID: taskID,
        conditionOCIDs: message.conditionOCIDs,
        runType: message.runType,
    }, function (err, taskResult, username) {
        if(err) log.error('Error running task ', taskID, ', by conditions : ', err.message);
        tasks.processWorkflows(username, taskID, message.workflow, 'execute', err, function() {});
    });
}

/**
 * Canceling scheduled task or task with condition
 * @param {number} taskID task ID
 */
function cancelTask(taskID) {
    if(scheduledTasks.has(taskID)) {
        clearTimeout(scheduledTasks.get(taskID));
        log.info('Task ID ', taskID, ' schedule canceled');
        scheduledTasks.delete(taskID);
    } else {
        log.info('Task ID ', taskID, ' is canceled');
        tasks.cancelTaskWithCondition(taskID);
    }
}

/**
 * Add condition for OCID to queue and process queue every cfg.waitingConditionsTime (30 sec)
 *
 * @param {Object} message message object
 * @param {number} message.OCID OCID
 * @param {string} message.objectName object name for log
 * @param {string} message.counterName counter name for log
 */
function queueCondition(message) {
    const OCID = Number(message.OCID);
    if(conditionsQueue.has(OCID)) return;

    log.debug('Receiving message for checking task condition, add to queue: ',
        message.objectName, ' (', message.counterName, ') OCID: ', OCID);
    delete message.OCID;
    conditionsQueue.set(OCID, message);
}

/**
 * Process queued conditions every cfg.waitingConditionsTime (30 sec)
 */
function processConditionsQueue() {
    var processingConditionsInProgress = setTimeout(function() {
        if(conditionsQueue.size) {
            log.debug('Checking task condition for: ', conditionsQueue);
            const OCIDs = Array.from(conditionsQueue.keys());
            conditionsQueue.clear();
            tasks.checkCondition(OCIDs);
        }
        processConditionsQueue();
    }, parseInt(confTaskServer.get('waitingConditionsTime'), 10) || 30000);
    processingConditionsInProgress.unref();
}
