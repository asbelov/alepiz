/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.03.2017.
 */
const log = require('../../lib/log')(module);
const transactionsDB = require('../../models_db/modifiers/transaction');
const tasksDB = require('../../rightsWrappers/tasksDB');
const tasks = require('../../serverTask/tasks');
const taskClient = require('../../serverTask/taskClient');
const async = require('async');
const unique = require('../../lib/utils/unique');

/**
 * Save the task
 * @param {Object} args parameters from the task maker web interface
 * @param {string} args.actionName "Task maker"
 * @param {string} args.removedTaskIDs comma separated string with task IDs for remove
 * @param {string} args.taskID stringified task ID
 * @param {string} args.username username
 * @param {string} args.taskActionID stringified taskActionID
 * @param {string} args.actionsOrder comma separated taskActionID in the order of action execution
 * @param {string} args.newTaskGroup stringified new task group
 * @param {string} args.newTaskGroupName new task group name if task will be moved to
 * @param {string} args.taskName task name
 * @param {string} args.actionsOrder comma separated taskActionID in the order of action execution
 * @param {string} args.newTaskGroup stringified new task group
 * @param {'dontRun'|'runNow'|'runAtTime'|'runByActions'} args.taskExecutionCondition
 * @param {string} args.runTaskAtDateTimestamp stringified timestamp of the date when the task should be started
 * @param {string} args.runTaskAtTime time (HH:MM) when task should be started
 * @param {string} args.runTaskOnce should the task be running only once
 * @param {string} args.taskUpdated have any changes been made to the task
 * @param {function(Error)|function()} callback callback(err)
 */
module.exports = function(args, callback) {
    log.debug('Starting action "' + args.actionName + '" with parameters', args);

    taskClient.connect('taskMaker:server', function (err) {
        if(err) return callback(err);
        saveTask(args, callback);
    });
};

/**
 * Save the task
 * @param {Object} args parameters from the task maker web interface
 * @param {string} args.removedTaskIDs comma separated string with task IDs for remove
 * @param {string} args.taskID stringified task ID
 * @param {string} args.username username
 * @param {string} args.taskActionID stringified taskActionID
 * @param {string} args.actionsOrder comma separated taskActionID in the order of action execution
 * @param {string} args.newTaskGroup stringified new task group
 * @param {string} args.newTaskGroupName new task group name if task will be moved to
 * @param {string} args.taskName task name
 * @param {string} args.actionsOrder comma separated taskActionID in the order of action execution
 * @param {string} args.newTaskGroup stringified new task group
 * @param {'dontRun'|'runNow'|'runAtTime'|'runByActions'} args.taskExecutionCondition
 * @param {string} args.runTaskAtDateTimestamp stringified timestamp of the date when the task should be started
 * @param {string} args.runTaskAtTime time (HH:MM) when task should be started
 * @param {string} args.runTaskOnce should the task be running only once
 * @param {string} args.taskUpdated have any changes been made to the task
 * @param {function(Error)|function()} callback callback(err)
 */
