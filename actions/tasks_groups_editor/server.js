/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 20.06.2017.
 */
var log = require('../../lib/log')(module);
var tasksDB = require('../../models_db/tasksDB');
var checkIDs = require('../../lib/utils/checkIDs');
var transactionDB = require('../../models_db/transaction');

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);
    transactionDB.begin(function(err) {
        if (err) return callback('Can\'t make changes with task groups: ' + err.message);

        if (args.removingGroupsNames && args !== 'Default group') {
            var groupNames = args.removingGroupsNames.split(',');
            log.debug('Remove groups: ', groupNames);
            tasksDB.getTasksGroupsList(function (err, rows) {
                if(err) return callback(new Error('Can\'t get task groups list: ' + err.message));

                for(var defaultTaskGroupName = '', i = 0; i < rows.length; i++) {
                    if(rows[i].id === 0) {
                        defaultTaskGroupName = rows[i].name.toLowerCase();
                        break;
                    }
                }

                for(i = 0; i < groupNames; i++) {
                    if(groupNames[i].toLowerCase() === defaultTaskGroupName) {
                        return callback(new Error('Trying to delete default task group: ' + JSON.stringify(args)));
                    }
                }

                tasksDB.removeTasksGroups(groupNames, function (err) {
                    if (err) return callback(err);

                    updateGroup(args.groupID, args.groupName, args.userRoles, function(err) {
                        if(err) return transactionDB.rollback(err, callback);
                        transactionDB.end(callback);
                    });
                });
            })
        } else updateGroup(args.groupID, args.groupName,  args.userRoles, function(err) {
            if(err) return transactionDB.rollback(err, callback);
            transactionDB.end(callback);
        });
    });
};
/*
Add new or rename existing group

id: id of existing group or 0 for a create a new group
name: new group name
callback(err)
 */
function updateGroup(id, name, roles, callback) {
    if(name && id && roles) {
        checkIDs(roles, function(err, checkedRoles) {
            if (err) callback(new Error('Error in user roles: ' + err.message));

            if (id === "00") {
                log.debug('Add new group ', name);
                tasksDB.addTasksGroup(name, function (err, taskGroupID) {
                    if (err) return callback(new Error('Can\'t add new task group ' + name + ': ' + err.message));

                    tasksDB.addRolesForGroup(taskGroupID, checkedRoles, function (err) {
                        if (err) return callback(new Error('Can\'t add roles "' + checkedRoles.join(',') +
                            '" for a new task group ' + taskGroupID + ', task group ID: ' + taskGroupID + ' : ' + err.message));

                        log.info('Added task group ', name, '; task group ID: ', taskGroupID, ', roles: ', checkedRoles);
                        callback();
                    });
                });
                return;
            }

            id = Number(id);
            if (id === parseInt(String(id), 10)) {
                log.debug('Rename group ID ', id, ' to ', name);
                tasksDB.renameTasksGroup(id, name, function(err) {
                    if(err) {
                        return callback(new Error('Can\'t rename task group ID ' + id + ', new name: ' + name +
                            ': ' + err.message));
                    }

                    tasksDB.deleteAllRolesForGroup(id, function(err) {
                        if(err) return callback(new Error('Can\'t delete roles for task group ' + name +
                            ', task group ID: ' + id +' when updating: ' + err.message));

                        tasksDB.addRolesForGroup(id, checkedRoles, function (err) {
                            if (err) return callback(new Error('Can\'t add roles "' + checkedRoles.join(',') +
                                '" for a task group ' + name + ', task group ID: ' + id + ' when updating: ' + err.message));

                            log.info('Updated task group ', name, ', task group ID: ', id, ', roles: ', checkedRoles);
                            callback();
                        });
                    });
                });
            } else callback(new Error('Invalid tasks group ID "' + id + '" for renaming group to "' + name + '": '));
        });
    } else callback();
}
