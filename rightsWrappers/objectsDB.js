/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var objectsDB = require('../models_db/objectsDB');
var objectsDBSave = require('../models_db/modifiers/modifierWapper').objectsDB;
var rightsDB = require('../models_db/usersRolesRightsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');

var rightsWrapper = {};
module.exports = rightsWrapper;

/*
 renaming objects with IDs in initIDs to names in newObjectsNamesStr
 user - user name
 objects - [{id: XX, name: "newObjectName1"}, {..},.... ]
 callback(err)
 */
rightsWrapper.renameObjects = function(user, objects, callback){

    if(!Array.isArray(objects) || !objects.length) return callback();

    var initIDs = objects.map(function(obj){return obj.id});

    checkIDs(initIDs, function(err, checkedIDs) {
        if (err) {
            return callback(new Error('User ' + user + ' try to rename objects with incorrect IDs: ' +
                JSON.stringify(objects) + ': ' + err.message ));
        }

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkChange: true,
            errorOnNoRights: true
        }, function (err) {
            if (err) {
                return callback(new Error('User ' + user + ' has no rights for rename objects ' +
                    JSON.stringify(objects) + ': ' + err.message ));
            }

            objectsDBSave.renameObjects(objects, function(err) {
                if(err) {
                    return callback(new Error('Error while user ' + user +' rename objects ' +
                        JSON.stringify(objects) + ': ' + err.message));
                }

                callback(null, true);
            });
        });
    });
};

/*
 add new objects into a database. Check for existing objects names from newObjectNames array in database
 before inserting and, if found, return error. If no newObjectsNames specified, callback(null, [])

 user - user name
 newObjectNames - array of new objects names
 description - description for new object names
 order - sort position for new objects. Top objects has order < 10 objectsFilterDB.js
 callback(err, newObjectsIDs, newObjects),
 newObjectsIDs - array of a new objects IDs;
 */
rightsWrapper.addObjects = function(user, newObjectsNames, newDescription, newOrder, disabled, color, callback){
    if(!newObjectsNames || !newObjectsNames.length) return callback(null, []);

    //user = prepareUser(user);

    // check for existing objects from newObjectsNames array in database
    objectsDB.getObjectsByNames(newObjectsNames, function(err, row) {
        if (err) return callback(err);

        // if some objects from newObjectsNames array are exists in database, then return error
        if (row && row.length) {
            var existingObjectsNames = row.map(function (obj) {
                return obj.name
            }).join(',');
            return callback(new Error('Some object names already exists in database: ' + existingObjectsNames));
        }

        var [objectsColor, objectsShade] = typeof color === 'string' ? color.split(':') : ['', ''];
        color = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal',
            'green', 'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey',
            'black', 'white', 'transparent'].indexOf((objectsColor || '').toLowerCase()) !== -1 ?
            objectsColor + ':' +
            (/^(lighten)|(darken)|(accent)-[1-4]$/.test((objectsShade || '').toLowerCase()) ? objectsShade : '') :
            null;

        // add a new objects, its description and order
        objectsDBSave.addObjects(newObjectsNames, newDescription, newOrder, (disabled ? 1 : 0), color, callback);
    });
};

/*
 Update description and sort position for objects with IDs
 user - username
 IDs - array of objects IDs
 description - object description one for all
 order - object sort position in a objects menu, one for all.  Top objects has order < 10 objectsFilterDB.js
 callback(err)
 undefined description or order are not updated
 */
