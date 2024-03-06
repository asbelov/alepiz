/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.03.2017.
 */
const log = require('../../lib/log')(module);
const async = require('async');
const rightsWrapper = require('../../rightsWrappers/tasksDB');
const tasksDB = require('../../models_db/tasksDB');
const rightsWrappersCountersDB = require('../../rightsWrappers/countersDB');
var tasks = require('../../serverTask/tasks');

module.exports = function(args, callback) {
    //log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (func === 'getTaskParameters') return tasks.getTaskParameters(args.username, args.id, callback);

    if (func === 'getTasksList') return getTaskList(args, callback);

    if (func === 'getCounters') return getCounters(args.username, args.objectsIDs, callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};

/**
 * Get task groups object
 * @param {string} username username
 * @param {function(Error)|function(null, {
 *      allowedTaskGroups: Array,
 *      taskGroups: Array,
 *      workflowGroups: Object,
 *      fullWorkflowGroups: Object,
 *      allowedTasksGroupsIDs: Array<number>,
 *      groupIDs: Object,
 * })} callback callback(err, taskGroupObj) where taskGroupObj is
 * {
 *  allowedTaskGroups: allowedRows,
 *  workflow: workflowGroups,
 *  allowedTasksGroupsIDs: allowedTasksGroupsIDs,
 *  groupIDs: groupIDs[row.id] = row.name,
 * }
 */
function getTaskGroups(username, callback) {
    tasks.getWorkflow(username, function (err, workflows) {
        if(err) return callback(err);

        tasks.getAllowedTaskGroupIDs(username, function (err, allowedTasksGroupsIDs) {
            if(err) return callback(err);

            tasksDB.getTasksGroupsList(function (err, rows) {
                if(err) return callback(new Error('Can\'t get task groups: ' + err.message));

                var groupNames = {}, groupIDs = {};
                var allowedRows = rows.filter(function (row) {
                    groupNames[row.name] = row.id;
                    groupIDs[row.id] = row.name;
                    return allowedTasksGroupsIDs.indexOf(row.id) !== -1;
                });

                var workflowGroups = {}, fullWorkflowGroups = {}, unfinishedGroupChains = {};
                workflows.forEach(function (workflow) {
                    if(!workflow.changeGroup || workflow.changeGroup.indexOf(',') === -1) return;
                    var groupPair = workflow.changeGroup.split(/ *, */);
                    var groupID = groupNames[groupPair[0]], nextGroupID = groupNames[groupPair[1]];

                    if(typeof groupID === 'number' && typeof nextGroupID === 'number') {
                        if(workflow.action === 'change') fullWorkflowGroups[groupID] = nextGroupID;

                        var isAllowedCurrentGroup = allowedTasksGroupsIDs.indexOf(groupID) !== -1;
                        var isAllowedNextGroup = allowedTasksGroupsIDs.indexOf(nextGroupID) !== -1;

                        if (isAllowedCurrentGroup && isAllowedNextGroup) workflowGroups[groupID] = nextGroupID;
                        else if (isAllowedCurrentGroup && !isAllowedNextGroup) unfinishedGroupChains[nextGroupID] = groupID;
                        else if (!isAllowedCurrentGroup && isAllowedNextGroup) {
                            if (unfinishedGroupChains[groupID] !== undefined) {
                                workflowGroups[unfinishedGroupChains[groupID]] = nextGroupID;
                            }
                        } else if (!isAllowedCurrentGroup && !isAllowedNextGroup) {
                            if (unfinishedGroupChains[groupID] !== undefined) {
                                unfinishedGroupChains[nextGroupID] = unfinishedGroupChains[groupID];
                            }
                        }

                        log.debug('workflowGroups: groupID: ', groupID, '(allow: ', isAllowedCurrentGroup,
                            ') nextGroupID: ', nextGroupID, '(allow: ', isAllowedNextGroup,
                            ') unfinishedGroupChains: ', unfinishedGroupChains, ', workflowGroups: ', workflowGroups);
                    }
                });
                // return only allowed tasks groups and tasks groups from workFlow
                var taskGroups = rows.filter(row => {
                    for(var groupID in fullWorkflowGroups) {
                        if(fullWorkflowGroups[groupID] === row.id) return true;
                    }
                    return allowedTasksGroupsIDs.indexOf(row.id) !== -1;
                });

                callback(null, {
                    allowedTaskGroups: allowedRows,
                    taskGroups: taskGroups,
                    fullWorkflowGroups: fullWorkflowGroups,
                    workflowGroups: workflowGroups,
                    allowedTasksGroupsIDs: allowedTasksGroupsIDs,
                    groupIDs: groupIDs,
                });
            });
        });
    });
}

/**
 * Get counters with run condition for specific objects
 * @param {string} username username
 * @param {string} objectsIDsStr string with comma separated object IDs
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, countersArray) where countersArray is
 * [{id:.., name:.., taskCondition:…, unitID:…, collectorID:…, debug:…, sourceMultiplier:…, groupID:…, OCID:…,
 * objectID:…, objectName:…, objectDescription:..}, …]
 */
function getCounters(username, objectsIDsStr, callback){
    if(!objectsIDsStr) return callback(new Error('Error in parameter objectsIDs: no such parameter'));

    var objectsIDs = objectsIDsStr.split(',').map(function(ID) {
        ID = Number(ID);
        if(!ID || ID !== parseInt(String(ID), 10)) return 0;
        return ID;
    }).filter(function(ID) { return (ID !== 0) });

    return rightsWrappersCountersDB.getCountersForObjects(username, objectsIDs, null, function(err, rows) {
        if(err) return callback(err);

        var countersArray = rows.filter(function (row) {
            return row.taskCondition;
        });

        callback(null, countersArray);
    });
}

/**
 * Get the task list
 * @param {Object} args parameters for filter tasks
 * @param {string} args.username username
 * @param {string} args.timestampFrom date from
 * @param {string} args.timestampTo date to
 * @param {string} args.groupID group ID
 * @param {string} args.taskName task name
 * @param {string} args.userName owner name
 * @param {boolean} args.searchFirstNotEmptyGroup !!groupID
 * @param {string} args.dateFromChangeTimestamp timestamp when dateFrom was changed
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, taskListObject)
 * where rows - task List rows, groupID - groupID with task for finding task List
 * @example
 * taskListObject
 * {
 *      taskData: Object.values(tasks),
 *      workflow: groupObj.workflowGroups,
 *      fullWorkflowGroups: groupObj.fullWorkflowGroups,,
 *      allowedTaskGroups: groupObj.allowedTaskGroups,
 *      taskGroups: groupObj.taskGroups,
 *      groupID: groupID,
 *}
 */
function getTaskList(args, callback) {
    if(!args.timestampFrom) {
        return callback(new Error('Undefined first timestamp while getting task list'));
    }

    var timestampFrom = Number(args.timestampFrom);
    if(!timestampFrom || timestampFrom !== parseInt(String(timestampFrom), 10) || timestampFrom < 946659600000 ) {
        return callback(new Error('Incorrect first timestamp ("' + args.timestampFrom +
            '") while getting task list'));
    }

    if(!args.timestampTo) return callback(new Error('Undefined last timestamp while getting task list'));
    var timestampTo = Number(args.timestampTo);
    if(!timestampTo || timestampTo !== parseInt(String(timestampTo), 10) || timestampTo < 946659600000 ) {
        return callback(new Error('Incorrect last timestamp ("' + args.timestampTo +
            '") while getting task list'));
    }

    if(timestampFrom >= timestampTo) {
        return callback(new Error('First timestamp ("' + args.timestampFrom +
            '") more then last timestamp ("' + args.timestampTo + '") for getting task list'));
    }

    var groupID = Number(args.groupID);
    if(!groupID) groupID = 0;
    else if(groupID !== parseInt(String(groupID), 10)) {
        return callback(new Error('Incorrect group ID ("' + args.groupID + '") while getting task list'));
    }

    getTaskGroups(args.username, function (err, groupObj) {
        if(err) return callback(err);

        var allowedTasksGroupsIDs = groupObj.allowedTasksGroupsIDs;
        var groupIDs = groupObj.groupIDs;

        if(allowedTasksGroupsIDs.indexOf(groupID) === -1) {
            return callback(new Error('Group ' + groupIDs[groupID] + ' is not allowed for user ' + args.username));
        }

        if(args.userName) var ownerName = args.userName;

        // if taskName is an integer, then try to search taskID
        if(args.taskName) {
            if(Number(args.taskName) === parseInt(args.taskName, 10) &&
                Number(args.taskName) > 0
            ) {
                var taskID = parseInt(args.taskName, 10);
            } else {
                var taskName = args.taskName;
            }
        }

        getRawTaskList({
            username: args.username,
            timestampFrom: timestampFrom,
            timestampTo: timestampTo,
            groupID: groupID,
            taskID: taskID,
            taskName: taskName,
            ownerName: ownerName,
            searchFirstNotEmptyGroup: !!args.groupID,
            dateFromChangeTimestamp: Number(args.dateFromChangeTimestamp) || 0,
        }, groupObj.workflowGroups, groupIDs, function(err, rows, groupID) {
            if(err) return callback(err);

            if(!rows.length) {
                log.debug('No tasks found for user ', args.username, ' from ',
                    new Date(timestampFrom).toLocaleString(), ' to ', new Date(timestampTo).toLocaleString(),
                    ', group: ', groupIDs[groupID], '; taskName: ', taskName, '; ownerName: ', ownerName);
                return callback(null, {
                    taskData: [],
                    workflowGroups: groupObj.workflowGroups,
                    fullWorkflowGroups: groupObj.fullWorkflowGroups,
                    allowedTaskGroups: groupObj.allowedTaskGroups,
                    taskGroups: groupObj.taskGroups,
                    groupID: groupID,
                });
            }

            var tasks = {}, actions = {};
            rows.forEach(function (row) {
                if(!tasks[row.id]) {
                    tasks[row.id] = row;
                    tasks[row.id].actionIDs = [row.actionID];
                } else tasks[row.id].actionIDs.push(row.actionID);
                if(!actions[row.actionID]) actions[row.actionID] = true;
            });
            rightsWrapper.checkActionsRights(args.username, Object.keys(actions), null,
                function (err, actionsRights) {
                if(err) {
                    return callback(new Error('Error checking rights for the actions in task: ' + err.message +
                        '; tasks: ' + JSON.stringify(tasks, null, 4) ));
                }

                for(var taskID in tasks) {

                    for(var i = 0; i < tasks[taskID].actionIDs.length; i++) {
                        var actionID = tasks[taskID].actionIDs[i];

                        if(!actionsRights[actionID] || !actionsRights[actionID].view) {
                            log.debug('User: ', args.username, ': has no rights for action ', actionID,
                                ' in task ', taskID, ' group ', groupIDs[groupID] ,'. Remove task from list');
                            delete tasks[taskID];
                            break;
                        }

                        tasks[taskID].canExecuteTask = !(!actionsRights[actionID] || !actionsRights[actionID].run);
                    }
                }

                log.debug('User: ', args.username, ': receiving task list in group ', groupIDs[groupID],
                    ': ', tasks, '; rows: ', rows);

                callback(null, {
                    taskData: Object.values(tasks),
                    workflowGroups: groupObj.workflowGroups,
                    fullWorkflowGroups: groupObj.fullWorkflowGroups,
                    allowedTaskGroups: groupObj.allowedTaskGroups,
                    taskGroups: groupObj.taskGroups,
                    groupID: groupID,
                });
            });
        });
    });
}

/**
 * Retrieving a list of tasks from the first group containing tasks using the group order settings in the workflow
 * f.e. for business user at first searching tasks in Default group, then in Business tasks for validation,
 * then in Business tasks group
 * @param {Object} filterParam parameters for filter tasks
 * @param {string} filterParam.username username
 * @param {number} filterParam.timestampFrom
 * @param {number} filterParam.timestampTo
 * @param {number} filterParam.groupID
 * @param {string} filterParam.taskName
 * @param {number} filterParam.taskID
 * @param {string} filterParam.ownerName
 * @param {boolean} filterParam.searchFirstNotEmptyGroup groupID === ''
 * @param {number} filterParam.dateFromChangeTimestamp timestamp when dateFrom was changed
 * @param {Object} workflowGroups group chain in workflow workflowGroup[groupID] = nextGroupID
 * @param {function(Error)|function(null, Array<Object>, number)} callback callback(err, rows, groupID)
 * where rows - task List rows, groupID - groupID with task for finding task List
 * @param {Object} groupIDs groupIDs[groupID] = groupName
 * @example
 * example of the returned array (rows)
 * [{
 *      id: task ID,
 *      name: task name or NULL for a new task,
 *      timestamp: time when task was created,
 *      ownerName: task owner username,
 *      ownerFullName: task owner full name,
 *      actionID: actionID, i.e. acton dir,
 *      runType: task condition runType (look value description it at tasks.js),
 *      userApproved: task approved username,
 *      userCanceled: task canceled username,
 *      changeStatusTimestamp: time when condition saw changed
 * }, ...]
 */
function getRawTaskList(filterParam, workflowGroups, groupIDs, callback) {
    var groupID = filterParam.groupID || 0, prevGroupID = groupID, rows = [];

    if(filterParam.searchFirstNotEmptyGroup) {
        log.debug('User: ', filterParam.username, ': move groups rules: ', workflowGroups,
            '; target group: ', groupIDs[groupID], '; groups: ', groupIDs);
    }

    async.whilst(function () {
        return groupID !== undefined && !rows.length;
    }, function (callback) {
        tasksDB.getTaskList(filterParam.username, filterParam.timestampFrom, filterParam.timestampTo, {
            groupID: groupID,
            taskName: filterParam.taskName,
            taskID: filterParam.taskID,
            ownerName: filterParam.ownerName,
            dateFromChangeTimestamp: filterParam.dateFromChangeTimestamp,
        }, function(err, _rows) {
            if (!err && _rows && _rows.length) rows = _rows;
            else if(filterParam.searchFirstNotEmptyGroup) {
                log.debug('User: ', filterParam.username, ': can\'t find tasks in task groups ', groupIDs[groupID],
                    '; try to search next group ', groupIDs[workflowGroups[groupID]]);
            }
            prevGroupID = groupID;
            groupID = filterParam.searchFirstNotEmptyGroup ? workflowGroups[groupID] : undefined;
            callback(err);
        });
    }, function(err) {
        callback(err, rows, prevGroupID);
    });
}
