/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const thread = require('../lib/threads');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confTaskServer = new Conf('config/taskServer.json');

const cfg = confTaskServer.get();

const async = require('async');
const tasksDB = require('../models_db/tasksDB');
const tasks = require('../lib/tasks');
const actionClient = require('../serverActions/actionClient');


var serverIPC,
    childProc,
    conditionsQueue = new Map(),
    receivedConditionsCnt = 0,
    processingConditions = 0,
    systemUser = conf.get('systemUser') || 'system',
    waitingConditionsTime = cfg.waitingConditionsTime || 30000,
    scheduledTasks = new Map();

tasks.startCheckConditions(function (err) {
    if(err) return log.warn('Error starting to check conditions: ', err.message);

    cfg.id = 'taskServer';
    serverIPC = new IPC.server(cfg, function (err, message, socket, callback) {
        if(err) log.error(err.message);

        if (socket === -1) { // server starting listening
            childProc = new thread.child({
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
            if(Number(message.OCID)) queueCondition(Number(message.OCID));
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

function destroy() {
    log.exit('Task server was stopped or destroyed or client was disconnected. Saving task information and exiting');
    log.disconnect(function () { process.exit(2) });
}

function stop(callback) {
    serverIPC.stop(function(err) {
        if (err) log.exit('Can\'t stop IPC system: ' + err.message);

        callback();
    });
}

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

function addConditionTask(taskID, message) {
    log.info('Queuing task ', taskID,', runType: ', message.runType,' for waiting conditions ', message.conditionOCIDs);
    tasks.runTask({
        userName: systemUser,
        taskID: taskID,
        conditionOCIDs: message.conditionOCIDs,
        runType: message.runType,
        variables: message.variables,
    }, function (err) {
        if(err) log.error('Error running task ', taskID, ', by conditions : ', err.message);
        sendMessage(taskID, message.workflow, err);
    });
}

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

function queueCondition(OCID, result, objectName, counterName) {
    log.info('Queuing task condition for ', OCID, '; result: ', result, ': ', objectName, ' (', counterName, ')');
    conditionsQueue.set(OCID, result);
    receivedConditionsCnt++;
    if (processingConditions) return;

    processingConditions = Date.now();
    setTimeout(function() {
        var OCIDs = [];
        for(var [OCID, result] of conditionsQueue) {
            if(result) OCIDs.push(OCID);
        }
        conditionsQueue.clear();
        log.info('Checking task condition for OCIDs: ', OCIDs);
        tasks.checkCondition(OCIDs);
        processingConditions = 0;
    }, waitingConditionsTime);
}

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