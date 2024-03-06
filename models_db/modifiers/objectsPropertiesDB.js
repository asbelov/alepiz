/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const async = require('async');
const log = require('../../lib/log')(module);
const db = require('../db');
const unique = require('../../lib/utils/unique');

var objectsPropertiesDB = {};
module.exports = objectsPropertiesDB;

/**
 * Update specific properties for the object ID
 * @param {number} objectID object ID
 * @param {Array<{
 *     name: string,
 *     value: number|string,
 *     mode: 0|1|2
 *     description: string
 * }>} properties an array of objects with properties
 * @param {function(null, Array<{
 *     name: string,
 *     value: number|string,
 *     mode: 0|1|2
 *     description: string
 * }>)|function(Error)} callback callback(err, notUpdatedProperties)
 */
objectsPropertiesDB.updateProperties = function(objectID, properties, callback) {
    log.debug('Updating properties for objectsIDs: ', objectID, ' properties: ', properties);

    var stmt = db.prepare('UPDATE objectsProperties SET name=$name, value=$value, mode=$mode, ' +
        'description=$description WHERE objectID=$objectID and name=$name', function(err) {
        if (err) return callback(err);

        var notUpdatedProperties = [];

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(properties, function(property, callback) {
            stmt.run( {
                $objectID: objectID,
                $name: property.name.trim(),
                $value: String(property.value).trim(), // for convert integer to TEXT correctly
                $mode: property.mode,
                $description: typeof property.description === 'string' ?
                    property.description.trim() : property.description,
            }, function(err, info) {
                if(err) return callback(err);

                // count of changes
                var changes = info && info.changes !== undefined ? info.changes : this.changes;
                if(changes !== 1)  notUpdatedProperties.push(property);
                callback();
            });
        }, function(err) {
            stmt.finalize();
            if(err) return callback(err);
            callback(null, notUpdatedProperties);
        });
    });
};

/**
 * Insert new properties for specific objectID
 * @param {Number} objectID - object ID
 * @param {Array} properties - array of objects with properties: [{name:, value:, mode:, description:. }, ...]
 * @param {function(Error|undefined)} callback - callback(err)
 */
objectsPropertiesDB.insertProperties = function(objectID, properties, callback) {
    log.debug('Inserting properties for objectsIDs: ', objectID, ' properties: ', properties);

    var stmt = db.prepare('INSERT INTO objectsProperties (id, objectID, name, value, mode, description) ' +
        'VALUES ($id, $objectID, $name, $value, $mode, $description)', function(err) {
        if (err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(properties, function(property, callback) {
            const id =
                unique.createHash(objectID.toString(36) + property.name + String(property.value) +
                property.mode + property.description);

            stmt.run( {
                $id: id,
                $objectID: objectID,
                $name: property.name.trim(),
                $value: String(property.value).trim(), // for convert integer to TEXT correctly
                $mode: property.mode,
                $description: typeof property.description === 'string' ?
                    property.description.trim() : property.description,
            }, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Delete specific properties for the objectID
 * @param {number} objectID object ID
 * @param {Array<string>} propertyNames an array with property names
 * @param {function()|function(Error)} callback callback(err)
 */
objectsPropertiesDB.deleteProperties = function(objectID, propertyNames, callback) {
    log.debug('Removing properties for objectID: ', objectID, ' properties ', propertyNames);

    var stmt = db.prepare('DELETE FROM objectsProperties WHERE objectID = $objectID AND name = $name',
        function(err) {
        if (err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(propertyNames, function(propertyName, callback) {
            stmt.run( {
                $objectID: objectID,
                $name: propertyName,
            }, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Delete all properties for the object IDs
 * @param {Array<number>} objectIDs an Array with object ID
 * @param {function()|function(Error)} callback callback(err)
 */
objectsPropertiesDB.deleteAllProperties = function(objectIDs, callback) {
    log.info('Deleting all properties for the object IDs: ', objectIDs);

    var stmt =
        db.prepare('DELETE FROM objectsProperties WHERE objectID = ?',function(err) {
        if (err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(objectIDs, function(objectID, callback) {
            stmt.run(objectID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};