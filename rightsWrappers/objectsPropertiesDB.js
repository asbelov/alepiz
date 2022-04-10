/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../lib/log')(module);
var async = require('async');
var objectsPropertiesDB = require('../models_db/objectsPropertiesDB');
var objectsDB = require('../models_db/objectsDB');
var rightsDB = require('../models_db/usersRolesRightsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');

var rightsWrapper = {};
module.exports = rightsWrapper;

/** Get object properties for specified object IDs. Return properties from DB if properties were not updated more than
 * objectPropertiesCacheExpireTime ms or from the cache
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} objectIDs - array or comma separated string with objects IDs
 * @param {boolean} errorOnNoRights - return error if user has not rights for some objects from obkectIDs
 * @param {function(Error)|function(null, Array)} callback - return error or an Array with all columns of object properties
 */

function getCachedProperties(user, objectIDs, errorOnNoRights, callback) {
    checkIDs(objectIDs, function(err, checkedIDs) {
        if (err) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkVew: true,
            errorOnNoRights: errorOnNoRights,
        }, function (err, checkedObjectsIDs) {
            if (err) return callback(err);

            objectsPropertiesDB.getProperties(checkedObjectsIDs, callback);
        });
    });
}

/** Get object properties for specified object IDs
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} objectsIDs - array or comma separated string with objects IDs
 * @param {boolean} noCache - if true, then getting properties from the database (not from the cache)
 * @param {function(Error)|function(null, Array)} callback - return error or an Array of shared object properties
 * [{name:..., value:..., description:..., mode:...}]
 */

rightsWrapper.getSharedProperties = function(user, objectsIDs, noCache, callback) {

    sortProperties(user, objectsIDs, [], true, function(err, obj) {
        if(err) return callback(err);

        log.info('SharedProps: ', Object.values(obj.shared));
        callback(null, Object.values(obj.shared).map(function (properties) {
            return {
                name: properties[0].name,
                value: properties[0].value,
                description: properties[0].description,
                mode: properties[0].mode
            }
        }));
    });
};

/** Get object properties for specified object IDs
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} objectsIDs - array or comma separated string with objects IDs
 * @param {function(Error)|function(null, Array)} callback - return error or an Array with all columns of object properties
 */
rightsWrapper.getProperties = function(user, objectsIDs, callback) {
    getCachedProperties(user, objectsIDs, true, callback);
};

/**
 * Getting all object properties for object by OCIDs
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} OCIDs -  array or string with objects counters IDs
 * @param {number} mode - property mode
 * @param {function(Error)|function(null, Array)} callback - return error or an Array of properties
 * [{OCID:..., name:..., value:...}, ...]
 */
rightsWrapper.getPropertiesByOCIDs = function (user, OCIDs, mode, callback) {
    checkIDs(OCIDs, function(err, checkedOCIDs) {
        if (err && (!checkedOCIDs || !checkedOCIDs.length)) return callback(err);

        // SELECT objects.name AS name, objects.id AS objectID, objectsCounters.id AS OCID FROM objects...
        objectsDB.getObjectsByOCIDs(checkedOCIDs, function (err, rowsOCIDs) {
            if (err) {
                return callback(new Error('Can\'t get objects IDs using OCIDs ' + JSON.stringify(checkedOCIDs) +
                    ': ' + err.message));
            }
            // remove duplicate objects IDs
            var objectsIDs2OCIDs = {};
            rowsOCIDs.forEach(row => {
                if(!objectsIDs2OCIDs[row.objectID]) objectsIDs2OCIDs[row.objectID] = [row.OCID];
                else objectsIDs2OCIDs[row.objectID].push(row.OCID);
            });

            getCachedProperties(user, Object.keys(objectsIDs2OCIDs), false, function(err, rows) {
                if(err) {
                    return callback(new Error('Can\'t get objects properties for objects IDs  ' +
                        JSON.stringify(Object.keys(objectsIDs2OCIDs)) + ': ' + err.message));
                }

                var res = [];
                rows.forEach(row => {
                    // typeof mode === "number" - check for mode is defined
                    // using "!Array.isArray(objectsIDs2OCIDs[row.objectID])" because once objectsIDs2OCIDs[row.objectID] was undefined
                    if((typeof mode === "number" && row.mode !== mode) || !Array.isArray(objectsIDs2OCIDs[row.objectID])) return;
                    objectsIDs2OCIDs[row.objectID].forEach(function (OCID) {
                        //  if you need you can uncomment any props
                        res.push({
                            OCID: OCID,
                            name: row.name,
                            value: row.value,
                            //mode: row.mode,
                            //objectID: row.objectID,
                            //description: row.description,
                            //id: row.id
                        });
                    });
                });
                return callback(null, res);
            });
        });
    });
}

