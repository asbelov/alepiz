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
 * @param {number} taskID new task ID
 * @param {number} userID user ID
 * @param {number} timestamp create task timestamp (Date.now())
 * @param {string|null} name task name
 * @param {number} groupID task group ID
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.addTask = function(taskID, userID, timestamp, name, groupID, callback) {
    if(!name) name = null;

    db.run('INSERT INTO tasks (id, userID, timestamp, name, groupID) ' +
        'VALUES ($id, $userID, $timestamp, $name, $groupID)', {
        $id: taskID,
        $userID: userID,
        $timestamp: timestamp,
        $name: name,
        $groupID: groupID,
    }, callback);
};

/**
 * Update existing task
 * @param {number} userID user ID
 * @param {number} taskID taskID for update
 * @param {string|null} name task name
 * @param {number} groupID task group ID
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.updateTask = function(userID, taskID, name, groupID, callback) {
    if(!name) name = null;

    db.run('UPDATE tasks SET name=$name, groupID=$groupID WHERE id=$taskID', {
        $taskID: taskID,
        $name: name,
        $groupID: groupID,
    }, function(err) {
        {
            if(err) {
                return callback(new Error('User ' + userID + ' can\'t  update taskID ' + taskID + '; name ' + name +
                    '; groupID: ' + groupID + ': ' + err.message));
            }
            callback();
        }
    });
};

/**
 * Insert an action for the task
 * @param {number} taskID task ID
 * @param {string} actionID action ID (action dir)
 * @param {0|1|2|3|null} startupOptions startupOptions
 * @param {number|null} actionsOrder order of action in the task
 * @param {function(Error) | function(null, number)} callback callback(err, taskActionID), where taskActionID
 *  is a new id of inserted action for the task
 */
tasksDB.addAction = function(taskID, actionID, startupOptions, actionsOrder, callback) {
    const taskActionID =
        unique.createHash(taskID.toString(36) + actionID + startupOptions + actionsOrder);

    db.run('INSERT INTO tasksActions (id, taskID, actionID, startupOptions, actionsOrder) VALUES (?, ?, ?, ?, ?)',
        [taskActionID, taskID, actionID, startupOptions, actionsOrder], function (err) {
        if(err) {
            return callback(new Error('Can\'t insert new actions with taskActionID: ' + taskActionID +
                ' for task with taskID "' + taskID +
                '", actionID "' + actionID + '", startupOptions: ' + startupOptions +
                ', actionsOrder: ' + actionsOrder + ' into the tasksActions database: ' + err.message));
        }
        callback(null, taskActionID);
    })
};

/**
 * Insert action parameters for specific action for the task
 * @param {number} taskActionID action ID for the task (id from the tasksActions table)
 * @param {Object} actionParams objects with an action parameters {<name>: <value>, ....}
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.addParameters = function(taskActionID, actionParams, callback) {
    var stmt = db.prepare('INSERT INTO tasksParameters (id, taskActionID, name, value) VALUES (?, ?, ?, ?)',
        function(err) {
        if(err) {
            return callback(new Error('Can\'t prepare to insert new task parameters for taskActionID "' + taskActionID +
                + '": ' + err.message + '; actionParams: ' + JSON.stringify(actionParams, null, 4) +
                ' into the tasksParameters table: '));
        }

        async.eachSeries(Object.keys(actionParams), function(name, callback) {
            if([
                'actionName',
                'actionID',
                'username',
                'taskActionID',
                'actionCfg'
            ].indexOf(name) !== -1) {
                return callback();
            }

            const value = typeof actionParams[name] === 'object' ?
                JSON.stringify(actionParams[name]) : actionParams[name];

            const id = unique.createHash(taskActionID.toString(36) + name + value);

            stmt.run([id, taskActionID, name, value], callback);
        }, function(err) {
            stmt.finalize();
            if(err) {
                return callback(new Error('Error while add task parameters for action "' + taskActionID  +
                    '": ' + err.message + '; actionParams: ' + JSON.stringify(actionParams, null, 4)));
            }
            callback();
        });
    });
};

/**
 * Remove task groups by group names
 * @param {Array<string>} groupsNames array of the group names
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.removeTasksGroups = function(groupsNames, callback) {
    var questionsString = groupsNames.map(function () {
        return '?'
    }).join(',');

    db.run('DELETE FROM tasksGroups WHERE name IN ('+questionsString+')', groupsNames, function(err) {
        if(err) {
            return callback(new Error('Can\'t remove tasks groups "' + groupsNames.join(', ') + '": ' + err.message));
        }
        callback();
    });
};


/**
 * Rename task group
 * @param {number} groupID group ID for rename
 * @param {string} newGroupName new group name
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.renameTasksGroup = function(groupID, newGroupName, callback){

    db.run('UPDATE tasksGroups SET name=? WHERE id=?', [newGroupName, groupID], function(err) {
        if(err) {
            return callback(new Error('Can\'t rename tasks groups ID "' + groupID + '" to the "' + newGroupName +
                '": ' + err.message));
        }
        callback();
    })
};

/**
 * Add a new tasks group
 * @param {string} groupName task group name
 * @param {function(Error)|function(null, number)} callback callback(err, groupID), where groupID is a new group ID
 */