rightsWrapper.updateObjectsInformation = function (user, initIDs, description, order, disabled, color, callback){

    if(!initIDs.length) return callback();

    var updateData = {};
    if(disabled !== undefined) updateData.$disabled = Number(disabled) ? 1 : 0;
    if(order !== undefined) updateData.$sortPosition = order;
    if(description !== undefined) updateData.$description = description;
    if(color !== undefined) {
        var [objectsColor, objectsShade] = typeof color === 'string' ? color.split(':') : ['', ''];
        updateData.$color = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal',
            'green', 'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey',
            'black', 'white', 'transparent'].indexOf((objectsColor || '').toLowerCase()) !== -1 ?
            objectsColor + ':' +
            (/^(lighten)|(darken)|(accent)-[1-4]$/.test((objectsShade || '').toLowerCase()) ? objectsShade : '') :
            null;
    }
    if(!Object.keys(updateData).length) return callback();

    checkIDs(initIDs, function(err, checkedIDs) {
        if (err) {
            return callback(new Error('User ' + user + ' try to update objects info with incorrect IDs ' +
                initIDs.join(', ') + '; description: ' + description + '; order: ' + order +
                '; disabled: ' + disabled + '; color: ' + color + ': ' + err.message ));
        }

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkChange: true,
            errorOnNoRights: true
        }, function (err, IDs) {
            if (err) {
                return callback(new Error('User ' + user + ' has no rights when updating objects info for ' +
                    initIDs.join(', ') + '; description: ' + description +
                    '; order: ' + order + '; disabled: ' + disabled +': ' + err.message ));
            }

            objectsDB.getObjectsByIDs(IDs, function (err, rows) {
                if(err) callback(new Error('User ' + user + ' got error when getting objects info for ' +
                    initIDs.join(', ') + ': ' + err.message ));

                var needToUpdate = false, objectNames = rows.map(object => {
                    if((description !== undefined && object.description !== description) ||
                        (order !== undefined && object.sortPosition !== order) ||
                        (disabled !== undefined && object.disabled !== disabled) ||
                        (color !== undefined && object.color !== color)) {
                        needToUpdate = true;
                    }
                    return object.name;
                });

                if(!needToUpdate) return callback(null, null, objectNames);

                objectsDBSave.updateObjectsInformation(IDs, updateData, function(err) {
                    if(err) {
                        return callback(new Error('User ' + user + ' got error when updating objects info for ' +
                            initIDs.join(', ') + '; description: ' + description + '; order: ' + order +
                            '; disabled: ' + disabled + '; color: ' + color + ': ' + err.message ), null, objectNames);
                    }

                    delete(updateData.$id);
                    callback(null, updateData, objectNames);
                });
            });
        });
    });
};


/**
 * Inserting new not existing object interactions
 * @param {string} user - username
 * @param {Array} newInteractions - [{id1: <objectID1>, id2: <objectID2>, type: <interactionType>}];
 *  interaction types: 0 - include; 1 - intersect, 2 - exclude
 * @param {function} callback - callback(err)
 * @returns {*}
 */
rightsWrapper.insertInteractions = function(user, newInteractions, callback) {

    if(!newInteractions.length) {
        log.info('Interactions are not set: ', newInteractions);
        return callback();
    }

    var allInteractedObjectIDs = [];
    newInteractions.forEach(interaction => {
        allInteractedObjectIDs.push(interaction.id1);
        allInteractedObjectIDs.push(interaction.id2);
    });

    checkIDs(allInteractedObjectIDs, function(err, checkedInteractedObjectIDs) {
        if (err && !checkedInteractedObjectIDs) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedInteractedObjectIDs,
            checkChangeInteractions: true,
            errorOnNoRights: true
        }, function (err) {
            if (err) return callback(err);

            objectsDB.getInteractions(checkedInteractedObjectIDs, function(err, existingInteractions) {
                if (err) {
                    return callback(new Error('Can\'t get interactions for check existing interactions for ' +
                        'save only not existing interactions: ' + err.message +
                        '; objectIDs: ' + checkedInteractedObjectIDs.join(',')));
                }

                // will inserted only not existing interactions
                var notExistingNewInteractions = new Set();
                newInteractions.forEach(newInteraction => {
                    // finding existing interaction
                    if(!existingInteractions.some(existingInteraction => {
                        // don't touch it
                        if(existingInteraction.type === newInteraction.type &&
                            (
                                // for inclusion (0), the order of interaction of objects is important
                                // for intersection (1) or exclusion (2), the order of interaction of objects is not important
                                newInteraction.type === 0 &&
                                (
                                    existingInteraction.id1 === newInteraction.id1 &&
                                    existingInteraction.id2 === newInteraction.id2
                                )
                            ) ||
                            (
                                (
                                    existingInteraction.id1 === newInteraction.id1 &&
                                    existingInteraction.id2 === newInteraction.id2
                                ) ||
                                (
                                    existingInteraction.id1 === newInteraction.id2 &&
                                    existingInteraction.id2 === newInteraction.id1
                                )
                            )
                        ) {
                            return true;
                        }
                    })) {
                        notExistingNewInteractions.add(newInteraction);
                    }
                });

                if(!notExistingNewInteractions.size) return callback();

                objectsDBSave.insertInteractions(Array.from(notExistingNewInteractions), function (err) {
                    log.info('Saved not existing interactions: ', notExistingNewInteractions);
                    return callback(err, true);
                });
            });
        });
    });
};


