/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../db');
var async = require('async');
var encrypt = require('../../lib/encrypt');

module.exports = function(callback) {
    log.debug('Creating users and roles tables in database');

    async.series({
        users: createUsersTable,
        roles: createRolesTable
    }, function(err, fillTables) {
        if(err) return callback(err);

        async.series([
            function(callback) {
                createUsersRolesTable((fillTables.users && fillTables.roles), callback);
            },
            function(callback) {
                createRightsForObjectsTable(fillTables.roles, callback);
            },
            function(callback) {
                createRightsForActionsTable(fillTables.roles, callback);
            },
            function(callback) {
                createCommunicationTable(fillTables.users, callback)
            }
        ], callback)
    });
};

function createUsersTable(callback) {
    db.run('CREATE TABLE IF NOT EXISTS users (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT NOT NULL,' +
        'fullName TEXT,' +
        'password TEXT,' +
        'isDeleted BOOLEAN DEFAULT 0)',
        function(err) {
            if (err) return callback(new Error('Can\'t create users table in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS name_users_index on users(name)',function (err) {
                if (err) {
                    return callback(new Error('Can\'t create users name index in database: ' + err.message));
                }

                db.get('SELECT COUNT(*) as count FROM users', [], function (err, row) {
                    if (err || row.count) return callback();

                    log.debug('Table users is empty, inserting initial values into this table');

                    var adminPassHash = encrypt('admin');
                    var businessPassHash = encrypt('business');
                    var watcherPassHash = encrypt('watcher');

                    db.run('INSERT OR IGNORE INTO users (id, name, fullName, password, isDeleted) VALUES ' +
                        '(0, "system", "System user", "", 0),' +
                        '(1, "admin", "System administrator", "' + adminPassHash + '", 0),' +
                        '(2, "business", "Business viewer and task creator", "' + businessPassHash + '", 0),' +
                        '(3, "watcher", "Watcher with a view only rights", "' + watcherPassHash + '", 0),' +
                        '(4, "guest", "User with minimal rights", "", 0)',
                        function (err) {
                            if (err) return callback(new Error('Can\'t insert initial users into users table in database: ' + err.message));
                            callback(null, true);
                        }
                    );
                });
            });
        }
    );
}

function createCommunicationTable(fillTable, callback) {
    db.run('CREATE TABLE IF NOT EXISTS userCommunication (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'userID INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'mediaID TEXT NOT NULL,' +
        'address TEXT)', function(err) {
        if (err) return callback(new Error('Can\'t create userCommunication table in database: ' + err.message));

        db.run('CREATE TABLE IF NOT EXISTS userCommunicationPriorityDescription (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'description TEXT NOT NULL)', function(err) {
            if (err) return callback(new Error('Can\'t create userCommunicationPriorityDescription table in database: ' + err.message));

            db.run('CREATE TABLE IF NOT EXISTS userCommunicationPriorities (' +
                'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                'userCommunicationID INTEGER NOT NULL REFERENCES userCommunication(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                'priority INTEGER NOT NULL REFERENCES userCommunicationPriorityDescription(id) ON DELETE CASCADE ON UPDATE CASCADE)', function (err) {
                if (err) return callback(new Error('Can\'t create userCommunicationPriorities table in database: ' + err.message));

                //if(!fillTable) return callback();

                db.get('SELECT COUNT(*) as count FROM userCommunicationPriorityDescription', [], function (err, row) {
                    if (err || row.count) return callback();

                    log.info('Table userCommunicationPriorityDescription is empty, inserting initial values into this table');

                    db.run('INSERT OR IGNORE INTO userCommunicationPriorityDescription (id, description) VALUES ' +
                        '(10, "High"),' +
                        '(20, "Normal"),' +
                        '(30, "Low")', function (err) {
                        if (err) {
                            return callback(new Error('Can\'t insert initial priorities into ' +
                                'userCommunicationPriorityDescription table in database: ' + err.message));
                        }

                        callback();
                    });
                });
            });
        });
    });
}

function createRolesTable(callback) {
    db.run('CREATE TABLE IF NOT EXISTS roles (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT NOT NULL,' +
        'description TEXT)',
        function(err) {
            if (err) return callback(new Error('Can\'t create roles table in database: ' + err.message));

            db.get('SELECT COUNT(*) as count FROM roles', [], function(err, row) {
                if (err || row.count) return callback();

                log.debug('Table roles is empty, inserting initial values into this table');

                db.run('INSERT OR IGNORE INTO roles (id, name, description) VALUES ' +
                    '(1, "Administrators", "Administrators of the system"),' +
                    '(2, "Businesses", "Business viewers and task creators"),' +
                    '(3, "Watchers", "Watchers with a view only rights"),' +
                    '(4, "Guests", "Users with minimal rights")',
                    function(err) {
                        if (err) return callback(new Error('Can\'t insert initial roles into roles table in database: ' + err.message));
                        callback(null, true);
                    }
                );
            });
        }
    );
}

