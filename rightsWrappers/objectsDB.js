/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var objectsDB = require('../models_db/objectsDB');
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

            objectsDB.renameObjects(objects, function(err) {
                if(err) {
                    return callback(new Error('Error while user ' + user +' rename objects ' +
                        JSON.stringify(objects) + ': ' + err.message));
                }
                callback();
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
 callback(err, newObjectsIDs),
 newObjectsIDs - array of a new objects IDs;
 */
rightsWrapper.addObjects = function(user, newObjectsNames, newDescription, newOrder, disabled, callback){
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

        // add a new objects, its description and order
        objectsDB.addObjects(newObjectsNames, newDescription, newOrder, (disabled ? 1 : 0), callback);
    });
};

/*
 Update description and sort position for objects with IDs
 user - user name
 IDs - array of objects IDs
 description - object description one for all
 order - object sort position in a objects menu, one for all.  Top objects has order < 10 objectsFilterDB.js
 callback(err)
 undefined description or order are not updated
 */
rightsWrapper.updateObjectsInformation = function (user, initIDs, description, order, disabled, callback){

    if((description === undefined && order === undefined && disabled === undefined) || !initIDs.length) return callback();

    checkIDs(initIDs, function(err, checkedIDs) {
        if (err) {
            return callback(new Error('User ' + user + ' try to update objects info with incorrect IDs ' +
                initIDs.join(', ') + '; description: ' + description +
                 '; order: ' + order + '; disabled: ' + disabled +': ' + err.message ));
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

            objectsDB.updateObjectsInformation(IDs, description, order, disabled, function(err, res) {
                if(err) {
                    return callback(new Error('User ' + user + ' got error when updating objects info for ' +
                        initIDs.join(', ') + '; description: ' + description +
                        '; order: ' + order + '; disabled: ' + disabled +': ' + err.message ), res);
                }

                callback(null, res); // res = true or undefined
            });
        });
    });
};

/*
 inserting new objects interactions
 user - user name
 interactions = [{id1: <objectID1>, id2: <objectID2>, type: <interactionType>}]
 callback(err)
 */
rightsWrapper.insertInteractions = function(user, interactionsForInserting, callback) {

    if(!interactionsForInserting.length) {
        log.info('Interactions are not set: ', interactionsForInserting);
        return callback(null, {});
    }

    var initIDs = interactionsForInserting.map(function(obj){ return obj.id1; });
    initIDs.push.apply(initIDs, interactionsForInserting.map(function(obj){ return obj.id2; }));

    if(!initIDs.length) {
        log.info('Interactions are not set: ', interactionsForInserting);
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
            objectsDB.insertInteractions(interactionsForInserting, callback);
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
            objectsDB.deleteInteractions(interactionsForDeleting, callback);
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

/*
 get interactions for specified objects IDs
 user - user name
 IDs - array of objects IDs
 callback(err, interactions), where
 interactions - [{
                  name1: <objName1>, description1: <objDescription1>, id1: <id1>,
                  name2: <objName2>, description2: <objDescription2>, id2: <id2>,
                  type: <interactionType1>},
                  {...},...]
 interaction types: 0 - include; 1 - intersect, 2 - exclude
*/
rightsWrapper.getInteractions = function(user, initIDs, callback){
    checkIDs(initIDs, function(err, checkedIDs) {
        if (err && !checkedIDs) return callback(err);

        user = prepareUser(user);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            checkView: true,
            errorOnNoRights: true
        }, function (err, IDs) {
            if (err) return callback(err);

            objectsDB.getInteractions(IDs, function(err, interactions) {
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