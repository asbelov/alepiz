/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const fs = require('fs');
const path = require('path');
const tasksDB = require('../models_db/tasksDB');
const actionClient = require('../serverActions/actionClient');
const objectsDB = require('../models_db/objectsDB');
const rightsWrapperTaskDB = require('../rightsWrappers/tasksDB');
const actionsConf = require('../lib/actionsConf');
const userDB = require('../models_db/usersDB');
const variablesReplace = require('../lib/utils/variablesReplace');
const media = require('../lib/communication');
const history = require('../serverHistory/historyClient');
const unique = require('../lib/utils/unique');
const Conf = require('../lib/conf');
const tasksDBSave = require('../models_db/modifiers/tasksDB');
const conf = new Conf('config/common.json');
const confTaskServer = new Conf('config/taskServer.json');

var tasks = {};
module.exports = tasks;

/**
 * Condition for run the task
 * @typedef {number} runType
 * @example
 * runType values description:
 * null dont run
 * 0  run permanently by condition
 * 1  run once by condition
 * 11 run once by condition and task has already started
 * 2  run now
 * 12 run now and task has already started
 * >100 running on time by schedule (runType is a timestamp)
 */


/**
 * id from tasks database
 * @typedef {number} taskID
 */

/**
 * part of the taskCondition object: id from objectsCounters table (Object counter ID)
 * @typedef {number} OCID
 */

/**
 * part of the taskCondition object: object with action properties
 * @typedef {Object} taskActionIDObj
 * @property {number} taskID task ID
 * @property {Set<OCID>} occurredConditionOCIDs OCIDs for which the condition was met
 * @property {Array} result action execution result
 * @property {function(Error|null, *)} actionCallback callback from the actions of the task
 * @property {Object} param parameters for actionClient.runAction(param, ...)
 */

/**
 * part of the taskCondition object: object with the task parameters
 * @typedef {Object} taskObj
 * @property {Set<OCID>} conditionOCIDs Set of the condition OCIDs for the task
 * @property {taskActionIDObj} [taskActionID] id from tasksActions table as a key contain a taskActionIDObj as a value
 */

 /**
 *
 * @type {Map<taskID, taskObj>} taskCondition
 * @example
 * taskCondition new Map(
 *      <taskID>: {
 *          *conditionOCIDs: Set<OCID>, set in checkCondition() and in tasks.runTask()
 *          *<taskActionID>: { set in runAction
 *              occurredConditionOCIDs: Set<OCID> (set in tasks.checkCondition(), clear in runActionByCondition())
 *              result: <Array>, action results. Set in runAction(), add results in runActionByCondition()
 *              actionCallback: <function(Error|null, result)>, action callback. Set in runAction()
 *              param: parameters for actionClient.runAction(param, ...). Set in runAction()
 *          },
 *          ...
 *      },
 *      ...
 * )
 *
 */
var taskCondition = new Map();

var needToSaveChanges = false, saveChangesInProgress = false;

const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
    '\n': '<br/>',
};

/**
 * Escape not allowed in HTML characters
 * @param {string} string source string
 * @return {string} HTML string with allowed characters
 */
function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/\n]/gm, function (s) {
        return entityMap[s];
    });
}

/**
 * Load conditions, saved ti the taskConditions.json file after last stop
 * Get last value from the history for the all task condition OCIDs and
 * check for the task conditions are met every waitingConditionsTime ms using setInterval()
 * condition will be met when last value for the OCID after convert to the is Boolean() is true
 * @param {function()} callback callback() return after run check conditions loop
 */
tasks.startCheckConditions = function(callback) {
    loadTasksWithApprovedRunConditionFromDB(function (err) {
        if(err) log.error('Error load initial task condition from DB: ', err.message);

        const dataFile = createDataFileName();

        fs.readFile(dataFile, 'utf8', (err, data) => {
            if (err) log.info('Can\'t load task conditions from ', dataFile, ': ', err.message);
            else {
                try {
                    var taskConditionFromFile = JSON.parse(data);
                } catch (err) {
                    log.error('Can\'t parse file with task conditions ', data, ': ', err.message);
                }

                if (taskConditionFromFile && typeof taskConditionFromFile === 'object') {
                    for (var taskID in taskConditionFromFile) {
                        // don't add completed tasks
                        if (!taskCondition.has(Number(taskID))) continue;

                        taskConditionFromFile[taskID].conditionOCIDs = taskCondition[taskID].conditionOCIDs;

                        // convert occurredConditionOCIDs array to the occurredConditionOCIDs Set()
                        for (var taskActionID in taskConditionFromFile[taskID]) {
                            if (Array.isArray(taskConditionFromFile[taskID][taskActionID].occurredConditionOCIDs)) {
                                taskConditionFromFile[taskID][taskActionID].occurredConditionOCIDs =
                                    new Set(taskConditionFromFile[taskID][taskActionID].occurredConditionOCIDs);
                            }
                        }
                        taskCondition.set(Number(taskID), taskConditionFromFile[taskID]);
                    }
                    if(taskCondition.size) {
                        log.info('Successfully loaded approved but not completed task with run condition from DB and ',
                            dataFile, ': ', taskCondition);
                    } else log.info('Not completed approved tasks were not found');
                }
            }

            history.connect('tasks', function () {
                log.info('Connecting to history server. Starting to check conditions for tasks');

                setInterval(function () {
                    if (!taskCondition.size) return;

                    var OCIDs = new Set();
                    taskCondition.forEach(task => {
                        if (!task.conditionOCIDs instanceof Set) return;
                        task.conditionOCIDs.forEach(function (OCID) {
                            OCIDs.add(OCID);
                        });
                    });

                    log.debug('checkCondition: Getting last values for ', OCIDs);
                    history.getLastValues(Array.from(OCIDs), function (err, records) {
                        if (err) {
                            return log.error('Error while getting last history values: ', err.message,
                                ': OCIDs: ', Array.from(OCIDs));
                        }

                        log.debug('checkCondition: history last values: ', records, ' for ', OCIDs);

                        var now = Date.now(), conditionOCIDs = [];
                        // don't use Object.keys(records).filter(..) because also need to convert ID from string to number
                        Object.keys(records).forEach(function (ID) {
                            // now - record.timestamp > 30000 - waiting for other conditions to check them all together
                            // record.data - check only conditions with true result
                            if (records[ID] &&
                                records[ID].timestamp && now - records[ID].timestamp > 30000 &&
                                records[ID].data) {
                                conditionOCIDs.push(Number(ID));
                            }
                        });

                        if (!conditionOCIDs.length) return;

                        log.debug('checkCondition: Conditions occurred: ', conditionOCIDs, '; waiting for: ', OCIDs);
                        tasks.checkCondition(conditionOCIDs);
                    });
                }, Number(confTaskServer.get('waitingConditionsTime')) || 30000);

                callback();
            });
        });
    });
};

