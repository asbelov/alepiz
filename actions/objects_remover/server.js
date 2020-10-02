/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */

var async = require('async');
var rightsWrapper = require('../../rightsWrappers/objectsDB');
var objectsDB = require('../../models_db/objectsDB');
var log = require('../../lib/log')(module);
var server = require('../../lib/server');
var history = require('../../models_history/history');
var ajax = require('./ajax');

module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);

    if(!args.o) return callback(new Error('Objects are not selected'));

    if(args.deleteWithChildren) {
        var getObjectsForRemoving = function(callback) {
            ajax({
                func: 'getChildObjects',
                objects: args.o, // send stringified object
                username: args.username,
                actionName: args.actionName
            }, callback);
        }
    } else {
        getObjectsForRemoving = function(callback) {
            try {
                var objects = JSON.parse(args.o);
            } catch(err) {
                return callback(new Error('Can\'t parse string with JSON object: ' + args.o));
            }
            callback(null, objects);
        };
    }

    getObjectsForRemoving(function(err, objects) {
        if(err) return callback(err);

        log.info('Objects for removing: ', objects);

        var objectsIDs = objects.map(function(obj) {
            if(obj.id) return Number(obj.id);
            else return 0;
        }).filter(function(id) {
            return (id && id === parseInt(id, 10)); // return only integer objectsIDs > 0
        });

        if(!objectsIDs.length || objectsIDs.length !== objects.length) return callback(new Error('Incorrect object in ' + objects));

        log.info('Checking user rights for removing objects for ', args.username,'...');

        rightsWrapper.getObjectsCountersIDs(args.username, objectsIDs, function(err, OCIDs) {
            if(err) return callback(new Error('Error getting objectsCountersIDs for objects IDs: ' + objectsIDs.join(',') + ': ' + err.message));

            if(!OCIDs || !OCIDs.length) {
                log.info('Objects: ', objectsIDs, ' has no counters.');
                callback();
            }

            log.info('Sending message to server for stopping collect data to OCIDs: ', OCIDs);
            server.sendMsg({
                removeCounters: OCIDs,
                description: 'Objects IDs ' + objectsIDs.join(',') + ' was removed from database by user ' + args.username
            });

            // remove objects without checking rights for speed up. We do it above at rightsWrapper.getObjectsCountersIDs()
            async.parallel([function(callback) {
                log.info('Sending message to history for removing OCIDs: ', OCIDs);
                history.del(OCIDs, function(err) {
                    if(err) log.error(err.message);
                });

                // Don't wait for the records to be removed from history.
                // This can last a long time when the housekeeper is working.
                callback();
            }, function(callback) {
                log.info('Removing objects from database: ', objectsIDs);
                objectsDB.deleteObjects(objectsIDs, function(err) {
                    if(err) log.error(err.message);
                    callback();
                });
            }], callback);
        })
    });
};
