/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var countersDB = require('../../rightsWrappers/countersDB');
var objectsDB = require('../../rightsWrappers/objectsDB');
var counterSaveDB = require('../../rightsWrappers/counterSaveDB');
var objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');
var transactionDB = require('../../models_db/transaction');
var server = require('../../server/counterProcessor');
const rawObjectsDB = require("../../models_db/objectsDB");
const Conf = require("../../lib/conf");
const confServer = new Conf('config/server.json');

module.exports = function(args, callback) {

    parseArgs(args, function(err, param) {
        if(err) return callback(err);

        var user = args.username;
        if(param.objectsIDs.length && (
            param.description && // '' - save old description
            param.order && // 0 - Current order will be unchanged
            (param.disabled === 1 || param.disabled === 0) // can be an undefined (if unchanged) or 1 or 0
        )) {
            log.info('Update objects parameters: ', param.objectsIDs, ': description: ', param.description,
                '; order: ', param.order, '; disabled: ', param.disabled);
            var updateObjects = objectsDB.updateObjectsInformation;
        } else updateObjects = nop;

        var addNewObjects = param.newObjectsNames.length ? objectsDB.addObjects : nop;
        var _saveProperties = args.isCloneProperties ? saveProperties : nop;
        var _saveCounters = args.isCloneCounters ? saveCounters : nop;
        var _saveInteractions = args.isCloneInteractions ?
            saveInteractions : (param.interactions.length ? addUpLevelObjectsInteractions : nop);

        transactionDB.begin(function(err) {
            if (err) return callback(err);

            updateObjects(user,  param.objectsIDs, param.description, param.order, param.disabled, param.color,
                function(err, isObjectsUpdated) {
                if(err) return transactionDB.rollback(err, callback);

                if(param.newObjectsNames.length) log.info('Add a new objects: ', param.newObjectsNames);
                addNewObjects(user, param.newObjectsNames, param.description, param.order, param.disabled, param.color,
                    function(err, newObjectsIDs) {
                    if(err) return transactionDB.rollback(err, callback);

                    if(newObjectsIDs) Array.prototype.push.apply(param.objectsIDs, newObjectsIDs);

                    _saveProperties(user, param, args.cloneAllProperties, function(err, updatedObjectsIDs/*, propertiesDebugInfo*/) {
                        if(err) return transactionDB.rollback(err, callback);

                        // callback(err, [<OCID1>, <OCID2>, ...]): array of updated objectsCountersIDs
                        _saveCounters(user, param, args.cloneAllCounters, function(err, updatedOCIDs) {
                            if(err) return transactionDB.rollback(err, callback);

                            _saveInteractions(user, param, args.cloneAllInteractions,
                                function(err, isUpdatedInteractions) {
                                if (err) return transactionDB.rollback(err, callback);

                                // param.alepizIDs === '' - remove alepizIDs
                                // param.alepizIDs === '-1' - save alepizIDs unchanged
                                var objectIDsForRelationships = args.alepizIDs !== '-1' ? param.objectsIDs : [];
                                rawObjectsDB.deleteObjectsAlepizRelation(objectIDsForRelationships,
                                    function (err) {
                                    if (err) return transactionDB.rollback(err, callback);

                                    var alepizIDs = param.alepizIDs && param.alepizIDs !== '-1' ?
                                        args.alepizIDs.split(',').map(id => parseInt(id, 10)) : [];

                                    rawObjectsDB.addObjectsAlepizRelation(objectIDsForRelationships, alepizIDs,
                                        function (err) {
                                        if (err) return transactionDB.rollback(err, callback);

                                        transactionDB.end(function (err) {
                                            if (err) return callback(err);

                                            rawObjectsDB.getAlepizIDs(function (err, alepizIDsObj) {
                                                if (err) return callback(err);

                                                var alepizID2Name = {};
                                                alepizIDsObj.forEach(row => {
                                                    alepizID2Name[row.id] = row.name
                                                });

                                                var alepizNames = confServer.get('alepizNames');
                                                var ownerOfUnspecifiedAlepizIDs = alepizNames.indexOf(null) !== 1;
                                                var ownerOfSpecifiedAlepizIDs = alepizIDs.some(alepizID => {
                                                    return alepizNames.indexOf(alepizID2Name[alepizID]) !== -1;
                                                });
                                                var objectsAreEnabled = !param.disabled &&
                                                    ((!alepizIDs.length && ownerOfUnspecifiedAlepizIDs) ||
                                                        ownerOfSpecifiedAlepizIDs);

                                                // send message for updating collected initial data for objects
                                                // parameters.disabled can be undefined (if unchanged), 0 or 1
                                                if (objectsAreEnabled && (!isObjectsUpdated && !newObjectsIDs &&
                                                    (updatedObjectsIDs && updatedObjectsIDs.length) &&
                                                    !updatedOCIDs && !isUpdatedInteractions)) {

                                                    server.sendMsg({
                                                        update: {
                                                            topObjects: true,
                                                            objectsProperties: true,
                                                        },
                                                        updateObjectsIDs: updatedObjectsIDs
                                                    });

                                                    return callback(null, updatedObjectsIDs.join(','));
                                                } else if (objectsAreEnabled && (isObjectsUpdated || newObjectsIDs ||
                                                    (updatedObjectsIDs && updatedObjectsIDs.length) || updatedOCIDs ||
                                                    isUpdatedInteractions)) {

                                                    server.sendMsg({
                                                        update: {
                                                            topObjects: true,
                                                            objectsProperties: updatedObjectsIDs && updatedObjectsIDs.length ?
                                                                updatedObjectsIDs : undefined,
                                                            objectsCounters: updatedOCIDs || isObjectsUpdated || newObjectsIDs
                                                        },
                                                        updateObjectsIDs: param.objectsIDs,
                                                        updateCountersIDs: updatedOCIDs ? updatedOCIDs.map(function (obj) {
                                                            return obj.counterID
                                                        }) : undefined
                                                    });

                                                    return callback(null, param.objectsIDs.join(','));
                                                } else if (param.disabled !== 1) {
                                                    log.debug('Nothing to update for objects: ', param.objectsIDs);
                                                }

                                                // object state changed to disabled. remove counters
                                                if (param.disabled === 1 && !objectsAreEnabled) {
                                                    objectsDB.getObjectsCountersIDs(user, param.objectsIDs,
                                                        function (err, rows) {
                                                            if (err) return callback(err);

                                                            var OCIDs = rows.map(row => row.id);
                                                            if (OCIDs.length) server.sendMsg({
                                                                removeCounters: OCIDs,
                                                                description: 'Objects was disabled from "object clone" ' +
                                                                    'by user ' + user +
                                                                    '. Object names: ' + param.cloneToObjectNames
                                                            });
                                                            callback(null, param.objectsIDs.join(','));
                                                        })
                                                } else callback(null, param.objectsIDs.join(','));
                                            });
                                        });
                                    });
                                });
                            });
                        })
                    })
                })
            });
        });
    })
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

    var color = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'light-blue', 'cyan', 'teal',
        'green', 'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey',
        'black', 'white', 'transparent'].indexOf((args.objectsColor || '').toLowerCase()) !== -1 ?
        args.objectsColor + ':' +
        (/^(lighten)|(darken)|(accent)-[1-4]$/.test((args.objectsShade || '').toLowerCase()) ? args.objectsShade : '') :
        null;

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

    var description = args.objectsDescription;
    var order = parseInt(args.objectsOrder, 10);
    var disabled = args.disabledCB; // checking for correct disabled value at rightsWrapper.addObjects

    if((order || newObjectsNames.length) && order !== parseInt(String(order), 10))
        return callback(new Error('Incorrect objects order for objects :' +
            args.cloneToObjectsJSON + ': ' + args.objectsOrder));

    var interactions = [];
    if(args.upLevelObjectsIDs) {
        String(args.upLevelObjectsIDs).split(/\s*[,;]\s*/).filter(function (id) {
            return id && Number(id) === parseInt(id, 10);
        }).forEach(function (id) {
            objectsIDs.forEach(function (id2) {
                interactions.push({
                    id1: Number(id),
                    id2: id2,
                    type: 0
                });
            });
        });
    }

    var countersIDs = [], propertiesIDs = [], interactionsObjectsIDs = [], num;
    Object.keys(args).forEach(function (arg) {
        if(args[arg]) {
            if (arg.indexOf('counterID-') === 0 && (num = parseInt(arg.substring('counterID-'.length), 10))) {
                countersIDs.push(num);
            } else if (arg.indexOf('propertyID-') === 0 && (num = parseInt(arg.substring('propertyID-'.length), 10))) {
                propertiesIDs.push(num);
            } else if (arg.indexOf('interactionID-') === 0 &&
                (num = parseInt(arg.substring('interactionID-'.length), 10))) {
                interactionsObjectsIDs.push(num);
            }
        }
    });

    var parameters = {
        objectsIDs: objectsIDs,
        newObjectsNames: newObjectsNames,
        templatesObjectsIDs: templatesObjectsIDs,
        interactions: interactions,
        description: description,
        order: order,
        disabled: Number(disabled),
        color: color,
        countersIDs: countersIDs,
        propertiesIDs: propertiesIDs,
        interactionsObjectsIDs: interactionsObjectsIDs
    };

    log.debug('Parsed parameters: ', parameters);
    callback(null, parameters);
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

        var countersIDs = cloneAllCounters ? rows.map(function(row) { return row.id; }) : rows.filter(function(row) {
                return parameters.countersIDs.indexOf(row.id) !== -1
            }).map(function(row) {
                return row.id
            });

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
    objectsPropertiesDB.getProperties(user, parameters.templatesObjectsIDs, function(err, propertiesObj) {
        if(err) return callback(err);

        var propertiesNames = {}; // checking for duplicate properties
        if(!cloneAllProperties) propertiesObj = propertiesObj.filter(function (property) {
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
        var properties = Object.keys(propertiesObj).filter(function (key) {
                var prop = propertiesObj[key];
                if(prop.description === undefined) prop.description = '';
                if(prop.mode !== undefined) prop.mode = Number(prop.mode);
                return prop.name && prop.value !== undefined && [0, 1, 2, 3].indexOf(prop.mode) !== -1
            }).map(function (key) {
                return propertiesObj[key];
            });

        objectsPropertiesDB.saveObjectsProperties(user, parameters.objectsIDs, properties,true,
            function(err, updatedObjectsIDs, properties) {
            if(updatedObjectsIDs.length) log.info('Changes in properties: ', properties);
            callback(err, updatedObjectsIDs)
        });
    });
}

/*
    Add uplevel objects interactions.
    user: user name
    parameters: see return of parseArgs() function
    "cloneAllInteractions" used for align parameters with saveInteraction(user, parameters, cloneAllInteractions, callback) function

    callback(err)
 */
function addUpLevelObjectsInteractions(user, parameters, cloneAllInteractions, callback) {
    objectsDB.insertInteractions(user, parameters.interactions, callback);
}

// interaction types: 0 - include; 1 - intersect, 2 - exclude
function saveInteractions(user, parameters, cloneAllInteractions, callback) {
    objectsDB.getInteractions(user, parameters.templatesObjectsIDs, function(err, rows) {
        if(err) return callback(err);

        if(cloneAllInteractions) var templateInteractions = rows;
        else templateInteractions = rows.filter(function(row) {
            return parameters.interactionsObjectsIDs.indexOf(row.id1) !== -1 ||
                parameters.interactionsObjectsIDs.indexOf(row.id2) !== -1
        });

        objectsDB.getInteractions(user, parameters.objectsIDs, function(err, rows) {
            if (err) return callback(err);

            var interactions = parameters.interactions; // interactions with upLevel objects
            parameters.objectsIDs.forEach(function (id2) {

                templateInteractions.forEach(function (interaction) {
                    if (parameters.templatesObjectsIDs.indexOf(interaction.id1) !== -1) {
                        interactions.push({
                            id1: id2,
                            id2: interaction.id2,
                            type: interaction.type
                        });
                        if (parameters.templatesObjectsIDs.indexOf(interaction.id2) !== -1) {
                            interactions.push({
                                id1: interaction.id1,
                                id2: id2,
                                type: interaction.type
                            });
                        }
                    } else if (parameters.templatesObjectsIDs.indexOf(interaction.id2) !== -1) {
                        interactions.push({
                            id1: interaction.id1,
                            id2: id2,
                            type: interaction.type
                        });
                    }

                    if(!interactions.length) return;

                    var lastInteraction = interactions[interactions.length -1];
                    for(var i = 0; i < rows.length; i++) {
                        if( (
                                rows.id1 === lastInteraction.id1 &&
                                rows.id2 === lastInteraction.id2 &&
                                rows.type === lastInteraction.type
                            ) ||
                            (
                                lastInteraction.type === 1 &&
                                (
                                    rows.id1 === lastInteraction.id2 &&
                                    rows.id2 === lastInteraction.id1 &&
                                    rows.type === lastInteraction.type
                                ))
                        ) interaction.pop();
                    }
                });
            });

            log.info('Saved interactions: ', interactions);
            if(!interactions.length) return callback();

            objectsDB.insertInteractions(user, interactions, function (err) {
                callback(err, true);
            });
        });
    });
}