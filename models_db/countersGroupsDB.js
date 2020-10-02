/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
var log = require('../lib/log')(module);
var db = require('../lib/db');

var groupsDB = {};
module.exports = groupsDB;

groupsDB.get = function(callback) {
    db.all('SELECT * FROM countersGroups ORDER BY name', [], function(err, groups) {
        if(err) {
            log.error('Error getting groups from countersGroups table: ' +err.message);
            return callback(err);
        }
        callback(null, groups);
    });
};

/*
    Getting counters groups for specific objects

    IDs - array of objects IDs
    callback(err, groups)
    groups: [{id:.., name:...}, ...]
 */

groupsDB.getGroupsForObjects = function(IDs, callback){
    log.debug('Getting counters groups for objects ', IDs);

    var questionStr = IDs.map(function(){return '?'}).join(',');

    db.all(
'SELECT countersGroups.id AS id, countersGroups.name AS name FROM countersGroups \
JOIN counters ON counters.groupID=countersGroups.id \
JOIN objectsCounters ON counters.id=objectsCounters.counterID \
WHERE objectsCounters.objectID IN ('+questionStr+') GROUP BY countersGroups.id',
    IDs,
    function(err, groups){
        if(err) return callback(new Error('Error in get groups from countersGroups table for objects '+IDs.join(',')+': ' +err.message));
        callback(null, groups);
    })
};

groupsDB.new = function(group, callback) {
    if(!group) {
        var err = new Error('Error inserting counters group into database: group name is not set');
        return callback(err);
    }
    db.run('INSERT INTO countersGroups (name) VALUES (?)', group, function(err){
        if(err) {
            log.error('Error inserting counter group '+group+' into database: ', err.message);
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
