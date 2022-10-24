/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var db = require('./db');

var tasksDB = {};
module.exports = tasksDB;

tasksDB.getUnnamedTask = function(userID, callback){
    db.get('SELECT id FROM tasks WHERE userID=? AND name IS NULL', [userID], function(err, row){
        if(err) {
            return callback(new Error('UserID ' + userID + 'Can\'t get taskID for unnamed task from tasks database: ' +
                err.message));
        }
        if(!row) return callback();
        callback(null, row.id);
    });
};

/*
Getting task parameters from DB

userName: user name
taskID: task ID or undefined for new task
callback(err, taskParameters)
taskParameters: [{sessionID:.., name:<taskParameterName>, value:.., actionID:<actionID ie action dir>, actionName:<actionName>, startupOptions: ...},..]
 */
tasksDB.getTaskParameters = function(userName, taskID, callback) {
    log.debug('Getting task parameters for task ID: "', taskID, '", user: "', userName, '"');
    db.all('\
SELECT tasksActions.id AS tasksActionsID, tasksActions.sessionID AS sessionID, tasksParameters.name AS name, tasksParameters.value AS value, \
auditUsers.actionID AS actionID, auditUsers.actionName AS actionName, tasksActions.startupOptions AS startupOptions, \
tasksActions.actionsOrder AS actionsOrder \
FROM tasksParameters \
JOIN tasksActions ON tasksParameters.taskActionID = tasksActions.id \
JOIN tasks ON tasksActions.taskID = tasks.id \
JOIN auditUsers ON tasksActions.sessionID = auditUsers.sessionID \
JOIN users ON tasks.userID = users.id \
WHERE ' + (taskID ? 'tasks.id = ?' : 'users.name = ? AND tasks.name IS NULL') +
        ' ORDER BY tasksActions.actionsOrder, tasksParameters.name',
        taskID ? [taskID] : [userName], function(err, taskParameters) {
        if(err) {
            return callback(new Error('Can\'t get task parameters for user ' + userName + ' and task ID ' +
                taskID + ': ' + err.message));
        }
        callback(null, taskParameters)
    });
};

/*
Getting common task parameters

 name: task name or undefined for new task
 callback(err, taskData)
 taskData: [{id: <taskID>, name: <taskName or NULL for a new task>, timestamp:.., userName:.., userFullName:..}]
 actionOrder field can contain comma separated sessionIDs
 */
tasksDB.getTaskData = function (userName, taskID, callback) {
    log.debug('Getting common task for task ID: "', taskID, '", user: "', userName, '"');

    // checking user name only for a new task
    db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, tasks.groupID AS groupID, \
users.name AS ownerName, users.fullName AS ownerFullName, tasksRunConditions.runType AS runType, \
tasksRunConditions.timestamp AS conditionTimestamp \
FROM tasks \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
JOIN users ON tasks.userID = users.id \
WHERE ' + (taskID ? 'tasks.id = ?' : 'users.name = ? AND tasks.name IS NULL'),
        taskID ? [taskID] : [userName], function(err, taskData) {
        if(err) {
            return callback(new Error('Error while getting task data for user "' + userName +
                '" and task ID "' + taskID + '": ' + err.message));
        }

        callback(null, taskData);
    })
};

/*
Getting data for creating a task list

timestampFrom: first timestamp for selecting tasks form DB
timestampTo: last timestamp for selecting tasks form DB
prm: {
    userName: task owner
    taskName: part of the task name for filter task
    groupID: group ID
}
callback(err, taskData)
taskData: [{id: <taskID>, name: <taskName or NULL for a new task>, timestamp:.., userName:.., userFullName:..}]

 */
