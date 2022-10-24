/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
var log = require('../lib/log')(module);
var db = require('./db');

var groupsDB = {};
module.exports = groupsDB;

/**
 * Get all counter groups using SELECT * FROM countersGroups ORDER BY name
 * @param {function(Error)|function(null, Array)} callback - callback(err, counterGroups), where
 *      counterGroups = [{id: <groupID>, name: <groupName>, isDefault: <0|1>}, ...]
 */
groupsDB.get = function(callback) {
    db.all('SELECT * FROM countersGroups ORDER BY name', [], function(err, counterGroups) {
        if(err) {
            log.error('Error getting groups from countersGroups table: ' +err.message);
            return callback(err);
        }
        callback(null, counterGroups);
    });
};

/**
 * Getting counters groups for specific objects
 * @param {Array} objectIDs - array of object IDs
 * @param {function(Error) | function(null, Array)} callback - callback(err, counterGroups) where
 *      counterGroups = [{id: <groupID>, name: <groupName>}, ...]
 */
groupsDB.getGroupsForObjects = function(objectIDs, callback){
    log.debug('Getting counters groups for objects ', objectIDs);

    var questionStr = objectIDs.map(function(){return '?'}).join(',');

    db.all(
'SELECT countersGroups.id AS id, countersGroups.name AS name FROM countersGroups \
JOIN counters ON counters.groupID=countersGroups.id \
JOIN objectsCounters ON counters.id=objectsCounters.counterID \
WHERE objectsCounters.objectID IN ('+questionStr+') GROUP BY countersGroups.id',
    objectIDs,
    function(err, counterGroups){
        if(err) return callback(new Error('Error in get groups from countersGroups table for objects '+objectIDs.join(',')+': ' +err.message));
        callback(null, counterGroups);
    })
};