/**
 * Create taskCondition structure when running: Map<<taskID>, {conditionOCIDs: Set<OCID>}>
 * @param {function(Error)|function()} callback callback(err)
 */
function loadTasksWithApprovedRunConditionFromDB(callback) {
    tasksDB.getApprovedTasks(function (err, rows) {
        if(err) return callback(err);

        rows.forEach(row => {
            if(!row.OCID) return;
            if(!taskCondition.has(row.taskID)) {
                taskCondition.set(row.taskID, {
                    conditionOCIDs: new Set([row.OCID])
                });
            } else taskCondition.get(row.taskID).conditionOCIDs.add(row.OCID);
        });

        callback();
    });
}

/**
 * Create temp file name with not completed tasks (taskConditions.json)
 * @return {string} file name
 */
function createDataFileName() {
    return path.join(__dirname, '..', (conf.get('tempDir') || 'temp'),
        (confTaskServer.get('dataFile') || 'taskConditions.json'));
}

/**
 * Checking for the approved task which waiting for condition is met
 *
 * @param {Array<number>} OCIDs an array of the OCIDs
 */
tasks.checkCondition = function(OCIDs) {
    if(!taskCondition.size) return;

    taskCondition.forEach((task, taskID) => {
        if(!task.conditionOCIDs instanceof Set) return;

        var occurredConditionOCIDs = new Set(), conditionOCIDs = new Set();
        task.conditionOCIDs.forEach(function (conditionOCID) {
            // save OCID in conditionOCIDs when OCID not found in conditionOCIDs
            if(OCIDs.indexOf(conditionOCID) === -1) conditionOCIDs.add(conditionOCID);
            else occurredConditionOCIDs.add(conditionOCID);
        });

        log.info('Found new conditions: ', OCIDs,', for task ', taskID, ': ', occurredConditionOCIDs,
            ' waiting for: ', conditionOCIDs, '; task: ', task);

        // conditions for this task are not met
        if(conditionOCIDs.size === task.conditionOCIDs.size) return;

        task.conditionOCIDs = conditionOCIDs;
        var taskSession = unique.createID();

        for(var taskActionID in task) {
            if(!Number(taskActionID)) continue;

            if(!task[taskActionID].occurredConditionOCIDs) {
                task[taskActionID].occurredConditionOCIDs = occurredConditionOCIDs;
            } else {
                // merge Set
                task[taskActionID].occurredConditionOCIDs = new Set([
                    ...task[taskActionID].occurredConditionOCIDs,
                    ...occurredConditionOCIDs]);
            }
            runActionByCondition(taskID, Number(taskActionID), taskSession);
            savePartiallyCompletedTasksStateToFile();
        }
    });
};

/**
 * Cancel to check the task when run condition is met
 * @param {number} taskID task ID
 */
tasks.cancelTaskWithCondition = function(taskID) {
    if(taskCondition.has(taskID)) {
        taskCondition.delete(taskID);
    }
};

/**
 * Sending message when something in the task is changed
 * @param {string} username username
 * @param {number} taskID taskID
 * @param {Object} param object with the message parameters ans variables
 * @param {string} action action with the task or error message
 * @param {function(Error)|function()} callback callback(err)
 */
tasks.sendMessage = function(username, taskID, param, action, callback) {
    /*
    TASK_ID, TASK_NAME, TASK_CREATOR, EXECUTE_CONDITION, ACTIONS_DESCRIPTION, ACTIONS_DESCRIPTION_HTML
    */

    taskID = Number(taskID);
    if(!taskID || taskID !== parseInt(String(taskID), 10)) {
        return callback(new Error('Invalid task ID ' + taskID + ' for sending message: ' +
            JSON.stringify(param, null, 4)));
    }


    tasks.getTaskParameters(username, taskID, function (err, taskParam) {
        if(err) {
            return callback(new Error('Error send message taskID ' + taskID + ': '+ err.message + ', param: ' +
                JSON.stringify(param, null, 4)));
        }

        log.debug('Send message task param: ', taskParam);

        if(!taskParam.parameters.name) return callback();

        if(taskParam.parameters.runType > 100) {
            var condition = 'run at ' + new Date(taskParam.parameters.runType).toLocaleString();
        } else if(taskParam.parameters.runType === 2 || taskParam.parameters.runType === 12) {
            condition = 'run now';
        } else if(taskParam.counters && taskParam.objects) {
            if(taskParam.parameters.runType === 0) condition = 'run every time';
            else condition = 'run once' // taskParam.parameters.runType === 11

            var objectsCounters = [];
            for(var OCID in taskParam.counters) {
                objectsCounters.push(taskParam.counters[OCID] + ' (' + taskParam.objects[OCID] + ')');
            }
            condition += ' when condition met: ' + objectsCounters.join('; ');
        } else if(taskParam.parameters.runType === null) {
            condition = 'do not run';
        } else {
            return callback(new Error('Error send message  taskID ' + taskID +
                ': Unexpected runType: ' + taskParam.parameters.runType +
                ', param: ' + JSON.stringify(param, null, 4) +
                '; taskParam: ' + JSON.stringify(taskParam, null, 4)));
        }

        var actionsDescription = [], actionsDescriptionHTML = [], num = 1;
        for(var taskActionID in taskParam.actions) {

            actionsDescription.push(String(num++) + '. ' + taskParam.actions[taskActionID].name +
                ':\n' + taskParam.actions[taskActionID].description);

            actionsDescriptionHTML.push('<li><span class="task-action"><span class="task-action-name">' +
                taskParam.actions[taskActionID].name + '</span><span class="task-action-startup" data-startup-option="' +
                taskParam.actions[taskActionID].startupOptions + '">&nbsp;</span><span class="task-action-description">' +
                taskParam.actions[taskActionID].description + '</span></span></li>');
        }

        param.sender = username;

        // remove stack from error message
        action = action.replace(/at .+?:\d+:\d+.+$/ims, '');

        param.variables = {
            TASK_ID: taskID,
            TASK_NAME: taskParam.parameters.name,
            TASK_CREATOR: taskParam.parameters.ownerName,
            TASK_CREATOR_FULL_NAME: taskParam.parameters.ownerFullName,
            EXECUTE_CONDITION: condition,
            ACTION: action[0].toUpperCase() + action.substring(1),
            ACTIONS_DESCRIPTION: actionsDescription.join('\n\n'),
            ACTIONS_DESCRIPTION_HTML: '<ol class="task-actions-description">' + actionsDescriptionHTML.join('') + '</ol>',
        };

        media.send(param, function (err) {
            if(err) return callback(new Error('Error send message for taskID ' + taskID + ': ' + err.message));
            callback();
        });
    });
}

