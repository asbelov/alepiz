/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const db = require('../db');
const transactions = require('../modifiers/transaction');
const auditDB = require('../../serverAudit/auditDB');
const async = require('async');

/*
Used for modifying the DB when changing the DB structure when updating the Alepiz version
 */

// Add a new DB modifier function to this array
var modifiersFunctions = [
    addAuditColumnToRightsForActions,
    moveAuditUsersDataToTasksActions,
    remove_name_timestamp_index_onTasks,
    addTaskNamesInAuditDB,
];

module.exports = function (callback) {
    async.waterfall(modifiersFunctions, callback);
};

/**
 * added 27.02.2023
 * Add audit column to the rightsForActions table and set the rights to prohibit viewing logs in the audit action for
 * all user roles except Administrators and Businesses.
 * @param {function()} callback callback();
 */
function addAuditColumnToRightsForActions(callback) {
    db.run('ALTER TABLE rightsForActions ADD COLUMN audit BOOLEAN', function(err) {
        if(err) {
            // column already exist
            log.debug('Can\'t add column "audit" to the rightsForActions table: ', err.message);
            return callback();
        }
        log.warn('Start to add column "audit" to the rightsForActions table and insert default right values to audit');
        log.info('Successfully added a new column "audit" to the rightsForActions table');

        db.run('UPDATE rightsForActions SET audit=0', function(err) {
            if(err) {
                log.warn('Can\'t set rights to prohibit viewing logs in the audit action for all user roles: ',
                    err.message);
            } else {
                log.info('The rights have been configured to prohibit viewing logs in the audit action for ' +
                    'all user roles.');
            }
            db.run('UPDATE rightsForActions SET audit=1 WHERE roleID=1 OR roleID=2', function (err) {
                if(err) {
                    log.warn('Can\'t set rights to allow viewing logs in the audit action for ' +
                        'Administrators and Businesses user roles: ', err.message);
                } else {
                    log.info('The rights have been configured to allow viewing logs in the audit action for ' +
                        'Administrators and Businesses user roles.');
                }

                callback();
            });
        });
    });
}

/**
 * added 02.03.2023
 * Add taskAction.actionID and move data from the auditUsers.actionID to the taskAction.actionID table.
 * Then remove taskAction..sessionID column and auditUsers table.
 * @param {function()|function(Error)} callback callback(err);
 */
function moveAuditUsersDataToTasksActions(callback) {
    db.all('SELECT tasksActions.id AS id, tasksActions.taskID AS taskID, auditUsers.actionID AS actionID, \
tasksActions.actionsOrder AS actionsOrder, tasksActions.startupOptions AS startupOptions \
FROM tasksActions \
JOIN auditUsers ON auditUsers.sessionID = tasksActions.sessionID', function (err, tasksActionsRows) {
        if (err) {
            // table was deleted before
            log.debug('Can\'t get data from the tasksActions and auditUsers table: ', err.message)
            return callback();
        }

        log.warn('Start to add tasksActions.actionID and move data from the auditUsers.actionID to the ' +
            'tasksActions.actionID table. Then remove tasksActions..sessionID column and auditUsers table.');

        log.info('Switch off foreign_keys and start transaction');
        db.exec('PRAGMA foreign_keys=off', function(err) {
            if (err) {
                return callback(new Error('Can\'t switch foreign_keys to off for modify tasksActions table: ' +
                    err.message));
            }

            transactions.begin(function (err) {
                if (err) {
                    return callback(new Error('Can\'t begin transaction for modify tasksActions table: ' + err.message));
                }

                db.run('DROP TABLE tasksActions', function (err) {
                    if (err) {
                        return transactions.rollback(new Error('Can\'t delete old tasksActions table: ' +
                            err.message), callback);
                    }

                    log.info('Deleted old tasksActions table');

                    db.run('DROP TABLE auditUsers', function (err) {
                        if (err) {
                            return transactions.rollback(new Error('Can\'t delete auditUsers table: ' + err.message),
                                callback);
                        }

                        log.info('Deleted auditUsers table');

                        const createTasksDB = require('./createTasksDB');

                        createTasksDB(function (err) {
                            if (err) {
                                return transactions.rollback(new Error('Can\'t create tasksActions table: ' +
                                    err.message), callback);
                            }

                            var stmt = db.prepare('INSERT INTO tasksActions (id, taskID, actionID, actionsOrder, \
 startupOptions) VALUES ($id, $taskID, $actionID, $actionsOrder, $startupOptions)',
                                function (err) {
                                if(err) {
                                    return transactions.rollback(new Error('Can\'t prepare statement for insert data ' +
                                        'to the tasksActions table: ' + err.message), callback);
                                }

                                log.info('Prepared statement and starting to inserted data to the tasksActions table');
                                async.eachSeries(tasksActionsRows, function (row, callback) {
                                    if(!row.actionID) {
                                        return callback(new Error('Error when inserting empty actionID ' +
                                            ' for row ' + JSON.stringify(row, null, 4)));
                                    }

                                    stmt.run({
                                        $id: row.id,
                                        $taskID: row.taskID,
                                        $actionID: row.actionID,
                                        $actionsOrder: row.actionsOrder,
                                        $startupOptions: row.startupOptions,
                                    }, function(err) {
                                        if(err) {
                                            return callback(new Error('Error when inserting row: ' + err.message + ': ' +
                                                JSON.stringify(row, null, 4)));
                                        }
                                        callback();
                                    });
                                }, function (err) {
                                    stmt.finalize();
                                    if(err) return transactions.rollback(err, callback);

                                    log.info('Inserting data to the tasksActions table, finish transaction');
                                    transactions.end(function (err) {
                                        if(err) log.error('Can\'t finish transaction: ', err.message);

                                        db.exec('PRAGMA foreign_keys=oon', function(err) {
                                            if (err) {
                                                return callback(new Error('Can\'t switch foreign_keys to oon after ' +
                                                    'modify tasksActions table: ' + err.message));
                                            }

                                            log.info('Switch on foreign_keys and finish tasksActions modification');
                                            callback();
                                        });
                                    });
                                });
                            });
                        })
                    });
                });
            });
        });
    });
}

