/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 10.04.2022, 16:15:07
*/
const log = require('../../lib/log')(module);
const objectsDB = require("../../rightsWrappers/objectsDB");
const countersDB = require("../../rightsWrappers/countersDB");
const objectsProperties = require("../../rightsWrappers/objectsPropertiesDB");
const counterDB = require("../../models_db/countersDB");

module.exports = function(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    var func = args.func;

    if(func === 'getObjectParameters') {
        objectsDB.getObjectsByIDs(args.username, args.IDs, function (err, objectRows) {
            if(err) return callback(new Error('Can\'t get object parameters: ' + err.message));

            objectsProperties.getProperties(args.username, args.IDs, function (err, propsRows) {
                if(err) return callback(new Error('Can\'t get object properties: ' + err.message));

                countersDB.getCountersForObjects(args.username, args.IDs, null, function (err, counterRows) {
                    if(err) return callback(new Error('Can\'t get counters for objects: ' + err.message));

                    objectsDB.getInteractions(args.username, args.IDs, function (err, interactionRows) {
                        if(err) return callback(new Error('Can\'t get object interactions: ' + err.message));

                        return callback(null, {
                            objects: objectRows,
                            properties: propsRows,
                            counters: counterRows,
                            interactions: interactionRows,
                        });
                    });
                });
            });
        });
        return
    }

    if(func === 'getObjectsByNames') return objectsDB.getObjectsIDs(args.username, args.objectNames.split('\r'), callback);

    if(func === 'getCountersByNames') return counterDB.getCountersIDsByNames(args.counterNames.split('\r'), callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};
