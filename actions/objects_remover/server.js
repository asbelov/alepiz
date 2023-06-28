/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */

var async = require('async');
var rightsWrapper = require('../../rightsWrappers/objectsDB');
var rawObjectsDB = require('../../models_db/modifiers/objectsDB');
var log = require('../../lib/log')(module);
var server = require('../../server/counterProcessor');
var history = require('../../serverHistory/historyClient');
var ajax = require('./ajax');

module.exports = function(args, callback) {
    log.debug('Starting action server ', args.actionName, ' with parameters', args);

    if(!args.o) return callback(new Error('Objects are not selected'));

    if(args.deleteWithChildren) {
        var getObjectsForRemoving = function(args, callback) {
            ajax({
                func: 'getChildObjects',
                objects: args.o, // send stringified object
                username: args.username,
                actionName: args.actionName
            }, callback);
        }
    } else {
        getObjectsForRemoving = function(args, callback) {
            try {
                var objects = JSON.parse(args.o);
            } catch(err) {
                return callback(new Error('Can\'t parse string with JSON object: ' + args.o));
            }
            callback(null, objects);
        };
    }

    getObjectsForRemoving(args, function(err, objects) {
        if(err) return callback(err);

        log.info('Objects for removing: ', objects);

        var objectNamesForRemove = [];
        var objectIDs = objects.map(function(obj) {
            if(obj.id) {
                objectNamesForRemove.push(obj.name);
                return Number(obj.id);
            }
            else return 0;
        }).filter(function(id) {
            return (id && id === parseInt(id, 10)); // return only integer objectIDs > 0
        });

        if(!objectIDs.length || objectIDs.length !== objects.length) {
            return callback(new Error('Incorrect object in ' + objects));
        }

        log.info('Checking user rights for removing objects for ', args.username,'...');

        rightsWrapper.getObjectsCountersIDs(args.username, objectIDs, function(err, rows) {
            if(err) {
                return callback(new Error('Error getting objectsCountersIDs: ' + err.message +
                    '; Objects: ' + objectNamesForRemove.join(', ')));
            }

            var OCIDs = rows.map(row => row.id);
            if(!OCIDs || !OCIDs.length) {
                log.info('Objects do not have linked counters');
                return removeObjectsFromDatabase(objectNamesForRemove, objectIDs, callback);
            }

            log.info('Sending message to server for stopping collect data for objects: ',
                objectNamesForRemove.join(', '), '; OCIDs: ', OCIDs);
            server.sendMsg({
                removeCounters: OCIDs,
                description: 'Objects was removed from database by user ' + args.username +
                    '; Objects: ' + objectNamesForRemove.join(', ')
            });

            history.connect('actionObjectRemover', function() {

                // remove objects without checking rights for speed up.
                // We do it above at rightsWrapper.getObjectsCountersIDs()
                async.parallel([function (callback) {
                    log.info('Sending message to history for removing objects');
                    history.del(OCIDs, function (err) {
                        if (err) log.error(err.message);
                    });

                    // Don't wait for the records to be removed from history.
                    // This can last a long time when the housekeeper is working.
                    callback();
                }, function (callback) {
                    removeObjectsFromDatabase(objectNamesForRemove, objectIDs, callback);
                }], callback);
            });
        })
    });
};

function removeObjectsFromDatabase(objectNamesForRemove, objectIDs, callback) {
    log.info('Removing objects from database: ', objectNamesForRemove.join(', '),
        '; object IDs: ', objectIDs.join(', '));
    rawObjectsDB.deleteObjects(objectIDs, function (err) {
        if (err) log.error(err.message);
        callback();
    });
}