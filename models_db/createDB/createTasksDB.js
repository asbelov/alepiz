/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../db');

module.exports = function(callback){

    createTaskGroupsTable(function (err) {
        if(err) return callback(err);

        log.debug('Creating tasksGroupsRoles table in database');
        db.run(
            'CREATE TABLE IF NOT EXISTS tasksGroupsRoles (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'taskGroupID INTEGER NOT NULL REFERENCES tasksGroups(id) ON DELETE CASCADE ON UPDATE CASCADE, ' +
            'roleID INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE)', function(err) {

            if (err) {
                return callback(new Error('Can\'t create tasksGroupsRoles table in database: ' + err.message));
            }

            createTasksTable(function(err) {
                if(err) return callback(err);

                createTasksActionsTable(function (err) {
                    if(err) return callback(err);

                    createTasksParametersTable(function (err) {
                        if(err) return callback(err);

                        createTaskConditionsTable(function (err) {
                            if (err) return callback(err);

                            tasksRunConditionsOCIDs(function (err) {
                                if (err) return callback(err);

                                db.get('SELECT COUNT(*) as count FROM tasksGroupsRoles', [],
                                    function (err, row) {

                                    if (err || row.count) return callback();

                                    log.debug('Table tasksGroupsRoles is empty, inserting initial values into this table');
                                    db.run(
                                    'INSERT OR IGNORE INTO tasksGroupsRoles (id, taskGroupID, roleID) VALUES ' +
                                        '(0, 0, 1), ' +
                                        '(1, 0, 2), ' +
                                        '(2, 1, 1), ' +
                                        '(3, 2, 1), ' +
                                        '(4, 3, 1), ' +
                                        '(5, 4, 1), ' +
                                        '(6, 5, 1), ' +
                                        '(7, 6, 1), ' +
                                        '(8, 6, 2), ' +
                                        '(9, 7, 1)', function (err) {
                                            if (err) {
                                                return callback(new Error('Can\'t insert initial roles into ' +
                                                    'tasksGroupsRoles table in database: ' + err.message));
                                            }
                                            callback();
                                        });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};

function createTaskGroupsTable(callback) {
    log.debug('Creating tasksGroups table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasksGroups (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT)', function(err) {
        if (err) return callback(new Error('Can\'t create tasksGroups table in database: ' + err.message));
        /*
                var stmt = db.prepare('INSERT OR IGNORE INTO tasksGroups (id, name) VALUES (?, ?)', function (err) {
                    if (err) {
                        return callback(new Error('Can\'t prepare to insert initial tasks groups into tasksGroups table in ' +
                            'database: ' + err.message));
                    }
                    var initialTaskGroups = [
                        [0, "Default group"],
                        [1, "Templates"],
                        [2, "Monitoring tasks"],
                        [3, "System tasks"],
                        [4, "Scheduled tasks"],
                        [5, "Administration tasks"],
                        [6, "Business tasks"],
                        [7, "Discovery tasks"]];
                    async.eachSeries(initialTaskGroups, stmt.run, function (err) {
                        if (err) {
                            return callback(new Error('Can\'t insert initial tasks groups into tasksGroups table in database: ' +
                                err.message));
                        }
         */
        db.run(
            'INSERT OR IGNORE INTO tasksGroups (id, name) VALUES ' +
            '(0, \'Default group\'),' +
            '(1, \'Templates\'),' +
            '(2, \'Monitoring tasks\'),' +
            '(3, \'System tasks\'),' +
            '(4, \'Scheduled tasks\'),' +
            '(5, \'Administration tasks\'),' +
            '(6, \'Business tasks\'),' +
            '(7, \'Discovery tasks\')', function (err) {
            if (err) {
                return callback(new Error('Can\'t insert initial tasks groups into tasksGroups ' +
                    'table in database: ' + err.message));
            }

            callback();
        });
    });
}

function createTasksTable (callback) {
    log.debug('Creating tasks table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasks (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'groupID INTEGER REFERENCES tasksGroups(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'userID INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'name TEXT,' +
        'timestamp INTEGER NOT NULL)', function (err) {
        if (err) return callback(new Error('Can\'t create tasks table in database: ' + err.message));

        db.run('CREATE INDEX IF NOT EXISTS timestamp_tasks_index on tasks(timestamp)', function (err) {
            if (err) return callback(new Error('Can\'t create tasks timestamp index in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS userID_tasks_index on tasks(userID)', function (err) {
                if (err) return callback(new Error('Can\'t create tasks usersID index in database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS name_tasks_index on tasks(name)', function (err) {
                    if (err) return callback(new Error('Can\'t create tasks name index in database: ' + err.message));

                    callback();
                });
            });
        });
    });
}

function createTasksActionsTable (callback) {
    log.debug('Creating tasksActions table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasksActions (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'taskID INTEGER REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'actionID TEXT NOT NULL,' +
        'actionsOrder INTEGER,' +
        'startupOptions INTEGER)', function (err) {
        if (err) {
            return callback(new Error('Can\'t create tasksActions table in database: ' + err.message));
        }

        db.run('CREATE INDEX IF NOT EXISTS taskID_tasksActions_index on tasksActions(taskID)', function (err) {
            if (err) {
                return callback(new Error('Can\'t create tasksActions taskID index in database: ' + err.message));
            }

            db.run('CREATE INDEX IF NOT EXISTS actionsOrder_tasksActions_index on tasksActions(actionsOrder)',
                function (err) {
                if (err) {
                    return callback(new Error('Can\'t create tasksActions actionsOrder index in database: ' +
                        err.message));
                }

                /*
                db.run('CREATE INDEX IF NOT EXISTS actionID_tasksActions_index on tasksActions(actionID)', function (err) {
                    if (err) {
                        return callback(new Error('Can\'t create tasksActions actionID index in database: ' + err.message));
                    }

                 */

                callback();
                //});
            });
        });
    });
}

function createTasksParametersTable(callback) {
    log.debug('Creating tasksParameters table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasksParameters (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'taskActionID INTEGER REFERENCES tasksActions(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'name TEXT NOT NULL,' +
        'value TEXT)', function (err) {

        if (err) {
            return callback(new Error('Can\'t create tasksParameters table in database: ' +
                err.message));
        }

        db.run('CREATE INDEX IF NOT EXISTS taskActionID_tasksParameters_index on ' +
            'tasksParameters(taskActionID)', function (err) {
            if (err) {
                return callback(new Error('Can\'t create tasksParameters taskActionID ' +
                    'index in database: ' + err.message));
            }

            db.run('CREATE INDEX IF NOT EXISTS name_tasksParameters_index on ' +
                'tasksParameters(name)', function (err) {
                if (err) {
                    return callback(new Error('Can\'t create tasksParameters name ' +
                        'index in database: ' + err.message));
                }

                db.run('CREATE INDEX IF NOT EXISTS value_tasksParameters_index on ' +
                    'tasksParameters(value)', function (err) {
                    if (err) {
                        return callback(new Error('Can\'t create tasksParameters value ' +
                            'index in database: ' + err.message));
                    }

                    callback();
                });
            });
        });
    });
}

function createTaskConditionsTable (callback) {
    log.debug('Creating tasksRunConditions table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasksRunConditions (' +
        'taskID INTEGER REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'timestamp INTEGER NOT NULL,' + // record change timestamp
        'runType INTEGER NOT NULL,' +
        'userApproved INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'userCanceled INTEGER REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE)', function (err) {
        if (err) {
            return callback(new Error('Can\'t create tasksRunConditions table in database: ' + err.message));
        }

        // UNIQUE INDEX used for 'INSERT OR REPLACE'
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS taskID_tasksRunConditions_index on tasksRunConditions(taskID)',
            function (err) {
            if (err) {
                return callback(new Error('Can\'t create tasksRunConditions taskID index in database: ' + err.message));
            }

            db.run('CREATE INDEX IF NOT EXISTS runType_tasksRunConditions_index on tasksRunConditions(runType)',
                function (err) {
                if (err) {
                    return callback(new Error('Can\'t create tasksRunConditions runType index in database: ' +
                        err.message));
                }

                db.run('CREATE INDEX IF NOT EXISTS userApproved_tasksRunConditions_index on ' +
                    'tasksRunConditions(userApproved)',function (err) {
                    if (err) {
                        return callback(new Error('Can\'t create tasksRunConditions userApproved index in database: ' +
                            err.message));
                    }

                    db.run('CREATE INDEX IF NOT EXISTS userCanceled_tasksRunConditions_index on ' +
                        'tasksRunConditions(userCanceled)',function (err) {
                        if (err) {
                            return callback(new Error('Can\'t create tasksRunConditions userCanceled index in database: ' +
                                err.message));
                        }

                        callback();
                    });
                });
            });
        });
    });
}

function tasksRunConditionsOCIDs (callback) {
    log.debug('Creating tasksRunConditionsOCIDs table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS tasksRunConditionsOCIDs (' +
        'taskID INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'OCID INTEGER REFERENCES objectsCounters(id) ON DELETE CASCADE ON UPDATE CASCADE)', function (err) {
        if (err) {
            return callback(new Error('Can\'t create tasksRunConditionsOCIDs table in database: ' + err.message));
        }

        db.run('CREATE INDEX IF NOT EXISTS taskID_tasksRunConditionsOCIDs_index on tasksRunConditionsOCIDs(taskID)',
            function (err) {
            if (err) {
                return callback(new Error('Can\'t create tasksRunConditionsOCIDs taskID index in database: ' +
                    err.message));
            }

            db.run('CREATE INDEX IF NOT EXISTS OCID_tasksRunConditionsOCIDs_index on tasksRunConditionsOCIDs(OCID)',
                function (err) {
                if (err) {
                    return callback(new Error('Can\'t create tasksRunConditionsOCIDs OCID index in database: ' +
                        err.message));
                }

                callback();
            });
        });
    });
}