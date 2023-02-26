/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../rightsWrappers/countersDB');
var rawCountersDB = require('../../models_db/countersDB');
var rawObjectsDB = require('../../models_db/objectsDB');
const checkIDs = require('../../lib/utils/checkIDs');

module.exports = function(args, callback) {
    log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (!func) return callback(new Error('Ajax function is not set'));

    if (func === 'getObjectsParameters') {
        checkIDs(args.IDs.split(','), function(err, objectsIDs) {
            if (err && !objectsIDs) return callback(err);

            objectsDB.getObjectsByIDs(args.username, objectsIDs, function (err, objectsParameters) {
                if (err) return callback(err);

                countersDB.getCountersForObjects(args.username, objectsIDs, null,
                    function (err, objectsCountersLinkage) {
                        if (err) return callback(err);

                        rawCountersDB.getAllCounters(function (err, counters) {
                            if (err) return callback(err);

                            rawObjectsDB.getAlepizIDs(function (err, alepizIDs) {
                                if (err) return callback(err);

                                rawObjectsDB.getObjectsAlepizRelationByObjectIDs(objectsIDs,
                                    function (err, objectsAlepizRelations) {
                                        if (err) return callback(err);

                                        var returnedObject = {
                                            objectsParameters: objectsParameters,
                                            objectsCountersLinkage: objectsCountersLinkage,
                                            counters: counters,
                                            alepizIDs: alepizIDs,
                                            objectsAlepizRelations: objectsAlepizRelations,
                                        }
                                        log.debug('objectsIDs: ', objectsIDs, '\nAjax return: ', returnedObject);

                                        callback(null, returnedObject);
                                    });
                            });
                        });
                    });
            });
        });
    }
};