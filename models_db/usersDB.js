/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//var log = require('../lib/log')(module);
var db = require('../lib/db');
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
    get userID for specific user name
    userName: user name, prepared by lib/utils/preparedUser function
    callback(err, userID);
 */
usersDB.getID = function(userName, callback) {
    if(!userName) return callback();

    db.get('SELECT id FROM users WHERE name=?', [userName], function(err, data) {
        if(err) return callback(err);

        if(!data || !data.id) return callback(new Error('Unknown user name "' + userName + '"'));
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
        userName ? userName : undefined, callback);
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

usersDB.removeUsers = function(usersIDs, callback) {
    log.debug('Remove users IDs: ', usersIDs);

    db.run('UPDATE users SET isDeleted=1 WHERE id IN (' + (new Array(usersIDs.length)).fill('?').join(',') +')', usersIDs, callback);
};

usersDB.addUser = function(userProperties, callback) {
    log.debug('Add user ', userProperties);

    db.run('INSERT INTO users (name, fullName, password, isDeleted) VALUES ($name, $fullName, $password, 0)', {
        $name: userProperties.name,
        $fullName: userProperties.fullName,
        $password: userProperties.password
    }, function(err) {
        callback(err, this.lastID);
    });
};

usersDB.addRolesForUser = function(userID, rolesIDs, callback) {
    log.debug('Add roles IDs ', rolesIDs, ' to user ID ', userID);

    var stmt = db.prepare('INSERT INTO usersRoles (userID, roleID) VALUES ($userID, $roleID)', function(err) {
        if(err) return callback(err);

        async.eachSeries(rolesIDs, function(roleID, callback) {
            stmt.run({
                $userID: userID,
                $roleID: roleID
            }, callback);
        }, callback);
    })
};

usersDB.updateUser = function(userProperties, callback) {
    log.debug('Updating user ', userProperties);

    db.run('UPDATE users SET name=$name, fullName=$fullName' + (userProperties.password ? ', password=$password' : '') +
    ' WHERE id=$id', {
            $id: userProperties.id,
            $name: userProperties.name,
            $fullName: userProperties.fullName,
            $password: userProperties.password
        }, callback
    );
};

usersDB.deleteAllRolesForUser = function(userID, callback) {
    log.debug('Deleting all user roles for user ID: ', userID);

    db.run('DELETE FROM usersRoles WHERE userID=?', userID, callback);
};

usersDB.addCommunicationMedia = function(userID, mediaID, address, callback) {
    db.run('INSERT INTO userCommunication (userID, mediaID, address) VALUES ($userID, $mediaID, $address)', {
        $userID: userID,
        $mediaID: mediaID,
        $address: address,
    }, function(err) {
        callback(err, this.lastID);
    });
};

usersDB.addCommunicationMediaPriority = function (userCommunicationID, priority, callback) {
    db.run('INSERT INTO userCommunicationPriorities (userCommunicationID, priority) VALUES ($userCommunicationID, $priority)', {
        $userCommunicationID: userCommunicationID,
        $priority: priority,
    }, callback);
};

usersDB.deleteAllMediasForUser = function (userID, callback) {
    db.run('DELETE FROM userCommunication WHERE userID=?', userID, callback);
}

usersDB.deleteCommunicationMedia = function (mediaID, callback) {
    db.run('DELETE FROM userCommunication WHERE mediaID=?', mediaID, callback);
}