function saveTask(args, callback) {
    if(args.taskID && typeof args.taskID === 'string') {
        var taskID = Number(args.taskID);
        // if taskID = 0, then don't add a new task. if taskID = '', don't remove task
        if (taskID && taskID !== parseInt(String(taskID), 10)) {
            return callback(new Error('Incorrect taskID parameter "' + args.taskID + '"'));
        }
        log.debug('User ', args.username, ': updating task with task ID ', taskID);
    } else log.debug('User ', args.username, ': adding a new task');

    var removedTaskIDs = [];
    // Getting IDs of removed tasks into the removedTaskIDs array.
    // From comma separated string with removed task IDs args.removedTaskIDs
    if(args.removedTaskIDs) {
        if(typeof args.removedTaskIDs !== 'string') {
            return callback(new Error('Incorrect taskID parameter for remove "' +
                JSON.stringify(args.removedTaskIDs) + '"'));
        }

        removedTaskIDs = args.removedTaskIDs.split(/ *, */).map(function(removedTaskIDStr) {
            var removedTaskID = Number(removedTaskIDStr);
            // if removed task ID is not integer, set to 0
            if(isNaN(removedTaskID) || removedTaskID < 1) return 0;
            return removedTaskID;
        });

        // checking removed task array for incorrect task ID
        for(var i = 0; i < removedTaskIDs.length; i++) {
            if(!removedTaskIDs[i]) return callback(new Error('Incorrect taskID for remove: "'+args.removedTaskIDs+'"'));
        }
        log.debug('User ', args.username, ': tasks for removing: ', args.removedTaskIDs, ': ', removedTaskIDs)
    } else log.debug('User ', args.username, ': no tasks for removing');

    var actions = {}, actionsIDsObj = {}, newApproves = {}, filterTaskActionIDs = [];
    Object.keys(args).forEach(function(arg) {
        if(arg.indexOf('startupOptions-') === 0) {
            var taskActionID = Number(arg.slice('startupOptions-'.length));
            if(!taskActionID || taskActionID !== parseInt(String(taskActionID), 10) || !args[arg]) return;

            // 0 - runOnPrevSuccess; 1 - runOnPrevUnSuccess; 2 - doNotWaitPrevious; 4 - runAnyway
            var startupOptions = Number(args[arg]);
            if([0,1,2,3].indexOf(startupOptions) === -1) startupOptions = 3;

            if(!actions[taskActionID] || !actions[taskActionID].args) actions[taskActionID] = {args:{}};

            actions[taskActionID].startupOptions = startupOptions;

        } else if(arg.indexOf('prm_') === 0) {
            taskActionID = Number(arg.replace(/^prm_(\d+)-.*$/, '$1'));
            if(!taskActionID || taskActionID !== parseInt(String(taskActionID), 10)) return;

            if(!actions[taskActionID] || !actions[taskActionID].args) actions[taskActionID] = {args:{}};

            // prm_149786456059798-objectsOrder -> objectsOrder
            var parameterName = arg.slice(String('prm_'+taskActionID+'_').length);
            actions[taskActionID].args[parameterName] = args[arg];
        } else if(arg.indexOf('actionName-') === 0) {
            taskActionID = Number(arg.slice('actionName-'.length));
            if(!taskActionID || taskActionID !== parseInt(String(taskActionID), 10)) return;

            if(!actions[taskActionID] || !actions[taskActionID].args) actions[taskActionID] = {args:{}};

            actions[taskActionID].name = args[arg];
        } else if(arg.indexOf('actionID-') === 0) {
            taskActionID = Number(arg.slice('actionID-'.length));
            if(!taskActionID || taskActionID !== parseInt(String(taskActionID), 10)) return;

            if(!actions[taskActionID] || !actions[taskActionID].args) actions[taskActionID] = {args:{}};

            actions[taskActionID].id = args[arg]; // actionID is a directory name

            if(!actionsIDsObj[args[arg]]) actionsIDsObj[args[arg]] = [taskActionID];
            else actionsIDsObj[args[arg]].push(taskActionID);
        } else if(arg.indexOf('taskRunType_') === 0) {
            // newApproves[taskID] = runType
            newApproves[arg.slice('taskRunType_'.length)] = Number(args[arg])
        } else if (arg.indexOf('selected-') === 0 && args[arg] === '1') {
            filterTaskActionIDs.push(Number(arg.slice('selected-'.length)));
        } else if (arg.indexOf('addNewTaskActionID-') === 0) {
            taskActionID = Number(arg.slice('addNewTaskActionID-'.length));
            if(!taskActionID || taskActionID !== parseInt(String(taskActionID), 10)) return;

            if(!actions[taskActionID] || !actions[taskActionID].args) actions[taskActionID] = {args:{}};

            actions[taskActionID].addNewTaskActionID = Number(args[arg]);
        }
    });

    log.debug('User ', args.username, ': actions: ', actions);

    tasks.getWorkflow(args.username, function(err, workflow) {
        if (err) return callback(err);

        log.debug('Workflow for user ', args.username, ': ', workflow);
        removeTasks(args.username, removedTaskIDs, workflow, function(err) {
            if(err) log.error('User ', args.username, ': ', err.message);

            // don't update task
            if (removedTaskIDs.indexOf(taskID) !== -1 /*|| taskID === 0 || !args.taskUpdated*/) {
                log.info('User ', args.username, ': do not update the task because the task ', taskID,
                    ' will be deleted');
                taskID = 0;
            }

            updateTask(args, taskID, actions, actionsIDsObj, filterTaskActionIDs, workflow, function (err) {
                if (err) log.error('User ', args.username, ': ', err.message);

                if(!Object.keys(newApproves).length) {
                    log.info('User ', args.username, ': no new approves');
                    return callback();
                }

                processApproves(args.username, Number(args.taskActionID), newApproves, workflow, function (err) {
                    if (err) log.error('User ', args.username, ': ', err.message);

                    callback();
                });
            });
        });
    });
}

