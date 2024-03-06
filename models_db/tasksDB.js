/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const db = require('./db');

var tasksDB = {};
module.exports = tasksDB;

/**
 * Get new unnamed taskID for specific user
 * @param {number} userID task creator user ID
 * @param {function(Error)|function()|function(null, number)} callback callback(err, taskID),
 * where taskID is a required task ID or undefined if unnamed task for specific user ID is not found
 */
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

/**
 * Getting task parameters. Username used only for a new undefined task (without taskID)
 * @param {string|null} username username for get parameters from a new task if taskID not defined
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Array)} callback callback(err, taskParametersRows)
 * where taskParametersRows is an array with objects described in example section
 * @example
 * for callback(err, taskParametersRows), returned array taskDataRows contain an objects like:
 * {
 *     taskActionID: <id from tasksActions table>,
 *     name: <action parameter name>,
 *     value: <action parameter value>,
 *     actionID: <action ID (action dir)>,
 *     startupOptions: <startup options for action>,
 *     actionsOrder: <action order in the task>,
 *     username: <task creator username>,
 * }
 */
tasksDB.getTaskParameters = function(username, taskID, callback) {
    log.debug('Getting task parameters for task ID: "', taskID, '", user: "', username, '"');
    db.all('\
SELECT tasksActions.id AS taskActionID, tasksParameters.name AS name, tasksParameters.value AS value, \
tasksActions.actionID AS actionID, tasksActions.startupOptions AS startupOptions, \
tasksActions.actionsOrder AS actionsOrder, users.name AS username \
FROM tasksParameters \
JOIN tasksActions ON tasksParameters.taskActionID = tasksActions.id \
JOIN tasks ON tasksActions.taskID = tasks.id \
JOIN users ON tasks.userID = users.id \
WHERE ' + (taskID ? 'tasks.id = ?' : 'users.name = ? AND tasks.name IS NULL') +
        ' ORDER BY tasksActions.actionsOrder, tasksParameters.name',
        taskID ? [taskID] : [username], function(err, taskParameters) {
        if(err) {
            return callback(new Error('Can\'t get task parameters for user ' + username + ' and task ID ' +
                taskID + ': ' + err.message));
        }
        callback(null, taskParameters)
    });
};

/**
 * Getting common task parameters
 * @param {string|null} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Array)} callback callback(err, taskDataRows), where
 * taskDataRows is an array with objects described in example section
 * @example
 * for callback(err, taskDataRows), returned array taskDataRows contain an objects like:
 * {
 *  id: <taskID>,
 *  name: <taskName>,
 *  timestamp: <taskCreatedTime>,
 *  groupID: <taskGroupID>,
 *  groupName: <taskGroupName>,
 *  userDI: <taskCreatorUserID>
 *  ownerName: <task creator login>,
 *  ownerFullName: <task creator full name>,
 *  runType: <task condition runType>,
 *  conditionTimestamp: <task condition timestamp>
 *}
 *
 */
tasksDB.getTaskData = function (username, taskID, callback) {
    log.debug('Getting common task for task ID: "', taskID, '", user: "', username, '"');

    if(username === null && !taskID) return callback(null, [])

    // checking user name only for a new task
    db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, tasks.groupID AS groupID, tasks.userID AS userID, \
users.name AS ownerName, users.fullName AS ownerFullName, tasksRunConditions.runType AS runType, \
tasksRunConditions.timestamp AS conditionTimestamp, tasksGroups.name AS groupName \
FROM tasks \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
JOIN users ON tasks.userID = users.id \
JOIN tasksGroups ON tasks.groupID = tasksGroups.id \
WHERE ' + (taskID ? 'tasks.id = ?' : 'users.name = ? AND tasks.name IS NULL'),
        taskID ? [taskID] : [username], function(err, taskData) {
        if(err) {
            return callback(new Error('Error while getting task data for user "' + username +
                '" and task ID "' + taskID + '": ' + err.message));
        }

        callback(null, taskData);
    })
};

/**
 * Getting data for creating a task list
 * @param {string} username username
 * @param {number} timestampFrom first timestamp for selecting tasks form DB
 * @param {number} timestampTo last timestamp for selecting tasks form DB
 * @param {Object} param query parameters
 * @param {string} param.ownerName task owner username
 * @param {string} param.taskName task name
 * @param {number} param.taskID task id
 * @param {number} param.groupID task group ID
 * @param {number} param.dateFromChangeTimestamp timestamp when dateFrom was changed
 * @param {function(Error)|function(null, Array)} callback callback(err, rows) where row is an array
 * @example
 * example of the returned array (rows)
 *  [
 *      {
 *          id: task ID,
 *          name: task name or NULL for a new task,
 *          timestamp: time when task was created,
 *          ownerName: task owner username
 *          ownerFullName: task owner full name,
 *          actionID: actionID, i.e. acton dir,
 *          runType: task condition runType (look value description it at tasks.js),
 *          userApproved: task approved username,
 *          userCanceled: task canceled username,
 *          changeStatusTimestamp: time when condition saw changed
 *      }, ...]
 */