tasksDB.getTaskList = function(userName, timestampFrom, timestampTo, prm, callback) {
    db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, users.name AS ownerName, \
users.fullName AS ownerFullName, auditUsers.actionID AS actionID, \
tasksRunConditions.runType AS runType, \
userApproved.fullName AS userApproved, userCanceled.fullName AS userCanceled, \
tasksRunConditions.timestamp AS changeStatusTimestamp \
FROM tasks \
JOIN users ON tasks.userID = users.id \
JOIN tasksActions ON tasksActions.taskID = tasks.id \
JOIN auditUsers ON tasksActions.sessionID = auditUsers.sessionID \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
LEFT JOIN users userApproved ON tasksRunConditions.userApproved = userApproved.id \
LEFT JOIN users userCanceled ON tasksRunConditions.userCanceled = userCanceled.id \
WHERE tasks.timestamp >= $timestampFrom AND tasks.timestamp <= $timestampTo AND \
(users.name = $userName OR tasks.name NOTNULL)' +
        (prm.ownerName ? ' AND users.name like $ownerName' : '') +
        (prm.taskName ? ' AND tasks.name like $taskName' : '') +
        ' AND tasks.groupID = $groupID ORDER by tasks.timestamp DESC', {

            $timestampFrom: timestampFrom,
            $timestampTo: timestampTo,
            $ownerName: prm.ownerName ? prm.ownerName : undefined,
            $taskName: prm.taskName ? prm.taskName : undefined,
            $groupID: prm.groupID,
            $userName: userName,
        }, function(err, taskData) {
            if(err) return callback(new Error('Error while getting task data: '+err.message));

            if(taskData.length >= 20) return callback(null, taskData);

            db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, users.name AS ownerName, \
users.fullName AS ownerFullName, auditUsers.actionID AS actionID, \
tasksRunConditions.runType AS runType, \
userApproved.fullName AS userApproved, userCanceled.fullName AS userCanceled, \
tasksRunConditions.timestamp AS changeStatusTimestamp \
FROM tasks \
JOIN users ON tasks.userID = users.id \
JOIN tasksActions ON tasksActions.taskID = tasks.id \
JOIN auditUsers ON tasksActions.sessionID = auditUsers.sessionID \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
LEFT JOIN users userApproved ON tasksRunConditions.userApproved = userApproved.id \
LEFT JOIN users userCanceled ON tasksRunConditions.userCanceled = userCanceled.id \
WHERE tasks.timestamp <= $timestampTo AND \
(users.name = $userName OR tasks.name NOTNULL)' +
        (prm.ownerName ? ' AND users.name like $ownerName' : '') +
        (prm.taskName ? ' AND tasks.name like $taskName' : '') +
        ' AND tasks.groupID = $groupID ORDER by tasks.timestamp DESC LIMIT 50', {

                    $timestampTo: timestampTo,
                    $ownerName: prm.ownerName ? prm.ownerName : undefined,
                    $taskName: prm.taskName ? prm.taskName : undefined,
                    $groupID: prm.groupID,
                    $userName: userName,
                },
                function(err, taskData) {
                    if (err) return callback(new Error('Error while getting 20 task data: ' + err.message));

                    callback(null, taskData);
                });
        });
};

/*
Getting list of tasks groups, sorted by task names

callback(err, rows)
rows: [{id:.., name:..}, {..}]
 */
tasksDB.getTasksGroupsList = function(callback) {
    db.all('SELECT * FROM tasksGroups ORDER BY name', function(err, groups) {
        if(err) return callback(new Error('Can\'t get tasks groups from database: ' + err.message));
        callback(null, groups);
    });
};

/*
Get actions for specific tasks

taskID - task ID
callback(err, row)
row - [{actionID: <>}, ...]
 */
tasksDB.getTaskActions = function(taskID, callback) {
    db.all('SELECT auditUsers.actionID AS actionID ' +
        'FROM tasksActions ' +
        'JOIN auditUsers ON tasksActions.sessionID = auditUsers.sessionID ' +
        'WHERE tasksActions.taskID = ?', [taskID], callback);
};

/*
Get actions IDs by session IDs

sessionIDs: array of session IDs [<id1>, id2, ...]
callback(err, rows)
rows: [{sessionID: .., actionID:..}, {}, ...]
 */
tasksDB.getActionsIDs = function (sessionIDs, callback) {
    var questionsString = sessionIDs.map(function(){return '?'}).join(',');

    db.all('SELECT sessionID, actionID FROM auditUsers WHERE sessionID IN ('+questionsString+')', sessionIDs, callback);
};

/*
Get all data from tasksGroupsRoles
callback(err, rows), where rows: [{id:.., taskGroupID:.., roleID}, ...]
 */
tasksDB.getRoles = function (callback) {
    db.all('SELECT * FROM tasksGroupsRoles', callback);
};

/*
    Get OCIDs for specific task ID
    taskID: task ID
    callback(err, rows), rows: [{OCID: ...}, {OCID: ...}, ..]
 */
tasksDB.getRunConditionOCIDs = function(taskID, callback) {
    db.all('SELECT OCID FROM tasksRunConditionsOCIDs WHERE taskID = ?', taskID, callback);
}

/*
    Get data from taskConditions for specific  taskID
    taskID: task ID
    callback(err, rows), rows: [{taskID: taskID, timestamp:... , runType:.., userApproved:..., userCanceled:...}, {}, ..]
 */
tasksDB.getTaskConditions = function(taskID, callback) {
    db.all('SELECT * FROM tasksRunConditions WHERE taskID = ?', taskID, callback);
}

/*
Get approved tasks for run from server
callback(err, rows)
rows: [{taskID:.., runType:.., OCID:...}, ...]
 */
tasksDB.getApprovedTasks = function(callback) {
    db.all('\
SELECT tasksRunConditions.taskID AS taskID, tasksRunConditions.runType AS runType, \
tasksRunConditionsOCIDs.OCID AS OCID, users.name AS username \
FROM tasksRunConditions \
JOIN users ON tasksRunConditions.userApproved=users.ID \
LEFT JOIN tasksRunConditionsOCIDs ON tasksRunConditions.taskID=tasksRunConditionsOCIDs.taskID \
WHERE (runType<2 OR runType>?) AND (userApproved IS NOT NULL AND userCanceled IS NULL)', Date.now(), callback);
};