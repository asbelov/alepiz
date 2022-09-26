/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var fs = require('fs');
var path = require('path');
var log = require('../lib/log')(module);
var tasksDB = require('../models_DB/tasksDB');
var actionClient = require('../serverActions/actionClient');
var objectsDB = require('../models_db/objectsDB');
var rightsWrapper = require('../rightsWrappers/tasksDB');
var actionsConf = require('../lib/actionsConf');
var userDB = require('../models_db/usersDB');
const variablesReplace = require('../lib/utils/variablesReplace');
var media = require('../lib/communication');
var history = require('../models_history/history');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confTaskServer = new Conf('config/taskServer.json');

var dataFile = path.join(__dirname, '..', (conf.get('tempDir') || 'temp'), (confTaskServer.get('dataFile') || 'taskConditions.json'));

var tasks = {};
module.exports = tasks;

var taskCondition = {}, needToSaveChanges = false, saveChangesInProgress = false;

var entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
    });
}

tasks.startCheckConditions = function(callback) {
    history.connect(null, function (err) {
        if(err) return callback(err);

        fs.readFile(dataFile, 'utf8', (err, data) => {
            if(err) log.info('Can\'t load task conditions from ', dataFile, ': ', err.message);
            else {
                try {
                    var _taskConditions = JSON.parse(data);
                } catch (err) {
                    log.error('Can\'t parse file with task conditions ', data, ': ', err.message);
                }

                if (_taskConditions) {
                    taskCondition = _taskConditions;
                    log.info('Successfully loading ', Object.keys(taskCondition).length, ' conditions from ', dataFile);
                }
            }

            log.info('Connecting to history server. Starting to check conditions for tasks');

            setInterval(function() {
                if(!Object.keys(taskCondition).length) return;

                var OCIDs = {};
                for(var taskID in taskCondition) {
                    if (!Array.isArray(taskCondition[taskID].conditionOCIDs)) continue;
                    taskCondition[taskID].conditionOCIDs.forEach(function (OCID) {
                        OCIDs[OCID] = true;
                    });
                }

                //log.debug('Getting last values for ', OCIDs);
                history.getLastValues(Object.keys(OCIDs), function (err, records) {
                    //log.debug('Last values: ', records);

                    var now = Date.now(), conditionOCIDs = [];
                    // don't use Object.keys(records).filter(..) because also need to convert ID from string to number
                    Object.keys(records).forEach(function (ID) {
                        // now - record.timestamp > 30000 - waiting for other conditions to check them all together
                        // record.data - check only conditions with true result
                        if(records[ID] &&
                            records[ID].timestamp && now - records[ID].timestamp > 30000 &&
                            records[ID].data) {
                            conditionOCIDs.push(Number(ID));
                        }
                    });

                    if(!conditionOCIDs.length) return;

                    //log.info('Conditions occurred: ', conditionOCIDs, '; waiting for conditions: ', OCIDs);
                    tasks.checkCondition(conditionOCIDs);
                })
            }, Number(confTaskServer.get('waitingConditionsTime')) || 30000);

            callback();
        });
    });
};

tasks.checkCondition = function(OCIDs) {
    if(!Object.keys(taskCondition).length) return;

    for(var taskID in taskCondition) {
        var task = taskCondition[taskID];

        if(!Array.isArray(task.conditionOCIDs)) continue;

        var occurredConditionOCIDs = [], conditionOCIDs = [];
        task.conditionOCIDs.forEach(function (conditionOCID) {
            // save OCID in conditionOCIDs when OCID not found in conditionOCIDs
            if(OCIDs.indexOf(conditionOCID) === -1) conditionOCIDs.push(conditionOCID);
            else occurredConditionOCIDs.push(conditionOCID);
        });

        log.info('Found new conditions: ', OCIDs,', for task ', taskID, ': ', occurredConditionOCIDs,
            ' waiting for: ', conditionOCIDs, '; task: ', task);

        // conditions for this task are not met
        if(conditionOCIDs.length === task.conditionOCIDs.length) continue;

        task.conditionOCIDs = conditionOCIDs;
        saveTasksStateToFile();

        for(var taskActionID in task) {
            if(task[taskActionID].actionParam) {
                if(!taskCondition[taskID][taskActionID].occurredConditionOCIDs) {
                    taskCondition[taskID][taskActionID].occurredConditionOCIDs = occurredConditionOCIDs;
                } else {
                    Array.prototype.push.apply(taskCondition[taskID][taskActionID].occurredConditionOCIDs, occurredConditionOCIDs);
                }
                runActionByCondition(taskID, taskActionID);
                saveTasksStateToFile();
            }
        }
    }
};