tasksDB.getTaskList = function(username, timestampFrom, timestampTo, param, callback) {

    // for searching like object search style using * and _
    var taskName =
        param.taskName ? '%' + param.taskName.replace(/[*]+/g, '%') + '%' : undefined;
    var creatorName =
        param.ownerName ? '%' + param.ownerName.replace(/[*]+/g, '%') + '%': undefined;

    // max number of returned rows
    var rowsLimit = 2000;

    // for searching in the stringified objects array, like
    // [{"id":59984,"name":"Test"},{"id":59985,"name":"Test1"}] using regexp
    var objectSearchStrFromName = taskName ? '^.*"name":"' +
        // convert SQL like style to regexp
        escapeRegExp(taskName).replace(/%/g, '[^"]*').replace(/_/g, '[^"]') +
        '".*$' : undefined;

    // searching exactly taskID.
    // if taskID is 2 then for "test-20" is false; "test-2" is true
    var objectSearchStrFromID =
        param.taskID ? '^.*"name":"([])|([^"]*[^0-9])' + param.taskID + '([^0-9][^"]*)|([])".*$' : undefined;

        db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, users.name AS ownerName, \
users.fullName AS ownerFullName, tasksActions.actionID AS actionID, \
tasksRunConditions.runType AS runType, \
userApproved.fullName AS userApproved, userCanceled.fullName AS userCanceled, \
tasksRunConditions.timestamp AS changeStatusTimestamp \
FROM tasks \
JOIN users ON tasks.userID = users.id \
JOIN tasksActions ON tasksActions.taskID = tasks.id \
JOIN tasksParameters ON tasksParameters.taskActionID=tasksActions.id \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
LEFT JOIN users userApproved ON tasksRunConditions.userApproved = userApproved.id \
LEFT JOIN users userCanceled ON tasksRunConditions.userCanceled = userCanceled.id \
WHERE tasks.timestamp >= $timestampFrom AND tasks.timestamp <= $timestampTo AND \
        (users.name = $userName OR tasks.name NOTNULL)' +
        (creatorName ? ' AND users.name like $ownerName' : '') +
        (taskName ? ' AND tasks.name like $taskName ' +
            'OR (tasksParameters.name="o" AND tasksParameters.value regexp $objectSearchStrFromName)' : '') +
        (param.taskID ? ' AND tasks.id=$taskID OR ' +
            '(tasksParameters.name="o" AND tasksParameters.value regexp $objectSearchStrFromID)' : '') +
        (!param.taskID && !taskName && !creatorName ? ' AND tasks.groupID = $groupID' : '') +
        ' ORDER by tasks.timestamp DESC LIMIT ' + rowsLimit, {

            $timestampFrom: timestampFrom,
            $timestampTo: timestampTo,
            $ownerName: creatorName,
            $taskName: taskName,
            $taskID: param.taskID ? param.taskID : undefined,
            $objectSearchStrFromName: objectSearchStrFromName,
            $objectSearchStrFromID: objectSearchStrFromID,
            $groupID: param.groupID,
            $userName: username,
        }, function(err, taskData) {
            if(err) return callback(new Error('Error while getting task data: '+err.message));

            // calculate number of tasks
            var taskIDs = new Set();
            taskData.forEach(row => taskIDs.add(row.id));
            if(taskIDs.size >= 20 || param.dateFromChangeTimestamp > Date.now()) return callback(null, taskData);

            /*
            Got a lot of rows because the tasks have a lot of parameters.
            Increase the number of rows limit by 2 times
            */
            if(taskData.length === rowsLimit) rowsLimit *= 2;

            db.all('\
SELECT tasks.id AS id, tasks.name AS name, tasks.timestamp AS timestamp, users.name AS ownerName, \
users.fullName AS ownerFullName, tasksActions.actionID AS actionID, \
tasksRunConditions.runType AS runType, \
userApproved.fullName AS userApproved, userCanceled.fullName AS userCanceled, \
tasksRunConditions.timestamp AS changeStatusTimestamp \
FROM tasks \
JOIN users ON tasks.userID = users.id \
JOIN tasksActions ON tasksActions.taskID = tasks.id \
JOIN tasksParameters ON tasksParameters.taskActionID=tasksActions.id \
LEFT JOIN tasksRunConditions ON tasks.id = tasksRunConditions.taskID \
LEFT JOIN users userApproved ON tasksRunConditions.userApproved = userApproved.id \
LEFT JOIN users userCanceled ON tasksRunConditions.userCanceled = userCanceled.id \
WHERE tasks.timestamp <= $timestampTo AND \
        (users.name = $userName OR tasks.name NOTNULL)' +
        (creatorName ? ' AND users.name like $ownerName' : '') +
            (taskName ? ' AND tasks.name like $taskName ' +
                'OR (tasksParameters.name="o" AND tasksParameters.value regexp $objectSearchStrFromName)' : '') +
            (param.taskID ? ' AND tasks.id=$taskID OR ' +
                '(tasksParameters.name="o" AND tasksParameters.value regexp $objectSearchStrFromID)' : '') +
        (!param.taskID && !param.taskName  && !creatorName ? ' AND tasks.groupID = $groupID' : '') +
        ' ORDER by tasks.timestamp DESC LIMIT ' + rowsLimit, {

                    $timestampTo: timestampTo,
                    $ownerName: creatorName,
                    $taskName: taskName,
                    $taskID: param.taskID ? param.taskID : undefined,
                    $objectSearchStrFromName: objectSearchStrFromName,
                    $objectSearchStrFromID: objectSearchStrFromID,
                    $groupID: param.groupID,
                    $userName: username,
                },
                function(err, taskData) {
                    if (err) return callback(new Error('Error while getting 20 task data: ' + err.message));

                    callback(null, taskData);
                });
        });
};

