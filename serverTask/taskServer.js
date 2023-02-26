/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const thread = require('../lib/threads');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confTaskServer = new Conf('config/taskServer.json');


const async = require('async');
const tasksDB = require('../models_db/tasksDB');
const tasks = require('../lib/tasks');
const actionClient = require('../serverActions/actionClient');


var serverIPC,
    conditionsQueue = new Set(),
    systemUser = conf.get('systemUser') || 'system',
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
                        '; approved user: ',tasksRunCondition.username, '; workflow: ', workflow);

                    tasks.runTask({
                        userName: systemUser,
                        taskID: taskID,
                        conditionOCIDs: tasksRunCondition.OCIDs, // Using Object.values for save Number type for OCID
                        runType: tasksRunCondition.runType,
                    }, function (err) {
                        if(err) log.error('Error running task ', taskID, ', by conditions : ', err.message);
                        sendMessage(taskID, workflow, err, callback);
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
 * @param {object} workflow workflow
 */
function scheduleTask(taskID, timestamp, workflow) {
    var runTime = timestamp - Date.now();
    if(runTime < 30000) {
        log.info('Run schedule task ', taskID, ' now, because time to run is ', new Date(timestamp).toLocaleString());
        tasks.runTask({
            userName: systemUser,
            taskID: taskID,
        }, function (err) {
            if(err) log.error('Error running task ', taskID, ' at ', new Date(timestamp).toLocaleString(), ': ', err.message);
            sendMessage(taskID, workflow, err);
        });
        return;
    }

    log.info('Schedule task ', taskID, ' to run at ', new Date(timestamp).toLocaleString());
    scheduledTasks.set(taskID, setTimeout(function () {
        scheduledTasks.delete(taskID);
        tasks.runTask({
            userName: systemUser,
            taskID: taskID,
        }, function (err) {
            if (err) log.error('Error running task ', taskID, ' at ', new Date(timestamp).toLocaleString(), ': ', err.message);
            sendMessage(taskID, workflow, err);
        });
    }, runTime));
}

/**
 * Add condition task
 * @param {number} taskID task ID
 * @param {Object} message message object
 * @param {Array} message.conditionOCIDs Array with condition OCIDs
 * @param {0|1} message.runType 0 - run permanently, 1 - run once
 * @param {Object} message.workflow workflow
 */
function addConditionTask(taskID, message) {
    log.info('Queuing task ', taskID,', runType: ', message.runType,' for waiting conditions ', message.conditionOCIDs);
    tasks.runTask({
        userName: systemUser,
        taskID: taskID,
        conditionOCIDs: message.conditionOCIDs,
        runType: message.runType,
    }, function (err) {
        if(err) log.error('Error running task ', taskID, ', by conditions : ', err.message);
        sendMessage(taskID, message.workflow, err);
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

    log.info('Queuing task condition for ', OCID, ': ', message.objectName, ' (', message.counterName, ')');
    conditionsQueue.add(OCID);
}

/**
 * Process queued conditions every cfg.waitingConditionsTime (30 sec)
 */
function processConditionsQueue() {
    var processingConditionsInProgress = setTimeout(function() {
        if(conditionsQueue.size) {
            const OCIDs = Array.from(conditionsQueue);
            conditionsQueue.clear();
            log.info('Checking task condition for OCIDs: ', OCIDs);
            tasks.checkCondition(OCIDs);
        }
        processConditionsQueue();
    }, parseInt(confTaskServer.get('waitingConditionsTime'), 10) || 30000);
    processingConditionsInProgress.unref();
}

/**
 * Send message after task executed
 * @param {number} taskID task ID
 * @param {Object} workflow workflow
 * @param {Error} [error] Error
 * @param {function(Error) | function()} [callback] callback(err)
 */
function sendMessage(taskID, workflow, error, callback) {
    async.each(workflow, function (obj, callback) {
        if(typeof(obj.action) === 'string' && obj.action.toLowerCase() === 'execute') {
            var action = error ? error.message : 'execute';
            tasks.sendMessage(systemUser, taskID, obj.message, action, callback);
        } else callback();
    }, function(err) {
        if(typeof callback === 'function') return callback(err);
        if(err) log.error(err.message);
    });
}