/** Get object property by property name (SQL LIKE sintaxis)
 *
 * @param {string} user - username for check right for objects
 * @param {string} propertyName - SQL Like property name (wildcards: "%" any simbols, "_" one simbol, "\\";"\%";"\_" - for escape)
 * @param {function(Error)|function(null, Array)} callback - return error or an Array with object properties
 * [{objectName:..., objectID:..., propName:..., propVal:..., propMode:... propDescription:...}, ....]
 */

rightsWrapper.getObjectsForProperty = function(user, propertyName, callback) {

    if(!propertyName || typeof propertyName !== 'string') {
        return callback(new Error('Getting objects for property: unknown property name: ' + JSON.stringify(propertyName)));
    }

    objectsPropertiesDB.getObjectsForProperty(propertyName, function(err, rows) {
        if(err) return callback(new Error('Getting objects for property error: ' + err.message));

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: rows.map(row => row.objectID),
            checkVew: true,
            errorOnNoRights: false
        }, function(err, checkedObjectsIDs) {
            if(err) return callback('Getting objects for property error while checking objects rights: ' + err.message);

            callback(null, rows.filter(row => checkedObjectsIDs.indexOf(row.objectID) !== -1));
        });
    })
};


/** Save properties for specific objects. !! Use transaction in a parent function
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} objectsIDs - array or comma separated string with objects IDs
 * @param {Object} propertiesForSave - properties for save [{name:..., mode:..., value:..., description:...}, ...]
 * @param {boolean} [deleteNotListedProperties] - if true, then delete properties, which not listed in "properties" array for use in automatic tasks
 * @param {function(Error)|function(null, Array, Object)} callback - return error or callback(null, objetIDs, properties)
 * where objectIDs is an Array of modified object IDs, properties is an object with information about properties
 * modification
 * @example
 * // returned properties object
 * {
 *      insert: {<objectID1>: propertyForSave1 ,...}, // props for insert
 *      update: {<objectID1>: propertyForSave1 ,...}, // props for update
 *      updateDescription: propertiesForSave, // properties with different descriptions,
 *      deleteShared: deleteNotListedProperties ? Object.keys(sharedPropertiesNamesForDelete) : undefined,
 *      shared: {<objectID1>: propertyForSave1 ,...}, // sharedPropertiesNamesForDelete
 * }
 */

rightsWrapper.saveObjectsProperties = function (user, objectsIDs, propertiesForSave, deleteNotListedProperties, callback) {

    log.debug('Saving properties: ', propertiesForSave, ' for objectsIDs: ', objectsIDs);

    sortProperties(user, objectsIDs, propertiesForSave, deleteNotListedProperties, function(err, properties) {
        if(err) return callback(err);

        var updatedObjectsIDs = {};
        async.eachSeries(objectsIDs, function (objectID, callback) {
            if(!properties.update[objectID] && !properties.updateDescription[objectID] &&
                !properties.insert[objectID] && (!deleteNotListedProperties ||
                (deleteNotListedProperties && (!properties.deleteShared || !properties.deleteShared.length)))) return callback();

            async.series([
                function (callback) {
                    if(!properties.update[objectID]) return callback();
                    updatedObjectsIDs[objectID] = objectID;
                    objectsPropertiesDB.updateProperties(objectID, Object.values(properties.update[objectID]), callback);
                }, function (callback) {
                    if(!properties.updateDescription[objectID]) return callback();
                    objectsPropertiesDB.updateProperties(objectID, Object.values(properties.updateDescription[objectID]), callback);
                }, function (callback) {
                    if(!properties.insert[objectID]) return callback();
                    updatedObjectsIDs[objectID] = objectID;
                    objectsPropertiesDB.insertProperties(objectID, Object.values(properties.insert[objectID]), callback)
                }, function (callback) {
                    if(!deleteNotListedProperties || !properties.deleteShared || !properties.deleteShared.length) return callback();
                    updatedObjectsIDs[objectID] = objectID;
                    objectsPropertiesDB.deleteProperties(objectID, properties.deleteShared, callback);
                }
            ], callback);
        }, function (err) {
            delete(properties.shared);
            // for reload properties to the cache
            callback(err, Object.values(updatedObjectsIDs), properties); // use Object.values for save type of objectID as Number
        });
    });
};