tasks.cancelTaskWithCondition = function(taskID) {
    if(taskCondition[taskID]) {
        delete taskCondition[taskID];
        saveTasksStateToFile();
    }
};

tasks.getTaskParameters = getTaskParameters;
tasks.getWorkflowAndAllowedGroupsIDs = getWorkflowAndAllowedGroupsIDs;
tasks.getWorkflow = getWorkflowAndAllowedGroupsIDs;

tasks.sendMessage = function(username, taskID, param, action, callback) {
    /*
    TASK_ID, TASK_NAME, TASK_CREATOR, EXECUTE_CONDITION, ACTIONS_DESCRIPTION, ACTIONS_DESCRIPTION_HTML
    */

    taskID = Number(taskID);
    if(!taskID || taskID !== parseInt(String(taskID), 10)) {
        return callback(new Error('Invalid task ID ' + taskID + ' for sending message: ' + JSON.stringify(param)));
    }


    getTaskParameters(username, taskID, function (err, taskParam) {
        if(err) {
            return callback(new Error('Error send message taskID ' + taskID + ': '+ err.message + ', param: ' + JSON.stringify(param)));
        }

        log.debug('Send message task param: ', taskParam);

        if(!taskParam.parameters.name) return callback();

        if(taskParam.parameters.runType > 100) var condition = 'run at ' + new Date(taskParam.parameters.runType).toLocaleString();
        else if(taskParam.parameters.runType === 2 || taskParam.parameters.runType === 12) condition = 'run now';
        else if(taskParam.counterName &&  taskParam.objectsNames) {
            if(taskParam.parameters.runType === 0) condition = 'run every time';
            else condition = 'run once' // taskParam.parameters.runType === 11
            condition += ' when condition met: ' + taskParam.counterName + ' (' + taskParam.objectsNames.join(', ') + ')';
        } else if(taskParam.parameters.runType === null) {
            condition = 'do not run';
        } else return callback(new Error('Error send message  taskID ' + taskID +
            ': Unexpected runType: ' + taskParam.parameters.runType + ', param: ' + JSON.stringify(param) +
            '; taskParam: ' + JSON.stringify(taskParam)));

        var actionsDescription = [], actionsDescriptionHTML = [], num = 1;
        for(var sessionID in taskParam.actions) {

            actionsDescription.push(String(num++) + '. ' + taskParam.actions[sessionID].name +
                ':\n' + taskParam.actions[sessionID].description);

            actionsDescriptionHTML.push('<li><span class="task-action"><span class="task-action-name">' +
                taskParam.actions[sessionID].name + '</span><span class="task-action-startup" data-startup-option="' +
                taskParam.actions[sessionID].startupOptions + '">&nbsp;</span><span class="task-action-description">' +
                taskParam.actions[sessionID].description + '</span></span></li>');
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
    variables: {var1: val1, var2: val2, ....}
    sessionIDs: [sessionID1, sessionID2] - list of actions to run in the specified task. null - run all actions

    callback(err, result)
    result: {
        tasksActionsID1: actionData1,
        tasksActionsID2: actionData2,
        ...
    }
*/
tasks.runTask = function(params, callback) {
    var userName = params.userName,
        taskID = params.taskID,
        variables = params.variables,
        filterSessionIDs = params.filterSessionIDs,
        mySessionID = params.mySessionID;

    if(params.conditionOCIDs) { // add task
        taskCondition[taskID] = {
            conditionOCIDs: params.conditionOCIDs.slice(), // copy array of objectIDs to a new array for save param
            callback: callback,
            runType: params.runType,
        };
        saveTasksStateToFile();
    }

    if(!userName) return callback(new Error('Can\'t run task ' + taskID + ' from undefined user "' + userName + '"'));

    if(typeof variables !== 'object' || variables === null) variables = {};
    tasksDB.getTaskParameters(userName, taskID, function(err, taskParameters) {
    // userName used only for a new undefined task (without taskID)
    // taskParameters sorted by actionsOrder column in tasksActions table
    // [{mySessionID:.., name:<taskParameterName>, value:.., actionID:<actionID ie action dir>, actionName:<actionName>, startupOptions:<>}, ..]
        if(err) return callback(err);
        if(!taskParameters || !taskParameters.length)
            return callback(new Error('Error while getting task parameters for task ID '+taskID+': parameters for this task are not found'));

        var actions = {}, actionsOrder = [];

        async.each(taskParameters, function(prm, callback) {
            if(Array.isArray(filterSessionIDs) && filterSessionIDs.indexOf(prm.sessionID) === -1) {
                //log.info('Skip mySessionID ', prm.mySessionID, '(' + prm.actionID+ ') in task ID ', taskID, ' ; required session: ', filterSessionIDs);
                return callback();
            }

            if(!actions[prm.tasksActionsID]) {
                actions[prm.tasksActionsID] = {
                    ID: prm.actionID,
                    args:{},
                    startupOption: prm.startupOptions,
                    sessionID: mySessionID || prm.sessionID,
                    actionSessionID: prm.sessionID,
                };
                actionsOrder.push(prm.tasksActionsID);
            }

            replaceVariablesToValues(prm.name, prm.value, variables, function(err, value) {
                if(err) return callback(err);

                actions[prm.tasksActionsID].args[prm.name] = value;
                callback();
            });

        }, function(err) {
            if(err) return callback(err);

            if(!actionsOrder.length) {
                return callback(new Error('Task ' + taskID + ' does not contain an actions for sessions IDs :' +
                filterSessionIDs.join(', ')));
            }

            log.info('Starting task ', taskID, '; user: ', userName, '; variables: ', variables,
                '; order: ', actionsOrder,
                (Array.isArray(filterSessionIDs) ? '; filterSessionIDs: ' + filterSessionIDs.join(', ') : ''),
                (Array.isArray(params.conditionOCIDs) ? '; task conditions: ' + params.conditionOCIDs.join(',') : ''));
            runTaskFunction(userName, taskID, actions, actionsOrder, function(err, returnedActionsValues) {
                // returnedActionsValues = {<tasksActionsID1>: <value1>, <tasksActionsID2>: <value2>, ....}
                log.info('End task ', taskID, '; actions: ', actions, '; returned: ', returnedActionsValues, ', err: ', err);

                if(!taskCondition[taskID]) return callback(err, returnedActionsValues);

                var runType = taskCondition[taskID].runType;
                delete taskCondition[taskID];
                saveTasksStateToFile();

                if(runType === 0) { // run again time while conditions met
                    callback(err, returnedActionsValues);
                    tasks.runTask(params, callback);
                    return;
                }

                // for run once when condition met
                actionClient.markTaskCompleted(taskID, function(_err) {
                    if(_err) log.error('Error marking run once task ', taskID, ' completed: ', _err.message);
                    else log.info('Marking run once task ', taskID, ' completed');
                    callback(err, returnedActionsValues);
                });
            });
        });
    })
};

/*
Creating task function from action functions using actionClient.runAction() according startupOption for each action
and running this task function.

userName: user name, which run task for check user rights for each action
actions: {taskActionID1: {ID: <actionID>, args: {prm1:val1, prm2:val2,...}, startupOption: 0|1|2}, taskActionID2: ....}
actionOrder: [taskActionID1, taskActionID2,...]

callback(err, result), where
result: {
        tasksActionsID1: actionData1,
        tasksActionsID2: actionData2,
        ...
    }
 */

function runTaskFunction(userName, taskID, actions, actionsOrder, callback) {

    var result = {},
        prevStartupOption,
        actionFunctionsRunInParallel = [], // array with parallel executed actions
        actionFunctionOnError = [function (err) { callback(err, result)}], // push callback as a last function in a array for success or error
        actionFunctionOnSuccess = [function (err) { callback(err, result)}];

    actions[actionsOrder[0]].startupOption = 0;

    /*
    * startupOption:
    * 0 - execute current action if previous action completed without errors
    * 1 - execute current actions if someone of previous actions completed with errors
    * 2 - execute current action in parallel with a previous action
    * */
    log.debug('Actions in task: ', actionsOrder);

    // processing actions in reverse order
    actionsOrder.reverse().forEach(function(tasksActionsID) {

        // previous action was last in parallel executed actions. create success function from array with
        // parallel executed actions
        if ( prevStartupOption === 2 && actions[tasksActionsID].startupOption !== 2 ) {
            log.debug('createTask: add parallel actions: ', Object.keys(actionFunctionsRunInParallel[actionFunctionsRunInParallel.length-1]), '. onSuccess: ', actionFunctionOnSuccess[actionFunctionOnSuccess.length-1], '; onError: ', actionFunctionOnError[actionFunctionOnError.length-1]);
            // closure
            (function(_actionFunctionsRunInParallel, _actionFunctionOnSuccess, _actionFunctionOnError) {
                actionFunctionOnSuccess.push(function (err, prevResult) {

                    var __actionFunctionsRunInParallel = _actionFunctionsRunInParallel.map(function (actionFunction) {
                        return function (callback) { actionFunction(prevResult, callback); }
                    });

                    async.parallel(__actionFunctionsRunInParallel, function (err, results) {
                        if (err) return _actionFunctionOnError(err);
                        _actionFunctionOnSuccess(null, results); // results = {taskActionID1: result1, taskActionID2: result2}
                    });
                });
            })(actionFunctionsRunInParallel[actionFunctionsRunInParallel.length-1],
                actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1]
            );
        }

        // push success function to array
        if( actions[tasksActionsID].startupOption === 0 ) {
            log.debug('createTask: add onSuccess actions ', tasksActionsID, '. onSuccess: ', actionFunctionOnSuccess[actionFunctionOnSuccess.length-1], '; onError: ', actionFunctionOnError[actionFunctionOnError.length-1]);
            // closure
            (function(_actionFunctionOnSuccess, _actionFunctionOnError, _actionID, _sessionID, _actionSessionID, _tasksActionsID) {
                actionFunctionOnSuccess.push(function (err, prevResult) {

                    // replace %:PREV_ACTION_RESULT:% variable to value of previous action execution result
                    var _args = {};
                    async.eachOf(actions[_tasksActionsID].args, function(valueWithVariables, name, callback) {
                        replaceVariablesToValues(name, valueWithVariables, {PREV_ACTION_RESULT: prevResult}, function(err, value) {
                            if(err) return callback(err);

                            _args[name] = value;
                            callback();
                        })
                    }, function(err) {
                        if(err) return _actionFunctionOnError(err);

                        runAction({
                            actionID: _actionID,
                            executionMode: 'server',
                            user: userName,
                            args: _args,
                            sessionID: _sessionID,
                            taskActionID: _tasksActionsID,
                            taskID: taskID,
                        }, function (err, data) {
                            if (err) return _actionFunctionOnError(err);
                            result[_tasksActionsID] = data;
                            _actionFunctionOnSuccess(null, data);
                        });
                    });
                });
            })(actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1],
                actions[tasksActionsID].ID,
                actions[tasksActionsID].sessionID,
                actions[tasksActionsID].actionSessionID,
                tasksActionsID,
            );

        // push error function in array
        } else if ( actions[tasksActionsID].startupOption === 1 ) {

            log.debug('createTask: add onError action ', tasksActionsID, '. onSuccess: ', actionFunctionOnSuccess[actionFunctionOnSuccess.length-1], '; onError: ', actionFunctionOnError[actionFunctionOnError.length-1]);
            // closure
            (function(_actionFunctionOnSuccess, _actionFunctionOnError, _actionID, _args, _sessionID, _actionSessionID, _tasksActionsID) {
                actionFunctionOnError.push(function (prevErr) {

                    actions[tasksActionsID].args.__prevError = prevErr;

                    runAction({
                        actionID: _actionID,
                        executionMode: 'server',
                        user: userName,
                        args: _args,
                        sessionID: _sessionID,
                        taskActionID: _tasksActionsID,
                        taskID: taskID,
                    }, function (err, data) {
                        if (err) return _actionFunctionOnError(err);
                        result[_tasksActionsID] = data;
                        _actionFunctionOnSuccess(null, data);
                    });
                });
            })(actionFunctionOnSuccess[actionFunctionOnSuccess.length-1],
                actionFunctionOnError[actionFunctionOnError.length-1],
                actions[tasksActionsID].ID,
                actions[tasksActionsID].args,
                actions[tasksActionsID].sessionID,
                actions[tasksActionsID].actionSessionID,
                tasksActionsID,
            );

            actionFunctionOnSuccess.push(callback);

        // push function in special array with parallel executed actions
        } else if( actions[tasksActionsID].startupOption === 2 ) {

            log.debug('createTask: \tadd action to array with parallel executed actions: ', tasksActionsID);
            if ( prevStartupOption !== 2) actionFunctionsRunInParallel.push([]);
            // closure
            (function(_actionID, _sessionID, _actionSessionID, _tasksActionsID) {
                actionFunctionsRunInParallel[actionFunctionsRunInParallel.length-1].push(function (prevResult, callback) {
                    // replace %:PREV_ACTION_RESULT:% variable to value of previous action execution result
                    var _args = {};
                    async.eachOf(actions[_tasksActionsID].args, function(valueWithVariables, name, callback) {
                        replaceVariablesToValues(name, valueWithVariables, {PREV_ACTION_RESULT: prevResult}, function(err, value) {
                            if(err) return callback(err);

                            _args[name] = value;
                            callback();
                        })
                    }, function(err) {
                        if(err) return callback(err);

                        runAction({
                            actionID: _actionID,
                            executionMode: 'server',
                            user: userName,
                            args: _args,
                            sessionID: _sessionID,
                            taskActionID: _tasksActionsID,
                            taskID: taskID,
                        }, function (err, data) {
                            if (err) return callback(err);
                            result[_tasksActionsID] = data;
                            callback(null, data);
                        });
                    });
                });
            })(actions[tasksActionsID].ID,
                actions[tasksActionsID].sessionID,
                actions[tasksActionsID].actionSessionID,
                tasksActionsID,
            )
        } else log.error('Unknown startupOption "', actions[tasksActionsID].startupOption, '" for action ', tasksActionsID ,': ', actions[tasksActionsID].ID);

        prevStartupOption = actions[tasksActionsID].startupOption;
    });

    log.debug('Beginning task execution with actions: ', actions, 'taskFunction: ', actionFunctionOnSuccess);

    // last function in array is a task function
    actionFunctionOnSuccess[actionFunctionOnSuccess.length-1]();
}

/*
Sync replace variables in action parameter to his value

name: action parameter name. used for perform special processing for parameter 'o'
value: action parameter value with or without variables, f.e.
    "This is action parameter value with variable1: %:VARIABLE1:% and variable2: %:VARIABLE2:%"
variables: {name1: val1, name2:val2, ....}

return action parameter value with replaced variables to his values
*/
function replaceVariablesToValues(name, value, variables, callback) {

    if(!value || typeof value !== 'string' || !variables) return callback(null, value);

    var res = variablesReplace(value, variables);
    if(!res) return callback(null, value);
    if(name.toLowerCase() !== 'o') return callback(null, res.value);

    // processing 'o' parameter
    // result of processing will be an array of objects [{name: .., id:..}, {..}, ...]
    // Variable value can be a one of stringify JSON objects:
    // object ID, array of objects IDs, object name, array of objects names, comma separated objects names or an array of objects [{name: .., id:..}, {..}, ...].

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
    } else return callback(new Error('Variable "' + value + '" value ' + res.value + '(parsed from ' + value + ') has incorrect type: ' + typeof res.value));

    if(!Array.isArray(values)) return callback(new Error('Variable "' + value + '" value ' + res.value + ' (source ' + value + ') has incorrect type: ' + typeof res.value));
    if(!values.length) return callback(null, '[]');

    // check parsed object for correct values and try to understand, what array contain:
    // objects IDs, objects names or objects with id an name
    for(var i = 0, type = 0; i < values.length; i++) {

        // object ID
        if(typeof values[i] === 'number' && values[i] === parseInt(String(values[i]), 10)) {
            if(!type) type = 2;
            else if(type !== 2) return callback(new Error('Incorrect object ID ' + JSON.stringify(values[i]) + ' in ' + res.value + ' (source ' + value + ')'));

            // object name
        } else if(typeof  values[i] === 'string') {
            if(!type) type = 3;
            else if(type !== 3) return callback(new Error('Incorrect object name ' + JSON.stringify(values[i]) + ' in ' + res.value + ' (source ' + value + ')'));

            // {name:.., id:...}
        } else if(typeof values[i] === 'object' &&
            values[i].id && Number(values[i].id) === parseInt(String(values[i].id), 10) &&
            typeof values[i].name === 'string') {

            if(!type) type = 1;
            else if(type !== 1) return callback(new Error('Incorrect object "' + JSON.stringify(values[i])+
                '". It must contain {name: <objectName>, id: <objectID>} in : ' + res.value + '(parsed from ' + value + ')'));

        } else return callback(new Error('Incorrect ' + JSON.stringify(values[i]) + ' in ' + res.value + '(parsed from ' + value + ')'));
    }

    // {name:.., id:...}
    if(type === 1) return callback(null, JSON.stringify(values));
    // object ID
    else if(type === 2) var getObjectsParameters = function(values, callback) { objectsDB.getObjectsByIDs(values, callback) }; // select * from objects
    // object name
    else if(type === 3) getObjectsParameters = function(values, callback) { objectsDB.getObjectsLikeNames(values, callback) }; // select id, name from objects
    else return callback(new Error('Error while parse "' + res.value + '", (source "' + value + '", type: ' + typeof(value) +')'));

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

function runActionByCondition(taskID, taskActionID) {

    var param = taskCondition[taskID][taskActionID].actionParam.param;
    var actionCallback = taskCondition[taskID][taskActionID].actionParam.actionCallback;
    var occurredConditionOCIDs = taskCondition[taskID][taskActionID].occurredConditionOCIDs;
    taskCondition[taskID][taskActionID].occurredConditionOCIDs = [];

    log.debug('Running action ', taskActionID, ', conditions: ', occurredConditionOCIDs,
        '; remain: ', taskCondition[taskID].conditionOCIDs,
        ' action: ', taskCondition[taskID][taskActionID]);

    if(!param.args) param.args = {};

    // run the action if all conditions are met
    if(!taskCondition[taskID].conditionOCIDs.length) {
        deleteActionParam(taskID, taskActionID);
        log.info('Starting action ', taskActionID, ', task ', taskID,
            ' for all remaining occurrences of conditions for OCIDs: ', occurredConditionOCIDs, '; o=', param.args.o,
            '; param: ', param);
        actionClient.runAction(param, function(err, result) {
            if(err) {
                log.error('Error in action ', taskActionID, ', task: ', taskID, ', running for all remaining conditions: ', err.message);
                return actionCallback(err);
            }

            // if the task is canceled during the execution of the action
            // or action was started once and this result unique
            if(!taskCondition[taskID] || !taskCondition[taskID][taskActionID] ||
                !taskCondition[taskID][taskActionID].result.length
            ) return actionCallback(null, result);

            if(result !== undefined) addToResult(taskID, taskActionID, result);

            actionCallback(null, taskCondition[taskID][taskActionID].result);
        });
        return;
    }

    if(!occurredConditionOCIDs || !occurredConditionOCIDs.length) {
        return log.debug('No occurred conditions for action ', taskActionID, ' task ', taskID,
            ', waiting for ', taskCondition[taskID].conditionOCIDs);
    }

    // try to parse stringified "o" parameter
    // if the action does not have "o" parameter, waiting while all conditions are met
    if(Array.isArray(param.args.o)) {
        if(param.args.o.length) var o = param.args.o;
        else return log.debug('Parameter "o" is empty array for task ', taskID, '; action ', taskActionID, '; "o": ', param.args.o);
    } else if(typeof param.args.o === 'string') {
        try {
            o = JSON.parse(param.args.o);
            if(!Array.isArray(o) || !o.length) {
                return log.debug('Parameter "o" is empty or not an array for task ', taskID, '; action ', taskActionID, '; "o": ', param.args.o);
            }
        } catch (e) {
            log.debug('Error parse "o" parameter for task ', taskID, '; action ', taskActionID, '; "o": ', param.args.o, '; err: ', e.message);
            return;
        }
    } else {
        log.debug('"o" parameter not a string and not an array for task ', taskID, '; action ', taskActionID, '; "o": ', param.args.o);
        return;
    }

    objectsDB.getObjectsByOCIDs(occurredConditionOCIDs, function (err, rows) {
        if(err) {
            log.error('Can\'t get objects IDs for occurred conditions OCIDs ' , occurredConditionOCIDs, ': ', err.message);
            return;
        }

        var occurredConditionsObjectsIDs = {};
        rows.forEach(function (row) {
            occurredConditionsObjectsIDs[row.objectID] = true;
        });

        var objectsForAction = []; // action will running for objects from condition
        // remove objects from "o" action parameter
        o = o.filter(function(object) {
            if(!occurredConditionsObjectsIDs[object.id]) return true;
            else if(object.id && object.name) objectsForAction.push(object);
        });

        if(typeof param.args.o === 'string') param.args.o = JSON.stringify(o);

        //log.debug('Occurred condition for objects: ', occurredConditionsObjectsIDs, ', OCIDs: ', occurredConditionOCIDs,
        //    '; objects in action remain: ', param.args.o, '; conditions for objects for action occurred : ', objectsForAction);

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
            if(!taskCondition[taskID] || !taskCondition[taskID][taskActionID]) {
                return actionCallback(null, result);
            }

            if(result !== undefined) addToResult(taskID, taskActionID, result);

            // run action callback if param.args.o has not an objects i.e. action was executed for all action object
            if(!o.length) {
                deleteActionParam(taskID, taskActionID);
                actionCallback(null, taskCondition[taskID][taskActionID].result);
            }
        });
    })
}