/*
    run task

    userName: user name
    taskID: task ID
    taskActionID: [taskActionID, taskActionID] - list of actions to run in the specified task. null - run all actions
    variables: {var1: val1, var2: val2, ....}

    callback(err, result)
    result: {
        taskActionID1: actionData1,
        taskActionID2: actionData2,
        ...
    }
*/
/**
 * run the task
 * @param {Object} param task parameters
 * @param {number} param.taskID taskID
 * @param {string} param.userName username
 * @param {Object} [param.variables] variables like {<name>: <value>, ...}
 * @param {Array<number>} [param.filterTaskActionIDs] filtered IDs from the tasksActions table
 * @param {Array<number>} [param.conditionOCIDs] array of the conditions OCIDs
 * @param {number} [param.runType] runType for the task
 * @param {function(Error)|function(null, Object)} callback callback(err, returnedTaskActionsResults) where
 *  returnedTaskActionsResults is {<taskActionID1>: <result1>, <taskActionID2>: <result2>, ....}
 */
tasks.runTask = function(param, callback) {
    var username = param.userName,
        taskID = param.taskID,
        variables = param.variables,
        filterTaskActionIDs = param.filterTaskActionIDs;

    if(typeof callback !== 'function') callback = function (err) { if(err) log.error(err.message); }

    if(param.conditionOCIDs) { // add not completed task to the taskCondition
        taskCondition.set(taskID, {
            conditionOCIDs: new Set(param.conditionOCIDs), // copy array of OCIDs
        });
    }

    if(!username) return callback(new Error('Can\'t run task ' + taskID + ' from undefined user "' + username + '"'));

    if(typeof variables !== 'object' || variables === null) variables = {};
    // username used only for a new undefined task (without taskID)
    tasksDB.getTaskParameters(username, taskID, function(err, taskParameters) {
        if(err) return callback(err);
        if(!Array.isArray(taskParameters) || !taskParameters.length) {
            return callback(new Error('Error while getting task parameters for task ID ' + taskID +
                ': parameters for this task were not found'));
        }

        var actions = {}, actionsOrder = [];

        async.each(taskParameters, function(taskParameter, callback) {
            if(Array.isArray(filterTaskActionIDs) && filterTaskActionIDs.indexOf(taskParameter.taskActionID) === -1) {
                return callback();
            }

            if(!actions[taskParameter.taskActionID]) {
                actions[taskParameter.taskActionID] = {
                    ID: taskParameter.actionID,
                    args: {},
                    startupOption: taskParameter.startupOptions,
                    taskActionID: taskParameter.taskActionID,
                };
                actionsOrder.push(taskParameter.taskActionID);
            }

            replaceVariablesToValues(taskParameter.name, taskParameter.value, variables, function(err, value) {
                if(err) return callback(err);

                actions[taskParameter.taskActionID].args[taskParameter.name] = value;
                callback();
            });

        }, function(err) {
            if(err) return callback(err);

            if(!actionsOrder.length) {
                log.debug('Task ' + taskID + ' does not contain an actions for sessions IDs :' +
                    filterTaskActionIDs.join(', '));
                return callback(new Error('Task ' + taskID + ' does not contain an actions for sessions IDs :' +
                filterTaskActionIDs.join(', ')));
            }

            log.debug('Starting create the task stack ', taskID, '; user: "', username, '"; variables: ', variables,
                '; order: ', actionsOrder,
                (Array.isArray(filterTaskActionIDs) ? '; filterTaskActionIDs: ' + filterTaskActionIDs.join(', ') : ''),
                (Array.isArray(param.conditionOCIDs) ? '; task conditions: ' + param.conditionOCIDs.join(',') : ''));

            var startTaskTime = Date.now();
            runTaskFunction(username, taskID, actions, actionsOrder, function(err, returnedTaskActionsResults) {
                // returnedTaskActionsResults = {<taskActionID1>: <value1>, <taskActionID2>: <value2>, ....}

                log.info('End task ', taskID, '; user: "', username,
                    '", executing time: ', Date.now() - startTaskTime, 'ms');
                log.debug('Task actions: ', actions, '; returned: ', returnedTaskActionsResults, ', err: ', err);

                if(!taskCondition.has(taskID)) return callback(err, returnedTaskActionsResults);

                taskCondition.delete(taskID);

                // run the task permanently when the condition is met next time
                if(param.runType === 0) {
                    taskCondition.set(taskID, {
                        conditionOCIDs: new Set(param.conditionOCIDs),
                    });
                    return callback(err, returnedTaskActionsResults);
                }

                // for run once when condition met, running from taskServer
                tasksDBSave.updateRunCondition(Number(taskID), 11, function(_err) {
                    if(_err) log.error('Error marking run once task ', taskID, ' as completed: ', _err.message);
                    else log.info('Marking run once task ', taskID, ' as completed');
                    callback(err, returnedTaskActionsResults);
                });
            });
        });
    });
};