function createUsersRolesTable(fillTable, callback) {
    db.run('CREATE TABLE IF NOT EXISTS usersRoles (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'userID INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'roleID INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE)',
        function(err) {
            if (err) return callback(new Error('Can\'t create usersRoles table in database: ' + err.message));
            //if(!fillTable) return callback();

            db.get('SELECT COUNT(*) as count FROM usersRoles', [], function(err, row) {
                if (err || row.count) return callback();

                log.debug('Table usersRoles is empty, inserting initial values into this table');

                db.run('INSERT OR IGNORE INTO usersRoles (id, userID, roleID) VALUES ' +
                    '(0, 0, 1),' +
                    '(1, 1, 1),' +
                    '(2, 2, 2),' +
                    '(3, 3, 3),' +
                    '(4, 4, 4)',
                    function(err) {
                        if (err) return callback(new Error('Can\'t insert initial values into usersRoles table in database: ' + err.message));
                        callback();
                    }
                );
            });
        }
    );
}

function createRightsForObjectsTable(fillTable, callback) {
    db.run('CREATE TABLE IF NOT EXISTS rightsForObjects (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'objectID INTEGER REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'roleID INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'view BOOLEAN,' +
        'change BOOLEAN,' +
        'makeTask BOOLEAN,' +
        'changeInteractions BOOLEAN,' +
        'applyToIncludedObjects BOOLEAN)',
        function(err) {
            if (err) return callback(new Error('Can\'t create rightsForObjects table in database: ' + err.message));
            //if(!fillTable) return callback();

            db.get('SELECT COUNT(*) as count FROM rightsForObjects', [], function(err, row) {
                if (err || row.count) return callback();

                log.debug('Table rightsForObjects is empty, inserting initial values into this table');

                db.run('INSERT OR IGNORE INTO rightsForObjects (id, objectID, roleID, view, change, makeTask, changeInteractions, applyToIncludedObjects) VALUES ' +
                    '(1, null, 1, 1, 1, 1, 1, 0),' +
                    '(2, null, 2, 1, 0, 1, 0, 0),' +
                    '(3, null, 3, 1, 0, 0, 0, 0),' +
                    '(4, null, 4, 0, 0, 0, 0, 0)',
                    function(err) {
                        if (err) return callback(new Error('Can\'t insert initial values into rightsForObjects table in database: ' + err.message));
                        callback();
                    }
                );
            });
        }
    );
}

function createRightsForActionsTable(fillTable, callback) {
    db.run('CREATE TABLE IF NOT EXISTS rightsForActions (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'actionName TEXT,' +
        'roleID INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'view BOOLEAN,' +
        'run BOOLEAN,' +
        'makeTask BOOLEAN,' +
        'audit BOOLEAN)',
        function(err) {
            if (err) return callback(new Error('Can\'t create rightsForActions table in database: ' + err.message));
            //if(!fillTable) return callback();

            db.get('SELECT COUNT(*) as count FROM rightsForActions', [], function(err, row) {
                if (err || row.count) return callback();

                log.debug('Table rightsForObjects is empty, inserting initial values into this table');

                db.run('INSERT OR IGNORE INTO rightsForActions (id, actionName, roleID, view, run, makeTask, audit) VALUES ' +
                    '(1, null, 1, 1, 1, 1, 1),' + // Administrators - full
                    '(2, null, 2, 1, 0, 1, 1),' + // Businesses - view, make task and audit
                    '(3, null, 3, 1, 0, 0, 0),' + // Watchers - view
                    '(4, null, 4, 0, 0, 0, 0), ' + // Guests - no rights
                    '(5, "task_maker", 2, 1, 1, 0, 0), ' +  // add execute rights for task_maker action for the Businesses role
                    '(7, "Configurations", 3, 0, 0, 0, 0), ' +  // Watchers - no rights to Configurations
                    denyActionsRights([2,3,4], ['Administration', 'Development', 'counter_settings'], 7),
                    function(err) {
                        if (err) return callback(new Error('Can\'t insert initial values into rightsForActions table in database: ' + err.message));
                        callback();
                    }
                );
            });
        }
    );
}

/**
 * Return part of the SQL query for deny rights for specific roles for action in specific folders or actions ID
 * f.e. denyActionsRights([2,3,4], ['Administration', 'Development', 'counter_settings'], 7):
 *     will removed rights for the actions and folders 'Administration', 'Development' and action 'counter_settings'
 *     for roles 2, 3, 4 (Businesses, Watchers, Guests) and start rightsForActions.id from 7
 * @param {Array<number>} roles array jf the user roles
 * @param {Array<string>} actionIDs array of the action IDs or action groups
 * @param {number} startID the initial value of the ID in the rightsForObjects table
 * @return {string} part of the SQL query
 */
function denyActionsRights(roles, actionIDs, startID) {
    var rights = [];
    roles.forEach(function (role) {
        actionIDs.forEach(function (actionID) {
            rights.push('(' + (startID++) + ', "' + actionID + '", ' + role + ', 0, 0, 0, 0)');
        });
    });

    return rights.join(',\n');
}