/*

param: {
            actionID: actionID,
            executionMode: 'server',
            user: userName,
            args: action parameters: {name1: value1, name2: value2, ....},
            sessionID: new session ID for action
            taskActionID: taskActionID from task
            taskID: task ID

callback(er, result);
*/
function runAction(param, callback) {
    var taskID = param.taskID;

    // run action immediately if task has not run condition
    if(!taskCondition[taskID]) return actionClient.runAction(param, callback);

    var taskActionID = param.taskActionID;
    if(!taskCondition[taskID][taskActionID]) {
        taskCondition[taskID][taskActionID] = {
            result: [],
        }
    }
    taskCondition[taskID][taskActionID].actionParam = {
        taskID: taskID,
        param: param,
        actionCallback: callback,
    };
    saveTasksStateToFile();

    // occurredConditionOCIDs may be loaded from file before
    runActionByCondition(taskID, taskActionID);
}

function deleteActionParam(taskID, taskActionID) {
    delete taskCondition[taskID][taskActionID].actionParam;
    saveTasksStateToFile();
}

function addToResult(taskID, taskActionID, result) {
    taskCondition[taskID][taskActionID].result.push(result);
    saveTasksStateToFile();
}

function saveTasksStateToFile() {

    if(saveChangesInProgress) {
        needToSaveChanges = true;
        return;
    }
    saveChangesInProgress = true;

    try {
        var data = JSON.stringify(taskCondition);
    } catch (e) {
        saveChangesInProgress = false;
        return log.error('Can\'t stringify task condition data for save changes: ' + e.message);
    }

    fs.writeFile(dataFile, data, 'utf-8', function (err) {
        if(err) return log.error('Can\'t save stringified task data to ' + dataFile + ': ' + err.message);
        saveChangesInProgress = false;
        if(needToSaveChanges) {
            needToSaveChanges = false;
            saveTasksStateToFile();
        }
    });
}