/*
 deleting some objects interactions
 user user name
 interactions = [{id1:<objectID1>, id2: <objectID2>, type: <interactionType>}]
 callback(err)
 */
rightsWrapper.deleteInteractions = function(user, interactionsForDeleting, callback){

    var initIDs = interactionsForDeleting.map(function(obj){ return obj.id1; });
    initIDs.push.apply(initIDs, interactionsForDeleting.map(function(obj){ return obj.id2; }));

    if(!initIDs.length) {
        log.info('No interaction specified for deleting: ', interactionsForDeleting);
        return callback(null, {});
    }

    checkIDs(initIDs, function(err, checkedIDs) {
        if (err && !checkedIDs) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkChangeInteractions: true,
            errorOnNoRights: true
        }, function (err) {
            if (err) return callback(err);
            objectsDBSave.deleteInteractions(interactionsForDeleting, callback);
        });
    });
};

/** Get objects information by object ID
 * @param {string} user - username for check rights to objects
 * @param {Array|string|number} initIDs - array of objects IDs or comma separated string with IDs or single ID
 * @param {function(Error)|function(null, Array)} callback - callback(err, objects) return array of rows with result of SELECT * FROM objects WHERE id=?
 * like [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:..., disabled:..., color:...}, {...},...]
 */
rightsWrapper.getObjectsByIDs = function(user, initIDs, callback) {

    checkIDs(initIDs, function(err, checkedIDs) {
        if (err) return callback(err);
        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkView: true,
            errorOnNoRights: true
        }, function (err, IDs) {
            if (err) return callback(err);

            objectsDB.getObjectsByIDs(IDs, callback);
        });
    });
};


/** Get interactions for specified objects IDs.
 * @param {string} user - username
 * @param {Array} IDs - array of objects IDs
 * @param {function(Error)|function(null, Array)} callback - callback(err, interactions)
 *
 * @example
 * // interactions returned by callback(err, interactions)
 * interactions - [{
 *      name1: <objName1>, description1: <objDescription1>, id1: <id1>,
 *      name2: <objName2>, description2: <objDescription2>, id2: <id2>,
 *      type: <interactionType1>},
 *      {...},...]
 * interaction types: 0 - include; 1 - intersect, 2 - exclude
 * function can be used for less than 999 objects, according  SQLITE_MAX_VARIABLE_NUMBER, which defaults to 999
 * https://www.sqlite.org/limits.html
 */

rightsWrapper.getInteractions = function(user, initIDs, callback){
    checkIDs(initIDs, function(err, checkedIDs) {
        if (err && !checkedIDs) return callback(err);

        user = prepareUser(user);

        objectsDB.getInteractions(checkedIDs, function(err, interactions) {
            if(err) return callback(err);

            // checking rights for returned objects
            var objectsIDs = [];
            interactions.forEach(function(interaction) {
                objectsIDs.push(interaction.id1, interaction.id2)
            });
            rightsDB.checkObjectsIDs({
                user: user,
                IDs: objectsIDs,
                checkView: true,
                errorOnNoRights: true
            }, function (err/*, IDs*/) {

                if(err) return callback(err);

                callback(null, interactions);
            });

        });
    });
};


/*
Getting objectsCountersIDs for specific objects
 user - user name
 objectsIDs - array of objects IDs
 callback(err, OCIDs)

 OCIDs - array of objectsCountersIDs
 */