/**
 * Creating task function from action functions using actionClient.runAction() according startupOption for each action
 * and running this task function.
 * @param {string} username username which run task for check user rights for each action
 * @param {number} taskID taskID
 * @param {Object} actions {taskActionID1: {ID: <actionID>, args: {prm1:val1, prm2:val2,...},
 *  startupOption: 0|1|2|3}, taskActionID2: ....}
 * @param {Array<number>} actionsOrder array of the IDs from the tasksActions table in order of the actions execution
 *  [taskActionID1, taskActionID2,...]
 * @param {function(Error)|function(null, Object)} callback callback(err, returnedTaskActionsResults) where
 *  returnedTaskActionsResults is {<taskActionID1>: <result1>, <taskActionID2>: <result2>, ....}
 */
function runTaskFunction(username, taskID, actions, actionsOrder, callback) {

    var result = {},
        taskSession = unique.createID(),
        nextStartupOption = 3,
        // array with parallel executed actions
        actionFunctionsRunInParallel = [],
        // push callback as a last function in a array for success or error
        actionFunctionOnError = [function (err) { callback(err, result)}],
        actionFunctionOnSuccess = [function (err) { callback(err, result)}];


    actions[actionsOrder[0]].startupOption = 3;

    /*
    * startupOption:
    * 0 - execute current action if previous action completed without errors
    * 1 - execute current actions if someone of previous actions completed with errors
    * 2 - execute current action in parallel with a previous action
    * 3 - runAnyway
    * */
    log.debug('Actions in task ', taskID, ': ', actionsOrder);

    // processing actions in reverse order
    actionsOrder.reverse().forEach(function(taskActionID) {

        // the next action was the last of the actions running in parallel.
        // create a success function from an array with next parallel executed actions
        if ( actionFunctionsRunInParallel.length && actions[taskActionID].startupOption !== 2 ) {
            log.debug('createTask: add previous parallel actions: ', actionFunctionsRunInParallel.length,
                ', ', actions[taskActionID].ID, ' (', actions[taskActionID].args, '). onSuccess: ',
                actionFunctionOnSuccess.length, '; onError: ', actionFunctionOnError.length);

            // closure
            (function(_actionFunctionsRunInParallel, _actionFunctionOnSuccess, _actionFunctionOnError) {
                actionFunctionOnSuccess.push(function (err, prevResult) {

                    var errors = [];
                    var __actionFunctionsRunInParallel =
                        _actionFunctionsRunInParallel.map(function (action) {
                            return function (callback) {
                                action.func(prevResult, function(err, res) {
                                    if(err) errors.push(action.name + ': ' + err.message);
                                    callback(null, res);
                                });
                            }
                        });

                    async.parallel(__actionFunctionsRunInParallel, function (err, results) {
                        if (errors.length) {
                            return _actionFunctionOnError(new Error('Error in parallel running actions: ' +
                                errors.join('; ')), results);
                        }
                        // results = {taskActionID1: result1, taskActionID2: result2}
                        _actionFunctionOnSuccess(null, results);
                    });
                });
            }) (actionFunctionsRunInParallel,
                actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1]
            );

            actionFunctionsRunInParallel = [];
        }

        // push success function to array for run if prev action completed without errors (0) or for run anyway (3)
        if( actions[taskActionID].startupOption === 0 || actions[taskActionID].startupOption === 3 ) {
            // closure
            (function(_actionFunctionOnSuccess, _actionFunctionOnError, _taskActionID, _nextStartupOption) {
                actionFunctionOnSuccess.push(function (err, prevResult) {

                    // replace %:PREV_ACTION_RESULT:% variable to value of previous action execution result
                    var _args = {};
                    async.eachOf(actions[_taskActionID].args, function(valueWithVariables, name, callback) {
                        replaceVariablesToValues(name, valueWithVariables, {PREV_ACTION_RESULT: prevResult},
                            function(err, value) {

                            if(err) return callback(err);

                            _args[name] = value;
                            callback();
                        })
                    }, function(err) {
                        if(err) return _actionFunctionOnError(err);

                        runAction({
                            actionID: actions[_taskActionID].ID,
                            executionMode: 'server',
                            user: username,
                            args: _args,
                            taskActionID: _taskActionID,
                            taskID: taskID,
                            taskSession: taskSession,
                        }, function (err, data) {
                            if (err && _nextStartupOption !== 3) {
                                return _actionFunctionOnError(err);
                            }

                            result[actions[_taskActionID].ID + ':' + _taskActionID] = data;
                            _actionFunctionOnSuccess(err, data);
                        });
                    });
                });
            }) (actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1],
                taskActionID,
                nextStartupOption,
            );

            log.debug('createTask: add onSuccess actions ', taskActionID, ', ' +
                'nextStartupOption: ', nextStartupOption,
                ', ', actions[taskActionID].ID, ' (', actions[taskActionID].args, '). onSuccess: ',
                actionFunctionOnSuccess.length, '; onError: ', actionFunctionOnError.length);

            // push error function in array for run if some of prev action executed with an errors (1)
        } else if ( actions[taskActionID].startupOption === 1 ) {
            // closure
            (function(_actionFunctionOnSuccess, _actionFunctionOnError, _taskActionID) {
                actionFunctionOnError.push(function (prevErr) {

                    actions[taskActionID].args.__prevError = prevErr;

                    runAction({
                        actionID: actions[_taskActionID].ID,
                        executionMode: 'server',
                        user: username,
                        args: actions[_taskActionID].args,
                        taskActionID: _taskActionID,
                        taskID: taskID,
                        taskSession: taskSession,
                    }, function (err, data) {
                        if (err) return _actionFunctionOnError(err);
                        result[actions[_taskActionID].ID + ':' + _taskActionID] = data;
                        _actionFunctionOnSuccess(null, data);
                    });
                });
            }) (actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1],
                taskActionID,
            );

            log.debug('createTask: add onError action ', taskActionID,
                ', ', actions[taskActionID].ID, ' (', actions[taskActionID].args, '). onSuccess: ',
                actionFunctionOnSuccess.length, '; onError: ', actionFunctionOnError.length);

        // push function in special array with parallel executed actions for run and don't wait until the prev
        // action will be completed (2)
        } else if( actions[taskActionID].startupOption === 2 ) {
            // closure
            (function(_taskActionID) {
                actionFunctionsRunInParallel.push({
                    name: actions[_taskActionID].ID + '(' + JSON.stringify(actions[_taskActionID].args) + '): ' + _taskActionID,
                    func: function (prevResult, callback) {
                        // replace %:PREV_ACTION_RESULT:% variable to value of previous action execution result
                        var _args = {};
                        async.eachOf(actions[_taskActionID].args, function(valueWithVariables, name, callback) {
                            replaceVariablesToValues(name, valueWithVariables, {PREV_ACTION_RESULT: prevResult},
                                function(err, value) {

                                    if(err) return callback(err);

                                    _args[name] = value;
                                    callback();
                                })
                        }, function(err) {
                            if(err) return callback(err);

                            runAction({
                                actionID: actions[_taskActionID].ID,
                                executionMode: 'server',
                                user: username,
                                args: _args,
                                taskActionID: _taskActionID,
                                taskID: taskID,
                                taskSession: taskSession,
                            }, function (err, data) {
                                if (err) return callback(err);
                                result[actions[_taskActionID].ID + ':' + _taskActionID] = data;
                                callback(null, data);
                            });
                        });
                    }
                });
            }) (taskActionID)

            log.debug('createTask: add parallel executed action ', taskActionID,
                ', ', actions[taskActionID].ID, ' (', actions[taskActionID].args, '). actionFunctionsRunInParallel: ',
                actionFunctionsRunInParallel.length);

        } else {
            log.error('Unknown startupOption "', actions[taskActionID].startupOption, '" for action ',
                taskActionID, ': ', actions[taskActionID].ID);
        }

        nextStartupOption = actions[taskActionID].startupOption;
    });

    log.debug('Beginning task execution with actions: ', actions);

    // last function in array is a task function
    actionFunctionOnSuccess[actionFunctionOnSuccess.length-1]();
}

