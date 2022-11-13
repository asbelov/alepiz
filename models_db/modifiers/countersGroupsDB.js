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

groupsDB.new = function(groupName, sessionID, callback) {
    const id = unique.createHash(groupName + sessionID);

    db.run('INSERT INTO countersGroups (id, name) VALUES (?, ?)', [id, groupName], function(err){
        if(err) {
            log.error('Error inserting counter group ', groupName , ' into the database: ', err.message);
            return callback(err);
        }
        callback();
    })
};

groupsDB.edit = function(groupID, newGroupName, callback) {
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
                log.error('Error changing name for counter group from ' + groupID + ' to '+newGroupName+' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    );
};

groupsDB.setInitial = function(groupID, groupProperty, callback) {
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

groupsDB.remove = function(groupID, callback) {
    if(!groupID || groupID === '0') {
        var err = new Error('Error removing counters group from database: group name is not set or it is a "Conditions for Tasks"');
        return callback(err);
    }
    db.run('DELETE FROM countersGroups WHERE id=?', groupID, function(err){
        if(err) {
            log.error('Error removing counter group '+groupID+' from database: ', err.message);
            return callback(err);
        }
        callback();
    })
};