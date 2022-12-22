/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require('async');
const log = require('../../lib/log')(module);
const db = require('../db');
const unique = require('../../lib/utils/unique');

var tasksDB = {};
module.exports = tasksDB;

/**
 * Insert a new task
 * @param {Number} userID - user ID
 * @param {Number} timestamp - create task timestamp (Date.now())
 * @param {string|null} name - task name
 * @param {Number} groupID - task group ID
 * @param {number} sessionID - sessionID for crate unique task ID
 * @param {function(Error) | function(null, Number)} callback - callback(err, taskID), where taskID is inserted task ID
 */
tasksDB.addTask = function(userID, timestamp, name, groupID, sessionID, callback) {
    if(!name) name = null;

    const id = unique.createHash(userID.toString(36) + name + groupID + sessionID);
    db.run('INSERT INTO tasks (id, userID, timestamp, name, groupID) VALUES ($id, $userID, $timestamp, $name, $groupID)', {
        $id: id,
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

tasksDB.updateTask = function(userID, taskID, name, groupID, callback) {
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

/**
 * Insert action for specific taskID
 * @param {Number} taskID - task ID
 * @param {Number} sessionID - session ID
 * @param {Number} startupOptions - startupOptions
 * @param {Number} actionsOrder - order of action in the task
 * @param {function(Error) | function(null, Number)} callback - callback(err, taskActionID), where taskActionID
 *  is a new id of inserted action for the task
 */
tasksDB.addAction = function(taskID, sessionID, startupOptions, actionsOrder, callback) {
    const id = unique.createHash(taskID.toString(36) + sessionID + startupOptions + actionsOrder);

    db.run('INSERT INTO tasksActions (id, taskID, sessionID, startupOptions, actionsOrder) VALUES (?, ?, ?, ?, ?)',
        [id, taskID, sessionID, startupOptions, actionsOrder], function (err, info) {
        if(err) {
            return callback(new Error('Can\'t insert new actions with taskActionID: '+ id +
                ' for task with taskID "' + taskID +
                '", sessionID "' + sessionID + '", startupOptions: ' + startupOptions +
                ', actionsOrder: ' + actionsOrder + ' into the tasksActions database: ' + err.message));
        }
        callback(null, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
    })
};

/**
 * Insert action parameters for specific action for the task
 * @param {Number} taskActionID - action ID for the task (id from the tasksActions table)
 * @param {Object} params - objects with an action parameters {<name>: <value>, ....}
 * @param {function(Error)|function()} callback - callback(err)
 */
tasksDB.addParameters = function(taskActionID, params, callback) {
    var stmt = db.prepare('INSERT INTO tasksParameters (id, taskActionID, name, value) VALUES (?, ?, ?, ?)',
        function(err) {
        if(err) {
            return callback(new Error('Can\'t prepare to insert new task parameters for taskActionID "' + taskActionID +
                + '": ' + err.message + '; params: ' + JSON.stringify(params) + ' into the tasksParameters table: '));
        }

        async.eachSeries(Object.keys(params), function(name, callback) {
            if(['actionName', 'actionID', 'username', 'sessionID', 'actionCfg'].indexOf(name) !== -1) return callback();
            const value = typeof params[name] === 'object' ? JSON.stringify(params[name]) : params[name];
            const id = unique.createHash(taskActionID.toString(36) + name + value);

            stmt.run([id, taskActionID, name, value], callback);
        }, function(err) {
            stmt.finalize();
            if(err) {
                return callback(new Error('Error while add task parameters for action "' + taskActionID  +
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

/**
 * Add a new tasks group
 * @param {string} groupName - task group name
 * @param {function(Error)|function(null, Number)} callback - callback(err, groupID), where groupID is a new group ID
 */
tasksDB.addTasksGroup = function(groupName, callback) {
    const id = unique.createHash(groupName);

    db.run('INSERT INTO tasksGroups (id, name) VALUES (?, ?)', [id, groupName], function (err, info) {
        if(err) return callback(new Error('Can\'t add new tasks groups "' + groupName + '": '+err.message));
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

/**
 * Add roles to task group
 * @param {Number} taskGroupID - task group ID
 * @param {Array} rolesIDs - array of the task role IDs
 * @param {function(Error|undefined)} callback - callback(err)
 */
tasksDB.addRolesForGroup = function(taskGroupID, rolesIDs, callback) {
    log.debug('Add roles IDs ', rolesIDs, ' to task group ID ', taskGroupID);

    var stmt = db.prepare('INSERT INTO tasksGroupsRoles (id, taskGroupID, roleID) VALUES ($id, $taskGroupID, $roleID)',
        function(err) {
        if(err) return callback(err);

        async.eachSeries(rolesIDs, function(roleID, callback) {
            const id = unique.createHash(taskGroupID.toString(36) + roleID.toString());
            stmt.run({
                $id: id,
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

    // NOT UNIQUE INDEX is set to TaskID and OCID. Table has not id filed
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