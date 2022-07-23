/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../rightsWrappers/countersDB');
var counterDBRaw = require('../../models_db/countersDB');
var counterSaveDB = require('../../models_db/counterSaveDB');
var transactionDB = require('../../models_db/transaction');
var log = require('../../lib/log')(module);
var server = require('../../server/counterProcessor');

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);

    editObjects(args.username, args, callback);
};

// edit objects description, order and interactions
// parameters - parameters, which returned by HTML form
// callback(err, <success message>)
function editObjects(user, param, callback){

    if(!param.o) return callback(new Error('Objects are not selected'));

    try {
        var objects = JSON.parse(param.o) // [{"id": "XX", "name": "name1"}, {..}, ...]
    } catch(err) {
        return callback(new Error('Can\'t parse JSON string with an object parameters "' + param.o + '": ' +
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
        return callback(new Error('Incorrect object ' + param.o));
    }

    if(param.rulesForRenameObjects) {
        try {
            // [{"id": "XX", "name": "newObjectName1"}, {..}, ...]
            var newObjects = JSON.parse(param.rulesForRenameObjects)
        } catch(err) {
            return callback(new Error('Can\'t parse JSON string with a new objects names "' +
                param.rulesForRenameObjects + '": ' + err.message))
        }
    }

    if(param.rulesForRenameObjects && (!Array.isArray(newObjects) || !newObjects.length))
        return callback(new Error('Error while parse JSON string with a new objects names "' +
            param.rulesForRenameObjects + '": result is not an array: ' + String(newObjects)));

    if(param.objectsOrder) {
        var order = Number(param.objectsOrder);
        // parameters.order is 0 for set it unchanged, but in updateObjectsInformation() set order unchanged
        // only if order is undefined
        if(!order) order = undefined;
        else if(order !== parseInt(String(order), 10)) {
            return callback(new Error('Incorrect sort order ' + param.objectsOrder + '. It can be an integer value'))
        }
    }

    // Do not check the rights to counters, because otherwise counters that are not linked to any object
    // will be skipped
    counterDBRaw.getAllCounters(function (err, counterRows) {
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
            if(typeof param.linkedCountersIDs !== 'string' || param.linkedCountersIDs.trim() !== '0') {

                // check for use in the tasks
                if(typeof param.linkedCounterIDsAdd === 'string') {
                    param.linkedCounterIDsAdd.trim().split(',').forEach(counterID => {
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
                if(typeof param.linkedCounterIDsDel === 'string') {
                    param.linkedCounterIDsDel.trim().split(',').forEach(counterID => {
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
                objectsDB.renameObjects(user, newObjects, function (err) {
                    if (err) return transactionDB.rollback(err, callback);

                    if(newObjects && newObjects.length) log.info('Rename objects: ', newObjects);
                    // update description and order for all existing objects
                    objectsDB.updateObjectsInformation(user, objectIDs, param.objectsDescription, order,
                        param.disabled ? 1 : 0, function (err, isObjectsUpdated) {
                        if (err) return transactionDB.rollback(err, callback);
                        if(isObjectsUpdated) {
                            log.info('Update object information: order: ', order,
                                (param.disabled !== '' ? ', disabled: ' + param.disabled : ''),
                                (param.objectsDescription !== '' ? ', description: ' + param.objectsDescription : ''),
                                ', objects: ', objectIDs.map(objectID => objectID2Name[objectID]).join('; '));
                        }
                        if(OCIDsForDelete.size || OCIDsToInsert.size) {
                            log.info('Links for delete: ', Array.from(OCIDsForDeleteHuman).join('; ') || 'none',
                                '. Links to insert: ', Array.from(OCIDsToInsertHuman).join('; ') || 'none');
                        }

                        counterSaveDB.deleteObjectCounterID(Array.from(OCIDsForDelete), function(err) {
                            if (err) return transactionDB.rollback(err, callback);

                            counterSaveDB.saveObjectsCountersIDs(Array.from(OCIDsToInsert), function(err) {
                                if(err) return transactionDB.rollback(err, callback);

                                transactionDB.end(function (err) {
                                    if (err) return callback(err);

                                    // send message for updating collected initial data for objects
                                    if (!param.disabled) {
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
                                            description: 'Object IDs ' + objectIDs.join(', ') +
                                                ' was disabled from "object editor" by user ' + user
                                        });
                                        callback(null, objectIDs.join(','));
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