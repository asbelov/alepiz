/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../../lib/log')(module);
const countersDB = require('../../rightsWrappers/countersDB');
const objectsDB = require('../../rightsWrappers/objectsDB');
const counterSaveDB = require('../../rightsWrappers/counterSaveDB');
const objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');
const transactionDB = require('../../models_db/modifiers/transaction');
const server = require('../../server/counterProcessor');
const Conf = require("../../lib/conf");
const confMyNode = new Conf('config/node.json');

module.exports = function(args, callback) {

    parseArgs(args, function(err, param) {
        if(err) return callback(err);

        var user = args.username;
        var addNewObjects = param.newObjectsNames.length ? objectsDB.addObjects : nop;
        var _saveProperties = args.isCloneProperties ? saveProperties : nop;
        var _saveCounters = args.isCloneCounters ? saveCounters : nop;
        var _saveInteractions = args.isCloneInteractions ? saveInteractions : nop;

        transactionDB.begin(function(err) {
            if (err) return callback(err);

            objectsDB.updateObjectsInformation(user,  param.objectsIDs, param.description, param.order, param.disabled,
                param.color, param.sessionID, function(err, updateData, objectNames) {
                if(err) return transactionDB.rollback(err, callback);

                if(!objectNames) objectNames = param.objectsIDs;
                if(updateData) log.info('Update object information: ', updateData, ' for ', objectNames);

                if(param.newObjectsNames.length) log.info('Add a new objects: ', param.newObjectsNames);
                addNewObjects(user, param.newObjectsNames, param.description, param.order, param.disabled, param.color,
                    args.sessionID, args.timestamp,function(err, newObjectsIDs) {
                    if(err) return transactionDB.rollback(err, callback);

                    if(newObjectsIDs) Array.prototype.push.apply(param.objectsIDs, newObjectsIDs);

                    _saveProperties(user, param, args.cloneAllProperties, function(err, updatedObjectsIDs/*, propertiesDebugInfo*/) {
                        if(err) return transactionDB.rollback(err, callback);

                        // callback(err, [<OCID1>, <OCID2>, ...]): array of updated objectsCountersIDs
                        _saveCounters(user, param, args.cloneAllCounters, function(err, updatedOCIDs) {
                            if(err) return transactionDB.rollback(err, callback);


                            _saveInteractions(user, param.objectsIDs, args, function(err, isUpdatedInteractions) {
                                if (err) return transactionDB.rollback(err, callback);

                                // args.alepizIDs === '' - remove alepizIDs
                                // args.alepizIDs === '-1' - save alepizIDs unchanged
                                var objectIDsForRelationships = args.alepizIDs !== '-1' ? param.objectsIDs : [];
                                var alepizIDs = args.alepizIDs && args.alepizIDs !== '-1' ?
                                    args.alepizIDs.split(',').map(id => parseInt(id, 10)) : [];
                                objectsDB.addObjectsAlepizRelation(user, objectIDsForRelationships, alepizIDs,
                                    function(err, newObjectsAlepizRelations, objectsAlepizRelationsForRemove) {
                                    if (err) return transactionDB.rollback(err, callback);

                                    if(newObjectsAlepizRelations && newObjectsAlepizRelations.length) {
                                        log.info('Add object Alepiz relations: ', newObjectsAlepizRelations,
                                            ' for ', objectNames);
                                    }

                                    if(objectsAlepizRelationsForRemove && objectsAlepizRelationsForRemove.length) {
                                        log.info('Remove object Alepiz relations: ', objectsAlepizRelationsForRemove,
                                            ' for ', objectNames);
                                    }

                                    transactionDB.end(function (err) {
                                        if (err) return callback(err);

                                        var cfg = confMyNode.get();
                                        var indexOfOwnNode = cfg.indexOfOwnNode;
                                        var ownerOfUnspecifiedAlepizIDs = cfg.serviceNobodyObjects;

                                        //console.log('!!!', param.disabled, alepizIDs, ownerOfUnspecifiedAlepizIDs, indexOfOwnNode)
                                        var objectsAreEnabled = !args.disabled &&
                                            ((!alepizIDs.length && ownerOfUnspecifiedAlepizIDs) ||
                                                alepizIDs.indexOf(indexOfOwnNode) !== -1);

                                        // send message for updating collected initial data for objects
                                        // parameters.disabled can be undefined (if unchanged), 0 or 1
                                        if (objectsAreEnabled && (!updateData && !newObjectsIDs &&
                                            (updatedObjectsIDs && updatedObjectsIDs.length) &&
                                            !updatedOCIDs && !isUpdatedInteractions)) {
                                            log.info('Sending message to the server for update objects ',
                                                objectNames.join('; '));
                                            server.sendMsg({
                                                update: {
                                                    topObjects: true,
                                                    objectsProperties: true,
                                                },
                                                updateObjectsIDs: updatedObjectsIDs
                                            });

                                            return callback(null, updatedObjectsIDs.join(','));
                                        } else if (objectsAreEnabled && (updateData || newObjectsIDs ||
                                            (updatedObjectsIDs && updatedObjectsIDs.length) || updatedOCIDs ||
                                            isUpdatedInteractions)) {

                                            log.info('Sending message to the server for separately update objects ',
                                                objectNames.join('; '));
                                            server.sendMsg({
                                                update: {
                                                    topObjects: true,
                                                    objectsProperties: updatedObjectsIDs && updatedObjectsIDs.length ?
                                                        updatedObjectsIDs : undefined,
                                                    objectsCounters: updatedOCIDs || updateData || newObjectsIDs
                                                },
                                                updateObjectsIDs: param.objectsIDs,
                                                updateCountersIDs: updatedOCIDs ? updatedOCIDs.map(function (obj) {
                                                    return obj.counterID
                                                }) : undefined
                                            });

                                            return callback(null, param.objectsIDs.join(','));
                                        }// else if (param.disabled !== 1) log.debug('Nothing to update for objects: ', objectNames);

                                        // object state changed to disabled. remove counters
                                        if (param.disabled === 1 && !objectsAreEnabled) {
                                            objectsDB.getObjectsCountersIDs(user, param.objectsIDs,
                                                function (err, rows) {
                                                    if (err) return callback(err);

                                                    var OCIDs = rows.map(row => row.id);
                                                    if (OCIDs.length) {
                                                        log.info('Sending message to the server for remove counters ' +
                                                            'for disabled objects ', objectNames.join('; '),
                                                            '; OCIDs: ', OCIDs);
                                                        server.sendMsg({
                                                            removeCounters: OCIDs,
                                                            description: 'Objects were disabled from "object clone" ' +
                                                                'by user ' + user +
                                                                '. Object names: ' + objectNames.join(','),
                                                        });
                                                    }
                                                    callback(null, param.objectsIDs.join(','));
                                                })
                                        } else callback(null, param.objectsIDs.join(','));
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
};

/*
    parameters: {
        newObjectNames: [name1, name2,...]

    }
 */


function parseArgs(args, callback) {
    if(!args.cloneToObjectsIDs) return callback(new Error('Destination objects for clone are not specified'));

    if(!Array.isArray(args.cloneToObjectsIDs)) {
        if (Number(args.cloneToObjectsIDs) === parseInt(String(args.cloneToObjectsIDs), 10)) {
            args.cloneToObjectsIDs = [Number(args.cloneToObjectsIDs)];
        } else if(typeof args.cloneToObjectsIDs === 'string') {
            args.cloneToObjectsIDs = args.cloneToObjectsIDs.split(/\s*[,;]\s*/);
        } else {
            return callback(new Error('Error in format of destination objects ID. Waiting for array of objects IDs: ' +
                JSON.stringify(args.cloneToObjectsIDs)));
        }
    }

    // color will be unchanged if color is undefined. args.objectsColor !== undefined for old tasks
    var color = args.objectsColor !== '0' && args.objectsColor !== undefined ?
        args.objectsColor + ':' + args.objectsShade : undefined;

    // you can use as source objects args.o (in tasks) or from objects selector
    if(!args.sourceObjectsIDs) {
        var templatesObjectsIDs = [];
        try {
            var templateObjects = JSON.parse(args.o) // [{"id": "XX", "name": "name1"}, {..}, ...]
        } catch (err) {
            return callback(new Error('Can\'t parse JSON string with a templates objects parameters ' + args.o +
                ': ' + err.message));
        }

        templateObjects.forEach(function (obj) {
            if (obj.id) {
                var id = parseInt(obj.id, 10);
                if (Number(obj.id) === id) templatesObjectsIDs.push(id);
            }
        });

        if (!Array.isArray(templatesObjectsIDs) || !templatesObjectsIDs.length ||
            templatesObjectsIDs.length !== templateObjects.length) {
            return callback(new Error('Incorrect templates objects ' + args.o));
        }
    } else {

        templatesObjectsIDs = args.sourceObjectsIDs.split(',');
        if(!Array.isArray(templatesObjectsIDs) &&
            Number(templatesObjectsIDs) === parseInt(String(templatesObjectsIDs), 10) ) {
            templatesObjectsIDs = [Number(templatesObjectsIDs)];
        }

        if (!Array.isArray(templatesObjectsIDs) || !templatesObjectsIDs.length) {
            return callback(new Error('Incorrect templates objects IDs ' + args.sourceObjectsIDs));
        }

        for(var i = 0; i < templatesObjectsIDs.length; i++) {
            if(Number(templatesObjectsIDs[i]) !== parseInt(String(templatesObjectsIDs[i]), 10)) {
                return callback(new Error('Incorrect template object ID ' + templatesObjectsIDs[i] + ' in ' +
                    JSON.stringify(args.sourceObjectsIDs)));
            } else templatesObjectsIDs[i] = Number(templatesObjectsIDs[i]);
        }
    }

    var newObjectsNames = [];
    var objectsIDs = args.cloneToObjectsIDs.filter(function (id) {
        if(!Number(id) || Number(id) !== parseInt(id, 10)) newObjectsNames.push(id);
        else return true
    }).map(function(id) {
        return Number(id);
    });

    var description = objectsIDs.length > 1 && args.objectsDescription === '' ? undefined : args.objectsDescription;
    var disabled = args.disabled !== '' ? args.disabled : undefined;

    if(args.objectsOrder) {
        var order = Number(args.objectsOrder);
        // when parameters.objectsOrder is 0, the order should remain unchanged, but in updateObjectsInformation(),
        // the order will remain unchanged if the parameters.objectsOrder is undefined
        if(!order) order = undefined;
        else if(order !== parseInt(String(order), 10) || isNaN(order)) {
            return callback(new Error('Incorrect sort order ' + args.objectsOrder + '. It can be an integer value'))
        }
    }

    var countersIDs = [], propertiesIDs = [], num;
    Object.keys(args).forEach(function (arg) {
        if(args[arg]) {
            if (arg.indexOf('counterID-') === 0 && (num = parseInt(arg.substring('counterID-'.length), 10))) {
                countersIDs.push(num);
            } else if (arg.indexOf('propertyID-') === 0 && (num = parseInt(arg.substring('propertyID-'.length), 10))) {
                propertiesIDs.push(num);
            }
        }
    });

    var parameters = {
        objectsIDs: objectsIDs,
        newObjectsNames: newObjectsNames,
        templatesObjectsIDs: templatesObjectsIDs,
        description: description,
        order: order,
        disabled: disabled,
        color: color,
        countersIDs: countersIDs,
        propertiesIDs: propertiesIDs,
    };

    log.debug('Parsed parameters: ', parameters);
    callback(null, parameters);
}

function createInteractions(cloneToObjectIDs, args) {

    var newInteractions = [];
    cloneToObjectIDs.forEach(function (id2) {
        if(args.upLevelObjectsIDs) { // <id1>,<id2>,....
            String(args.upLevelObjectsIDs).split(/\s*[,;]\s*/).forEach(function (id1) {
                // the ID1 will be verified later
                newInteractions.push({
                    id1: parseInt(id1, 10),
                    id2: id2,
                    type: 0
                });
            });
        }

        Object.keys(args).forEach(function (arg) {
            if(args[arg]) {
                if (arg.indexOf('interactionID-') === 0) { // interactionID-<objectID>,<interactionType>
                    var [id1, type] = arg.substring('interactionID-'.length).split(/\s*[,;]\s*/);
                    id1 = parseInt(id1); type = parseInt(type, 10);
                    // IDs will be verified later
                    if([0,1,2].indexOf(type) === -1) return;
                    if(id1 > 0) {
                        newInteractions.push({
                            id1: id1,
                            id2: id2,
                            type: type,
                        });
                    } else {
                        newInteractions.push({
                            id1: id2,
                            id2: -id1,
                            type: type,
                        });
                    }
                }
            }
        });
    });

    return newInteractions;
}

/*
    get latest argument and run it as callback function
 */
function nop() {
    // run latest argument as callback from function arguments
    arguments[arguments.length - 1]();
}

function saveCounters(user, parameters, cloneAllCounters, callback) {

    countersDB.getCountersForObjects(user, parameters.templatesObjectsIDs, null,function(err, rows) {
        if(err) return callback(err);

        var countersIDs = cloneAllCounters ? rows.map(row => row.id) :
            rows.filter(row => parameters.countersIDs.indexOf(row.id) !== -1).map(row => row.id);

        if(!countersIDs.length) {
            log.warn('Can\'t find objects to counters relations for objects IDs: ', parameters.objectsIDs);
            return callback();
        }
        //log.debug('Saved objects to counters relations: objects IDs: ', parameters.objectsIDs, '; counters IDs: ', countersIDs);

        // callback(err, [{objectID:.., counterID:..}, {..}, ...]): array of updated objectsCountersIDs
        counterSaveDB.saveObjectsCountersIDs(user, parameters.objectsIDs, countersIDs, function(err, updatedOCIDs) {
            if(updatedOCIDs && updatedOCIDs.length) {
                log.info('Updating objects to counters relations for: ', updatedOCIDs);
            }
            callback(err, updatedOCIDs);
        });
    });
}

function saveProperties(user, parameters, cloneAllProperties, callback) {
    objectsPropertiesDB.getProperties(user, parameters.templatesObjectsIDs, function(err, rows) {
        if(err) return callback(err);

        var propertiesNames = {}; // checking for duplicate properties
        if(!cloneAllProperties) rows = rows.filter(function (property) {
            if(propertiesNames[property.name]) {
                if(property.value !== propertiesNames[property.name])
                    log.warn('Templates has properties with equal names: "', property.name,
                        '", skip property with value ', property.value, ' and save property with value ',
                        propertiesNames[property.name]);
                return false;
            }
            propertiesNames[property.name] = property.value;

            if(!cloneAllProperties) return parameters.propertiesIDs.indexOf(property.id) !== -1;
            return true;
        });

        /*
        properties: [{name:.., mode:.., value:.., description:..}, ...]
        */
        var properties = rows.filter(function (prop) {
            if(prop.description === undefined) prop.description = '';
            if(prop.mode !== undefined) prop.mode = Number(prop.mode);
            return prop.name && prop.value !== undefined && [0, 1, 2, 3].indexOf(prop.mode) !== -1
        });

        objectsPropertiesDB.saveObjectsProperties(user, parameters.objectsIDs, properties,false,
            function(err, updatedObjectsIDs, properties) {
            if(updatedObjectsIDs.length) log.info('Changes in properties: ', properties);
            callback(err, updatedObjectsIDs)
        });
    });
}

// interaction types: 0 - include; 1 - intersect, 2 - exclude
function saveInteractions(user, cloneToObjectIDs, args, callback) {

    // add upLevel interaction
    // parameters.interactionsObjectsIDs = [{id1:, id2:. type:}, {...}, ...]
    // parameters.upLevelObjectsIDs: [{id1:, id2:. type: 0}, {...}, ...] - interactions with upLevel objects

    var newInteractions = createInteractions(cloneToObjectIDs, args);

    if(!newInteractions.length) return callback();
    objectsDB.insertInteractions(user, newInteractions, callback);
}