/**
 * Sync replace variables in action parameter to them values
 * @param {string} name action parameter name. used for perform special processing for parameter 'o'
 * @param {string} value action parameter value with or without variables, f.e.
 *     "This is action parameter value with variable1: %:VARIABLE1:% and variable2: %:VARIABLE2:%"
 * @param {Object} variables {<name1>: <val1>, <name2>: <val2>, ....}
 * @param {function(Error)|function(null, string)} callback callback(err, <string with replaced variables>)
 */
function replaceVariablesToValues(name, value, variables, callback) {

    if(!value || typeof value !== 'string' || !variables) return callback(null, value);

    var res = variablesReplace(value, variables);
    if(!res) return callback(null, value);
    if(name.toLowerCase() !== 'o') return callback(null, res.value);

    // processing 'o' parameter
    // result of processing will be an array of objects [{name: .., id:..}, {..}, ...]
    // Variable value can be a one of stringify JSON objects:
    // object ID, array of objects IDs, object name, array of objects names, comma separated objects names or
    // an array of objects [{name: .., id:..}, {..}, ...].

    if(Number(res.value) === parseInt(String(res.value), 10)) var values = [Number(res.value)]; // single objectID
    else if(typeof res.value === 'string') {
        if(res.value.trim().toUpperCase() === '%:PREV_ACTION_RESULT:%') return callback(null, '%:PREV_ACTION_RESULT:%');
        // stringify JSON object: objectID, array of objects IDs, object name, array of objects
        // names or array of objects [{name: .., id:..}, {..}, ...]
        try {
            values  = JSON.parse(res.value);
        } catch(e) {
            // String with comma separated object names. ("qwerty".split(/\s*?[,;]\s*?/) = ["qwerty"])
            values = res.value.split(/\s*?[,;]\s*?/);
        }
        // after parsing I hope, that 'values' will be an array
    } else {
        return callback(new Error('Variable "' + value + '" value ' + res.value + '(parsed from ' + value +
            ') has incorrect type: ' + typeof res.value));
    }

    if(!Array.isArray(values)) {
        return callback(new Error('Variable "' + value + '" value ' + res.value + ' (source ' + value +
            ') has incorrect type: ' + typeof res.value));
    }
    if(!values.length) return callback(null, '[]');

    // check parsed object for correct values and try to understand, what array contain:
    // objects IDs, objects names or objects with id an name
    for(var i = 0, type = 0; i < values.length; i++) {

        // object ID
        if(typeof values[i] === 'number' && values[i] === parseInt(String(values[i]), 10)) {
            if(!type) type = 2;
            else if(type !== 2) {
                return callback(new Error('Incorrect object ID ' +
                    JSON.stringify(values[i], null, 4) + ' in ' + res.value + ' (source ' + value + ')'));
            }

            // object name
        } else if(typeof  values[i] === 'string') {
            if(!type) type = 3;
            else if(type !== 3) {
                return callback(new Error('Incorrect object name ' +
                    JSON.stringify(values[i], null, 4) + ' in ' + res.value + ' (source ' + value + ')'));
            }

            // {name:.., id:...}
        } else if(typeof values[i] === 'object' &&
            values[i].id && Number(values[i].id) === parseInt(String(values[i].id), 10) &&
            typeof values[i].name === 'string') {

            if(!type) type = 1;
            else if(type !== 1) {
                return callback(new Error('Incorrect object ' + JSON.stringify(values[i], null, 4) +
                    '. It must contain {name: <objectName>, id: <objectID>} in : ' +
                    res.value + '(parsed from ' + value + ')'));
            }

        } else {
            return callback(new Error('Incorrect ' + JSON.stringify(values[i], null, 4) +
                ' in ' + res.value + '(parsed from ' + value + ')'));
        }
    }

    if(type === 1) return callback(null, JSON.stringify(values)); // {name:.., id:...}
    else if(type === 2) { // object ID
        // select * from objects
        var getObjectsParameters = function(values, callback) { objectsDB.getObjectsByIDs(values, callback) };
    } else if(type === 3) { // object name
        // select id, name from objects
        getObjectsParameters = function(values, callback) { objectsDB.getObjectsLikeNames(values, callback) };
    } else {
        return callback(new Error('Error while parse "' + res.value + '", (source "' + value +
            '", type: ' + typeof(value) +')'));
    }

    // get objects [{name:.., id:...}, {..}, ... ] by objects IDs or objects names
    getObjectsParameters(values, function(err, rows) {
        if(err) return callback(new Error('Error getting object information from DB: ' + err.message));

        var value = JSON.stringify(
            rows.map(function(row) {
                return {
                    id: Number(row.id),
                    name: row.name
                }
            }));
        log.debug('Replacing variable "o" = "', value, '"; type: ',
            (type===1 ? 'object' : (type===2 ? 'ID': (type===3 ? 'name' : 'unknown'))), ' result: ', value);
        callback(null, value);
    });
}

