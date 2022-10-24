/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//var log = require('../lib/log')(module);
var db = require('./db');
var async = require('async');
var log = require('../lib/log')(module);

var usersDB = {};
module.exports = usersDB;

usersDB.checkAndGetFullUserName = function(userName, hash, callback) {
    if(!userName) return callback();
    db.get('SELECT fullName FROM users WHERE name=? AND password=?', [userName, hash], callback);
};

usersDB.getFullUserName = function(userName, callback) {
    if(!userName) return callback();
    db.get('SELECT fullName FROM users WHERE name=?', [userName], callback);
};


/*
    get userID for specific username

    username: username, prepared by lib/utils/preparedUser function
    callback(err, userID);
 */
usersDB.getID = function(userName, callback) {
    if(!userName) return callback();

    db.get('SELECT id FROM users WHERE name=?', [userName], function(err, data) {
        if(err) return callback(err);

        if(!data || !data.id) return callback(new Error('Unknown username "' + userName + '"'));
        callback(null, data.id);
    });
};

usersDB.gerPriorityDescriptions = function(callback) {
    db.all('SELECT * FROM userCommunicationPriorityDescription ORDER BY id', callback);
};

usersDB.getUsersInformation = function(userName, callback) {

    db.all('\
SELECT users.id AS id, users.name AS name, users.fullName AS fullName, \
usersRoles.roleID AS roleID, roles.name AS roleName, \
userCommunicationPriorities.priority AS priority, userCommunication.mediaID AS mediaID, userCommunication.address AS address \
FROM users \
JOIN usersRoles ON users.id=usersRoles.userID \
JOIN roles ON usersRoles.roleID=roles.id \
LEFT JOIN userCommunication ON userCommunication.userID=users.id \
LEFT JOIN userCommunicationPriorities ON userCommunicationPriorities.userCommunicationID = userCommunication.id \
WHERE users.isDeleted=0' + (userName ? ' AND users.name=?' : '') + ' ORDER BY users.name',
        userName ? userName : [], callback);
};

usersDB.getCommunicationMediaForUsers = function(users, callback) {
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
        async.eachSeries(users, function (user, callback) {
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

usersDB.getRolesInformation = function(callback) {
    db.all('SELECT * FROM roles ORDER BY name', callback);
};