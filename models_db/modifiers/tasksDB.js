/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../../lib/log')(module);
var db = require('../db');

var tasksDB = {};
module.exports = tasksDB;

tasksDB.addTask = function(userID, timestamp, name, groupID, callback) {
    if(!name) name = null;

    db.run('INSERT INTO tasks (userID, timestamp, name, groupID) VALUES ($userID,$timestamp,$name,$groupID)', {
        $userID: userID,
        $timestamp: timestamp,
        $name: name,
        $groupID: groupID,
    }, function (err, info) {
        if(err) {
            return callback(new Error('User ' + userID + ' can\'t  add task ' + name + '; groupID: ' + groupID +
                '; timestamp: ' + timestamp + ': ' + err.message));
        }
        callback(null, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
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
        [taskID, sessionID, startupOptions, actionsOrder], function (err, info) {
        if(err) {
            return callback(new Error('Can\'t insert new actions for task with taskID "' + taskID +
                '", sessionID "' + sessionID + '", startupOptions: ' + startupOptions +
                ', actionsOrder: ' + actionsOrder +' into the tasksActions database: ' + err.message));
        }
        callback(null, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
    })
};

tasksDB.addParameters = function(actionID, params, callback) {
    var stmt = db.prepare('INSERT INTO tasksParameters (taskActionID, name, value) VALUES (?,?,?)', function(err) {
        if(err) {
            return callback(new Error('Can\'t prepare to insert new task parameters for actionID "' + actionID +
                + '": ', err.message + '; params: ' + JSON.stringify(params) + ' into the tasksParameters table: '));
        }

        async.eachSeries(Object.keys(params), function(name, callback) {
            if(['actionName', 'actionID', 'username', 'sessionID', 'actionCfg'].indexOf(name) !== -1) return callback();
            var param = typeof params[name] === 'object' ? JSON.stringify(params[name]) : params[name];
            stmt.run([actionID, name, param], callback);
        }, function(err) {
            stmt.finalize();
            if(err) {
                return callback(new Error('Error while add task parameters for action "' + actionID  +
                    '": ' + err.message + '; params: ' + JSON.stringify(params)));
            }
            callback();
        });
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
    db.run('INSERT INTO tasksGroups (name) VALUES (?)', [name], function (err, info) {
        if(err) return callback(new Error('Can\'t add new tasks groups "'+name+'": '+err.message));
        callback(null, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
    })
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
        }, function(err) {
            stmt.finalize();
            callback(err);
        }); // error described in the calling function
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
        }, function (err) {
            stmt.finalize();
            callback(err);
        });
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