/**
 * Run the action according occurred task run condition
 * @param {number} taskID task ID
 * @param {number} taskActionID id from the tasksActions table for run specific action
 * @param {number} taskSession unique task session ID
 * @return
 */
function runActionByCondition(taskID, taskActionID, taskSession) {

    var task = taskCondition.get(taskID);
    // param was set in runAction(param)
    var param = task[taskActionID].param;
    var actionCallback = task[taskActionID].actionCallback;
    var occurredConditionOCIDs = new Set(task[taskActionID].occurredConditionOCIDs);
    task[taskActionID].occurredConditionOCIDs = new Set();

    if(!param) {
        log.warn('Can\'t run action ', taskActionID, ' for task ', taskID, ': action parameters were not set: ', task);
        return;
    }

    log.debug('Running action ', taskActionID, ', conditions: ', occurredConditionOCIDs,
        '; remain: ', task.conditionOCIDs,
        ' action: ', task[taskActionID]);

    if(!param.args) param.args = {};
    param.taskID = taskID;
    param.taskSession = taskSession;

    // run the action if all conditions are met
    if(!task.conditionOCIDs.size) {
        log.info('Starting action ', taskActionID, ', task ', taskID,
            ' for all remaining occurrences of conditions for OCIDs: ', occurredConditionOCIDs, '; o=', param.args.o,
            '; param: ', param);
        actionClient.runAction(param, function(err, result) {
            if(err) {
                log.error('Error in action ', taskActionID, ', task: ', taskID,
                    ', running for all remaining conditions: ', err.message);
                return actionCallback(err);
            }

            // if the task is canceled during the execution of the action
            // or action was started once and this result unique
            if(!task || !task[taskActionID] || !task[taskActionID].result.length) {
                return actionCallback(null, result);
            }

            if(result !== undefined) addToResult(taskID, taskActionID, result);

            actionCallback(null, task[taskActionID].result);
        });
        return;
    }

    if(!occurredConditionOCIDs || !occurredConditionOCIDs.size) {
        log.debug('There are no occurred conditions for action ', taskActionID, ' of the task ', taskID,
            ', waiting when conditions ', task.conditionOCIDs, ' are occur');
        return;
    }

    // try to parse stringified "o" parameter
    // if the action does not have "o" parameter, waiting while all conditions are met
    var args_o = [];
    if(Array.isArray(param.args.o)) {
        if(param.args.o.length) args_o = param.args.o;
        else {
            return log.debug('Parameter "o" is empty array for the task ', taskID, ', action ', taskActionID,
                '. "o": ', param.args.o);
        }
    } else if(typeof param.args.o === 'string') {
        try {
            args_o = JSON.parse(param.args.o);
            if(!Array.isArray(args_o) || !args_o.length) {
                return log.debug('Parameter "o" is empty or not an array for the task ', taskID,
                    ', action ', taskActionID, '. "o": ', param.args.o);
            }
        } catch (e) {
            log.debug('Error parse "o" parameter for the task ', taskID, ', action ', taskActionID,
                '. "o": ', param.args.o,
                '; err: ', e.message);
            return;
        }
    } else {
        log.debug('"o" parameter not a string and not an array for the task ', taskID, ', action ', taskActionID,
            '. "o": ', param.args.o);
        return;
    }

    objectsDB.getObjectsByOCIDs(Array.from(occurredConditionOCIDs), function (err, rows) {
        if(err) {
            log.error('Can\'t get objects IDs for occurred conditions OCIDs ' , occurredConditionOCIDs,
                ': ', err.message);
            return;
        }

        var occurredConditionsObjectsIDs = {};
        rows.forEach(function (row) {
            occurredConditionsObjectsIDs[row.objectID] = true;
        });

        var objectsForAction = []; // action will running for objects from condition
        // remove objects from "o" action parameter
        args_o = args_o.filter(function(object) {
            if(!occurredConditionsObjectsIDs[object.id]) return true;
            else if(object.id && object.name) objectsForAction.push(object);
        });

        if(typeof param.args.o === 'string') param.args.o = JSON.stringify(args_o);

        log.debug('Occurred condition for objects: ', occurredConditionsObjectsIDs, ', OCIDs: ', occurredConditionOCIDs,
            '; objects in action remain: ', param.args.o,
            '; conditions for objects for action occurred : ', objectsForAction);

        // do not run the action if the action does not have objects that match the objects from the current condition
        if(!objectsForAction.length) return;

        // copy param object to paramCopy for run action with a new args.o object and save param object
        var paramCopy = {};
        for(var key in param) {
            if(typeof(param[key]) !== 'object') paramCopy[key] = param[key];
            else {
                paramCopy[key] = {};
                for(var subKey in param[key]) {
                    paramCopy[key][subKey] = param[key][subKey];
                }
            }
        }

        paramCopy.args.o = JSON.stringify(objectsForAction);

        log.info('Starting action ', taskActionID, ', task ', taskID,
            ' for occurred condition: ', occurredConditionOCIDs, '; o=', paramCopy.args.o, '; remain o=', param.args.o,
            '; param: ', paramCopy);

        // run action for objects from condition
        actionClient.runAction(paramCopy, function(err, result) {
            if(err) {
                log.error('Error in action ', taskActionID, ', task: ', taskID, ', running for conditions: ',
                    occurredConditionOCIDs, ': ', err.message);
                return actionCallback(err);
            }

            // if the task is canceled during the execution of the action
            if(!task || !task[taskActionID]) {
                return actionCallback(null, result);
            }

            if(result !== undefined) addToResult(taskID, taskActionID, result);

            // run action callback if param.args.o has not an objects i.e. action was executed for all action object
            if(!args_o.length) {
                actionCallback(null, task[taskActionID].result);
            }
        });
    })
}

