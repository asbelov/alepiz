/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//var log = require('../lib/log')(module);
var db = require('../db');
var async = require('async');
var log = require('../../lib/log')(module);

var usersDB = {};
module.exports = usersDB;

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
    }, function (err, info) {
        callback(err, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
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
        }, function (err) {
            stmt.finalize();
            callback(err);
        });
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

usersDB.updateUserPassword = function(userName, newPassword, callback) {
    log.debug('Updating user password for ', userName);

    db.run('UPDATE users SET password=$password WHERE name=$name', {
            $name: userName,
            $password: newPassword,
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
    }, function (err, info) {
        callback(err, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
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