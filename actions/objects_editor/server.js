/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../rightsWrappers/countersDB');
var counterSaveDB = require('../../models_db/counterSaveDB');
var transactionDB = require('../../models_db/transaction');
var log = require('../../lib/log')(module);
var server = require('../../server/counterProcessor');

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);

    try {
        editObjects(args.username, args, callback);
    } catch(err){
        callback(err);
    }
};

// edit objects description, order and interactions
// parameters - parameters, which returned by HTML form
// callback(err, <success message>)
function editObjects(user, parameters, callback){

    if(!parameters.o) return callback(new Error('Objects are not selected'));

    try {
        var objects = JSON.parse(parameters.o) // [{"id": "XX", "name": "name1"}, {..}, ...]
    } catch(err) {
        return callback(new Error('Can\'t parse JSON string with a objects parameters "' + parameters.o + '": ' + err.message));
    }

    var objectsIDs = objects.map(function(obj) {
        if(obj.id) return Number(obj.id);
        else return 0;
    }).filter(function(id) {
        return (id && id === parseInt(id, 10)); // return only integer objectsIDs > 0
    });

    if(!objectsIDs.length || objectsIDs.length !== objects.length) return callback(new Error('Incorrect object ' + parameters.o));

    if(parameters.rulesForRenameObjects) {
        try {
            var newObjects = JSON.parse(parameters.rulesForRenameObjects) // [{"id": "XX", "name": "newObjectName1"}, {..}, ...]
        } catch(err) {
            return callback('Can\'t parse JSON string with a new objects names "' + parameters.rulesForRenameObjects + '": ' + err.message)
        }
    }

    if(parameters.rulesForRenameObjects && (!Array.isArray(newObjects) || !newObjects.length))
        return callback('Error while parse JSON string with a new objects names "' +
            parameters.rulesForRenameObjects + '": result is not an array: ' + String(newObjects));

    if(parameters.objectsOrder) {
        var order = Number(parameters.objectsOrder);
        if(!order) order = undefined; // parameters.order is 0 for set it unchanged, but in updateObjectsInformation() set order unchanged only if order is undefined
        else if(order !== parseInt(String(order), 10)) return callback(new Error('Incorrect sort order ' + parameters.objectsOrder + '. It can be an integer value'))
    }

    countersDB.getCountersForObjects(user, objectsIDs, null, function(err, objectsCountersLinkage) {
        if (err) return callback(err);

        var countersObjectsLinkage = {}, OCIDsForDelete = [], OCIDsToInsert = [],
            newCountersIDs = typeof parameters.linkedCountersIDs === 'string' ? parameters.linkedCountersIDs.split(',') : [];

        if(typeof parameters.linkedCountersIDs === 'string' && parameters.linkedCountersIDs.trim() !== '0') {
            objectsCountersLinkage.forEach(function (counter) {
                if (!countersObjectsLinkage[counter.id]) countersObjectsLinkage[counter.id] = {};
                countersObjectsLinkage[counter.id][counter.objectID] = counter.OCID;

                if (Object.keys(countersObjectsLinkage[counter.id]).length === objectsIDs.length) {
                    if (newCountersIDs.indexOf(String(counter.id)) === -1) {
                        for (var objectID in countersObjectsLinkage[counter.id]) {
                            OCIDsForDelete.push({
                                objectID: Number(objectID),
                                counterID: counter.id
                            });
                        }
                    }
                }
            });

            newCountersIDs.forEach(function (counterID) {
                if (Number(counterID) !== parseInt(counterID, 10)) return;

                objectsIDs.forEach(function (objectID) {
                    if (!countersObjectsLinkage[counterID] || !countersObjectsLinkage[counterID][objectID]) {
                        OCIDsToInsert.push({
                            objectID: Number(objectID),
                            counterID: Number(counterID)
                        });
                    }
                })
            });
        }

        transactionDB.begin(function (err) {
            if (err) return callback(new Error('Error begin transaction for edit objects ' + String(newObjects) + ': ' + err.message));

            // [{"id": "XX", "name": "newObjectName1"}, {..}, ...]
            objectsDB.renameObjects(user, newObjects, function (err) {
                if (err) return transactionDB.rollback(err, callback);

                if(newObjects && newObjects.length) log.info('Rename objects: ', newObjects);
                // update description and order for all existing objects
                objectsDB.updateObjectsInformation(user, objectsIDs, parameters.objectsDescription, order, parameters.disabled ? 1 : 0, function (err, isObjectsUpdated) {
                    if (err) return transactionDB.rollback(err, callback);
                    if(isObjectsUpdated) log.info('Update object information: order: ', order, ', disabled: ', parameters.disabled, ', description: ', parameters.objectsDescription);
                    if(OCIDsForDelete.length || OCIDsToInsert.length) log.info('Links for delete: ', OCIDsForDelete, '. Links to insert: ', OCIDsToInsert);

                    counterSaveDB.deleteObjectCounterID(OCIDsForDelete, function(err) {
                        if (err) return transactionDB.rollback(err, callback);

                        counterSaveDB.saveObjectsCountersIDs(OCIDsToInsert, function(err) {
                            if(err) return transactionDB.rollback(err, callback);

                            transactionDB.end(function (err) {
                                if (err) return callback(err);

                                // send message for updating collected initial data for objects
                                if (!parameters.disabled) {
                                    server.sendMsg({
                                        update: {
                                            topObjects: true,
                                            objectsCounters: true
                                        },
                                        updateObjectsIDs: objectsIDs
                                    });
                                    return callback(null, objectsIDs.join(','));
                                }

                                // object disabled. remove counters
                                objectsDB.getObjectsCountersIDs(user, objectsIDs, function (err, rows) {
                                    if (err) return callback(err);

                                    var OCIDs = rows.map(row => row.id);
                                    if (OCIDs.length) server.sendMsg({
                                        removeCounters: OCIDs,
                                        description: 'Objects IDs ' + objectsIDs.join(', ') + ' was disabled from "object editor" by user ' + user
                                    });
                                    callback(null, objectsIDs.join(','));
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}