/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */
var async = require('async');
var rightsWrapper = require('../../rightsWrappers/objectsDB');
var transactionDB = require('../../models_db/transaction');
var log = require('../../lib/log')(module);
var server = require('../../lib/server');

// interaction types: 0 - include; 1 - intersect, 2 - exclude

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);
    try {
        editObjectsInteractions(args.username, args, callback);
    } catch(err){
        callback(err);
    }
};

// edit objects interactions
//
// user - user name
// parameters - parameters from HTML form
// callback(err)
function editObjectsInteractions(user, args, callback){

    if(args.objectsIDs) {
        if(typeof args.objectsIDs === 'string') var IDs = args.objectsIDs.split(/\s*[,;]\s*/);
        else if (Number(args.objectsIDs) === parseInt(String(args.objectsIDs), 10)) IDs = [Number(args.objectsIDs)];
    } else {// if objects are not set in args.objectsIDs then try to get objects from args.o  (this easy to use in tasks)
        if(!args.o) return callback(new Error('Objects are not selected'));

        try {
            var objects = JSON.parse(args.o); // [{"id": "XX", "name": "name1"}, {..}, ...]
        } catch(err) {
            return callback(new Error('Can\'t parse JSON string with a objects parameters "' + args.o + '": ' + err.message));
        }

        if(!objects || !Array.isArray(objects) || !objects.length) return callback(new Error('Objects are incorrect or not defined: ' + args.o));

        IDs = objects.map(function(obj) {
            return Number(obj.id);
        });

        args.objectsIDs = args.o; // for simple use in log
    }

    if(!IDs || !Array.isArray(IDs) || !IDs.length) return callback(new Error('Objects are not defined or incorrect: ' + args.objectsIDs));

    // getting existing intersections for objects from database for check, what intersection we have to insert and
    // what we have to delete
    rightsWrapper.getInteractions(user, IDs, function(err, existingInteractions){
        /*
         existingInteractions = [{
                    name1: <objName1>, description1: <objDescription1>, id1: <id1>,
                    name2: <objName2>, description2: <objDescription2>, id2: <id2>,
                    type: <interactionType1>},
                {...},...]
                interaction types: 0 - include; 1 - intersect, 2 - exclude
        */
        if(err) return callback(err);


        //log.info('Editing interaction for objects: ', args.objectsIDs);

        // creating arrays with interactions: interactionsForInserting and interactionsForDeleting

        // select interactions from returned parameters and push it into the "interactions" array as object
        // [{id1: <objectID1>, interactObjectID: <objectID2>, type: <interactionType>}, {...}, ...]
        // interactionType: 0,1,2,101 (different),100,102
        var interactionsTypes = {include: 0, intersect: 1, included: 100, exclude: 2, excluded: 102, different: 101};
        var interactions = [];
        for (var key in args) {
            if(!args.hasOwnProperty(key) || key.indexOf('interact_') !== 0) continue;

            // checking for format of parameter interact_<XXX> = <interactionType>:<objectID>
            if(!/^.+?:\d+$/.test(args[key])) {
                log.error('Error while parse interaction "', args[key] ,'" (waiting for <interactionType>:<objectID>). Skip interaction for: ', args.objectsIDs, ' to ', key);
                continue;
            }

            var typeAndObjectID = args[key].split(':');

            var type = interactionsTypes[typeAndObjectID[0]];
            if(type === undefined) {
                log.error('Unknown interaction type "', args[key] ,'". Skip interaction for: ', args.objectsIDs, ' to ', key);
                continue;
            }

            var interactObjectID = Number(typeAndObjectID[1]);
            if( interactObjectID !== parseInt(String(interactObjectID), 10) || !interactObjectID) { // if interactObjectID is not an integer, continue
                log.error('Unknown ID of the interaction object in ', key, '. Objects: ', args.objectsIDs, ', type: ', args[key]);
                continue;
            }

            for(var i = 0; i < IDs.length; i++) {
                var baseObjectID = Number(IDs[i]);
                if(!baseObjectID || baseObjectID !== parseInt(String(baseObjectID), 10)) {  // if IDs[i] is not an integer, then skip it
                    log.error('Incorrect object ID ', IDs[i]);
                    continue;
                }

                //log.debug('interactObjectID: ', interactObjectID, ', baseObjectID: ', baseObjectID, ', type: ', type);

                if(type === 100 || type === 102) interactions.push({id1: interactObjectID, id2: baseObjectID, type: (type-100)});
                else interactions.push({id1: baseObjectID, id2: interactObjectID, type: type});
            }
        }

        // search equal interactions in existingInteractions and interactions arrays and add to insertion only interactions,
        // which doesn't present in existingInteractions array and present in interactions array
        // and add it array to interactionsForInserting array with a new objects
        var interactionsForInserting = interactions.filter(function(newInteraction) {
            for(var i = 0; i < existingInteractions.length; i++) {
                var existingInteraction = existingInteractions[i];
                // don't inserting intersections with different types (101). It's can't be a new interactions
                if( newInteraction.type === 101 ||
                    // also don't inserting interactions, witch presents in existingInteractions
                    (existingInteraction.id1 === newInteraction.id1 && existingInteraction.id2 === newInteraction.id2 && existingInteraction.type === newInteraction.type) ||
                    // also don't inserting interactions with type 1 (intersections) and with reversed equal
                    // objects IDs in "existingInteractions" and "intersections" arrays
                    (existingInteraction.id1 === newInteraction.id2 && existingInteraction.id2 === newInteraction.id1 && existingInteraction.type === 1 && newInteraction.type === 1)) return false;
            }
            // inserting all other interactions
            return true;
        });

        if(args.deleteOtherInteractions !== '' && Number(args.deleteOtherInteractions) !== 0) {
            // search equals interactions in existingInteractions and interactions arrays and add to deletion only interactions,
            // which doesn't present in interactions array and present in existingInteractions array
            var interactionsForDeleting = existingInteractions.filter(function (existingInteraction) {
                for (var i = 0; i < interactions.length; i++) {
                    var newInteraction = interactions[i];
                    // don't deleting all interactions, which equals and presents in "interactions" array and
                    // "existingInteractions" array.
                    // Also don't deleting, if type in "intersection" array set to 101 (different) and objects IDs are equals to
                    // objects IDs in existingInteractions array
                    if ((newInteraction.id1 === existingInteraction.id1 && newInteraction.id2 === existingInteraction.id2 &&
                        (newInteraction.type === existingInteraction.type || newInteraction.type === 101)) ||
                        // also don't deleting interactions with type 1 (intersections) and with reversed equal
                        // objects IDs in "existingInteractions" and "intersections" arrays
                        (newInteraction.id1 === existingInteraction.id2 && newInteraction.id2 === existingInteraction.id1 &&
                            ((newInteraction.type === 1 && existingInteraction.type === 1) || newInteraction.type === 101)))

                        return false;
                }
                // deleting all other interactions
                return true;
            });
        } else interactionsForDeleting = [];

        // nothing to do
        if(!interactionsForInserting.length && !interactionsForDeleting.length) return callback();

        log.info('Objects: ', args.objectsIDs, '; Existing interactions:       ', existingInteractions);
        log.info('Interactions from module:    ', interactions);
        log.info('Interactions for inserting:  ', interactionsForInserting);
        log.info('Interactions for deleting:   ', interactionsForDeleting, '; deleteOtherInteractions: ', args.deleteOtherInteractions);

        transactionDB.begin(function(err){
            if(err) return callback(new Error('Error begin transaction for editing objects interactions: ' + err.message));

            // series used for possible transaction rollback if error occurred
            async.series([
                function(callback){ rightsWrapper.insertInteractions(user, interactionsForInserting, callback) },
                function(callback){ rightsWrapper.deleteInteractions(user, interactionsForDeleting, callback); }
            ], function(err){
                if(err) return transactionDB.rollback(err, callback);
                transactionDB.end(function(err) {
                    if(err) return callback(err);

                    // send message for updating collected initial data for objects
                    server.sendMsg({
                        update: {
                            topObjects: true
                        },
                        updateObjectsIDs: IDs
                    });
                    callback();
                });
            });
        });
    });
}
