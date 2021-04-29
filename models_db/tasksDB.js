/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var db = require('../lib/db');

var tasksDB = {};
module.exports = tasksDB;

tasksDB.addTask = function(userID, timestamp, name, groupID, callback) {
    if(!name) name = null;

    db.run('INSERT INTO tasks (userID, timestamp, name, groupID) VALUES ($userID,$timestamp,$name,$groupID)', {
        $userID: userID,
        $timestamp: timestamp,
        $name: name,
        $groupID: groupID,
    }, function (err) {
        if(err) {
            return callback(new Error('User ' + userID + ' can\'t  add task ' + name + '; groupID: ' + groupID +
                '; timestamp: ' + timestamp + ': ' + err.message));
        }
        callback(null, this.lastID);
    });
};

tasksDB.updateTask = function(taskID, name, groupID, callback) {
    if(!name) name = null;

    db.run('UPDATE tasks SET name=$name, groupID=$groupID WHERE id=$taskID', {
        $taskID: taskID,
        $name: name,
        $groupID: groupID,
    }, function(err) {
        {
            if(err) {
                return callback(new Error('User ' + userID + ' can\'t  update taskID ' + taskID +'; name ' + name +
                    '; groupID: ' + groupID + ': ' + err.message));
            }
            callback();
        }
    });
};

tasksDB.addAction = function(taskID, sessionID, startupOptions, actionsOrder, callback) {
    db.run('INSERT INTO tasksActions (taskID, sessionID, startupOptions, actionsOrder) VALUES (?,?,?,?)',
        [taskID, sessionID, startupOptions, actionsOrder], function(err) {
        if(err) {
            return callback(new Error('Can\'t insert new actions for task with taskID "' + taskID +
                '", sessionID "' + sessionID + '", startupOptions: ' + startupOptions +
                ', actionsOrder: ' + actionsOrder +' into the tasksActions database: ' + err.message));
        }
        callback(null, this.lastID);
    })
};

tasksDB.addParameters = function(actionID, params, callback) {
    var stmt = db.prepare('INSERT INTO tasksParameters (taskActionID, name, value) VALUES (?,?,?)', function(err) {
        if(err) {
            return callback(new Error('Can\'t prepare to insert new task parameters for actionID "' + actionID +
                '", params: ' + JSON.stringify(params) + ' into the tasksParameters table: ' + err.message));
        }

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(Object.keys(params), function(name, callback) {

            stmt.run([actionID, name, params[name]], callback);
        }, function(err) {
            stmt.finalize();
            if(err) {
                return callback(new Error('Error while add task parameters for action "' + actionID + '", params: ' +
                    JSON.stringify(params) + ': ' + err.message));
            }
            callback();
        });
    });
};

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
Remove tasks groups by group names

groupsNames: array with groups names
callback(err);
 */
tasksDB.removeTasksGroups = function(groupsNames, callback) {
    var questionsString = groupsNames.map(function () {
        return '?'
    }).join(',');

    db.run('DELETE FROM tasksGroups WHERE name IN ('+questionsString+')', groupsNames, function(err) {
        if(err) return callback(new Error('Can\'t remove tasks groups "'+groupsNames.join(', ')+'": '+err.message));
        callback();
    });
};


/*
Rename tasks group

id: group ID
name: new group name
callback(err);
 */
tasksDB.renameTasksGroup = function(id, name, callback){

    db.run('UPDATE tasksGroups SET name=? WHERE id=?', [name, id], function(err) {
        if(err) return callback(new Error('Can\'t rename tasks groups ID "'+id+'" to "'+name+'": '+err.message));
        callback();
    })
};

/*
Add a new tasks group

name: tasks group name
callback(err, newGroupID);
 */