/*
    Return parameters for actions in the task

    username - username
    taskID - task ID
    callback(err, actionsConfiguration)

    actionsConfiguration - [ sessionID1: {
            ID: actionID
            name: actionName
            parameters: {name:.., value:.., ...} - parameters from web form, sent for a actions

            configuration: {
                    <action config from action config.json file>,
                    link: path to action
                    actionID: actionID
                }
            description: string - prepared description for a action from descriptionTemplate parameter and from parameters
        },
        sessionID2: {.....}, ....]

 */
function getTaskParameters(username, taskID, callback) {
    rightsWrapper.getTaskParameters(username, taskID, function(err, taskParameters, taskData, OCIDs, counters, objects){
        if(err) return callback(err);
        if(!taskData || !taskData.length) return callback(new Error('Task with taskID "' + taskID + '" is not found in database'));

        var actions = {};

        // taskParameters: [{sessionID:.., name:<taskParameterName>, value:.., actionID:<actionID ie action dir>, actionName:<actionName>, startupOptions: ...},..]

        var actionsIDsObj = {};
        taskParameters.forEach(function(prm) {

            var sessionID = Number(prm.sessionID);
            if(sessionID !== parseInt(String(sessionID), 10)) return;

            if(!actions[sessionID]) {
                actionsIDsObj[prm.actionID] = true;

                actions[sessionID] = {
                    ID: prm.actionID,
                    name: prm.actionName,
                    startupOptions: prm.startupOptions,
                    parameters: [],
                    actionsOrder: prm.actionsOrder,
                };
            }

            // don't allowing to change action owner and action name and actionID
            if(prm.name !== 'username' && prm.name !== 'actionName' && prm.name !== 'actionID' && prm.name !== 'sessionID') {
                actions[sessionID].parameters.push({
                    name: prm.name,
                    value: prm.value
                })
            }
        });

        async.each(Object.keys(actions), function(sessionID, callback) {
            if(!actions.hasOwnProperty(sessionID)) return callback();

            var action = actions[sessionID];
            actionsConf.getConfiguration(action.ID, function(err, actionCfg){
                if(err) return callback(err);

                log.debug('Configuration for action ', action.ID, ': ', actionCfg);

                async.parallel([
                    function (callback) {
                        if(!actionCfg.descriptionTemplateHTML) return callback();

                        actionsConf.makeActionDescription(actionCfg.descriptionTemplateHTML, action.parameters, function(err, description) {
                            if(err) return callback(err);

                            log.debug('HTML description for action ', action.ID, ': ', description);
                            action.descriptionHTML = description;
                            callback();
                        });
                    },
                    function (callback) {
                        actionsConf.makeActionDescription(actionCfg.descriptionTemplate, action.parameters, function(err, description) {
                            if(err) return callback(err);

                            log.debug('Description for action ', action.ID, ': ', description);

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

            rightsWrapper.checkActionsRights(username, Object.keys(actionsIDsObj), 'run', function(err) {

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

function getWorkflowAndAllowedGroupsIDs(userName, callback) {
    actionsConf.getConfiguration('task_maker', function(err, actionCfg) {
        if (err) return callback(err);

        userDB.getUsersInformation(userName, function (err, rows) {
            if (err) return callback(new Error('Can\'t get user roles for ' + userName + ': ' + err.message));

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

                var allowedTasksGroupsIDs = [];
                rows.forEach(function (row) {
                    if (userRoles[row.roleID]) allowedTasksGroupsIDs.push(row.taskGroupID);
                });

                callback(null, workflow, allowedTasksGroupsIDs);
            });
        });
    });
}