/**
 * Run the action
 * @param {Object} param object with action parameters
 * @param {string} param.actionID action directory name
 * @param {number} param.taskID task ID if action running from the task
 * @param {number} param.taskSession unique task session ID if action running from the task
 * @param {number} param.taskActionID id from the tasksActions table
 * @param {'server'} param.executionMode="server" one of execution modes
 * @param {string} param.user username
 * @param {object} param.args - object with action arguments like {<name>: <value>, ...}
 * @param {function(Error)|function(null, string)} callback callback(err, <string with replaced variables>)
 */
function runAction(param, callback) {
    var taskID = param.taskID;

    // run action immediately if task has not run condition
    var taskActionID = param.taskActionID;
    if(!taskCondition.has(taskID)) {
        log.debug('Running action ', taskActionID, ' action: ', param);
        return actionClient.runAction(param, callback);
    }

    var task = taskCondition.get(taskID)
    if(!task[taskActionID]) {
        task[taskActionID] = {
            result: [],
        }
    }
    task[taskActionID].param = param;
    task[taskActionID].actionCallback = callback;
    savePartiallyCompletedTasksStateToFile();

    // occurredConditionOCIDs may be loaded from file before
    runActionByCondition(taskID, taskActionID, param.taskSession);
}

/**
 * Add new action result to the existing array with action results
 * @param {number} taskID task ID
 * @param {number } taskActionID id from the tasksActions table
 * @param {*} result action execution result for add
 */
function addToResult(taskID, taskActionID, result) {
    taskCondition.get(taskID)[taskActionID].result.push(result);
    savePartiallyCompletedTasksStateToFile();
}

/**
 * Save partially completed tasks data from taskCondition to the file (for correct run uncompleted task after restart)
 */
function savePartiallyCompletedTasksStateToFile() {

    if(saveChangesInProgress) {
        needToSaveChanges = true;
        return;
    }
    saveChangesInProgress = true;

    /**
     * Create an object with partially completed tasks for save to the file.
     * Save only not completed tasks with occurred conditions
     * @type {Object}
     * @example
     * {
     *     <taskID>: {
     *         <taskActionID>: {
     *             result: <Array>, action results,
     *             param: <Object> >parameters for actionClient.runAction(param, ...),
     *             occurredConditionOCIDs: <Array> with occurred OCIDs,
     *         }
     *     }
     * }
     */
    var partiallyCompletedTasksWithRunConditionsForSaveToFile = {};
    taskCondition.forEach((taskObj, taskID) => {
        // don't save conditionOCIDs because they will be loaded from DB

        for(var taskActionID in taskObj) {
            if(taskObj[taskActionID].occurredConditionOCIDs instanceof Set &&
                taskObj[taskActionID].occurredConditionOCIDs.size
            ) {
                if(!partiallyCompletedTasksWithRunConditionsForSaveToFile[taskID]) {
                    partiallyCompletedTasksWithRunConditionsForSaveToFile[taskID] = {};
                }

                partiallyCompletedTasksWithRunConditionsForSaveToFile[taskID][taskActionID] = {
                    result: taskObj[taskActionID].result,
                    param: taskObj[taskActionID].param,
                    occurredConditionOCIDs: Array.from(taskObj[taskActionID].occurredConditionOCIDs)
                }
            }
        }
    });

    try {
        var data = JSON.stringify(partiallyCompletedTasksWithRunConditionsForSaveToFile);
    } catch (e) {
        saveChangesInProgress = false;
        return log.error('Can\'t stringify task condition data for save changes: ' + e.message);
    }

    const dataFile = createDataFileName();

    fs.writeFile(dataFile, data, 'utf-8', function (err) {
        saveChangesInProgress = false;
        if(err) log.error('Can\'t save stringified task data to ' + dataFile + ': ' + err.message);
        if(needToSaveChanges) {
            needToSaveChanges = false;
            savePartiallyCompletedTasksStateToFile();
        }
    });
}

/**
 * Get workflow and allowed taskGroupIDs for specific user
 * @param {string} username username
 * @param {function(Error)|function(null, Array, Array)} callback callback(err, workflow, allowedTaskGroupIDs) where
 * workflow is an array from the config.json for the task_maker action with workflow of the specific username
 * allowedTasksGroupsIDs is an array with allowed taskGroupIDs
 */
