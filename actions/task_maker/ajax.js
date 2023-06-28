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
 * @param {function(Error)|function(null, Object)} callback callback(err, taskGroupObj) where taskGroupObj is
 * {
 *  groups: allowedRows,
 *  workflow: workflowGroups,
 *  allowedTasksGroupsIDs: allowedTasksGroupsIDs,
 * }
 */
function getTaskGroups(username, callback) {
    tasks.getWorkflow(username, function (err, workflow, allowedTasksGroupsIDs) {
        if(err) return callback(err);

        tasksDB.getTasksGroupsList(function (err, rows) {
            if(err) return callback(new Error('Can\'t get task groups: ' + err.message));

            var groupsNames = {};
            var allowedRows = rows.filter(function (row) {
                groupsNames[row.name] = row.id;
                return allowedTasksGroupsIDs.indexOf(row.id) !== -1;
            });

            var workflowGroups = {};
            workflow.forEach(function (obj) {
                if(!obj.action || obj.action.indexOf(',') === -1) return;
                var groupPair = obj.action.split(/ *, */);
                var groupID = groupsNames[groupPair[0]], nextGroupID = groupsNames[groupPair[1]];
                if(typeof groupID !== 'number' || typeof nextGroupID !== 'number') return;
                workflowGroups[groupID] = nextGroupID;
            });

            callback(null, {
                groups: allowedRows,
                workflow: workflowGroups,
                allowedTasksGroupsIDs: allowedTasksGroupsIDs,
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
 * @param {Object} filterParam parameters for filter tasks
 * @param {string} filterParam.username username
 * @param {number} filterParam.timestampFrom
 * @param {number} filterParam.timestampTo
 * @param {number} filterParam.groupID
 * @param {string} filterParam.taskName
 * @param {string} filterParam.ownerName
 * @param {boolean} filterParam.searchFirstNotEmptyGroup !!groupID
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, taskListObject)
 * where rows - task List rows, groupID - groupID with task for finding task List
 * @example
 * taskListObject
 * {
 *      taskData: Object.values(tasks),
 *      workflow: groupObj.workflow,
 *      groups: groupObj.groups,
 *      groupID: groupID,
 *}
 */
function getTaskList(filterParam, callback) {
    if(!filterParam.timestampFrom) return callback(new Error('Undefined first timestamp while getting task list'));
    var timestampFrom = Number(filterParam.timestampFrom);
    if(!timestampFrom || timestampFrom !== parseInt(String(timestampFrom), 10) || timestampFrom < 946659600000 )
        return callback(new Error('Incorrect first timestamp ("' + filterParam.timestampFrom + '") while getting task list'));

    if(!filterParam.timestampTo) return callback(new Error('Undefined last timestamp while getting task list'));
    var timestampTo = Number(filterParam.timestampTo);
    if(!timestampTo || timestampTo !== parseInt(String(timestampTo), 10) || timestampTo < 946659600000 )
        return callback(new Error('Incorrect last timestamp ("' + filterParam.timestampTo + '") while getting task list'));

    if(timestampFrom >= timestampTo)
        return callback(new Error('First timestamp ("' + filterParam.timestampFrom + '") more then last timestamp ("' + filterParam.timestampTo + '") for getting task list'));

    var groupID = Number(filterParam.groupID);
    if(!groupID) groupID = 0;
    else if(groupID !== parseInt(String(groupID), 10)) return callback(new Error('Incorrect group ID ("' + filterParam.groupID + '") while getting task list'));

    getTaskGroups(filterParam.username, function (err, groupObj) {
        if(err) return callback(err);

        var allowedTasksGroupsIDs = groupObj.allowedTasksGroupsIDs;

        if(allowedTasksGroupsIDs.indexOf(groupID) === -1) {
            return callback(new Error('Group ID ' + groupID + ' is not allowed for user ' + filterParam.username));
        }

        if(filterParam.userName) var ownerName = '%' + filterParam.userName + '%';
        if(filterParam.taskName) var taskName = '%' + filterParam.taskName + '%';

        getRawTaskList({
            username: filterParam.username,
            timestampFrom: timestampFrom,
            timestampTo: timestampTo,
            groupID: groupID,
            taskName: taskName,
            ownerName: ownerName,
            searchFirstNotEmptyGroup: !!filterParam.groupID,
        }, groupObj.workflow, function(err, rows, groupID) {
        /*
        tasksDB.getTaskList(args.username, timestampFrom, timestampTo, {
            groupID: groupID,
            taskName: taskName,
            ownerName: ownerName
        }, function(err, rows) {

         */
            if(err) return callback(err);

            groupObj.groupID = groupID;

            if(!rows.length) {
                log.debug('No tasks found for user ', filterParam.username, ' from ',
                    new Date(timestampFrom).toLocaleString(), ' to ', new Date(timestampTo).toLocaleString(),
                    ', groupID: ', groupID, '; taskName: ', taskName, '; ownerName: ', ownerName);
                return callback(null, groupObj);
            }

            var tasks = {}, actions = {};
            rows.forEach(function (row) {
                if(!tasks[row.id]) tasks[row.id] = row;
                if(!actions[row.actionID]) actions[row.actionID] = true;
            });
            rightsWrapper.checkActionsRights(filterParam.username, Object.keys(actions), null, function (err, actionsRights) {
                if(err) {
                    return callback(new Error('Error checking rights for task "' + taskName +
                        '", actions in task: "' + Object.keys(actions).join(', ') + '": ' + err.message));
                }

                for(var taskID in tasks) {
                    tasks[taskID].canExecuteTask = true;
                    tasks[taskID].canViewTask = true;

                    for(var actionID in actionsRights) {
                        if(!actionsRights[actionID] || !actionsRights[actionID].run) {
                            tasks[taskID].canExecuteTask = false;
                        }
                        if(!actionsRights[actionID] || !actionsRights[actionID].view) {
                            tasks[taskID].canViewTask = false;
                        }
                    }
                }

                log.debug('Receiving task list: ', tasks)

                callback(null, {
                    taskData: Object.values(tasks),
                    workflow: groupObj.workflow,
                    groups: groupObj.groups,
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
 * @param {string} filterParam.ownerName
 * @param {boolean} filterParam.searchFirstNotEmptyGroup groupID === ''
 * @param {Object} workflowGroups group chain in workflow workflowGroup[groupID] = nextGroupID
 * @param {function(Error)|function(null, Array<Object>, number)} callback callback(err, rows, groupID)
 * where rows - task List rows, groupID - groupID with task for finding task List
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
function getRawTaskList(filterParam, workflowGroups, callback) {
    var groupID = filterParam.groupID, prevGroupID = groupID, rows = [];
    async.whilst(function () {
        return groupID !== undefined && !rows.length;
    }, function (callback) {
        tasksDB.getTaskList(filterParam.username, filterParam.timestampFrom, filterParam.timestampTo, {
            groupID: groupID,
            taskName: filterParam.taskName,
            ownerName: filterParam.ownerName
        }, function(err, _rows) {
            if (!err && _rows && _rows.length) rows = _rows;
            else if(filterParam.searchFirstNotEmptyGroup) {
                log.debug('Can\'t find tasks in task groups ', groupID, '; try to search in group ', workflowGroups[groupID]);
            }
            prevGroupID = groupID;
            groupID = filterParam.searchFirstNotEmptyGroup ? workflowGroups[groupID] : undefined;
            callback(err);
        });
    }, function(err) {
        callback(err, rows, prevGroupID);
    });
}
