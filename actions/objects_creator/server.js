/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */
var rightsWrapper = require('../../rightsWrappers/objectsDB');
var transactionDB = require('../../models_db/transaction');
var log = require('../../lib/log')(module);

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);
    try {
        addNewObjects(args.username, args, callback);
    } catch(err){
        callback(err);
    }
};


// Add new objects with description, order and interactions
// parameters - parameters, which returned by HTML form
// callback(err, <success message>)
function addNewObjects(user, parameters, callback){

    if(!parameters.objectsNames) return callback(new Error('New objects names are not specified: ' + parameters.objectsNames));

    var newUncheckedObjectsNames = parameters.objectsNames.split(/\s*?[,;]\s*?/);
    if(!Array.isArray(newUncheckedObjectsNames)) newUncheckedObjectsNames = [parameters.objectsNames];

    var newObjectsNames = newUncheckedObjectsNames.filter(function(name) {
        if (!name || /[%\n\r]/.test(name) || /__/.test(name)) {
            log.error('Can\'t adding object name "' + name + '": Name contain incorrect symbols, such as "%", "\\r", "\\n", "__"');
            return false;
        }
        return true;
    });

    if(!newObjectsNames.length) return callback(new Error('New objects names are not specified or incorrect: ' + newUncheckedObjectsNames));

    var description = parameters.objectsDescription;
    var order = Number(parameters.objectsOrder);
    var disabled = parameters.disabled; // check disabled value at rightsWrapper.addObjects

    if(order !== parseInt(String(order), 10)) return callback(new Error('Incorrect objects order: ' + parameters.objectsOrder));

    if(parameters.o) { // string '[{"name": "name1", "id": "XX"}, {"name": "name2", "id": "YY"},....]'
        try {
            var upLevelObjects = JSON.parse(parameters.o);
        } catch(err) {
            return callback(new Error('Can\'t parse JSON string with up level objects: "' + parameters.o + '": ' + err.message));
        }

        var upLevelObjectsIDs = upLevelObjects.map(function(obj) {
            if(obj.id) return Number(obj.id);
            return 0;
        }).filter(function(id){
            return (id && id === parseInt(id, 10)); // return only integer and defined and not 0
        });
    }

    // Top objects has order < 10 objectsFilterDB.js
    if(!upLevelObjectsIDs.length && order > 9) {
        return callback(new Error('Up level objects are not set: ' + upLevelObjectsIDs +
            ' and object order is not set for top object: ' + order + ' >= 10'));
    }

    log.debug('Adding new object[s] ', newObjectsNames, ' with description: ', description, ' and sort order ', order, '; up level objects: ', upLevelObjects);

        // before prepare arrays with interactions to inserting or deleting, insert all new objects into a database
        // for gets objects IDs (newObjectsIDs array), witch will be used when inserting interactions
    transactionDB.begin(function(err) {
        if (err) return callback(new Error('Error begin transaction for editing or adding objects: ' + err.message));

        // add a new objects, its description and order
        //  Top objects has order < 10 objectsFilterDB.js
        rightsWrapper.addObjects(user, newObjectsNames, description, order, disabled, function (err, newObjectsIDs) {
            if (err) {
                log.error('Error adding new object[s] ', newObjectsNames, ' with description: ', description,
                    ' and sort order ', order, ': ', err.message);
                return transactionDB.rollback(err, callback);
            }

            // no up level objects for include a new objects in
            if(!upLevelObjectsIDs.length) {
                transactionDB.end(function(err) {
                    if(err) return callback(err);

                    log.info('Added new object[s] ', newObjectsNames, ' with description: ', description, ' and sort order ', order);
                    // because in case with newObjectsIDs.join(',') and one object it return id as string, i.e. "12"
                    if(newObjectsIDs.length === 1) callback(null, newObjectsIDs[0]);
                    else callback(null, newObjectsIDs.join(','));
                });
                return;
            }

            // create interactions array for a new objects and up level objects
            var interactionsForInserting = [];
            upLevelObjectsIDs.forEach(function(upLevelObjectID) {
                newObjectsIDs.forEach(function(newObjectID){
                    interactionsForInserting.push({id1: upLevelObjectID, id2: newObjectID, type: 0})
                });
            });

            rightsWrapper.insertInteractions(user, interactionsForInserting, function (err) {

                if (err) return transactionDB.rollback(err, callback);
                transactionDB.end(function(err) {
                    if(err) return callback(err);
                    log.info('Added new object[s] ', newObjectsNames, ' with description: ', description, ' and sort order ', order, '; up level objects: ', upLevelObjects);
                    // because in case with newObjectsIDs.join(',') and one object it return id as string, i.e. "12"
                    if(newObjectsIDs.length === 1) callback(null, newObjectsIDs[0]);
                    else callback(null, newObjectsIDs.join(','));
                });
            });
        });
    });
}