/** Sorting properties for saving
 *
 * @param {string} user - username for check right for objects
 * @param {Array|string|number} objectsIDs - array or comma separated string with objects IDs
 * @param {Object} initProperties - properties for sorting [{name:..., mode:..., value:..., description:...}, ...]
 * @param {boolean} [deleteNotListedProperties] - if true, then delete properties, which not listed in "properties" array for use in automatic tasks
 * @param {function(Error)|function(null, Array, Object)} callback - return error or callback(null, objetIDs, properties)
 * where objectIDs is an Array of modified object IDs, properties is an object with information about properties
 * modification
 * @example
 * // returned properties object
 * {
 *      insert: {<objectID1>: propertiyForSave1 ,...}, // props for insert
 *      update: {<objectID1>: propertiyForSave1 ,...}, // props for update
 *      updateDescription: propertiesForSave, // properties with different descriptions,
 *      deleteShared: deleteNotListedProperties ? Object.keys(sharedPropertiesNamesForDelete) : undefined,
 *      shared: {<objectID1>: propertiyForSave1 ,...}, // sharedPropertiesNamesForDelete
 * } */
function sortProperties(user, objectsIDs, initProperties, deleteNotListedProperties, callback) {

    getCachedProperties(user, objectsIDs, true, function(err, rows) {
        if (err) return callback(err);

        var sharedProperties = {};
        initProperties.forEach(function (property) {
            sharedProperties[property.name] = property;
        });

        var allProperties = {},
            propertiesWithDifferentDescriptions = {},
            propertiesForUpdate = {},
            sharedPropertiesNamesForDelete = {},
            propertiesForInsert = {};
        rows.forEach(function (property) {
            var objectID = property.objectID;

            if(!allProperties[objectID]) allProperties[objectID] = {};
            allProperties[objectID][property.name] = property;

            if(sharedProperties[property.name]) {
                var sharedProperty = sharedProperties[property.name];
                // true or false are saved in DB as 1 or 0 and next condition always will be true with those values
                if(typeof sharedProperty.value === 'boolean') sharedProperty.value = Number(sharedProperty.value);
                if (Number(sharedProperty.mode) !== Number(property.mode) || String(sharedProperty.value) !== String(property.value)) {
                    // for debug
                    sharedProperty.oldMode = property.mode;
                    sharedProperty.oldValue = property.value;
                    if(!propertiesForUpdate[objectID]) propertiesForUpdate[objectID] = [sharedProperty];
                    else propertiesForUpdate[objectID].push(sharedProperty);
                } else if(sharedProperty.description !== property.description) {
                    if(!propertiesWithDifferentDescriptions[objectID]) propertiesWithDifferentDescriptions[objectID] = [sharedProperty];
                    else propertiesWithDifferentDescriptions[objectID].push(sharedProperty);
                }
            } else if(deleteNotListedProperties) {
                if(!sharedPropertiesNamesForDelete[property.name]) sharedPropertiesNamesForDelete[property.name] = [property];
                else sharedPropertiesNamesForDelete[property.name].push(property);
            }
        });

        if(deleteNotListedProperties) {
            for (var propertyName in sharedPropertiesNamesForDelete) {
                if (sharedPropertiesNamesForDelete[propertyName].length !== objectsIDs.length)
                    delete sharedPropertiesNamesForDelete[propertyName];
                else {
                    var value = sharedPropertiesNamesForDelete[propertyName][0].value,
                        description = sharedPropertiesNamesForDelete[propertyName][0].description,
                        mode = sharedPropertiesNamesForDelete[propertyName][0].mode;
                    for(var i = 1; i < sharedPropertiesNamesForDelete[propertyName].length; i++) {
                        var property = sharedPropertiesNamesForDelete[propertyName][i];
                        if(value !== property.value || description !== property.description || mode !== property.mode) {
                            delete sharedPropertiesNamesForDelete[propertyName];
                            break;
                        }
                    }
                }
            }
        }
        for(propertyName in sharedProperties) {
            objectsIDs.forEach(function (objectID) {
                if(!allProperties[objectID] || !allProperties[objectID][propertyName]) {
                    if(!propertiesForInsert[objectID]) propertiesForInsert[objectID] = [sharedProperties[propertyName]];
                    else propertiesForInsert[objectID].push(sharedProperties[propertyName]);
                }
            });
        }
        callback(null, {
            insert: propertiesForInsert,
            update: propertiesForUpdate,
            updateDescription: propertiesWithDifferentDescriptions,
            deleteShared: deleteNotListedProperties ? Object.keys(sharedPropertiesNamesForDelete) : undefined,
            shared: sharedPropertiesNamesForDelete
        });
    });
}