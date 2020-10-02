/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.03.2017.
 */
var async = require('async');
var log = require('../../lib/log')(module);
var rightsWrapper = require('../../rightsWrappers/tasksDB');
var tasksDB = require('../../models_db/tasksDB');
var rightsWrappersCountersDB = require('../../rightsWrappers/countersDB');
var tasks = require('../../lib/tasks');

module.exports = function(args, callback) {
    //log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (func === 'getTaskParameters') return tasks.getTaskParameters(args.username, args.id, callback);

    if (func === 'getTasksList') return getTaskList(args, callback);

    if (func === 'getCounters') return getCounters(args.username, args.objectsIDs, callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};

function getTaskGroups(userName, callback) {
    tasks.getWorkflowAndAllowedGroupsIDs(userName, function (err, workflow, allowedTasksGroupsIDs) {
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

function getCounters(user, objectsIDsStr, callback){
    if(!objectsIDsStr) return callback(new Error('Error in parameter objectsIDs: no such parameter'));

    var objectsIDs = objectsIDsStr.split(',').map(function(ID) {
        ID = Number(ID);
        if(!ID || ID !== parseInt(String(ID), 10)) return 0;
        return ID;
    }).filter(function(ID) { return (ID !== 0) });

    // callback(err, rows); rows = [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
    return rightsWrappersCountersDB.getCountersForObjects(user, objectsIDs, null, function(err, rows) {
        if(err) return callback(err);

        var countersArray = rows.filter(function (row) {
            return row.taskCondition;
        });

        callback(null, countersArray);
    });
}


function getTaskList(args, callback) {
    if(!args.timestampFrom) return callback(new Error('Undefined first timestamp while getting task list'));
    var timestampFrom = Number(args.timestampFrom);
    if(!timestampFrom || timestampFrom !== parseInt(String(timestampFrom), 10) || timestampFrom < 946659600000 )
        return callback(new Error('Incorrect first timestamp ("' + args.timestampFrom + '") while getting task list'));

    if(!args.timestampTo) return callback(new Error('Undefined last timestamp while getting task list'));
    var timestampTo = Number(args.timestampTo);
    if(!timestampTo || timestampTo !== parseInt(String(timestampTo), 10) || timestampTo < 946659600000 )
        return callback(new Error('Incorrect last timestamp ("' + args.timestampTo + '") while getting task list'));

    if(timestampFrom >= timestampTo)
        return callback(new Error('First timestamp ("' + args.timestampFrom + '") more then last timestamp ("' + args.timestampTo + '") for getting task list'));

    var groupID = Number(args.groupID);
    if(!groupID) groupID = 0;
    else if(groupID !== parseInt(String(groupID), 10)) return callback(new Error('Incorrect group ID ("' + args.groupID + '") while getting task list'));

    getTaskGroups(args.username, function (err, groupObj) {
        if(err) return callback(err);

        var allowedTasksGroupsIDs = groupObj.allowedTasksGroupsIDs;

        if(allowedTasksGroupsIDs.indexOf(groupID) === -1) {
            return callback(new Error('Group ID ' + groupID + ' is not allowed for user ' + args.username));
        }

        if(args.userName) var ownerName = args.userName + '%';
        if(args.taskName) var taskName = args.taskName + '%';

        getRawTaskList({
            username: args.username,
            timestampFrom: timestampFrom,
            timestampTo: timestampTo,
            groupID: groupID,
            taskName: taskName,
            ownerName: ownerName,
            searchFirstNotEmptyGroup: args.groupID === '',
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
                log.debug('No tasks found for user ', args.username, ' from ',
                    new Date(timestampFrom).toLocaleString(), ' to ', new Date(timestampTo).toLocaleString(),
                    ', groupID: ', groupID, '; taskName: ', taskName, '; ownerName: ', ownerName);
                return callback(null, groupObj);
            }

            var tasks = {}, actions = {};
            rows.forEach(function (row) {
                if(!tasks[row.id]) tasks[row.id] = row;
                if(!actions[row.actionID]) actions[row.actionID] = true;
            });
            rightsWrapper.checkActionsRights(args.username, Object.keys(actions), null, function (err, actionsRights) {
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

/*
Retrieving a list of tasks from the first group containing tasks using the group order settings in the workflow
f.e. for business user at first searching tasks in Default group, then in Business tasks for validation, then in Business tasks group
prm: {
username: args.username,
timestampFrom: timestampFrom,
timestampTo: timestampTo,
groupID: groupID,
taskName: taskName,
ownerName: ownerName,
searchFirstNotEmptyGroup: args.groupID === '',
}

workflowGroup - group chain in workflow workflowGroup[groupID] = nextGroupID
callback(err, rows, groupID), where rows - task List rows, groupID - groupID with task for finding task List
 */
function getRawTaskList(prm, workflowGroups, callback) {
    var groupID = prm.groupID, prevGroupID = groupID, rows = [];
    async.whilst(function () {
        return groupID !== undefined && !rows.length;
    }, function (callback) {
        tasksDB.getTaskList(prm.username, prm.timestampFrom, prm.timestampTo, {
            groupID: groupID,
            taskName: prm.taskName,
            ownerName: prm.ownerName
        }, function(err, _rows) {
            if (!err && _rows && _rows.length) rows = _rows;
            else if(prm.searchFirstNotEmptyGroup) {
                log.debug('Can\'t find tasks in task groups ', groupID, '; try to search in group ', workflowGroups[groupID]);
            }
            prevGroupID = groupID;
            groupID = prm.searchFirstNotEmptyGroup ? workflowGroups[groupID] : undefined;
            callback(err);
        });
    }, function(err) {
        callback(err, rows, prevGroupID);
    });
}

