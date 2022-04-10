/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 10.04.2022, 16:15:07
*/
const log = require('../../lib/log')(module);
const async = require('async');
const transactionDB = require("../../models_db/transaction");
const objectsDB = require("../../rightsWrappers/objectsDB");
const modelsDBObjectsDB = require('../../models_db/objectsDB');
const objectsPropertiesDB = require("../../rightsWrappers/objectsPropertiesDB");
const countersDB = require("../../rightsWrappers/countersDB");
const counterSaveDB = require("../../rightsWrappers/counterSaveDB");


module.exports = function(args, callback) {
    log.info('Starting action server "', args.actionName, '" with parameters', args);

    try {
        var importedData = JSON.parse(args.importExportJSONEditor);
    } catch (e) {
        return callback(new Error('Can\'t parse JSON object: ' + e.message + ': object: ' + args.importExportJSONEditor));
    }

    if(!Array.isArray(importedData) || !importedData.length) {
        log.info('Imported data is not an array or is empty: ', args.importExportJSONEditor);
        return callback();
    }

    // find existing objects in database for update
    var counters = {};
    var objects = {};
    importedData.forEach(o => {
        if(Array.isArray(o.counters)) {
            o.counters.forEach(counterName => counters[counterName] = 0);
        }
        objects[o.name] = 0;

        if(Array.isArray(o.interactions)) {
            o.interactions.forEach(interaction => {
                objects[interaction.name1] = 0;
                objects[interaction.name2] = 0;
            });
        }
    });

    // get object IDs by object names
    modelsDBObjectsDB.getObjectsByNames(Object.keys(objects), function (err, rows) {
        if(err) return callback(new Error('Error get existing objects :' + err.message + ': ' + objectNames.join(',')));

        rows.forEach(row => objects[row.name] = row.id);

        countersDB.getCountersIDsByNames(Object.keys(counters), function (err, rows) {
            if (err) {
                return callback(new Error('Can\'t get counter IDs by counter names: ' + err.message +
                    '; counter names: ' + Object.keys(counters).join(', ')));
            }
            rows.forEach(row => counters[row.name] = row.id);

            transactionDB.begin(function (err) {
                if (err) return callback(err);

                async.eachSeries(importedData, function (param, callback) {
                    addOrUpdateObjects(args.user, {
                        id: objects[param.name],
                        name: param.name,
                        description: param.description,
                        disabled: param.disabled,
                        color: param.color,
                    }, function (err, objectID) {
                        if (err) {
                            log.error('Can\'t insert or update object ', param.name,': ', err.message, ': ', param);
                            callback();
                        }

                        async.waterfall([function (callback) {
                                saveProperties(args.user, {
                                    id: objectID,
                                    name: param.name,
                                    properties: param.properties,
                                }, callback);
                            }, function (callback) {
                                saveLinkedCounters(args.user, {
                                    id: objectID,
                                    name: param.name,
                                    counters: param.counters,
                                }, counters, callback);
                            }, function (callback) {
                                saveInteractions(args.user, {
                                    id: objectID,
                                    name: param.name,
                                    interactions: param.interactions,
                                }, objects, callback);
                            }
                        ], callback);

                    });
                }, function (err) {
                    if(err) transactionDB.rollback(err, callback);
                    else {
                        transactionDB.end(callback);
                        log.info('Objects ', Object.keys(objects), ' successfully imported');
                    }
                });
            });
        });
    });
};

function addOrUpdateObjects(user, param, callback) {
    if (!param.name) return callback(new Error('Object name is not set'));

    var order = Number(param.order);
    if (order !== parseInt(String(order), 10) || !order) {
        return callback(new Error('Object order is not set'));
    }

    var description = param.description || '';
    var disabled = Boolean(param.disabled);

    var addOrUpdateObjects = param.id ? objectsDB.updateObjectsInformation : objectsDB.addObjects;
    var objectID = param.id || param.name;

    addOrUpdateObjects(user, [objectID], description, order, disabled, function (err, newObjectIDs) {
        if (err) return callback(new Error('Can\'t insert object: ' + err.message));

        if (!param.id) log.info('Inserting object ', param.name, '; objectID: ', newObjectIDs[0]);
        else log.info('Updating object ', param.name, '; objectID: ', objectID);

        callback(null, param.id || newObjectIDs[0]);
    });
}

