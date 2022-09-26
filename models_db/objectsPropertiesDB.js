/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
var log = require('../lib/log')(module);
var db = require('./db');

var objectsPropertiesDB = {};
module.exports = objectsPropertiesDB;

/** Get objects properties for specified object IDs
 *
 * @param {Array[number]} objectsIDs - array of object IDs
 * @param {function(Error)|function(null, Array): void} callback - return Error or array with objects properties for
 * SQL query "SELECT * FROM objectsProperties WHERE objectID = ?" like
 * [{id:..., objectID:..., name:..., value:..., description:..., mode:...}, ...], where mode:
 * 0 - not calculated text; 1 - checkbox, 2 - not calculated text area, 3 - calculated expression
 * @returns {*|void}
 */
objectsPropertiesDB.getProperties = function (objectsIDs, callback) {
    log.debug('Getting all properties for objects IDs: ', objectsIDs);

    if(!objectsIDs || !objectsIDs.length) return db.all('SELECT * FROM objectsProperties', callback);

    var rows = [];
    var stmt = db.prepare('SELECT * FROM objectsProperties WHERE objectID = ?', function(err) {
        if(err) return callback(err);

        async.eachLimit(objectsIDs,100,function(objectID, callback) {
            stmt.all(objectID, function(err, res) {
                if(err) return callback(err);
                rows.push.apply(rows, res);
                callback();
            });
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
};

objectsPropertiesDB.updateProperties = function(objectID, properties, callback) {
    log.debug('Updating properties for objectsIDs: ', objectID, ' properties: ', properties);

    var stmt = db.prepare('UPDATE objectsProperties SET name=$name, value=$value, mode=$mode, description=$description ' +
        'WHERE objectID=$objectID and name=$name', function(err) {
        if (err) return callback(err);

        var notUpdatedProperties = [];

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(properties, function(property, callback) {
            stmt.run( {
                $objectID: objectID,
                $name: property.name,
                $value: String(property.value), // for convert integer to TEXT correctly
                $mode: property.mode,
                $description: property.description
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

objectsPropertiesDB.insertProperties = function(objectID, properties, callback) {
    log.debug('Inserting properties for objectsIDs: ', objectID, ' properties: ', properties);

    var stmt = db.prepare('INSERT INTO objectsProperties (objectID, name, value, mode, description) ' +
        'VALUES ($objectID, $name, $value, $mode, $description)', function(err) {
        if (err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(properties, function(property, callback) {
            stmt.run( {
                $objectID: objectID,
                $name: property.name,
                $value: String(property.value), // for convert integer to TEXT correctly
                $mode: property.mode,
                $description: property.description
            }, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

objectsPropertiesDB.deleteProperties = function(objectID, propertiesNames, callback) {
    log.debug('Removing properties for objectID: ', objectID, ' properties ', propertiesNames);

    var stmt = db.prepare('DELETE FROM objectsProperties WHERE objectID = $objectID AND name = $name', function(err) {
        if (err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(propertiesNames, function(propertyName, callback) {
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

/** Get object property by property name (SQL LIKE syntax)
 *
 * @param {string} propertyName - SQL Like property name (wildcards: "%" any symbols, "_" one symbol, "\\";"\%";"\_" - for escape)
 * @param {function(Error)|function(null, Array)} callback - return error or an Array with object properties
 * [{objectName:..., objectID:..., propName:..., propVal:..., propMode:... propDescription:...}, ....]
 */
objectsPropertiesDB.getObjectsForProperty = function (propertyName, callback) {
    log.debug('Getting objects for property: ', propertyName);

    db.all('SELECT objects.name AS objectName, objects.id AS objectID, objectsProperties.name AS propName, ' +
        'objectsProperties.value AS propVal, objectsProperties.mode AS propMode, ' +
        'objectsProperties.description AS propDescription FROM objects ' +
        'JOIN objectsProperties ON objects.id=objectsProperties.objectID '+
        'WHERE objectsProperties.name LIKE ? ESCAPE "\\" ORDER BY objects.name', propertyName, callback);
}