tasksDB.addTasksGroup = function(name, callback) {
    db.run('INSERT INTO tasksGroups (name) VALUES (?)', [name], function(err){
        if(err) return callback(new Error('Can\'t add new tasks groups "'+name+'": '+err.message));
        callback(null, this.lastID);
    })
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
Remove specific task
taskID - task ID for remove
callback(err)

 */

tasksDB.removeTask = function(taskID, callback) {
    db.run('DELETE FROM tasks WHERE id = ?', taskID, function(err) {
        if(err) return callback(new Error('Can\'t remove task with ID  "'+taskID+'": '+err.message));
        callback();
    });
};

/*
Remove specific task actions and parameters. Used for update task
taskID - task ID for remove
callback(err)

 */

tasksDB.removeTaskActionsAndParameters = function(taskID, callback) {
    db.run('DELETE FROM tasksActions WHERE taskID = ?', taskID, function(err) {
        if(err) return callback(new Error('Can\'t remove task actions with task ID  "'+taskID+'": '+err.message));
        callback();
    });
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
Add roles to task group
taskGroupID: task group ID
rolesIDs: array of roles IDs
callback(err)
 */
tasksDB.addRolesForGroup = function(taskGroupID, rolesIDs, callback) {
    log.debug('Add roles IDs ', rolesIDs, ' to task group ID ', taskGroupID);

    var stmt = db.prepare('INSERT INTO tasksGroupsRoles (taskGroupID, roleID) VALUES ($taskGroupID, $roleID)', function(err) {
        if(err) return callback(err);

        async.eachSeries(rolesIDs, function(roleID, callback) {
            stmt.run({
                $taskGroupID: taskGroupID,
                $roleID: roleID
            }, callback);
        }, callback); // error described in the calling function
    });
};

/*
Delete all roles for taskGroupID
taskGroupID: task group ID
callback(err)
 */
tasksDB.deleteAllRolesForGroup = function(taskGroupID, callback) {
    log.debug('Deleting all tasksGroups roles for task group ID: ', taskGroupID);

    // error described in the calling function
    db.run('DELETE FROM tasksGroupsRoles WHERE taskGroupID=?', taskGroupID, callback);
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

/*
Add run condition for taskID

taskID: task ID
runType: 0 - run permanently, 1 - run once, 2 - run now
    11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
callback(err)
 */
tasksDB.addRunCondition = function (taskID, runType, callback) {
    log.debug('Add condition for taskID ', taskID, ', run type ', runType);

    // UNIQUE INDEX is set to TaskID, and if TaskID exists, other values will be replaced
    db.run('INSERT INTO tasksRunConditions (taskID, runType, timestamp) VALUES ($taskID, $runType, $timestamp)', {
        $taskID: taskID,
        $runType: runType,
        $timestamp: Date.now(),
    }, callback);
};

tasksDB.updateRunCondition = function (taskID, runType, callback) {
    log.debug('Update condition for taskID ', taskID, ', run type ', runType);

    db.run('UPDATE tasksRunConditions SET runType=$runType, timestamp=$timestamp WHERE taskID=$taskID', {
        $taskID: taskID,
        $runType: runType,
        $timestamp: Date.now(),
    }, callback);
};

/*
Add OCIDs to run condition
taskID: task ID
OCIDs: array of object counter IDs [OCID1, OCID2,....]
callback(err)
 */
tasksDB.addRunConditionOCIDs = function (taskID, OCIDs, callback) {
    log.debug('Add OCIDs ', OCIDs, ' to tasksRunConditionsOCIDs with  taskID ', taskID);

    var stmt = db.prepare(
        'INSERT INTO tasksRunConditionsOCIDs (taskID, OCID) VALUES ($taskID, $OCID)',
        function(err) {
        if(err) return callback(err);

        async.eachSeries(OCIDs, function(OCID, callback) {
            stmt.run({
                $taskID: taskID,
                $OCID: OCID
            }, callback);
        }, callback);
    });
};

tasksDB.deleteRunCondition = function (taskID, callback) {
    db.run('DELETE FROM tasksRunConditions WHERE taskID=?', taskID, callback);
};

tasksDB.deleteRunConditionOCIDs = function (taskID, callback) {
    db.run('DELETE FROM tasksRunConditionsOCIDs WHERE taskID=?', taskID, callback);
};

/*
Approve task
taskID: task ID
userID: approved user ID
callback(err)
 */
tasksDB.approveTask = function (taskID, userID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userApproved=$userID, userCanceled=NULL WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $userID: userID,
        $taskID: taskID,
    }, callback);
};

/*
Cancel approved task
taskID: task ID
userID: canceled user ID
callback(err)
 */
tasksDB.cancelTask = function (taskID, userID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userCanceled=$userID WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $userID: userID,
        $taskID: taskID,
    }, callback);
};

/*
remove all approval f.e. when task changed
taskID: task ID
callback(err)
 */
tasksDB.removeApproval = function (taskID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userApproved=Null, userCanceled=NULL WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $taskID: taskID,
    }, callback);
}