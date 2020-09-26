/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 25.03.2017.
 */
var log = require('../../lib/log')(module);
var transactionsDB = require('../../models_db/transaction');
var tasksDB = require('../../rightsWrappers/tasksDB');
var tasks = require('../../lib/tasks');
var taskServer = require('../../lib/taskServer');
var async = require('async');


module.exports = function(args, callback) {
    log.debug('Starting action \"'+args.actionName+'\" with parameters', args);

    try {
        taskServer.connect(function (err) {
            if(err) return callback(err);
            saveTask(args, callback);
        });
    } catch(err){
        callback(err);
    }
};

function saveTask(args, callback) {
    if(args.taskID && typeof args.taskID === 'string') {
        var taskID = Number(args.taskID);
        // if taskID = 0, then don't add a new task. if taskID = '', don't remove task
        if (taskID && taskID !== parseInt(String(taskID), 10)) {
            return callback(new Error('Incorrect taskID parameter "' + args.taskID + '"'));
        }
        log.debug('Updating task with task ID ', taskID);
    } else log.debug('Adding a new task');

    var removedTaskIDs = [];
    // Getting IDs of removed tasks into the removedTaskIDs array.
    // From comma separated string with removed task IDs args.removedTaskIDs
    if(args.removedTaskIDs) {
        if(typeof args.removedTaskIDs !== 'string') {
            return callback(new Error('Incorrect taskID parameter for remove "'+args.removedTaskIDs+'"'));
        }

        removedTaskIDs = args.removedTaskIDs.split(/\s*,\s*/).map(function(removedTaskIDStr){
            var removedTaskID = Number(removedTaskIDStr);
            // if removed task ID is not integer, set to 0
            if(!removedTaskID || removedTaskID !== parseInt(String(removedTaskID), 10)) return 0;
            return removedTaskID;
        });
    }

    // checking removed task array for incorrect task ID
    for(var i = 0; i < removedTaskIDs.length; i++) {
        if(!removedTaskIDs[i]) return callback(new Error('Incorrect taskID for remove: "'+args.removedTaskIDs+'"'));
    }

    var actions = {}, actionsIDsObj = {}, newApproves = {}, filterSessionIDs = [];
    Object.keys(args).forEach(function(arg) {
        if(arg.indexOf('startupOptions-') === 0) {
            var sessionID = Number(arg.slice('startupOptions-'.length));
            if(!sessionID || sessionID !== parseInt(String(sessionID), 10) || !args[arg]) return;

            // 0 - runOnPrevSuccess; 1 - runOnPrevUnSuccess; 2 - doNotWaitPrevious
            var startupOptions = Number(args[arg]);
            if(!startupOptions) startupOptions = 0;

            if(!actions[sessionID] || !actions[sessionID].args) actions[sessionID] = {args:{}};

            actions[sessionID].startupOptions = startupOptions;

        } else if(arg.indexOf('prm_') === 0) {
            sessionID = Number(arg.replace(/^prm_(\d+)-.*$/, '$1'));
            if(!sessionID || sessionID !== parseInt(String(sessionID), 10)) return;

            if(!actions[sessionID] || !actions[sessionID].args) actions[sessionID] = {args:{}};

            // prm_149786456059798-objectsOrder -> objectsOrder
            var parameterName = arg.slice(String('prm_'+sessionID+'_').length);
            actions[sessionID].args[parameterName] = args[arg];
        } else if(arg.indexOf('actionName-') === 0) {
            sessionID = Number(arg.slice('actionName-'.length));
            if(!sessionID || sessionID !== parseInt(String(sessionID), 10)) return;

            if(!actions[sessionID] || !actions[sessionID].args) actions[sessionID] = {args:{}};

            actions[sessionID].name = args[arg];
        } else if(arg.indexOf('actionID-') === 0) {
            sessionID = Number(arg.slice('actionID-'.length));
            if(!sessionID || sessionID !== parseInt(String(sessionID), 10)) return;

            if(!actions[sessionID] || !actions[sessionID].args) actions[sessionID] = {args:{}};

            actions[sessionID].id = args[arg]; // actionID is a directory name

            if(!actionsIDsObj[args[arg]]) actionsIDsObj[args[arg]] = [sessionID];
            else actionsIDsObj[args[arg]].push(sessionID);
        } else if(arg.indexOf('taskRunType_') === 0) {
            // newApproves[taskID] = runType
            newApproves[arg.slice('taskRunType_'.length)] = Number(args[arg])
        } else if (arg.indexOf('selected-') === 0 && args[arg] === '1') {
            filterSessionIDs.push(Number(arg.slice('selected-'.length)));
        } else if (arg.indexOf('addNewSessionID-') === 0) {
            sessionID = Number(arg.slice('addNewSessionID-'.length));
            if(!sessionID || sessionID !== parseInt(String(sessionID), 10)) return;

            if(!actions[sessionID] || !actions[sessionID].args) actions[sessionID] = {args:{}};

            actions[sessionID].addNewSessionID = Number(args[arg]);
        }
    });

    log.debug('Actions: ', actions);

    tasks.getWorkflow(args.username, function(err, workflow) {
        if (err) return callback(err);

        log.debug('Workflow for user ', args.username, ': ', workflow);
        removeTasks(args.username, removedTaskIDs, workflow, function(err) {
            if(err) log.error(err.message);

            // don\'t update task
            if (removedTaskIDs.indexOf(taskID) !== -1 /*|| taskID === 0 || !args.taskUpdated*/) {
                log.info('Skipping update task ID ', taskID, ' it will be removed');
                taskID = 0;
            }

            updateTask(args, taskID, actions, actionsIDsObj, filterSessionIDs, workflow, function (err) {
                if (err) log.error(err.message);

                if(!Object.keys(newApproves).length) {
                    log.info('No new approves');
                    return callback();
                }

                processApproves(args.username, args.sessionID, newApproves, workflow, function (err) {
                    if (err) log.error(err.message);

                    callback();
                });
            });
        });
    });
}

