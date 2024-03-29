/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
const log = require('../../lib/log')(module);
const db = require('../db');
const unique = require('../../lib/utils/unique');

var groupsDB = {};
module.exports = groupsDB;

/**
 * Add counter group
 * @param {string} groupName new group name
 * @param {function(Error)|function()} callback callback(err)
 */
groupsDB.addCounterGroup = function(groupName, callback) {
    // The hash algorithm is too simple. There may be problems with renaming
    const id = unique.createHash(groupName);

    db.run('INSERT INTO countersGroups (id, name) VALUES (?, ?)', [id, groupName], function(err){
        if(err) {
            log.error('Error inserting counter group ', groupName , ' into the database: ', err.message);
            return callback(err);
        }
        callback();
    })
};

/**
 * Rename counter group
 * @param {number} groupID counter group ID
 * @param {string} newGroupName new group name
 * @param {function(Error)|function()} callback callback(err)
 */
groupsDB.renameCounterGroup = function(groupID, newGroupName, callback) {
    if(!groupID) {
        var err = new Error('Error editing counters group: initial group name is not set');
        return callback(err);
    }

    if(!newGroupName) {
        err = new Error('Error editing counters group: new group name is not set');
        return callback(err);
    }

    db.run('UPDATE countersGroups SET name=$name WHERE id=$id', {
            $name: newGroupName,
            $id: groupID
        }, function(err) {
            if (err) {
                log.error('Error changing name for counter group from ', groupID, ' to ', newGroupName,
                    ' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    );
};

/**
 * Set or unset the initial counter group (when new counter will be created, this group will be selected)
 * @param {number} groupID group ID
 * @param {0|1} groupProperty 0 - not initial group, 1 - initial group
 * @param {function(Error)|function()} callback callback(err)
 */
groupsDB.setInitialCounterGroup = function(groupID, groupProperty, callback) {
    if(!groupID) return callback(new Error('Error editing counters group: initial group name is not set'));
    if(!groupProperty) return callback(new Error('Error editing counters group: property of initial group is not set'));

    db.run('UPDATE countersGroups SET isDefault = 0 WHERE isDefault = ?', groupProperty, function(err){
        if(err) {
            log.error('Error reset initial counter group for change it to '+groupID+' into database: ', err.message);
            return callback(err);
        }
        db.run('UPDATE countersGroups SET isDefault=? WHERE id=?', [groupProperty, groupID], function(err) {
                if (err) {
                    log.error('Error changing initial counter group to '+groupID+' into database: ', err.message);
                    return callback(err);
                }
                callback();
            }
        );
    });
};

/**
 * Remove counter group
 * @param {number} groupID group ID
 * @param {function(Error)|function()} callback callback(err)
 */
groupsDB.removeCounterGroup = function(groupID, callback) {
    if(!groupID) {
        return callback(new Error('Error removing counters group from database: group ID is not set or there is a ' +
            '"Conditions for Tasks": ') + groupID);
    }
    db.run('DELETE FROM countersGroups WHERE id=?', groupID, function(err){
        if(err) {
            log.error('Error removing counter group '+groupID+' from database: ', err.message);
            return callback(err);
        }
        callback();
    })
};