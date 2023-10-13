/*
 * Copyright © 2015. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.05.2015.
 */

const async = require('async');
const objectDB = require('../../rightsWrappers/objectsDB');
const log = require('../../lib/log')(module);
const server = require('../../server/counterProcessor');
const history = require('../../serverHistory/historyClient');
const ajax = require('./ajax');

/**
 * remove objects
 * @param {Object} args object with an action arguments
 * @param {string} args.o stringified array with objects "[{id:.. name:.. }, ]"
 * @param {string} args.actionName action name
 * @param {string} args.deleteWithChildren is required delete included objects
 * @param {string} args.username username
 * @param {function (Error)|function()} callback callback(err)
 */
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
            return callback(new Error('Incorrect objects in ' + JSON.stringify(objects, null, 4)));
        }

        log.info('Checking user rights for removing objects for ', args.username, '...');

        objectDB.getObjectsCountersIDs(args.username, objectIDs, function(err, rows) {
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
                // We do it above at objectDB.getObjectsCountersIDs()
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

/**
 * Remove objects from DB
 * @param {Array<string>} objectNamesForRemove an array with object names for remove (for log)
 * @param {Array<number>} objectIDs an array with object IDs
 * @param {function(Error)|function()} callback callback(err)
 */
function removeObjectsFromDatabase(objectNamesForRemove, objectIDs, callback) {
    log.info('Removing objects from database: ', objectNamesForRemove.join(', '),
        '; object IDs: ', objectIDs.join(', '));
    objectDB.deleteObjects(objectIDs, function (err) {
        if (err) log.error(err.message);
        callback();
    });
}