function updateTask(args, taskID, actions, actionsIDsObj, filterSessionIDs, workflow, callback) {
    if(taskID === 0) return callback();

    log.info('Starting update task ', taskID, '; actions: ', actionsIDsObj);

    if(!args.actionsOrder || typeof args.actionsOrder !== 'string') {
        return callback(new Error('Incorrect actionsOrder parameter "'+args.actionsOrder+'"'));
    }
    var actionsOrder = args.actionsOrder.split(/\s*,\s*/).map(function(sessionIDStr) {
        var sessionID = Number(sessionIDStr);
        if(!sessionID || sessionID !== parseInt(String(sessionID), 10)) return 0;
        return sessionID;
    });

    // checking actionsOrder array for incorrect session ID
    for(var i = 0; i < actionsOrder.length; i++) {
        if(!actionsOrder[i]) return callback(new Error('Incorrect session ID in actionsOrder: "'+args.actionsOrder+'"'));
    }

    var newTaskGroup = Number(args.newTaskGroup);

    // getting user rights for actions in selected task
    tasksDB.checkActionsRights(args.username, Object.keys(actionsIDsObj), null, function(err, actionsRights) {
        if(err) {
            return callback(new Error('Error getting actions rights for user ' + args.username +
                ' for task ID ' + taskID + ': ' + err.message))
        }

        var hasRightsForRunByActions = true;
        for (var actionID in actionsRights) {
            if (!actionsRights[actionID].view) {
                return callback(new Error('User ' + args.username +
                    ' has no rights for view actions in task ID ' + taskID + ': ' + err.message));
            }
            // skip rights check for an unselected action. actionsIDsObj[actionID] = [sessionID1, sessionID2,..]
            if(!hasRightsForRunByActions) continue;
            var thisActionNotSelected = false;
            actionsIDsObj[actionID].forEach(function (sessionID) {
                if(filterSessionIDs.indexOf(sessionID) === -1) thisActionNotSelected = true;
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
                    log.warn('Task name was removed. Repair task name to ', args.taskName);
                }

                // don't change task group for task with empty task name
                if(taskData && !args.taskName) newTaskGroup = taskData.groupID;

                // running all tasks in series for correct transaction processing, and if error occurred in any of running tasks, we will run
                // rollback for transaction
                tasksDB.addTask(args.username, {
                    name: args.taskName,
                    groupID: newTaskGroup,
                    actionsOrder: actionsOrder,
                    taskID: taskID,
                }, actions, function(err, taskID) {
                    if(err) return transactionsDB.rollback(err, callback);

                    var runType = taskData ? taskData.runType : null;

                    processTaskExecutionCondition(args,
                        taskID, hasRightsForRunByActions, filterSessionIDs, workflow, function(err) {
                        if(err) return transactionsDB.rollback(err, callback);

                        // remove approval for this task if something changed
                        removeApproval(args.username, taskID, taskParams, runType, conditionsOCIDs, workflow,
                            function(err, taskNotChanged) {

                            if(err) return transactionsDB.rollback(err, callback);
                            // new task or task group was not changed
                            if(!taskData || newTaskGroup === taskData.groupID) {
                                if(taskNotChanged) return transactionsDB.end(callback);

                                sendMessage(args.username, taskID, workflow, 'change', null,function(err) {
                                    if (err) log.error(err.message);
                                    transactionsDB.end(callback);
                                });
                                return;
                            }

                            tasksDB.getTasksGroupsList(function(err, rows) {
                                if(err) {
                                    return transactionsDB.rollback(new Error('Can\'t get tasks groups list: ' +
                                        err.message), callback);
                                }

                                var oldTaskGroupName = '', newTaskGroupName = '';
                                rows.forEach(function (row) {
                                    if(row.id === taskData.groupID) oldTaskGroupName = row.name;
                                    else if(row.id === newTaskGroup) newTaskGroupName = row.name;
                                });

                                if(!oldTaskGroupName || !newTaskGroupName) {
                                    return transactionsDB.rollback(new Error('Undefined task old group "' +
                                        oldTaskGroupName +
                                        '"(' + taskData.groupID + ') or new task group "' + newTaskGroupName +
                                        '"(' + args.newTaskGroup + ')'), callback);
                                }

                                sendMessage(args.username, taskID, workflow,
                                    oldTaskGroupName + ',' + newTaskGroupName, null,function (err) {
                                        if (err) log.error(err.message);
                                        transactionsDB.end(callback);
                                    });
                            });
                        });
                    });
                });
            });
        });
    });
}