tasksDB.addTasksGroup = function(groupName, callback) {
    const id = unique.createHash(groupName);

    db.run('INSERT INTO tasksGroups (id, name) VALUES (?, ?)', [id, groupName], function (err) {
        if(err) return callback(new Error('Can\'t add new tasks groups "' + groupName + '": ' + err.message));
        callback(null, id);
    })
};

/**
 * Remove the task
 * @param {number} taskID task ID for remove
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.removeTask = function(taskID, callback) {
    db.run('DELETE FROM tasks WHERE id = ?', taskID, function(err) {
        if(err) return callback(new Error('Can\'t remove task with ID  "' + taskID + '": ' + err.message));
        callback();
    });
};

/**
 * Remove all action parameters for the task
 * @param {number} taskID task ID for remove action parameters
 * @param {function(Error)|function()} callback callback(err)
 */
tasksDB.removeTaskActionsAndParameters = function(taskID, callback) {
    db.run('DELETE FROM tasksActions WHERE taskID = ?', taskID, function(err) {
        if(err) {
            return callback(new Error('Can\'t remove task actions with task ID  "' + taskID + '": ' + err.message));
        }
        callback();
    });
};

/**
 * Add roles to task group
 * @param {number} taskGroupID task group ID
 * @param {Array} rolesIDs array of the task role IDs
 * @param {function(Error|undefined)} callback callback(err)
 */
tasksDB.addRolesForGroup = function(taskGroupID, rolesIDs, callback) {
    log.debug('Add roles IDs ', rolesIDs, ' to task group ID ', taskGroupID);

    var stmt = db.prepare('INSERT INTO tasksGroupsRoles (id, taskGroupID, roleID) ' +
        'VALUES ($id, $taskGroupID, $roleID)',
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

/**
 * Delete all roles for the taskGroupID
 * @param {number} taskGroupID task group ID
 * @param {function(Error|undefined)} callback callback(err)
 */
tasksDB.deleteAllRolesForGroup = function(taskGroupID, callback) {
    log.debug('Deleting all tasksGroups roles for task group ID: ', taskGroupID);

    // error described in the calling function
    db.run('DELETE FROM tasksGroupsRoles WHERE taskGroupID=?', taskGroupID, callback);
};

/**
 * Add run condition for the task
 * @param {number} taskID task ID
 * @param {0|1|11|2|12} runType 0 - run permanently, 1 - run once, 2 - run now
 *     11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
 * @param {function(Error|undefined)} callback callback(err)
 */
tasksDB.addRunCondition = function (taskID, runType, callback) {
    log.debug('Add condition for taskID ', taskID, ', run type ', runType);

    // UNIQUE INDEX is set to TaskID, and if TaskID exists, other values will be replaced
    db.run('INSERT INTO tasksRunConditions (taskID, runType, timestamp) ' +
        'VALUES ($taskID, $runType, $timestamp)', {
        $taskID: taskID,
        $runType: runType,
        $timestamp: Date.now(),
    }, callback);
};

/**
 * Set specific runType for the task 
 * @param {number} taskID taskID
 * @param {0|1|11|2|12} runType 0 - run permanently, 1 - run once, 2 - run now
 *     11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
 * @param {function(Error)} callback callback(err)
 */
tasksDB.updateRunCondition = function (taskID, runType, callback) {
    log.debug('Update condition for taskID ', taskID, ', run type ', runType);

    db.run('UPDATE tasksRunConditions SET runType=$runType, timestamp=$timestamp WHERE taskID=$taskID', {
        $taskID: taskID,
        $runType: runType,
        $timestamp: Date.now(),
    }, callback);
};

/**
 * Add OCIDs to the run condition
 * @param {number} taskID task ID
 * @param {Array<number>} OCIDs array of the object counter IDs [OCID1, OCID2,....] 
 * @param {function(Error)} callback callback(err)
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

/**
 * Delete all run condition for the task
 * @param {number} taskID task ID
 * @param {function(Error)} callback callback(err)
 */
tasksDB.deleteRunCondition = function (taskID, callback) {
    db.run('DELETE FROM tasksRunConditions WHERE taskID=?', taskID, callback);
};

/**
 * Delete all run condition OCIDs for the task
 * @param {number} taskID task ID
 * @param {function(Error)} callback callback(err)
 */
tasksDB.deleteRunConditionOCIDs = function (taskID, callback) {
    db.run('DELETE FROM tasksRunConditionsOCIDs WHERE taskID=?', taskID, callback);
};

/**
 * Approve the task
 * @param {number} taskID task ID
 * @param {number} userID user ID
 * @param {function(Error)} callback callback(err)
 */
tasksDB.approveTask = function (taskID, userID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userApproved=$userID, userCanceled=NULL ' +
        'WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $userID: userID,
        $taskID: taskID,
    }, callback);
};

/**
 * Cancel the task approving
 * @param {number} taskID task ID
 * @param {number} userID user ID
 * @param {function(Error)} callback callback(err)
 */
tasksDB.cancelTask = function (taskID, userID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userCanceled=$userID WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $userID: userID,
        $taskID: taskID,
    }, callback);
};

/**
 * Remove all approval for the task f.e. when task changed
 * @param {number} taskID task ID
 * @param {function(Error)} callback callback(err)
 */
tasksDB.removeApproval = function (taskID, callback) {
    db.run('UPDATE tasksRunConditions SET timestamp=$timestamp, userApproved=Null, userCanceled=NULL ' +
        'WHERE taskID=$taskID', {
        $timestamp: Date.now(),
        $taskID: taskID,
    }, callback);
}