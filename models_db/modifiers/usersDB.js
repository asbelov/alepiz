/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const db = require('../db');
const async = require('async');
const unique = require('../../lib/utils/unique');

var usersDB = {};
module.exports = usersDB;

/**
 * Remove specific users by userIDs
 * @param {Array} usersIDs - array of user IDs for remove
 * @param {function(Error)} callback - callback(err)
 */
usersDB.removeUsers = function(usersIDs, callback) {
    log.debug('Remove user IDs: ', usersIDs);

    db.run('UPDATE users SET isDeleted=1 WHERE id IN (' + (new Array(usersIDs.length)).fill('?').join(',') +')',
        usersIDs, callback);
};

/**
 * Add a new user to the database
 * @param {Object} userProperties - object with user parameters.
 * @param {string} userProperties.name - user name
 * @param {string} userProperties.fullName - user full real name
 * @param {string} userProperties.password - user encrypted password
 * @param {number} userProperties.sessionID - sessionID for create unique user ID
 * @param {function(Error) | function(null, Number)} callback - callback(err, userID), where userID is a new user ID
 */
usersDB.addUser = function(userProperties, callback) {
    log.debug('Add user ', userProperties);

    const id = unique.createHash(userProperties);
    db.run('INSERT INTO users (id, name, fullName, password, isDeleted) VALUES ($id, $name, $fullName, $password, 0)', {
        $id: id,
        $name: userProperties.name,
        $fullName: userProperties.fullName,
        $password: userProperties.password
    }, function (err, info) {
        callback(err, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
    });
};

/**
 * Add roles for specific userID
 * @param {Number} userID - user ID
 * @param {Array} rolesIDs - array with roles for specific user
 * @param {function(Error|undefined)} callback - callback(err)
 */
usersDB.addRolesForUser = function(userID, rolesIDs, callback) {
    log.debug('Add roles IDs ', rolesIDs, ' to user ID ', userID);

    var stmt = db.prepare('INSERT INTO usersRoles (id, userID, roleID) VALUES ($id, $userID, $roleID)',
        function(err) {
        if(err) return callback(err);

        async.eachSeries(rolesIDs, function(roleID, callback) {
            const id = unique.createHash(userID.toString(36) + roleID.toString());
            stmt.run({
                $id: id,
                $userID: userID,
                $roleID: roleID,
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

/**
 * Add communication media for specific user ID
 * @param {Number} userID - user ID
 * @param {string} mediaID - media name
 * @param {string} address - communication media address, f.e. email, mobile phone etc
 * @param {function(Error) | function(null, Number)} callback - callback(err, userCommunicationID), where
 *  userCommunicationID is a new userCommunicationID
 */
usersDB.addCommunicationMedia = function(userID, mediaID, address, callback) {
    const id = unique.createHash(userID.toString(36) + mediaID + address);

    db.run('INSERT INTO userCommunication (id, userID, mediaID, address) VALUES ($id, $userID, $mediaID, $address)', {
        $id: id,
        $userID: userID,
        $mediaID: mediaID,
        $address: address,
    }, function (err, info) {
        callback(err, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
    });
};

/**
 * Add communication media priority
 * @param {Number} userCommunicationID - userCommunicationID - id from userCommunication table
 * @param {Number} priority - communication media priority
 * @param {function(Error|undefined)} callback - callback(err)
 */
usersDB.addCommunicationMediaPriority = function (userCommunicationID, priority, callback) {
    const id = unique.createHash(userCommunicationID.toString(36) + priority.toString(36));

    db.run('INSERT INTO userCommunicationPriorities (id, userCommunicationID, priority) VALUES ($id, $userCommunicationID, $priority)', {
        $id: id,
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