/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var async = require('async');
var objectsPropertiesDB = require('../models_db/objectsPropertiesDB');
var objectsDB = require('../models_db/objectsDB');
var rightsDB = require('../models_db/usersRolesRightsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');
var log = require('../lib/log')(module);

var rightsWrapper = {};
module.exports = rightsWrapper;


/*
    getting shared properties for objects with ObjectsIDs

    objectsIDs - array of objects IDs
    callback(err, properties)

    properties [{name:.., value:.., mode:.., description:..}]
 */

rightsWrapper.getSharedProperties = function(user, objectsIDs, callback) {

    checkIDs(objectsIDs, function(err, checkedIDs){
        if(err) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkVew: true,
            errorOnNoRights: true
        }, function(err, checkedObjectsIDs) {
            if(err) return callback(err);

            sortProperties(checkedObjectsIDs, [], true, function(err, obj) {
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
        });
    });
};

/*
    getting all properties for objects with ObjectsIDs

    objectsIDs - array or string with objects IDs
    callback(err, properties)

    properties [{id:.., objectID:.., name:.., value:.., mode:.., description:..}]
 */

rightsWrapper.getProperties = function(user, objectsIDs, callback) {

    checkIDs(objectsIDs, function(err, checkedIDs){
        if(err) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkVew: true,
            errorOnNoRights: true
        }, function(err, checkedObjectsIDs) {
            if(err) return callback(err);

            objectsPropertiesDB.getProperties(checkedObjectsIDs, callback);
        });
    });
};

/*
    getting all properties for objects with OCIDs

    OCIDs - array or string with objects counters IDs
    callback(err, properties)

    properties [{id:.., objectID:.., OCID:..., name:.., value:.., mode:.., description:..}]
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

            user = prepareUser(user);

            rightsDB.checkObjectsIDs({
                user: user,
                IDs: Object.keys(objectsIDs2OCIDs),
                checkView: true,
                errorOnNoRights: false
            }, function (err, checkedObjectsIDs) {
                if (err) {
                    return callback(new Error('Error checking rights for get objects properties for objects IDs  ' +
                        JSON.stringify(objectsIDs2OCIDs) + ': ' + err.message));
                }

                // SELECT * FROM objectsProperties...
                objectsPropertiesDB.getProperties(checkedObjectsIDs, function(err, rows) {
                    if(err) {
                        return callback(new Error('Can\'t get objects properties for objects IDs  ' +
                            JSON.stringify(checkedObjectsIDs) + ': ' + err.message));
                    }

                    var res = [];
                    rows.forEach(row => {
                        // typeof mode === "number" - check for mode is defined
                        // !Array.isArray(objectsIDs2OCIDs[row.objectID]): I dont known how, but once objectsIDs2OCIDs[row.objectID] was undefined
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
    });
}

/*
    getting all properties for objects with ObjectsIDs

    objectsIDs - array or string with objects IDs
    callback(err, properties)

    properties [{id:.., objectID:.., name:.., value:.., mode:.., description:..}]
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


/*
    Save properties for specific objects.

    !! Use transaction in a parent function

    objectsIDs - array or string with objects IDs
    properties: [{name:.., mode:.., value:.., description:..}, ...]
    notShared - if true, then delete properties, which not listed in "properties" array for use in automatic tasks

    callback(err)
 */

rightsWrapper.saveObjectsProperties = function (user, objectsIDs, initProperties, isDeleteNotListedProperties, callback) {

    log.debug('Saving properties: ', initProperties, ' for objectsIDs: ', objectsIDs);

    checkIDs(objectsIDs, function(err, checkedIDs) {
        if (err) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkChange: true,
            errorOnNoRights: true
        }, function (err, checkedObjectsIDs) {
            if (err) return callback(err);

            sortProperties(checkedObjectsIDs, initProperties, isDeleteNotListedProperties, function(err, properties) {
                if(err) return callback(err);

                var updatedObjectsIDs = {};
                async.eachSeries(checkedObjectsIDs, function (objectID, callback) {
                    if(!properties.update[objectID] && !properties.updateDescription[objectID] &&
                        !properties.insert[objectID] && (!isDeleteNotListedProperties ||
                        (isDeleteNotListedProperties && (!properties.deleteShared || !properties.deleteShared.length)))) return callback();

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
                            if(!isDeleteNotListedProperties || !properties.deleteShared || !properties.deleteShared.length) return callback();
                            updatedObjectsIDs[objectID] = objectID;
                            objectsPropertiesDB.deleteProperties(objectID, properties.deleteShared, callback);
                        }
                    ], callback);
                }, function (err) {
                    delete(properties.shared);
                    callback(err, Object.values(updatedObjectsIDs), properties); // use Object.values for save type of objectID as Number
                });
            });
        });
    });
};

function sortProperties(objectsIDs, initProperties, isDeleteNotListedProperties, callback) {
    objectsPropertiesDB.getProperties(objectsIDs, function (err, rows) {
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
            } else if(isDeleteNotListedProperties) {
                if(!sharedPropertiesNamesForDelete[property.name]) sharedPropertiesNamesForDelete[property.name] = [property];
                else sharedPropertiesNamesForDelete[property.name].push(property);
            }
        });

        if(isDeleteNotListedProperties) {
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
            deleteShared: isDeleteNotListedProperties ? Object.keys(sharedPropertiesNamesForDelete) : undefined,
            shared: sharedPropertiesNamesForDelete
        });
    });
}