/**
 * Update task parameters
 * @param {Object} args parameters from the task maker web interface
 * @param {string} args.username username
 * @param {string} args.actionsOrder comma separated taskActionID in the order of action execution
 * @param {string} args.newTaskGroup stringified new task group
 * @param {string} args.newTaskGroupName new task group name if task will be moved to
 * @param {string} args.taskName task name
 * @param {string} args.taskActionID stringified taskActionID
 * @param {'dontRun'|'runNow'|'runAtTime'|'runByActions'} args.taskExecutionCondition
 * @param {string} args.runTaskAtDateTimestamp stringified timestamp of the date when the task should be started
 * @param {string} args.runTaskAtTime time (HH:MM) when task should be started
 * @param {string} args.runTaskOnce should the task be running only once
 * @param {string} args.taskUpdated have any changes been made to the task
 * @param {number} taskID task ID
 * @param {Object} actions object with task actions (see example)
 * @param {Object} actionsIDsObj actionsIDsObj[actionID] = [taskActionID1, taskActionID2,..]
 * @param {Array<number>} filterTaskActionIDs array of the filtered taskActionIDs
 * @param {Array} workflows workflow
 * @param {function(Error)|function(null, number)} callback callback(err, taskID)
 * @example
 * actions:
 * {
 *     taskActionID1: {
 *         startupOptions: [0|1|2|3] // 0 - runOnPrevSuccess; 1 - runOnPrevUnSuccess; 2 - doNotWaitPrevious; 3 - runAnyway
 *         parameters: [{name:..., val:..}, {},...]
 *     },
 *     taskActionID2: {},
 *     ....
 * }
 */
