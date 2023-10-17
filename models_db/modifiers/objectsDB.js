/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require('async');
const log = require('../../lib/log')(module);
const db = require('../db');
const unique = require('../../lib/utils/unique');

var objectsDB = {};
module.exports = objectsDB;
/**
 * Delete objects
 * @param {Array} objectIDs - array of object IDs
 * @param {function(Error)|function()} callback - callback(err)
 */
objectsDB.deleteObjects = function(objectIDs, callback) {
    log.debug('Deleting objects IDs: ', objectIDs);

    var stmt = db.prepare('DELETE FROM objects WHERE id=?', function(err) {
        if(err) return callback(err);

        async.eachSeries(objectIDs, function(objectID, callback) {
            stmt.run(objectID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Renaming objects. selected by objectID. Check user rights before using this functions
 * @param {Array} objects - object list like [{id: XX, name: "newObjectName1"}, {..},.... ]
 * @param {function(Error)|function()} callback - callback(err)
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

/**
 * add new objects into a database.
 * @param {Array} newObjectsNames - array of the new object names
 * @param {string} description - object description
 * @param {number} order - object sort order in the object list
 * @param {0|1} disabled - is object disabled
 * @param {string|null} color - object color
 * @param {number} createdTimestamp - timestamp when object was created
 * @param {function(Error)|function(null, newObjectsIDs:Array<number>, newObjectNames:Object)} callback -
 *  callback(err, newObjectsIDs, newObjectNames), where newObjectsIDs - array with
 *  new object IDs, newObjectNames - object like {<objectName1>: <objectID1>, ...}
 */
objectsDB.addObjects = function(newObjectsNames, description, order, disabled,
                                color, createdTimestamp, callback){
    log.debug('Add objects: ', newObjectsNames, ', description: ', description, ', order: ', order,
        ', disabled: ', disabled);

    // Prepare statement for inserting new objects into a database
    var stmt = db.prepare('INSERT INTO objects (id, name, description, sortPosition, disabled, ' +
        'color, created) VALUES ($id, $name, $description, $sortPosition, $disabled, $color, $created)',
        function(err) {

        if(err) return callback(err);

        // array with IDs of a new objects, which inserting
        var newObjectsIDs = [], newObjects = {};

        async.eachSeries(newObjectsNames, function(name, callback) {
            const id = unique.createHash(name + description + order + disabled + color);

            stmt.run({
                $id: id,
                $name: name,
                $description: description,
                $sortPosition: order,
                $disabled: disabled,
                $color: color,
                $created: createdTimestamp,
            }, function (err, info) {
                if(err) return callback(err);
                // push new object ID into array
                newObjectsIDs.push(id);
                newObjects[name] = id;
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
 * @param {function(Error)|function()} callback - callback(err)
 */
objectsDB.updateObjectsInformation = function (objectIDs, updateData, callback) {
    log.debug('Update objects IDs: ', objectIDs, ': ', updateData);

    var subQuery = [];
    // f.e. subQuery can be a ["description=$description", "disabled=$disabled", "color=$color"]
    for(var key in updateData) subQuery.push(key.substring(1) + '=' + key);

    var stmt = db.prepare('UPDATE objects SET ' + subQuery.join(', ') + ' WHERE id=$id',
        function(err) {

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
 * @param {Array<{id1: number, id2: number, type: 0|1|2}>} interactions -
 *  [{id1: <objectID1>, id2: <objectID2>, type: <interactionType>}];
 *  interaction types: 0 - include; 1 - intersect, 2 - exclude
 * @param {function(Error)|function()} callback - callback(err)
 */
objectsDB.insertInteractions = function(interactions, callback){

    var stmt = db.prepare('INSERT INTO interactions (id, objectID1, objectID2, type) VALUES (?, ?, ?, ?)',
        function(err) {
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(interactions, function(interaction, callback) {
            const id = unique.createHash(interaction.id1.toString(36) + interaction.id2.toString(36) +
                interaction.type.toString(36));

            stmt.run([id, interaction.id1, interaction.id2, interaction.type], callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Deleting some objects interactions. Check user rights before using it functions
 * @param {Array<{id1: number, id2: number, type: 0|1|2}>} interactions -
 *      [{id1:<objectID1>, id2: <objectID2>, type: <interactionType>}];
 *  interaction types: 0 - include; 1 - intersect, 2 - exclude
 * @param {function(Error)|function()} callback - callback(err)
 */
objectsDB.deleteInteractions = function(interactions, callback){
    if(!interactions.length) return callback();

    var stmt = db.prepare('DELETE FROM interactions WHERE objectID1=? AND objectID2=? AND type=?',
        function(err) {

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
 * Add new object to Alepiz relationship
 * @param {Array} objectsAlepizRelations array of objects to Alepiz instances relationship like
 *  [{objectID:, alepizID:}, ....]
 * @param {function(Error)|function()} callback callback(err)
 */
objectsDB.addObjectsAlepizRelation = function (objectsAlepizRelations, callback) {
    if(!objectsAlepizRelations) return callback();

    var stmt = db.prepare('INSERT INTO objectsAlepizRelation (id, objectID, alepizID) ' +
        'VALUES ($id, $objectID, $alepizID)',function(err) {

        if(err) return callback(err);

        async.eachSeries(objectsAlepizRelations, function(objectAlepizRelation, callback) {
            const id = unique.createHash(objectAlepizRelation);
            stmt.run({
                $id: id,
                $objectID: objectAlepizRelation.objectID,
                $alepizID: objectAlepizRelation.alepizID,
            }, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
}

/**
 * Delete object to Alepiz instance relationship
 * @param {Array} objectIDs - array of object IDs
 * @param {function(Error)|function()} callback - callback(err)
 */
objectsDB.deleteObjectsAlepizRelation = function(objectIDs, callback) {
    if(!objectIDs.length) return callback();

    var stmt = db.prepare('DELETE FROM objectsAlepizRelation WHERE objectID=?',
        function(err) {

        if(err) return callback(err);

        async.eachSeries(objectIDs, function(objectID, callback) {
            stmt.run(objectID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};