/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../rightsWrappers/countersDB');
var rawCountersDB = require('../../models_db/countersDB');
var rawObjectsDB = require('../../models_db/objectsDB');
var counterSaveDB = require('../../models_db/modifiers/modifierWapper').countersDB;
var transactionDB = require('../../models_db/modifiers/transaction');
var log = require('../../lib/log')(module);
var server = require('../../server/counterProcessor');
const Conf = require("../../lib/conf");
const confServer = new Conf('config/server.json');


module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);

    editObjects(args.username, args, callback);
};

// edit objects description, order and interactions
// parameters - parameters, which returned by HTML form
// callback(err, <success message>)
function editObjects(user, args, callback){

    if(!args.o) return callback(new Error('Objects are not selected'));

    try {
        var objects = JSON.parse(args.o) // [{"id": "XX", "name": "name1"}, {..}, ...]
    } catch(err) {
        return callback(new Error('Can\'t parse JSON string with an object parameters "' + args.o + '": ' +
            err.message));
    }

    var objectID2Name = {};
    var objectIDs = objects.map(function(obj) {
        if(obj.id) {
            objectID2Name[obj.id] = obj.name;
            return Number(obj.id);
        }
        else return 0;
    }).filter(function(id) {
        return (id === parseInt(id, 10) && id > 0); // return only integer objectIDs > 0
    });

    if(!objectIDs.length || objectIDs.length !== objects.length) {
        return callback(new Error('Incorrect object ' + args.o));
    }

    if(args.rulesForRenameObjects) {
        try {
            // [{"id": "XX", "name": "newObjectName1"}, {..}, ...]
            var newObjects = JSON.parse(args.rulesForRenameObjects)
        } catch(err) {
            return callback(new Error('Can\'t parse JSON string with a new objects names "' +
                args.rulesForRenameObjects + '": ' + err.message))
        }
    }

    if(args.rulesForRenameObjects && (!Array.isArray(newObjects) || !newObjects.length))
        return callback(new Error('Error while parse JSON string with a new objects names "' +
            args.rulesForRenameObjects + '": result is not an array: ' + String(newObjects)));

    var description = objectIDs.length > 1 && args.objectsDescription === '' ? undefined : args.objectsDescription;
    var disabled = args.disabled !== '' ? args.disabled : undefined;

    if(args.objectsOrder) {
        var order = Number(args.objectsOrder);
        // when parameters.objectsOrder is 0, the order should remain unchanged, but in updateObjectsInformation(),
        // the order will remain unchanged if the parameters.objectsOrder is undefined
        if(!order) order = undefined;
        else if(order !== parseInt(String(order), 10) || isNaN(order)) {
            return callback(new Error('Incorrect sort order ' + args.objectsOrder + '. It can be an integer value'))
        }
    }

    // color will be unchanged if color is undefined. args.objectsColor !== undefined for old tasks
    var color = args.objectsColor !== '0' && args.objectsColor !== undefined ?
        args.objectsColor + ':' + args.objectsShade : undefined;

    // Do not check the rights to counters, because otherwise counters that are not linked to any object
    // will be skipped
    rawCountersDB.getAllCounters(function (err, counterRows) {
        if(err) return callback(err);

        var counterID2Name = {};
        counterRows.forEach(counter => { counterID2Name[counter.id] = counter.name });

        countersDB.getCountersForObjects(user, objectIDs, null, function(err, objectsCountersLinkage) {
            if (err) return callback(err);

            var countersObjectsLinkage = {};
            objectsCountersLinkage.forEach(counter => {
                if (!countersObjectsLinkage[counter.id]) countersObjectsLinkage[counter.id] = {};
                countersObjectsLinkage[counter.id][counter.objectID] = counter.OCID;
            });

            var OCIDsToInsert = new Set(), OCIDsForDelete = new Set();
            var OCIDsToInsertHuman = new Set(), OCIDsForDeleteHuman = new Set();
            // set linkedCountersIDs to 0 in task for disable counter linkage operations
            if(typeof args.linkedCountersIDs !== 'string' || args.linkedCountersIDs.trim() !== '0') {

                // check for use in the tasks
                if(typeof args.linkedCounterIDsAdd === 'string') {
                    args.linkedCounterIDsAdd.trim().split(',').forEach(counterID => {
                        objectIDs.forEach(objectID => {
                            if (Number(counterID) > 0 && Number(objectID) > 0 &&
                                (!countersObjectsLinkage[counterID] || !countersObjectsLinkage[counterID][objectID])) {
                                OCIDsToInsert.add({
                                    objectID: Number(objectID),
                                    counterID: Number(counterID),
                                });
                                OCIDsToInsertHuman.add(objectID2Name[objectID] + ' #' + objectID + ' => ' +
                                    counterID2Name[counterID] + ' #' + counterID);
                            }
                        });
                    });
                }

                // check for use in the tasks
                if(typeof args.linkedCounterIDsDel === 'string') {
                    args.linkedCounterIDsDel.trim().split(',').forEach(counterID => {
                        objectIDs.forEach(objectID => {
                            if (countersObjectsLinkage[counterID] && countersObjectsLinkage[counterID][objectID]) {
                                OCIDsForDelete.add({
                                    objectID: Number(objectID),
                                    counterID: Number(counterID),
                                });
                                OCIDsForDeleteHuman.add(objectID2Name[objectID] + ' #' + objectID + ' => ' +
                                    counterID2Name[counterID] + ' #' + counterID);
                            }
                        });
                    });
                }
            }

            transactionDB.begin(function (err) {
                if (err) {
                    return callback(new Error('Error begin transaction for edit objects ' + String(newObjects) +
                        ': ' + err.message));
                }

                // [{"id": "XX", "name": "newObjectName1"}, {..}, ...]
                objectsDB.renameObjects(user, newObjects, function (err, isObjectRenamed) {
                    if (err) return transactionDB.rollback(err, callback);
                    if(isObjectRenamed) {
                        log.info('Rename ', Object.values(objectID2Name), ' to ', newObjects.map(o=>o.name));
                    }

                    if(newObjects && newObjects.length) log.info('Rename objects: ', newObjects);
                    // update description and order for all existing objects
                    objectsDB.updateObjectsInformation(user, objectIDs, description, order, disabled, color,
                        function (err, updateData) {
                        if (err) return transactionDB.rollback(err, callback);
                        if(updateData) {
                            log.info(Object.values(objectID2Name) + ': update object information: ', updateData);
                        }
                        if(OCIDsForDelete.size || OCIDsToInsert.size) {
                            log.info(Object.values(objectID2Name) +
                                ': links for delete: ', Array.from(OCIDsForDeleteHuman).join('; ') || 'none',
                                '; links to insert: ', Array.from(OCIDsToInsertHuman).join('; ') || 'none');
                        }

                        counterSaveDB.deleteObjectCounterID(Array.from(OCIDsForDelete), function(err) {
                            if (err) return transactionDB.rollback(err, callback);

                            counterSaveDB.saveObjectsCountersIDs(Array.from(OCIDsToInsert), function(err) {
                                if(err) return transactionDB.rollback(err, callback);

                                // param.alepizIDs === '' - remove alepizIDs
                                // param.alepizIDs === '-1' - save alepizIDs unchanged
                                var objectIDsForRelationships = args.alepizIDs !== '-1' ? objectIDs : [];
                                var alepizIDs = args.alepizIDs && args.alepizIDs !== '-1' ?
                                    args.alepizIDs.split(',').map(id => parseInt(id, 10)) : [];

                                objectsDB.addObjectsAlepizRelation(user, objectIDsForRelationships, alepizIDs,
                                    function(err, newObjectsAlepizRelations, objectsAlepizRelationsForRemove) {
                                    if(err) return transactionDB.rollback(err, callback);

                                        if(newObjectsAlepizRelations && newObjectsAlepizRelations.length) {
                                            log.info(Object.values(objectID2Name) +
                                                ': add object to Alepiz relations: ', newObjectsAlepizRelations);
                                        }

                                        if(objectsAlepizRelationsForRemove && objectsAlepizRelationsForRemove.length) {
                                            log.info(Object.values(objectID2Name) +
                                                ': remove object to Alepiz relations: ', objectsAlepizRelationsForRemove);
                                        }


                                        transactionDB.end(function (err) {
                                        if (err) return callback(err);

                                        rawObjectsDB.getAlepizIDs(function (err, alepizIDsObj) {
                                            if(err) return callback(err);

                                            var alepizID2Name = {};
                                            alepizIDsObj.forEach(row => { alepizID2Name[row.id] = row.name});
                                            var alepizNames = confServer.get('alepizNames');
                                            var ownerOfUnspecifiedAlepizIDs = alepizNames.indexOf(null) !== 1;
                                            var ownerOfSpecifiedAlepizIDs = alepizIDs.some(alepizID => {
                                                return alepizNames.indexOf(alepizID2Name[alepizID]) !== -1;
                                            });
                                            //console.log('!!!', param.disabled, alepizIDs, ownerOfUnspecifiedAlepizIDs, ownerOfSpecifiedAlepizIDs)
                                            var objectsAreEnabled = !args.disabled &&
                                                ((!alepizIDs.length && ownerOfUnspecifiedAlepizIDs) ||
                                                    ownerOfSpecifiedAlepizIDs);
                                            // send message for updating collected initial data for objects
                                            if (objectsAreEnabled) {
                                                server.sendMsg({
                                                    update: {
                                                        topObjects: true,
                                                        objectsCounters: true
                                                    },
                                                    updateObjectsIDs: objectIDs
                                                });
                                                return callback(null, objectIDs.join(','));
                                            }

                                            // object disabled. remove counters
                                            objectsDB.getObjectsCountersIDs(user, objectIDs, function (err, rows) {
                                                if (err) return callback(err);

                                                var OCIDs = rows.map(row => row.id);
                                                if (OCIDs.length) server.sendMsg({
                                                    removeCounters: OCIDs,
                                                    description: 'Objects were disabled from the "object editor" by user ' +
                                                        user + '. Object names: ' + Object.values(objectID2Name).join('; ')
                                                });
                                                callback(null, objectIDs.join(','));
                                            });

                                        })
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}