function updateTask(args, taskID, actions, actionsIDsObj, filterTaskActionIDs,
                    workflows, callback) {

    if(!args.taskUpdated) {
        log.info('User ', args.username, ': not updating the task ', taskID, ' because no changes have been made');
        return callback();
    }
    if(taskID === 0) return callback();

    log.info('User ', args.username, ': starting update the task ', taskID, '; actions num: ', Object.keys(actions).length);
    log.debug('Actions: ', actions);

    if(!args.actionsOrder || typeof args.actionsOrder !== 'string') {
        return callback(new Error('Incorrect actionsOrder parameter "' + args.actionsOrder + '"'));
    }
    var actionsOrder = args.actionsOrder.split(/\s*,\s*/).map(function(taskActionIDStr) {
        var taskActionID = Number(taskActionIDStr);
        if(!taskActionID || isNaN(taskActionID) || !isFinite(taskActionID)) return 0;
        return taskActionID;
    });

    // checking actionsOrder array for incorrect taskActionID
    if(!actionsOrder.length || actionsOrder.indexOf(0) !== -1) {
        return callback(new Error('Incorrect taskActionID in actionsOrder: "' + args.actionsOrder + '"'));
    }

    var newTaskGroup = Number(args.newTaskGroup);

    // getting user rights for actions in selected task
    tasksDB.checkActionsRights(args.username, Object.keys(actionsIDsObj), null,
        function(err, actionsRights) {
        if(err) {
            return callback(new Error('Error getting actions rights for user ' + args.username +
                ' for task ID ' + taskID + ': ' + err.message))
        }

        var hasRightsForRunByActions = true;
        for (var actionID in actionsRights) {
            if (!actionsRights[actionID].view) {
                return callback(new Error('User ' + args.username +
                    ' has no rights for view actions in task ID ' + taskID));
            }
            // skip rights check for an unselected action. actionsIDsObj[actionID] = [taskActionID1, taskActionID2,..]
            if(!hasRightsForRunByActions) continue;
            var thisActionNotSelected = false;
            actionsIDsObj[actionID].forEach(function (taskActionID) {
                if(filterTaskActionIDs.indexOf(taskActionID) === -1) thisActionNotSelected = true;
            });
            if(thisActionNotSelected) continue;

            hasRightsForRunByActions = actionsRights[actionID].run;
        }

        getTaskParameters(args.username, taskID, function (err, taskParams, taskData, conditionsOCIDs) {
            if(err) return callback(err);

            transactionsDB.begin(function (err) {
                if (err) {
                    return callback(new Error('Can\'t start transaction for processing task \"' + args.taskName +
                        '\": ' + err.message));
                }

                // when remove task name
                if(taskData && taskData.name && !args.taskName) {
                    args.taskName = taskData.name;
                    log.warn('User ', args.username, ': task name was removed. Repair task name to ', args.taskName);
                }

                // don't change task group for task without task name (initializing task in the Default group)
                if(taskData && !args.taskName) newTaskGroup = taskData.groupID;
                var param = {
                    name: args.taskName,
                    groupID: newTaskGroup,
                    actionsOrder: actionsOrder,
                    taskID: taskID,
                    taskActionID: Number(args.taskActionID),
                }

                if(!taskID) {
                    param.newTaskID = unique.createHash(JSON.stringify(param));
                }

                if(taskData && taskData.groupID !== newTaskGroup) {
                    log.info('User ', args.username, ': move the task ', taskID, ' from "', taskData.groupName,
                        '" (', taskData.groupID ,') to "', args.newTaskGroupName, '" (', newTaskGroup, ')');
                }
                // running all tasks in series for correct transaction processing, and if error occurred in any of
                // running tasks, we will run rollback for transaction
                tasksDB.addOrUpdateTask(args.username, param, actions, function(err, taskID) {
                    if(err) return transactionsDB.rollback(err, callback);

                    var runType = taskData ? taskData.runType : null;

                    log.debug('User ', args.username, ': process task execution condition');
                    processTaskExecutionCondition(args, taskID, hasRightsForRunByActions, filterTaskActionIDs, workflows,
                        function(err) {

                        if(err) return transactionsDB.rollback(err, callback);

                        // remove approval for this task if something changed
                        log.debug('User ', args.username, ': remove approval for task ', taskID ,
                            ' because something changed');

                        removeApproval(args.username, taskID, taskParams, runType, conditionsOCIDs, workflows,
                            function(err/*, taskNotChanged*/) {

                            if(err) return transactionsDB.rollback(err, callback);

                            // this hack is used for save the old group name in the workFlows[0].oldGroupName
                            if(workflows.length) workflows[0].oldGroupName = taskData.groupName;
                            tasks.processWorkflows(args.username, taskID, workflows, 'change', null,
                            function() {
                                transactionsDB.end(callback);
                            });
                        });
                    });
                });
            });
        });
    });
}

/**
 * Remove the task
 * @param {string} username username
 * @param {Array<number>} removedTaskIDs an array with task IDs for remove
 * @param {Array} workflow workflow
 * @param {function()|function(Error)} callback callback(err)
 */
function removeTasks(username, removedTaskIDs, workflow, callback) {
    if(!Array.isArray(removedTaskIDs) || !removedTaskIDs.length) return callback();

    log.info('User ', username, ': tasks for removing: ', removedTaskIDs);

    transactionsDB.begin(function (err) {
        if (err) {
            return callback(new Error('Can\'t start transaction for remove tasks ' + removedTaskIDs.join(',') +
                ': ' + err.message));
        }

        async.eachSeries(removedTaskIDs, function (removedTaskID, callback) {
            tasksDB.cancelTask(username, removedTaskID, function(err) {
                if (err) {
                    log.error('User ', username, ': error while canceling the task ', removedTaskID,
                        '  in DB before removing: ', err);
                }
                taskClient.cancelTask(removedTaskID);
                /*
                first we send the message, then we delete the task, because we cannot get the properties of the task
                to send the message after deleting the task
                 */
                tasks.processWorkflows(username, removedTaskID, workflow, 'remove', null, function () {
                    tasksDB.removeTask(username, removedTaskID, callback);
                });
            });
        }, function(err) {
            if(err) return transactionsDB.rollback(err, callback);

            transactionsDB.end(function (err) {
                if (err) {
                    return callback(new Error('Unable to complete transaction when deleting tasks ' +
                        removedTaskIDs.join(',') + ': ' + err.message));
                }
                callback();
            });
        });
    });
}

