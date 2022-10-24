/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
var log = require('../../lib/log')(module);
var db = require('../db');

var objectsPropertiesDB = {};
module.exports = objectsPropertiesDB;

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