rightsWrapper.getObjectsCountersIDs = function (user, objectsIDs, callback){

    checkIDs(objectsIDs, function(err, checkedIDs){
        if(err) {
            return callback(new Error('User ' + user + ' try to get OCIDs for incorrect object IDs ' +
                objectsIDs.join(', ') + ': ' + err.message));
        }

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkChange: true, // don't remove it! function used for change counters
            errorOnNoRights: true
        }, function(err, checkedObjectsIDs){
            if(err) {
                return callback(new Error('User ' + user + ' has no rights for getting OCIDs for object IDs ' +
                    objectsIDs.join(', ') + ': ' + err.message));
            }

            objectsDB.getObjectsCountersIDs(checkedObjectsIDs, function(err, rows) {
                if(err) {
                    return callback(new Error('User ' + user + ' got error when getting OCIDs for object IDs ' +
                        objectsIDs.join(', ') + ': ' + err.message));
                }

                callback(null, rows);
                //callback(null, rows.map(function(obj) { return obj.id }));
            });
        });
    });
};

rightsWrapper.getObjectsIDs = function (user, objectsNames, callback) {

    // select * from objects where name like <objectsNames>
    objectsDB.getObjectsLikeNames(objectsNames, function (err, rows) {
        if(err) return callback(new Error('Can\'t get object IDs by names like ' + objectsNames.join(', ') + ': ' + err.message));

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: rows, // can be a [{id:..., name:...}, ....]
            errorOnNoRights: true
        }, function(err, checkedObjectsIDs) {
            if(err) return callback(err);

            callback(null, checkedObjectsIDs);
        });
    });
}

rightsWrapper.addObjectsAlepizRelation = function (user, objectIDs, alepizIDs, callback) {
    if(!objectIDs.length) return callback();

    rightsDB.checkObjectsIDs({
        user: user,
        IDs: objectIDs,
        errorOnNoRights: true
    }, function(err, checkedObjectsIDs) {
        if(err) return callback(err);

        objectsDB.getObjectsAlepizRelationByObjectIDs(checkedObjectsIDs, function (err, rows) {
            if(err) {
                return callback(new Error('Can\'t get objectsAlepizRelations: ' + err.message +
                    '; objectIDs: ' + checkedObjectsIDs.join(', ')));
            }
            var newObjectIDsSet = new Set(checkedObjectsIDs);
            var newAlepizIDsSet = new Set(alepizIDs);
            var objectIDsSet = new Set(), alepizIDsSet = new Set();
            var newObjectsAlepizRelations = [], objectsAlepizRelationsForRemove = [];
            rows.forEach(row => {
                if(!newObjectIDsSet.has(row.objectID) || !newAlepizIDsSet.has(row.alepizID)) {
                    objectsAlepizRelationsForRemove.push({
                        $objectID: row.objectID,
                        $alepizID: row.alepizID,
                    });
                }
                objectIDsSet.add(row.objectID);
                alepizIDsSet.add(row.alepizID);
            });

            checkedObjectsIDs.forEach(objectID => {
                alepizIDs.forEach(alepizID => {
                    if(!objectIDsSet.has(objectID) || !alepizIDsSet.has(alepizID)) {
                        newObjectsAlepizRelations.push({
                            $objectID: objectID,
                            $alepizID: alepizID,
                        });
                    }
                });
            });
            objectsDBSave.deleteObjectsAlepizRelation(objectsAlepizRelationsForRemove, function (err) {
                if(err) {
                    return callback('Can\'t remove objectsAlepizRelations: ' + err.message +
                        ': ', JSON.stringify(objectsAlepizRelationsForRemove));
                }

                objectsDBSave.addObjectsAlepizRelation(newObjectsAlepizRelations, function (err) {
                    if(err) {
                        return callback('Can\'t add objectsAlepizRelations: ' + err.message +
                            ': ', JSON.stringify(newObjectsAlepizRelations));
                    }

                    callback(null, newObjectsAlepizRelations, objectsAlepizRelationsForRemove);
                });
            });
        });
    });
}