/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var cfg = conf.get('taskServer');

if(module.parent) initServer();
else runServerProcess(); //standalone process

function initServer() {
    var taskServer = {};
    module.exports = taskServer;

    var clientIPC;

    // before init real stop function
    taskServer.stop = function(callback) {
        callback()
    };

    taskServer.connect = function (callback) {
        if(!cfg) return typeof callback === 'function' ? callback(new Error('Task server is not configured')) : undefined;

        cfg.id = 'taskServer';
        clientIPC = new IPC.client(cfg, function (err, msg, isConnecting) {
            if (err) log.error(err.message);
            else if (isConnecting && typeof callback === 'function') {
                callback();
                callback = null; // prevent run callback again on reconnect
            }
        });
    };

    // call from lib/server.js
    taskServer.checkCondition = function(OCID, result, objectName, counterName) {
        clientIPC.send({
            OCID: OCID, // single object counters ID
            result: result,
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

    taskServer.start = function (callback) {
        if(!cfg) {
            log.warn('Task server is not configured. Server not started');
            return callback();
        }

        new proc.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            restartAfterErrorTimeout: 2000,
            killTimeout: 1000,
            module: 'taskServer',
        }, function (err, taskServerProcess) {
            if (err) return callback(new Error('Can\'t initializing task server: ' + err.message));

            log.info('Starting task server process');

            taskServerProcess.start(function (err) {
                if (err) return callback(new Error('Can\'t start task server: ' + err.message));

                taskServer.stop = taskServerProcess.stop;
                callback();
            });
        });
    }
}

function runServerProcess() {
    var async = require('async');
    var tasksDB = require('../models_db/tasksDB');
    var tasks = require('../lib/tasks');
    var actionClient = require('../lib/actionClient');


    var serverIPC,
        childProc,
        conditionsQueue = {},
        receivedConditionsCnt = 0,
        processingConditions = 0,
        systemUser = conf.get('systemUser') || 'system',
        waitingConditionsTime = cfg.waitingConditionsTime || 30000,
        scheduledTasks = {};

    if(!cfg) {
        log.warn('Task server is not configured. Try to start server again after 3min');
        setTimeout(runServerProcess, 180000);
    }

    tasks.startCheckConditions(function (err) {
        if(err) {
            log.warn('Error starting to check conditions. Try to start server again after 3min: ', err.message);
            setTimeout(runServerProcess, 180000);
            return;
        }

        cfg.id = 'taskServer';
        serverIPC = new IPC.server(cfg, function (err, message, socket) {
            if(err) log.error(err.message);

            if (socket === -1) { // server starting listening
                childProc = new proc.child({
                    module: 'taskServer',
                    onDisconnect: destroy,
                    onDestroy: destroy,
                    onStop: stop,
                });
            }

            if (message) {
                log.debug('Received message ', message);

                var taskID = Number(message.taskID);
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
        actionClient.connect(function () {

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
                            scheduleTask(tasksRunCondition.taskID, tasksRunCondition.runType, workflow);
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
        setTimeout(process.exit, 500, 2);
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
        scheduledTasks[taskID] = setTimeout(function () {
            delete scheduledTasks[taskID];
            tasks.runTask({
                userName: systemUser,
                taskID: taskID,
            }, function (err) {
                if (err) log.error('Error running task ', taskID, ' at ', new Date(timestamp).toLocaleString(), ': ', err.message);
                sendMessage(taskID, workflow, err);
            });
        }, runTime);
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
        if(scheduledTasks[taskID]) {
            clearTimeout(scheduledTasks[taskID]);
            log.info('Task ID ', taskID, ' schedule canceled');
            delete scheduledTasks[taskID];
        } else {
            log.info('Task ID ', taskID, ' is canceled');
            tasks.cancelTaskWithCondition(taskID);
        }
    }

    function queueCondition(OCID, result, objectName, counterName) {
        log.info('Queuing task condition for ', OCID, '; result: ', result, ': ', objectName, ' (', counterName, ')');
        conditionsQueue[OCID] = result;
        receivedConditionsCnt++;
        if (processingConditions) return;

        processingConditions = Date.now();
        setTimeout(function() {
            var OCIDs = Object.keys(conditionsQueue).filter(function (OCID) {
                return conditionsQueue[OCID]; // checking condition only if result is true
            });
            conditionsQueue = {};
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
}