/**
 * Get the task parameters
 * @param {string} username username
 * @param {number} taskID taskID
 * @param {function(Error)|function()|function(null, Object, Object, Array<number>)} callback
 *      callback(null, params, taskData, conditionOCIDs)
 * @example
 * param:
 * {
 *      taskActionID: row.taskActionID,
 *      actionID: row.actionID,
 *      parameterName: row.name,
 *      parameterValue: row.value,
 *      actionsOrder: row.actionsOrder,
 *      startupOptions: row.startupOptions,
 * }
 * taskData: {
 *      id: <taskID>,
 *      name: <taskName>,
 *      timestamp: <taskCreatedTime>,
 *      group: <taskGroupName>,
 *      ownerName: <task creator login>,
 *      ownerFullName: <task creator full name>,
 *      runType: <task condition runType>,
 *      conditionTimestamp: <task condition timestamp>
 * }
 *
 * conditionOCIDs: [<OCID1>, <OCID2>, ....]
 */
function getTaskParameters(username, taskID, callback) {
    if(!taskID) return callback();

    tasksDB.getTaskParameters(username, taskID, function(err, taskParams, taskData, conditionOCIDs) {
        if(err) return callback(err);

        var params = taskParams.map(function(row) {
            return {
                taskActionID: row.taskActionID,
                actionID: row.actionID,
                parameterName: row.name,
                parameterValue: row.value,
                actionsOrder: row.actionsOrder,
                startupOptions: row.startupOptions,
            }
        });

        return callback(null, params, taskData[0], conditionOCIDs);
    });
}

/**
 * Remove task approval
 * @param {string} username username
 * @param {number} taskID taskID
 * @param {Object} taskParams task parameters
 * @param {number} runType task run type
 * @param {Array<number>} conditionsOCIDs conditionsOCIDs
 * @param {Array} workflow workflow
 * @param {function(Error)|function(null, true)|function()} callback callback(err, true|undefined) true if no changes were made
 */
function removeApproval(username, taskID, taskParams, runType, conditionsOCIDs, workflow, callback) {
    if(!taskParams) {
        log.info('User ', username, ': removing previous approval from new task ', taskID);
        tasksDB.removeApproval(taskID, callback);
        return;
    }

    getTaskParameters(username, taskID, function (err, newTaskParams, newTaskData, newConditionOCIDs) {
        if(err) return callback(err);

        var conditionsOCIDsForCompare = conditionsOCIDs ? conditionsOCIDs.sort().join(',') : '';
        var newConditionOCIDsForCompare = newConditionOCIDs ? newConditionOCIDs.sort().join(',') : '';
        var isActionParametersChanged = JSON.stringify(taskParams) !== JSON.stringify(newTaskParams)
        // if runType, action parameters and actions are not changed, do not remove the approval
        if(runType === newTaskData.runType &&
            ((newTaskData.runType !== 0 && newTaskData.runType !== 1 && newTaskData.runType !== 11) ||
            conditionsOCIDsForCompare === newConditionOCIDsForCompare) && !isActionParametersChanged) {
            log.info('User ', username, ': no changes found to delete approval from previously approved task ', taskID);
            return callback(null, true);
        }

        log.info('User ', username, ': removing previous approval from changed taskID ', taskID,
            '; runType was\\now: ', runType, '\\', newTaskData.runType,
            '; action parameters were changed: ', isActionParametersChanged);
        log.debug('Action parameters: was: ', taskParams, '; now: ', newTaskParams);
        tasksDB.removeApproval(taskID, callback);
    });
}

/**
 *
 * @param {Object} args parameters from the task maker web interface
 * @param {'dontRun'|'runNow'|'runAtTime'|'runByActions'} args.taskExecutionCondition
 * @param {string} args.runTaskAtDateTimestamp stringified timestamp of the date when the task should be started
 * @param {string} args.runTaskAtTime time (HH:MM) when task should be started
 * @param {string} args.username username
 * @param {string} args.runTaskOnce should the task be running only once
 * @param {number} taskID task ID
 * @param {Boolean} hasRightsForRunByActions does the user have the rights to run action in the task
 * @param {Array<number>} filterTaskActionIDs filtered taskActionIDs
 * @param {Array} workflow workflow
 * @param {function()|function(Error)} callback callback(err)
 */
