/*
 * Copyright © 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
var log = require('../lib/log')(module);
var db = require('../lib/db');

var objectsPropertiesDB = {};
module.exports = objectsPropertiesDB;

objectsPropertiesDB.getProperties = function (objectsIDs, callback) {
    log.debug('Getting all properties for objects IDs: ', objectsIDs);

    if(!objectsIDs || !objectsIDs.length) return db.all('SELECT * FROM objectsProperties', callback);

    if(objectsIDs.length < db.maxVariableNumber)
        db.all('SELECT * FROM objectsProperties WHERE objectID IN (' + (Array(objectsIDs.length).fill('?')).join(',')+ ')', objectsIDs, callback);
    else {
        var rows = [];
        var stmt = db.prepare('SELECT * FROM objectsProperties WHERE objectID = ?', function(err) {
            if(err) return callback(err);

            async.eachLimit(objectsIDs,100,function(objectID, callback) {
                stmt.all(objectID, function(err, res) {
                    if(err) return callback(err);
                    rows.push.apply(rows, res);
                    callback();
                })
            }, function(err) {
                stmt.finalize();
                callback(err, rows);
            })
        });
    }
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
                $value: property.value,
                $mode: property.mode,
                $description: property.description
            }, function(err) {
                if(err) return callback(err);

                // count of changes
                if(this.changes !== 1) notUpdatedProperties.push(property);
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
                $value: property.value,
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