function saveProperties(user, param, callback) {
    if(!Array.isArray(param.properties) || !param.properties.length) return callback();

    objectsPropertiesDB.saveObjectsProperties(user, [param.id], param.properties,
        true, function (err, updatedObjectsIDs, properties) {
        if (err) {
            return callback(new Error('Can\'t update properties for object ' + param.name + ': ' + err.message));
        }

        if (properties) log.info('Modifying properties for ', param.name, ': ', properties);
        callback();
    });
}

function saveLinkedCounters(user, param, counters, callback) {
    if(!Array.isArray(param.counters) || !param.counters.length) return callback();

    var countersIDs = [], notExistingCounters = [];
    param.counters.forEach(counterName => {
        if(counters[counterName]) countersIDs.push(counters[counterName]);
        else notExistingCounters.push(counterName);
    });

    if(notExistingCounters.length) {
        return callback(new Error('Can\'t link object ' + param.name + ' to counters ' +
            notExistingCounters.join(', ') + ': counters are not exist'));
    }

    counterSaveDB.saveObjectsCountersIDs(user, param.id, countersIDs,
        function (err, updatedOCIDs) {
        if(err) {
            return callback(new Error('Can\'t save object to counter relations for ' +
                param.name + ' and counters ' + Object.keys(param.counters).join(', ') +
                ': ' + err.message));
        }

        log.info('Successfully linking object ', param.name, ' to counters ',
            Object.keys(param.counters).join(', '), '; OCIDs: ', updatedOCIDs);
        callback();
    });
}

function saveInteractions(user, param, objects, callback) {
    if(!Array.isArray(param.interactions) || !param.interactions.length) return callback();

    var interactions = [], interactionsForCheck = {};
    objectsDB.getInteractions(user, [param.id], function(err, rows) {
        if (err) {
            return callback(new Error('Can\'t get interactions for object ' + param.name + ': ' + err.message));
        }

        if(Array.isArray(rows) && rows.length) {
            rows.forEach(row => interactionsForCheck[row.id1 + ':' + row.id2 + ':' + row.type] = 1);
        }

        param.interactions.forEach(interaction => {
            if (!objects[interaction.name1]) {
                return callback(new Error('Can\'t insert object interaction for object ' + param.name +
                    ': object ' + interaction.name1 + ' is not exist'));
            }
            if (!objects[interaction.name2]) {
                return callback(new Error('Can\'t insert object interaction for object ' + param.name +
                    ': object ' + interaction.name2 + ' is not exist'));
            }

            if ([0, 1, 2].indexOf(interaction.type) === -1) {
                return callback(new Error('Can\'t insert object interaction for object ' + param.name +
                    ', interaction ' + JSON.stringify(interaction) + ': unknown interaction type'));
            }

            // interaction types: 0 - include; 1 - intersect, 2 - exclude
            if(!interactionsForCheck[
                objects[interaction.name1] + '-' + objects[interaction.name2] + ':' + interaction.type] &&
                (interaction.type !== 1 || !interactionsForCheck[
                objects[interaction.name2] + '-' + objects[interaction.name1] + ':' + interaction.type])
            ) {
                interactions.push({
                    id1: objects[interaction.name1],
                    id2: objects[interaction.name2],
                    type: interaction.type,
                });
            }
        });

        objectsDB.insertInteractions(user, interactions, function (err) {
            if(err) {
                return callback(new Error('Can\'t save object interactions for ' +
                    param.name + ' and interactions ' + JSON.stringify(interactions) +
                    ': ' + err.message));
            }
            callback();
        });
    });
}