function processTaskExecutionCondition(args, taskID, hasRightsForRunByActions,
                                       filterTaskActionIDs, workflow, callback) {
    if(args.taskExecutionCondition === 'dontRun') return tasksDB.deleteRunCondition(taskID, callback);

    if(args.taskExecutionCondition === 'runNow') return tasksDB.addRunCondition(taskID, 2, null, callback);

    if(args.taskExecutionCondition === 'runAtTime') {

        var timeToRun = Number(args.runTaskAtDateTimestamp) + getTimeFromStr(args.runTaskAtTime);
        tasksDB.addRunCondition(taskID, timeToRun, null, callback);
        return;
    }

    if (args.taskExecutionCondition === 'runByActions') {
        if(!hasRightsForRunByActions) {
            return callback(new Error('User ' + args.username + ' has no rights for executing task ID ' + taskID));
        }

        taskClient.runTask({
            userName: args.username,
            taskID: taskID,
            filterTaskActionIDs: filterTaskActionIDs,
            runTaskFrom: 'taskMaker',
            runOnLocalNode: true,
        }, function(err) {
            if(err) log.error('User ', args.username, ': run task: ', err.message);

            tasks.processWorkflows(args.username, taskID, workflow, 'execute', err, callback);
        });

        return;
    }

    if(Number(args.taskExecutionCondition[0]) === parseInt(args.taskExecutionCondition[0], 10)) { // OCIDs
        // if previous run type was 11 (task was executed), save this runType
        tasksDB.addRunCondition(taskID, (args.runTaskOnce ? 1 : 0), args.taskExecutionCondition, callback);
        return;
    }

    return callback();
    //return callback(new Error('Unknown task execution condition: ' + JSON.stringify(args.taskExecutionCondition)));
}

/**
 * Process approves
 * @param {string} username username
 * @param {number} taskActionID taskActionID
 * @param {Object} newApproves {<taskID>: <runType>, ...}
 * @param {Array} workflow workflow
 * @param {function(Error)|function()} callback callback()
 */
function processApproves(username, taskActionID, newApproves, workflow, callback) {

    log.info('User ', username, ': processing approves: ', newApproves);
    async.eachSeries(Object.keys(newApproves), function (taskID, callback) {
        var runType = newApproves[taskID];

        tasksDB.checkTaskRights(username, taskID, 'run', function (err) {
            if(err) return callback(new Error('Error checking the rights to run task ' + taskID + ': ' + err.message));

            // [2 - ask to run now; 12 - run now already started; 32 - canceled run now] => run task now
            if(runType === 2 || runType === 12 || runType === 32) {
                taskClient.runTask({
                    userName: username,
                    taskID: taskID,
                    taskActionID: taskActionID,
                    runTaskFrom: 'taskMaker',
                    runOnLocalNode: true,
                }, function(err) {
                    if(err) log.error('User ', username, ': run task when processed approves: ', err.message);

                    tasks.processWorkflows(username, taskID, workflow, 'execute', err, function() {

                        transactionsDB.begin(function(err) {
                            if(err) {
                                return callback(new Error('Can\'t start transaction for save approve for task ID ' +
                                    taskID + ': ' + err.message));
                            }

                            tasksDB.approveTask(username, taskID, function (err) {
                                if(err) return transactionsDB.rollback(err, callback);

                                // 12 - run now already started
                                if(runType === 12) return transactionsDB.end(callback);

                                tasksDB.addRunCondition(taskID, 12, null, function (err) {
                                    if(err) return transactionsDB.rollback(err, callback);
                                    transactionsDB.end(callback);
                                });
                            });
                        });
                    });
                });
                return;
            }

            // there was a request for approval and is now approved
            if(runType < 10) {
                log.info('User ', username, ': approve task ID ', taskID, ' for runType ', runType);
                tasksDB.approveTask(username, taskID, function (err) {
                    if(err) return callback(err);
                    addTaskToTaskServer(username, taskID, runType, workflow,function(err) {
                        if(err) return callback(err);

                        tasks.processWorkflows(username, taskID, workflow, 'approve', null, callback);
                    });
                });
            // was launched, but again approved to run, or was canceled, but again approved
            } else if(runType >= 10 && runType < 20 || runType >= 30) {
                log.info('User ', username, ': approve task ID ', taskID, ' and reset previous runType ', runType,
                    ' to ', String(runType)[1]);
                transactionsDB.begin(function(err) {
                    if(err) {
                        return callback(new Error('Can\'t start transaction for save approve for task ID ' +
                            taskID + ': ' + err.message));
                    }
                    tasksDB.addRunCondition(taskID, runType % 10, null, function(err) {
                        if (err) return transactionsDB.rollback(err, callback);

                        tasksDB.approveTask(username, taskID, function(err) {
                            if(err) return transactionsDB.rollback(err, callback);

                            addTaskToTaskServer(username, taskID, runType % 10, workflow, function(err) {
                                if(err) return transactionsDB.rollback(err, callback);
                                transactionsDB.end(function(err) {
                                    if(err) return callback(err);

                                    tasks.processWorkflows(username, taskID, workflow, 'approve', null,
                                        callback);
                                });
                            })
                        });
                    });
                });
            // has been approved and is now being canceled
            } else if(runType >= 20 && runType < 30) {
                log.info('User ', username, ': cancel task ID ', taskID, ' for runType ', runType);
                tasksDB.cancelTask(username, taskID, function(err) {
                    if(err) return callback(err);
                    taskClient.cancelTask(taskID);

                    tasks.processWorkflows(username, taskID, workflow, 'cancel', null, callback);
                });
            } else callback(new Error('Unknown runType: ' + runType + ' for task ID ' + taskID));
        });
    }, callback);
}