function removeTasks(username, removedTaskIDs, workflow, callback) {
    if(!Array.isArray(removedTaskIDs) || !removedTaskIDs.length) return callback();

    log.info('Tasks for removing: ', removedTaskIDs);

    transactionsDB.begin(function (err) {
        if (err) {
            return callback(new Error('Can\'t start transaction for remove tasks ' + removedTaskIDs.join(',') +
                ': ' + err.message));
        }

        async.eachSeries(removedTaskIDs, function (removedTaskID, callback) {
            /*
            first we send the message, then we delete the task, because we cannot get the properties of the task
            to send the message after deleting the task
             */
            sendMessage(username, removedTaskID, workflow, 'remove', null,function(err) {
                if(err) log.error(err.message);
                tasksDB.removeTask(username, removedTaskID, callback);
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

function getTaskParameters(username, taskID, callback) {
    if(!taskID) return callback();

    tasksDB.getTaskParameters(username, taskID, function(err, taskParameters, taskData, conditionOCIDs) {
        if(err) return callback(err);

        var params = taskParameters.map(function(row) {
            return {
                sessionID: row.sessionID,
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

function removeApproval(username, taskID, taskParams, runType, conditionsOCIDs, workflow, callback) {
    if(!taskParams) {
        log.info('Removing previous approval from new task ', taskID);
        tasksDB.removeApproval(taskID, callback);
        return;
    }

    getTaskParameters(username, taskID, function (err, newTaskParams, newTaskData, newConditionOCIDs) {
        if(err) return callback(err);

        var conditionsOCIDsForCompare = conditionsOCIDs ? conditionsOCIDs.sort().join(',') : '';
        var newConditionOCIDsForCompare = newConditionOCIDs ? newConditionOCIDs.sort().join(',') : '';
        // if runType, action parameters and actions are not changed, do not remove the approval
        if(runType === newTaskData.runType &&
            ((newTaskData.runType !== 0 && newTaskData.runType !== 1 && newTaskData.runType !== 11) ||
            conditionsOCIDsForCompare === newConditionOCIDsForCompare) &&
            JSON.stringify(taskParams) === JSON.stringify(newTaskParams)) {
            log.info('No changes found to delete approval from previously approved task ', taskID);
            return callback(null, true);
        }

        log.info('Removing previous approval from changed task ', taskID, '; runType was\\now: ', runType, '\\', newTaskData.runType,
            '; changes: was: ', JSON.stringify(taskParams), '; now: ', JSON.stringify(newTaskParams));
        tasksDB.removeApproval(taskID, callback);
    });
}

function sendMessage(username, taskID, workflows, action, err, callback) {
    log.info('Send message from user: ', username, ' taskID: ', taskID, ' action: ', action,
        ' workflows: ', workflows, '; err: ', err);

    if(action.indexOf(',') !== -1) action = 'Move from ' + action.split(/ *, */).join(' to ');
    action = action.toLowerCase();
    async.each(workflows, function (workflow, callback) {
        if(typeof workflow.action !== 'string') return callback();
        if(workflow.action.indexOf(',') !== -1) workflow.action = 'Move from ' + workflow.action.split(/ *, */).join(' to ');
        if(workflow.action.toLowerCase() === action) {
            tasks.sendMessage(username, taskID, workflow.message, (err ? err.message : action), callback);
        } else callback();
    }, callback);
}

function processTaskExecutionCondition(args, taskID, hasRightsForRunByActions, filterSessionIDs, workflow, callback) {
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

        tasks.runTask({
            userName: args.username,
            taskID: taskID,
            filterSessionIDs: filterSessionIDs,
            mySessionID: args.sessionID,
        }, function(err) {
            if(err) log.error(err.message);

            sendMessage(args.username, taskID, workflow, 'execute', err, function(err) {
                if(err) log.error(err.message);
                callback();
            });
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

function processApproves(userName, mySessionID, newApproves, workflow, callback) {

    log.info('Processing approves: ', newApproves);
    async.eachSeries(Object.keys(newApproves), function (taskID, callback) {
        var runType = newApproves[taskID];

        tasksDB.checkTaskRights(userName, taskID, 'run', function (err) {
            if(err) return callback(new Error('Error checking the rights to run task ' + taskID + ': ' + err.message));

            // [2 - ask to run now; 12 - run now already started; 32 - canceled run now] => run task now
            if(runType === 2 || runType === 12 || runType === 32) {
                tasks.runTask({
                    userName: userName,
                    taskID: taskID,
                    mySessionID: mySessionID,
                }, function(err) {
                    if(err) log.error(err.message);
                    sendMessage(userName, taskID, workflow, 'execute', err, function(err) {
                        if(err) log.error(err.message);

                        transactionsDB.begin(function(err) {
                            if(err) {
                                return callback(new Error('Can\'t start transaction for save approve for task ID ' +
                                    taskID + ', user: ' + userName + ': ' + err.message));
                            }

                            tasksDB.approveTask(userName, taskID, function (err) {
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

            if(runType < 10) { // there was a request for approval and is now approved
                log.info('Approve task ID ', taskID, ' for runType ', runType, ' user: ', userName);
                tasksDB.approveTask(userName, taskID, function (err) {
                    if(err) return callback(err);
                    addTaskToTaskServer(taskID, runType, workflow,function(err) {
                        if(err) return callback(err);

                        sendMessage(userName, taskID, workflow, 'approve', null, function(err) {
                            if(err) log.error(err.message);
                            callback();
                        });
                    });
                });
            } else if(runType >= 10 && runType < 20 || runType >= 30) { // was launched, but again approved to run, or was canceled, but again approved
                log.info('Approve task ID ', taskID, ' and reset previous runType ', runType, ' to ', String(runType)[1],
                    ' user: ', userName);
                transactionsDB.begin(function(err) {
                    if(err) {
                        return callback(new Error('Can\'t start transaction for save approve for task ID ' +
                            taskID + ', user: ' + userName + ': ' + err.message));
                    }
                    tasksDB.addRunCondition(taskID, runType % 10, null, function(err) {
                        if (err) return transactionsDB.rollback(err, callback);

                        tasksDB.approveTask(userName, taskID, function(err) {
                            if(err) return transactionsDB.rollback(err, callback);

                            addTaskToTaskServer(taskID, runType % 10, workflow, function(err) {
                                if(err) return transactionsDB.rollback(err, callback);
                                transactionsDB.end(function(err) {
                                    if(err) return callback(err);

                                    sendMessage(userName, taskID, workflow, 'approve', null, function(err) {
                                        if(err) log.error(err.message);
                                        callback();
                                    });
                                });
                            })
                        });
                    });
                });
            } else if(runType >= 20 && runType < 30) { // has been approved and is now being canceled
                log.info('Cancel task ID ', taskID, ' for runType ', runType, ' user: ', userName);
                tasksDB.cancelTask(userName, taskID, function(err) {
                    if(err) return callback(err);
                    taskServer.cancelTask(taskID);

                    sendMessage(userName, taskID, workflow, 'cancel', null,  function(err) {
                        if(err) log.error(err.message);
                        callback();
                    });
                });
            } else callback(new Error('Unknown runType: ' + runType + ' for task ID ' + taskID + ' user: ' + userName));
        });
    }, callback);
}

/*
runType = [0,1,2,9]
 */
function addTaskToTaskServer(taskID, runType, workflow, callback) {
    log.debug('Add task to taskServer: ', taskID, '; runType: ', runType);

    if(runType === 9) { // scheduled task by time
        tasksDB.getTaskConditions(taskID, function (err, rows) { // get task schedule time
            if(err) return callback(err);

            if(rows[0].runType < Date.now()) {
                log.warn('Skip to add scheduled task to task server. Task start time has passed: ',
                    new Date(rows[0].runType).toLocaleString());
                return callback();
            }

            log.info('Add task: ', taskID, ', time: ', new Date(rows[0].runType).toLocaleString());
            taskServer.addTask(taskID, rows[0].runType, workflow);
            callback();
        });
        return;
    }

    if(runType !== 0 && runType !== 1) return callback();

    tasksDB.getRunConditionOCIDs(taskID, function (err, rows) {
        if(err) return  callback(err);

        var conditionsOCIDs = rows.map(function (row) {
            return row.OCID;
        });

        log.info('Add task: ', taskID, '; mode: ', runType, '; OCIDs: ', conditionsOCIDs);
        taskServer.addTask(taskID, runType, workflow, conditionsOCIDs);
        callback();
    });
}

/*
    Converting time string in format HH:MM to ms

    timeStr: time string in format HH:MM
    return time in ms
 */
function getTimeFromStr(timeStr) {
    if(!timeStr) return;
    var timeParts = timeStr.match(/^(\d\d?):(\d\d?)$/);
    if(timeParts === null) return;
    return Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000;
}