/**
 * Index name_timestamp_index renamed to timestamp_tasks_index
 * @param {function(Error)} callback callback(err)
 */
function remove_name_timestamp_index_onTasks(callback) {
    db.run('DROP INDEX IF EXISTS name_timestamp_index', callback);
}

/**
 * Add task names into the taskNames and taskReferences tables in the auditDB
 * @param {function(Error)|function()} callback callback(err)
 */
function addTaskNamesInAuditDB(callback) {
    auditDB.getAuditDbPaths(function (err, dbPaths) {
        if(err) return callback(err);

        auditDB.dbOpen(dbPaths[0], false, function (err, auditDB) {
            try {
                var taskNamesNum = auditDB.prepare('SELECT COUNT(*) AS cnt FROM taskNames').get();
            } catch (err) {
                callback(new Error('Can\'t get number of rows in the taskNames: ' + err.message));
            }
            if(!taskNamesNum || taskNamesNum.cnt) {
                log.debug('Task names copy not required. Task names in auditDB: ', taskNamesNum);
                return callback();
            }

            try {
                var auditTaskDataRows =
                    auditDB.prepare('SELECT taskID, taskSession FROM sessions WHERE taskID NOTNULL').all();
            } catch (err) {
                callback(new Error('Can\'t get task data in the sessions: ' + err.message));
            }

            log.info('Starting copy task names to the auditDB. Tasks number: ', auditTaskDataRows.length);
            db.all('SELECT id, name FROM tasks', function (err, taskDataRows) {
                if(err) return callback(new Error('Can\'t get task data in the tasks: ' + err.message));

                var taskData = new Map();
                taskDataRows.forEach(taskDataRow => taskData.set(taskDataRow.id, taskDataRow.name));

                var insertedRows = 0, taskSessions = new Set();
                auditTaskDataRows.forEach(auditTaskDataRow => {
                    if(!auditTaskDataRow.taskID || !auditTaskDataRow.taskSession) {
                        log.info('Unexpected task data in auditDB for ', auditTaskDataRow);
                        return;
                    }

                    if(taskSessions.has(auditTaskDataRow.taskSession)) return;

                    var taskName = taskData.get(auditTaskDataRow.taskID);
                    if(!taskName) {
                        log.info('No task name for taskID: ', auditTaskDataRow.taskID);
                        return;
                    }

                    var insertTaskName = auditDB.transaction(auditTaskDataRow => {
                        let taskNamesTable =
                            auditDB.prepare('INSERT INTO taskNames (name) VALUES (?)').run(taskName);
                        let taskNameRowID = taskNamesTable.lastInsertRowid;

                        /*
                        log.info('Inserting taskName ', taskName, ', taskID: ', auditTaskDataRow.taskID,
                            ', taskSession: ', auditTaskDataRow.taskSession, ', taskNameRowID: ', taskNameRowID);
                         */

                        auditDB.prepare('INSERT INTO taskReferences (taskSession, taskNameRowID) ' +
                            'VALUES ($taskSession, $taskNameRowID)').run({
                            taskSession: auditTaskDataRow.taskSession,
                            taskNameRowID: taskNameRowID,
                        });
                        ++insertedRows;
                        taskSessions.add(auditTaskDataRow.taskSession);
                    });

                    try {
                        insertTaskName(auditTaskDataRow);
                    } catch (err) {
                        callback(new Error('Can\'t insert task names into the taskNames table: ' + err.message));
                    }
                });

                if(insertedRows) {
                    log.info('Inserted ', insertedRows, ' rows into the taskNames table');
                }

                callback();
            })

        });
    });
}