/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 10.04.2022, 16:15:07
*/
const log = require('../../lib/log')(module);
const async = require('async');
const transactionDB = require("../../models_db/modifiers/transaction");
const objectsDB = require("../../rightsWrappers/objectsDB");
const modelsDBObjectsDB = require('../../models_db/objectsDB');
const objectsPropertiesDB = require("../../rightsWrappers/objectsPropertiesDB");
const modelsDBCountersDB = require('../../models_db/countersDB');
const counterSaveDB = require("../../rightsWrappers/counterSaveDB");


module.exports = function(args, callback) {
    log.info('Starting action server "', args.actionName, '" with parameters', args);

    try {
        var importedData = JSON.parse(args.importExportJSONEditor);
    } catch (e) {
        return callback(new Error('Can\'t parse JSON object: ' + e.message + ': object: ' + args.importExportJSONEditor));
    }

    if(!Array.isArray(importedData) || !importedData.length) {
        return callback(new Error('Imported data is not an array or is empty: ' +
            JSON.stringify(args.importExportJSONEditor)));
    }

    // find existing objects in database for update
    var counters = {};
    var objects = {};
    importedData.forEach(obj => {
        if(Array.isArray(obj.counters)) {
            obj.counters.forEach(counterName => counters[counterName] = 0);
        }
        objects[obj.name] = 0;

        if(Array.isArray(obj.interactions)) {
            obj.interactions.forEach(interaction => {
                objects[interaction.name1] = 0;
                objects[interaction.name2] = 0;
            });
        }
    });

    if(!Object.keys(objects).length) return callback(new Error('Can\'t find objects in the imported data'));

    // get object IDs by object names
    modelsDBObjectsDB.getObjectsByNames(Object.keys(objects), function (err, rows) {
        if(err) return callback(new Error('Error get existing objects :' + err.message + ': ' + objectNames.join(',')));

        rows.forEach(row => objects[row.name] = row.id);

        modelsDBCountersDB.getCountersIDsByNames(Object.keys(counters), function (err, rows) {
            if (err) {
                return callback(new Error('Can\'t get counter IDs by counter names: ' + err.message +
                    '; counter names: ' + Object.keys(counters).join(', ')));
            }
            rows.forEach(row => counters[row.name] = row.id);

            log.info('Import objects from ', importedData);
            log.info('Objects: ', objects);
            log.info('Counters: ', counters);
            transactionDB.begin(function (err) {
                if (err) return callback(err);

                async.eachSeries(importedData, function (param, callback) {
                    addOrUpdateObjects(args.username, {
                        id: objects[param.name],
                        name: param.name,
                        description: param.description,
                        disabled: param.disabled,
                        sortPosition: param.sortPosition,
                        color: param.color,
                        timestamp: args.timestamp,
                    }, function (err, objectID) {
                        if (err) {
                            return callback(new Error('Can\'t insert or update object ' + param.name + ': ' +
                                err.message + ': ' + JSON.stringify(param)));
                        }

                        objects[param.name] = objectID;

                        async.waterfall([function (callback) {
                                saveProperties(args.username, {
                                    id: objectID,
                                    name: param.name,
                                    properties: args.skipProperties ? null : param.properties,
                                }, callback);
                            }, function (callback) {
                                saveLinkedCounters(args.username, {
                                    id: objectID,
                                    name: param.name,
                                    counters: args.skipLinkedCounters ? null : param.counters,
                                }, counters, callback);
                            }, function (callback) {
                                saveInteractions(args.username, {
                                    id: objectID,
                                    name: param.name,
                                    interactions: args.skipInteractions ? null : param.interactions,
                                }, objects, callback);
                            }
                        ], callback);

                    });
                }, function (err) {
                    if(err) transactionDB.rollback(err, callback);
                    else {
                        transactionDB.end(function (err) {
                            if(err) return callback(err);
                            log.info('Objects ', Object.keys(objects), ' successfully imported');
                            callback(null, importedData);
                        });
                    }
                });
            });
        });
    });
};

function addOrUpdateObjects(user, param, callback) {
    if (!param.name) return callback(new Error('Object name is not set'));

    var order = Number(param.sortPosition);
    if (order !== parseInt(String(order), 10) || !order) {
        return callback(new Error('Object order is not set'));
    }

    var description = param.description || '';
    var disabled = param.disabled ? 1 : 0;

    if(!param.id) {
        objectsDB.addObjects(user, param.id, description, order, disabled, param.color, param.timestamp,
            function (err, newObjectIDs) {
                if (err) return callback(new Error('Can\'t insert object: ' + err.message));

                log.info('Inserting object ', param.name, '; objectID: ', newObjectIDs[0]);
                callback(null, newObjectIDs[0]);
            });
    } else {
        objectsDB.updateObjectsInformation(user, param.name, description, order, disabled, param.color, param.sessionID,
            function (err) {
                if (err) return callback(new Error('Can\'t update object: ' + err.message));

                log.info('Updating object ', param.name, '; objectID: ', objectID);
                callback(null, param.id);
            });
    }
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

    counterSaveDB.saveObjectsCountersIDs(user, param.id, countersIDs, false,
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

        for(var i = 0; i < param.interactions.length; i++) {
            var interaction = param.interactions[i];
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
        }

        objectsDB.insertInteractions(user, interactions, false, function (err) {
            if(err) {
                return callback(new Error('Can\'t save object interactions for ' +
                    param.name + ' and interactions ' + JSON.stringify(interactions) +
                    ': ' + err.message));
            }
            callback();
        });
    });
}