tasks.getWorkflow = function (username, callback) {
    actionsConf.getConfiguration('task_maker', function(err, actionCfg) {
        if (err) return callback(err);

        userDB.getUsersInformation(username, function (err, rows) {
            if (err) return callback(new Error('Can\'t get user roles for ' + username + ': ' + err.message));

            var workflow = [], userRoles = {};
            rows.forEach(function (row) {
                if(actionCfg.workflow &&
                    Array.isArray(actionCfg.rolesPriority) &&
                    !workflow.length &&
                    actionCfg.rolesPriority.indexOf(row.roleName) !== -1 &&
                    Array.isArray(actionCfg.workflow[row.roleName])
                ) {
                    workflow = actionCfg.workflow[row.roleName];
                }
                userRoles[row.roleID] = true;
            });

            tasksDB.getRoles(function (err, rows) {
                if (err) return callback(new Error('Can\'t get task groups roles: ' + err.message));

                var allowedTaskGroupIDs = [];
                rows.forEach(function (row) {
                    if (userRoles[row.roleID]) allowedTaskGroupIDs.push(row.taskGroupID);
                });

                callback(null, workflow, allowedTaskGroupIDs);
            });
        });
    });
}

/**
 * Return parameters for actions from the task
 *
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Object)} callback callback(err, taskParameters)
 * @example
 * taskParameters: {
 *      actionsConfiguration: see bellow,
 *      parameters: taskData[0] from rightsWrapperTaskDB.getTaskParameters(): {
 *          id: <taskID>,
 *          name: <taskName>,
 *          timestamp: <taskCreatedTime>,
 *          group: <taskGroupName>,
 *          ownerName: <task creator login>,
 *          ownerFullName: <task creator full name>,
 *          runType: <task condition runType>,
 *          conditionTimestamp: <task condition timestamp>
 *      },
 *      OCIDs: OCIDs from rightsWrapperTaskDB.getTaskParameters(): [<OCID1>, <OCID2>, ...]
 *      counters: counters from rightsWrapperTaskDB.getTaskParameters(): {<OCID>: <counterName>, ...}
 *      objects: objects from rightsWrapperTaskDB.getTaskParameters(): {<OCID>: <objectName>, ...}
 *      canExecuteTask: !err from rightsWrapperTaskDB.checkActionsRights()
 * }
 * actionsConfiguration - [
 *     <taskActionID1>: {
 *         ID: actionID
 *         name: actionName,
 *         startupOptions: action startUp options
 *         actionsOrder: actionsOrder
 *         parameters: {name:.., value:.., ...} - parameters from web form, sent for the actions
 *
 *         configuration: {
 *                 <action config from action config.json file>,
 *                 link: path to action
 *                 actionID: actionID
 *             }
 *         description: string - prepared description for the action from descriptionTemplate parameter and from parameters
 *         descriptionHTML: string - prepared description for the action from descriptionTemplateHTML parameter and from parameters
 *     },
 *     <taskActionID2>: {.....},
 *     ....]
 */
tasks.getTaskParameters = function (username, taskID, callback) {
    rightsWrapperTaskDB.getTaskParameters(username, taskID,
        function(err, taskParameters, taskData, OCIDs, counters, objects) {

        if(err) {
            return callback(new Error('Error while getting task parameters for user: ' + username + ', taskID: ' +
                taskID + ': ' + err.message));
        }

        if(!taskData || !taskData.length) {
            return callback(new Error('Task with taskID "' + taskID + '" is not found in database'));
        }

        var actions = {};

        // taskParameters: [{taskActionID:.., name:<taskParameterName>, value:.., actionID:<actionID ie action dir>,
            // actionName:<actionName>, startupOptions: ...},..]

        var actionsIDsObj = {};
        taskParameters.forEach(function(param) {

            var taskActionID = Number(param.taskActionID);
            if(taskActionID !== parseInt(String(taskActionID), 10)) return;

            if(!actions[taskActionID]) {
                actionsIDsObj[param.actionID] = true;

                actions[taskActionID] = {
                    ID: param.actionID,
                    name: param.actionName,
                    startupOptions: param.startupOptions,
                    parameters: [],
                    actionsOrder: param.actionsOrder,
                };
            }

            actions[taskActionID].parameters.push({
                name: param.name,
                value: param.value
            });
        });

        async.eachOf(actions, function(action, taskActionID, callback) {

            actionsConf.getConfiguration(action.ID, function(err, actionCfg){
                if(err) return callback(err);

                log.debug('Configuration for action ', action.ID, ': ', actionCfg);
                action.name = actionCfg.name;

                async.parallel([
                    function (callback) {
                        if(!actionCfg.descriptionTemplateHTML) return callback();

                        actionsConf.makeActionDescription(actionCfg.descriptionTemplateHTML, action.parameters,
                            function(err, description) {

                            if(err) return callback(err);

                            log.debug('HTML description for action ', action.ID, ': ', description);
                            action.descriptionHTML = description;
                            callback();
                        });
                    },
                    function (callback) {
                        actionsConf.makeActionDescription(actionCfg.descriptionTemplate, action.parameters,
                            function(err, description) {

                            if(err) return callback(err);

                            log.debug('Description for ', action.ID, ': ', description);

                            action.configuration = actionCfg;
                            action.description = description;
                            if(action.descriptionHTML === undefined) {
                                action.descriptionHTML = escapeHtml(description).split('\n').join('<br/>');
                            }
                            callback();
                        });
                    }
                ], callback);
            });
        }, function(err) {
            // don't return callback(err, actions), because you can send with err private information in 'actions'
            if(err) return callback(err);

            rightsWrapperTaskDB.checkActionsRights(username, Object.keys(actionsIDsObj), 'run',
                function(err) {

                callback(null, {
                    actions: actions,
                    parameters: taskData[0],
                    OCIDs: OCIDs,
                    counters: counters,
                    objects: objects,
                    canExecuteTask: !err, // if err, then false, else true
                });
            });
        });
    });
}