/**
 * Escape regExp characters in the string for make a regExp from the string
 * @param {string} string string for regExp
 * @return {string} string with escaped regExp characters
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}


/**
 * Getting list of all tasks groups, sorted by task names (SELECT * FROM tasksGroups ORDER BY name)
 * @param {function(Error|undefined, Array)} callback callback(err, row) where row is an array like
 *  [{id: <task group ID, name:<task group name> }, ...]
 */
tasksDB.getTasksGroupsList = function(callback) {
    db.all('SELECT * FROM tasksGroups ORDER BY name', callback);
};

/**
 * Get actions for specific tasks (SELECT actionID FROM tasksActions WHERE tasksActions.taskID = ?)
 * @param {number} taskID task ID
 * @param {function(Error|undefined, Array)} callback callback(err, rows) where rows is an array like
 *  [{actionID: }, ...]
 */
tasksDB.getTaskActions = function(taskID, callback) {
    db.all('SELECT actionID FROM tasksActions WHERE tasksActions.taskID = ?', [taskID], callback);
};

/**
 * Get actionIDs (action dir) by taskActionIDs (id in tasksActions table)
 * @param {Array} taskActionIDs array with taskActionIDs
 * @param {function(Error)|function(null, Object)} callback callback(err, taskActionID2actionID), where
 *    taskActionID2actionID is a object like {<taskActionID>: <actionID>, ...}
 */
tasksDB.getActionsIDs = function (taskActionIDs, callback) {
    var stmt = db.prepare('SELECT id AS taskActionID, actionID FROM tasksActions WHERE id = ?',
        function (err) {
        if(err) {
            return callback(new Error('Can\'t prepare stmt for get actionIDs by taskActionIDs: ' + err.message));
        }

        var taskActionID2actionID = {};
        async.eachSeries(taskActionIDs, function (taskActionID, callback) {
            stmt.get(taskActionID, function (err, row) {
                if(err) return callback(err);
                if(row) taskActionID2actionID[taskActionID] = row.actionID;
                callback();
            });
        }, function (err) {
            if(err) {
                return callback(new Error('Can\'t get actionIDs by taskActionIDs: ' + err.message + ': ' +
                    taskActionIDs.join(',')));
            }
            callback(null, taskActionID2actionID);
        });
    });
};

/**
 * Get all data from tasksGroupsRoles using SELECT * FROM tasksGroupsRoles
 * @param {function(Error, Array<{id: number, taskGroupID: number, roleID: number}>)} callback
 * callback(err, rows) where rows is an array like [{id:.., taskGroupID:.., roleID}, ...]
 */
tasksDB.getRoles = function (callback) {
    db.all('SELECT * FROM tasksGroupsRoles', callback);
};

/**
 * Get OCIDs for specific task ID using SELECT OCID FROM tasksRunConditionsOCIDs WHERE taskID = ?
 * @param {number} taskID task ID
 * @param {function(Error, Array)} callback callback(err, rows), rows is an array like
 * [{OCID: ...}, {OCID: ...}, ..]
 */
tasksDB.getRunConditionOCIDs = function(taskID, callback) {
    db.all('SELECT OCID FROM tasksRunConditionsOCIDs WHERE taskID = ?', taskID, callback);
}

/**
 * Get data from taskConditions for specific taskID (SELECT * FROM tasksRunConditions WHERE taskID = ?)
 * @param {number} taskID task ID
 * @param {function(Error|undefined, Array<{taskID:number, timestamp:number, runType:1|11|2|12, userApproved:number,
 * userCanceled:number}>)} callback callback(err, rows), where rows is an array like
 *  [{taskID:... , timestamp:... , runType:{1|11|2|12}, userApproved:<userID>, userCanceled:<userID>}, {}, ..]
 *  @example
 *  runType values example
 * 1  run once by condition
 * 11 run once by condition and task has already started
 * 2  run now
 * 12 run now and task has already started
 */
tasksDB.getTaskConditions = function(taskID, callback) {
    db.all('SELECT * FROM tasksRunConditions WHERE taskID = ?', taskID, callback);
}

/**
 * Get approved tasks
 * @param {function(Error|undefined, Array)} callback callback(err, rows), where rows is an array like
 *  [{taskID:.., runType:.., OCID:..., username:...}, ...]
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