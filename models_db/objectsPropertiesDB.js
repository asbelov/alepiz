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
 * @param {Array[number]|null} objectsIDs - array of object IDs. null for return properties for all objects
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

        async.eachSeries(objectsIDs, function(objectID, callback) {
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