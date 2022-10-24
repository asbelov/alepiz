/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../../lib/log')(module);
var db = require('../db');

var objectsDB = {};
module.exports = objectsDB;
/*
 Delete objects.
 Check user rights before using this functions
 IDs - array objects IDs
 callback(err)
*/
objectsDB.deleteObjects = function(IDs, callback) {
    log.debug('Deleting objects IDs: ', IDs);

    var stmt = db.prepare('DELETE FROM objects WHERE id=?', function(err) {
        if(err) return callback(err);

        async.eachSeries(IDs, function(ID, callback) {
            stmt.run(ID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/*
 renaming objects with IDs in initIDs to names in newObjectsNamesStr
 Check user rights before using this functions
 objects - [{id: XX, name: "newObjectName1"}, {..},.... ]
 callback(err)
 */
objectsDB.renameObjects = function(objects, callback) {
    log.debug('Renaming objects: ', objects);

    var stmt = db.prepare('UPDATE objects SET name=? WHERE id=?', function(err){
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(objects, function(object, callback){
                stmt.run([object.name, object.id], callback);
            }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/*
 add new objects into a database.

 newObjectNames - array of new objects names
 description - description for new object names
 order - sort position for new objects.  Top objects has order < 10 objectsFilterDB.js
 disabled - 1|0
 color = <color>:<shade> (https://materializecss.com/color.html#palette)
 callback(err, newObjectsIDs),
 newObjectsIDs - array of a new objects IDs;
 newObjects - object like {<objectName1>: <objectID1>, ...}
 */
objectsDB.addObjects = function(newObjectsNames, description, order, disabled, color, callback){
    log.debug('Add objects: ', newObjectsNames, ', description: ', description, ', order: ', order, ', disabled: ', disabled);

    // Prepare statement for inserting new objects into a database
    var stmt = db.prepare('INSERT INTO objects (name, description, sortPosition, disabled, color, created) VALUES ' +
        '($name,$description,$sortPosition, $disabled, $color, $created)', function(err) {
        if(err) return callback(err);

        // array with IDs of a new objects, which inserting
        var newObjectsIDs = [], newObjects = {};
        // async inserting new objects into a database. series used for transaction rollback if error and
        // save order of newObjectsIDs
        async.eachSeries(newObjectsNames, function(name, callback){
            stmt.run({
                $name: name,
                $description: description,
                $sortPosition: order,
                $disabled: disabled,
                $color: color,
                $created: Date.now(),
            }, function (err, info) {
                if(err) return callback(err);
                // push new object ID into array
                var newObjectID = this.lastID === undefined ? info.lastInsertRowid : this.lastID;
                newObjectsIDs.push(newObjectID);
                newObjects[name] = newObjectID;
                callback();
            });
        }, function(err){
            stmt.finalize();
            if(err) return callback(err);
            callback(null, newObjectsIDs, newObjects);
        });
    });
};

/**
 * Update description sort position, disabled, color for objects with objectIDs
 * @param objectIDs - array of object IDs
 * @param updateData - object with a new object parameters like {$disabled:, $sortPosition:, $description:, $color:}
 *  Some of parameters may be missing
 * @param callback - callback(err)
 */
objectsDB.updateObjectsInformation = function (objectIDs, updateData, callback) {
    log.debug('Update objects IDs: ', objectIDs, ': ', updateData);

    var subQuery = [];
    // f.e. subQuery can be a ["description=$description", "disabled=$disabled", "color=$color"]
    for(var key in updateData) subQuery.push(key.substring(1) + '=' + key);

    var stmt = db.prepare('UPDATE objects SET ' + subQuery.join(', ') + ' WHERE id=$id', function(err) {
        if(err) return callback(err);
        async.eachSeries(objectIDs, function(ID, callback) {
            updateData.$id = ID;
            stmt.run(updateData, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    })
};


/**
 * Inserting new objects interactions. Check user rights before using it functions
 * @param {Array} interactions - [{id1: <objectID1>, id2: <objectID2>, type: <interactionType>}];
 *  interaction types: 0 - include; 1 - intersect, 2 - exclude
 * @param {function} callback - callback(err)
 */
objectsDB.insertInteractions = function(interactions, callback){

    var stmt = db.prepare('INSERT INTO interactions (objectID1, objectID2, type) VALUES (?,?,?)', function(err){
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(interactions, function(interaction, callback){
            stmt.run([interaction.id1, interaction.id2, interaction.type], callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Deleting some objects interactions. Check user rights before using it functions
 * @param {Array} interactions - [{id1:<objectID1>, id2: <objectID2>, type: <interactionType>}];
 *  interaction types: 0 - include; 1 - intersect, 2 - exclude
 * @param {function} callback - callback(err)
 */
objectsDB.deleteInteractions = function(interactions, callback){
    if(!interactions.length) return callback();

    var stmt = db.prepare('DELETE FROM interactions WHERE objectID1=? AND objectID2=? AND type=?', function(err) {
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(interactions, function(interaction, callback){
            stmt.run([interaction.id1, interaction.id2, interaction.type], callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

objectsDB.addObjectsAlepizRelation = function (objectsAlepizRelations, callback) {
    if(!objectsAlepizRelations) return callback();

    var stmt = db.prepare('INSERT INTO objectsAlepizRelation (objectID, alepizID) VALUES ($objectID, $alepizID)',
        function(err) {
        if(err) return callback(err);

        async.eachSeries(objectsAlepizRelations, function(objectAlepizRelation, callback){
            stmt.run(objectAlepizRelation, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
}

objectsDB.deleteObjectsAlepizRelation = function(objectIDs, callback) {
    if(!objectIDs.length) return callback();

    var stmt = db.prepare('DELETE FROM objectsAlepizRelation WHERE objectID=?', function(err) {
        if(err) return callback(err);

        async.eachSeries(objectIDs, function(objectID, callback) {
            stmt.run(objectID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};