/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const db = require('./db');
const async = require('async');

var usersDB = {};
module.exports = usersDB;

var usersTable = new Map();

/**
 * Check user password and return fill user name on success
 * @param {string} username username
 * @param {string} hash password hash
 * @param {function()|function(Error, Object)} callback callback(err, userNameObj), where userNameObj is object like
 *    {fillName: <full user name>} or undefined if username not specified or user not found
 * @returns {*}
 */
usersDB.checkAndGetFullUserName = function(username, hash, callback) {
    if(!username) return callback();
    db.get('SELECT fullName FROM users WHERE isDeleted=0 AND name=? AND password=?', [username, hash], callback);
};

/**
 * Gey full user name by user name
 * @param {string} username username
 * @param {function()|function(Error, Object)} callback callback(err, userNameObj), where userNameObj is object like
 *    {fillName: <full user name>} or undefined if username not specified or user not found
 */
usersDB.getFullUserName = function(username, callback) {
    if(!username) return callback();
    db.get('SELECT fullName FROM users WHERE isDeleted=0 AND name=?', [username], callback);
};

/**
 * Return userID for specific username. Prepare username using lib/utils/preparedUser function
 * @param {string|number|undefined} user username or userID
 * @param {function()|function(Error)|function(null, number)} callback callback(err) or callback(null, userID)
 */
usersDB.getID = function(user, callback) {
    if(user === undefined) return callback();

    if(Number(user) === parseInt(String(user), 10)) {
        return callback(null, parseInt(String(user), 10))
    }

    if(!user) return callback(new Error('Undefined username: ' + user));

    // return userID from cache
    if(usersTable.has(user)) return callback(null, usersTable.get(user));

    db.get('SELECT id FROM users WHERE isDeleted=0 AND name=?', [user], function(err, row) {
        if(err) return callback(err);

        if(!row || typeof row.id !== 'number') return callback(new Error('Unknown username "' + user + '"'));
        usersTable.set(user, row.id);
        callback(null, row.id);
    });
};

/**
 * Get all communication priority descriptions
 * @param {function(Error, Array)} callback callback(err, descriptionArray), where descriptionArray is array like
 *     [{id:, description:}, ...]
 * @example
 * SELECT * FROM userCommunicationPriorityDescription ORDER BY id
 * By default will returned descriptionArray:
 * [
 *  {
 *      id:10,
 *      description: "High"
 *  },{
 *      id: 20,
 *      description "Normal"
 *  },{
 *      id: 30,
 *      description: "Low"
 *  }]
 */
usersDB.gerPriorityDescriptions = function(callback) {
    db.all('SELECT * FROM userCommunicationPriorityDescription ORDER BY id', callback);
};

/**
 * Get information for all users or for specific user
 * @param {string|null} username username or null for get information for all users
 * @param {function(err)|function(Error, Array<{id: number, name: string, fullName: string, roleID: number,
 *     roleName: string}>)} callback callback(err, userInfoArray), where userInfoArray is array like
 *     [{id: <user ID>, name: <username>, fullName: <full user name>, roleID: <user role ID>,
 *     roleName: <user role name>}, ...]
 */
usersDB.getUsersInformation = function(username, callback) {

    db.all('\
SELECT users.id AS id, users.name AS name, users.fullName AS fullName, \
usersRoles.roleID AS roleID, roles.name AS roleName, \
userCommunicationPriorities.priority AS priority, userCommunication.mediaID AS mediaID, userCommunication.address AS address \
FROM users \
JOIN usersRoles ON users.id=usersRoles.userID \
JOIN roles ON usersRoles.roleID=roles.id \
LEFT JOIN userCommunication ON userCommunication.userID=users.id \
LEFT JOIN userCommunicationPriorities ON userCommunicationPriorities.userCommunicationID = userCommunication.id \
WHERE users.isDeleted=0' + (username ? ' AND users.name=?' : '') + ' ORDER BY users.name',
        username ? username : [], callback);
};

/**
 * Get information about all users (include deleted users)
 * @param {function(Error, Array)} callback callback(err, usersArray), where usersArray is array like
 *     [{id: <user ID>, name: <username>, fullName: <user full name>, isDeleted: <0|1 is user was deleted>}, ...]
 */
usersDB.getAllUserInfo = function (callback) {
    db.all('SELECT id, name, fullName, isDeleted FROM users', callback);
}

/**
 * Get communication media information for specific users
 * @param {Array} usernames array or usernames
 * @param {function(Error)|function(Error, Array)} callback callback(err, objArray), where objArray is array like
 *     [{userName: <username>, priority: <user communication priority (10,20,30,...)>,
 *     mediaID: <communication media ID ("SMS", "email", ...)>,
 *     address: <media address>, fullName: <user full name>}]
 */
usersDB.getCommunicationMediaForUsers = function(usernames, callback) {
    var stmt = db.prepare('\
SELECT users.name AS userName, userCommunicationPriorities.priority AS priority, \
userCommunication.mediaID AS mediaID, userCommunication.address AS address, users.fullName AS fullName \
FROM users \
LEFT JOIN userCommunication ON userCommunication.userID=users.id \
LEFT JOIN userCommunicationPriorities ON userCommunicationPriorities.userCommunicationID = userCommunication.id \
WHERE users.isDeleted=0 AND users.name=? \
ORDER BY userCommunicationPriorities.priority ASC', function (err) {
        if(err) return callback(err);

        var rows = [];
        async.eachSeries(usernames, function (user, callback) {
            stmt.all(user, function (err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            });
        }, function (err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
};

/**
 * Get information about all user roles
 * @param {function(Error, Array)} callback callback(err, rolesArray) where rolesArray is array like
 *     [{id: <role ID>, name: <role name>, description: <role description>}, ...]
 */
usersDB.getRolesInformation = function(callback) {
    db.all('SELECT * FROM roles ORDER BY name', callback);
};