/**
 * Add a task to the task server
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {0|1|2|9} runType task run type
 * @param {Array} workflow workflow
 * @param {function()|function(Error)} callback callback(err)
 */
function addTaskToTaskServer(username, taskID, runType, workflow, callback) {
    log.debug('User ', username, ': adding the task to taskServer: ', taskID, '; runType: ', runType);

    if(runType === 9) { // scheduled task by time
        tasksDB.getTaskConditions(taskID, function (err, rows) { // get task schedule time
            if(err) return callback(err);

            if(rows[0].runType < Date.now()) {
                log.warn('User ', username, ': skip to add scheduled task to task server. Task start time has passed: ',
                    new Date(rows[0].runType).toLocaleString(), ', now: ', new Date().toLocaleString());
                return callback();
            }

            log.info('User ', username, ': added the scheduled task: ', taskID,
                ', time: ', new Date(rows[0].runType).toLocaleString());
            taskClient.addTask(taskID, username, rows[0].runType, workflow);
            callback();
        });
        return;
    }

    if(runType !== 0 && runType !== 1) return callback();

    // runType 0  run permanently by condition
    // runType 1  run once by condition
    tasksDB.getRunConditionOCIDs(taskID, function (err, rows) {
        if(err) return  callback(err);

        var conditionsOCIDs = rows.map(function (row) {
            return row.OCID;
        });

        if(!conditionsOCIDs.length) {
            return callback(new Error('Error add the task ' + taskID + '; runType: ' +
                (runType === 1 ? '1 (run once by condition)' : '0 (run permanently by condition)') +
                ' to queue: no objects-counter links were found to calculate the meet of the condition: conditionsOCIDs: ' +
                conditionsOCIDs));
        }
        log.info('User ', username, ': added the task: ', taskID, '; mode: ', runType,
            '; conditionsOCIDs: ', conditionsOCIDs);
        taskClient.addTask(taskID, username, runType, workflow, conditionsOCIDs);
        callback();
    });
}

/**
 * Converting time string in format HH:MM to ms
 * @param {string} timeStr  time string in format HH:MM
 * @return {number|undefined} time in ms or undefined whe error occurred
 */
function getTimeFromStr(timeStr) {
    if(!timeStr) return;
    var timeParts = timeStr.match(/^(\d\d?):(\d\d?)$/);
    if(timeParts === null) return;
    return Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000;
}