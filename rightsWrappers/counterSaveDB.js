/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var counterSaveDB = require('../models_db/modifiers/countersDB');
var countersDB = require('../models_db/countersDB');
var rightsDB = require('../models_db/usersRolesRightsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');
var collectors = require('../lib/collectors');
var transaction = require('../models_db/modifiers/transaction');
var history = require('../serverHistory/historyClient');
var async = require('async');
var server = require('../server/counterProcessor');

var rightsWrapper = {};
module.exports = rightsWrapper;

/**
 * Delete counter with counterID for db and all counters data from history. counterName used only for log information
 * @param {string} username username who removed counter
 * @param {number} counterID counter ID for removing
 * @param {string} counterName counter name for removing. Used only for information
 * @param {function(Error)|function()} callback callback(err)
 * @returns {*}
 */
rightsWrapper.deleteCounter = function(username, counterID, counterName, callback) {

    if (!counterID || Number(counterID) !== parseInt(String(counterID), 10))
        return callback(new Error('Delete counter: unexpected counter: ' + counterName + '; id: ' + counterID));
    else counterID = Number(counterID);

    rightsDB.checkCounterID({
        user: prepareUser(username),
        id: counterID,
        checkChange: true
    }, function (err, counterID) {
        if (err) return callback(err);

        countersDB.getObjectCounterIDForCounter (counterID, function(err, properties){
            if(err) {
                return callback(new Error('Can\'t get properties for counter ' + counterName +
                    '(' + counterID + '): ' + err.message));
            }

            counterSaveDB.delete(counterID, function(err) {
                if(err) {
                    return callback(new Error('Can\'t delete counter ' + counterName +
                        '(' + counterID + '): ' + err.message));
                }

                var objectsCountersIDs = properties.map(function(property){
                    return property.id;
                });

                // on delete counter
                log.info('Sending message to the server and history for remove counter ',
                    counterName, '(', counterID, '); OCIDs: ', objectsCountersIDs);
                server.sendMsg({
                    removeCounters: objectsCountersIDs,
                    description: 'Counter' + counterName + '(' + counterID + ') was removed by user ' + username
                });
                history.connect('actionCounterSettings', function () {
                    history.del(objectsCountersIDs, function(err) {
                        if(err) log.error(err.message);
                    });
                });

                // Don't wait for the records to be removed from history
                // This can last a long time when the housekeeper is working.
                callback();
            });

        });
    });
};

/**
 * Save not existing object counter relations and does not save existing object counter relation
 * I.e. checks existing object counter relationships and does not save if the relationship already exists
 * @param {string} username - username
 * @param {Array<number>} initObjectIDs array of object IDs
 * @param {Array<number>} initCountersIDs array of counter IDs
 * @param {boolean} deleteExistingCounterLinks delete existing object to counter links for the objects
 * @param {function(Error)|function()|function(null, Array<{
 *     objectID; number,
 *     counterID: number,
 * }>, Array<{
 *     objectID; number,
 *     counterID: number,
 * }>, Array<{
 *     id: number,
 *     objectID; number,
 *     counterID: number,
 * }>)} callback - callback(err, objectsCountersIDs, objectsCountersIDsForDeletion, existingObjectCounters)
 */
rightsWrapper.saveObjectsCountersIDs = function(username, initObjectIDs, initCountersIDs,
                                                deleteExistingCounterLinks, callback) {

    if(!initCountersIDs && !deleteExistingCounterLinks) return callback();

    checkIDs(initCountersIDs, function(err, counterIDs) {
        if(err && !Array.isArray(counterIDs)) {
            return callback(new Error('Incorrect counters IDs: ' + err.message));
        }

        checkIDs(initObjectIDs, function(err, checkedObjectsIDs) {
            if (err && (!Array.isArray(checkedObjectsIDs) || !checkedObjectsIDs.length)) {
                return callback(new Error('Incorrect objects IDs: ' + err.message));
            }

            username = prepareUser(username);

            rightsDB.checkObjectsIDs({
                user: username,
                IDs: checkedObjectsIDs,
                checkChange: true,
                errorOnNoRights: true
            }, function (err, objectIDs) {
                if (err) return callback(err);

                if(!objectIDs || !objectIDs.length) {
                    return callback(new Error('Object IDs are not defined: ' +
                        JSON.stringify(initObjectIDs, null, 4) + ':' +
                        JSON.stringify(objectIDs, null, 4)));
                }

                countersDB.getCountersForObjects(objectIDs, function(err, rows) {
                    if (err) return callback(err);

                    var objectsCountersIDs = [];
                    counterIDs.forEach(function (counterID) {
                        // don't check user rights to counters because it's will be checking user rights to the
                        // linked objects and will
                        // deny adding a new link with the object to the counter
                        objectIDs.forEach(function (objectID) {

                            var isThisObjectCounterIDExist = false;
                            for(var j = 0; j < rows.length; j++) {
                                var row = rows[j];
                                if(row.counterID === counterID && row.objectID === objectID) {
                                    isThisObjectCounterIDExist = true;
                                    break;
                                }
                            }

                            if(!isThisObjectCounterIDExist) {
                                objectsCountersIDs.push({
                                    objectID: objectID,
                                    counterID: counterID,
                                });
                            }
                        });
                    });
                    counterSaveDB.saveObjectsCountersIDs(objectsCountersIDs, function(err) {
                        if(err) return callback(err);

                        if(!deleteExistingCounterLinks) {
                            return callback(null, objectsCountersIDs, null, rows);
                        }

                        var objectsCountersIDsForDeletion = [];
                        rows.forEach(function (row) {
                            objectIDs.forEach(function (objectID) {
                                if (objectID === row.objectID && counterIDs.indexOf(row.counterID) === -1) {
                                    objectsCountersIDsForDeletion.push({
                                        objectID: row.objectID,
                                        counterID: row.counterID,
                                    });
                                }
                            });
                        });

                        counterSaveDB.deleteObjectCounterID(objectsCountersIDsForDeletion, function (err) {
                            if(err) return callback(err);
                            callback(null, objectsCountersIDs, objectsCountersIDsForDeletion, rows);
                        });
                    });
                });
            });
        });
    });
};

/**
 * Save the counter
 * @param {string} username username
 * @param {Object} counterData counter data
 * @param {Array<number>} counterData.initObjectsIDs linked object IDs
 * @param {Object} counterData.counter counter properties
 * @param {Object} counterData.counterParameters counter parameters
 * @param {Array<Object>} counterData.updateEvents counter update events parameters
 * @param {Object} counterData.variables counter variables data
 * @param {function(Error)|function(null, number)} callback callback(err, counterID)
 */
rightsWrapper.saveCounter = function(username, counterData, callback) {

    var initObjectsIDs = counterData.initObjectsIDs;
    var counter = counterData.counter;
    var counterParameters = counterData.counterParameters;
    var updateEvents = counterData.updateEvents;
    var variables = counterData.variables;

    checkIDs(initObjectsIDs, function(err, checkedIDs) {
        if (err && (!Array.isArray(checkedIDs) || !checkedIDs.length)) {
            return callback(new Error('Incorrect objects IDs: ' + err.message));
        }

        username = prepareUser(username);
        rightsDB.checkObjectsIDs({
            user: username,
            IDs: checkedIDs,
            errorOnNoRights: true
        }, function (err, objectsIDs) {
            if (err) return callback(err);

            if (!counter.name) return callback(new Error('Counter name not specified'));

            if (!counter.collectorID) return callback(new Error('Collector ID not specified'));

            if (counter.groupID === undefined || counter.groupID === null) {
                return callback(new Error('Group ID is not specified'));
            }
            counter.groupID = Number(counter.groupID);

            if (counter.unitID && !Number(counter.unitID)) {
                return callback(new Error('Incorrect unit ID: "' + counter.unitID + '"'));
            }
            counter.unitID = Number(counter.unitID);
            if (!counter.unitID) counter.unitID = null;

            if (counter.keepHistory === undefined) counter.keepHistory = 0;
            else counter.keepHistory = Number(counter.keepHistory);

            if (counter.keepTrends === undefined) counter.keepTrends = 0;
            else counter.keepTrends = Number(counter.keepTrends);

            if (counter.sourceMultiplier === undefined || !Number(counter.sourceMultiplier)) counter.sourceMultiplier = 1;

            if(counter.disabled) counter.disabled = 1;
            else counter.disabled = 0;

            if(counter.debug) counter.debug = 1;
            else counter.debug = 0;

            if(counter.taskCondition) counter.taskCondition = 1;
            else counter.taskCondition = 0;

            // can be undefined or integer > 0
            if(counter.objectID) {
                if (!Number(counter.objectID) ||
                    Number(counter.objectID) !== parseInt(String(counter.objectID), 10)) {
                    return callback(new Error('Unexpected counter id: ' + counter.objectID));
                } else counter.objectID = Number(counter.objectID);
            }

            // can be undefined or integer > 0
            if(counter.counterID) {
                if (!Number(counter.counterID) ||
                    Number(counter.counterID) !== parseInt(String(counter.counterID), 10))
                    return callback(new Error('Unexpected counter id: ' + counter.counterID));
                else counter.counterID = Number(counter.counterID);
            }

            // in rightsDB.checkCounterID set if(counter.counterID) return callback()
            rightsDB.checkCounterID({
                user: prepareUser(username),
                id: counter.counterID,
                checkChange: true
            },function(err) {
                if(err) return callback(err);

                // callback(err, counterID)
                saveCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback);
            });
        });
    });
};

/**
 * Delete all object to counter relations for object IDs
 * @param {string} username username
 * @param {Array<number>} objectIDs object IDs
 * @param {function()|function(Error)} callback callback(err)
 */
rightsWrapper.deleteAllCountersRelationsForObject = function(username, objectIDs, callback) {
    if(!Array.isArray(objectIDs) || !objectIDs.length) return callback();

    checkIDs(objectIDs, function(err, checkedIDs) {
        if (err) return callback(err);

        username = prepareUser(username);

        rightsDB.checkObjectsIDs({
            user: username,
            IDs: checkedIDs,
            checkChange: true,
            errorOnNoRights: true,
        }, function (err, checkedObjectsIDs) {
            if (err) return callback(err);

            counterSaveDB.deleteAllCountersRelationsForObject(checkedObjectsIDs, callback);
        });
    });
};

/**
 * Save the counter
 * @param {Array<number>} objectsIDs linked object IDs
 * @param {Object} counter counter properties
 * @param {Object} counterParameters counter parameters
 * @param {Array<Object>} updateEvents counter update events parameters
 * @param {Object} variables counter variables data
 * @param {function(Error)|function(null, number)} callback callback(err, counterID)
 */
function saveCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {

    collectors.checkParameters(counter.collectorID, counterParameters, variables,
        function(err, preparedCounterParameters){
        if(err) return callback(err);

        counterParameters = preparedCounterParameters;
        log.debug('Successfully checking counter parameters: ', counterParameters);

        transaction.begin(function(err) {
            if(err) return callback(err);

            if(counter.counterID) {
                updateCounter(objectsIDs, counter, counterParameters, updateEvents, variables, function(err) {
                    if(err) return transaction.rollback(err, callback);
                    transaction.end(function(err) {
                        if(err) return callback(err);

                        // on update counters and counter not disabled
                        log.info('Sending message to the server and history for update counter ',
                            counter.name, '(', counter.counterID, ')');
                        if(!counter.disabled) {
                            server.sendMsg({
                                update: {
                                    topObjects: true,
                                    objectsCounters: true,
                                    historyVariables: true,
                                    variablesExpressions: true
                                },
                                updateCountersIDs: [counter.counterID]
                            });
                            callback(err, counter.counterID)
                        }
                        else {
                            countersDB.getObjectCounterIDForCounter(counter.counterID, function(err, rows) {
                                if(err) return callback(new Error('Can\'t get objects counters IDs for counter ' +
                                    counter.name + ' for stop collect data for disabled counter: ' + err.message));

                                var OCIDs = rows.map(row => row.id);
                                // when disable counter (and possible on update parameters)
                                log.info('Sending message to the server and history for remove disabled counter ',
                                    counter.name, '(', counter.counterID, '); OCIDs: ', OCIDs);
                                if(rows.length) server.sendMsg({
                                    removeCounters: OCIDs,
                                    description: 'Counter ' + counter.name + ' was updated in database and disabled'
                                });
                                callback(err, counter.counterID);
                            })
                        }
                    });
                });
            } else {
                insertCounter(objectsIDs, counter, counterParameters, updateEvents, variables,
                    function(err, counterID) {
                    if(err) return transaction.rollback(err, callback);

                    transaction.end(function(err) {
                        if(err) return callback(err);

                        // on create a new not disabled counter
                        log.info('Sending message to the server and history for add new counter ',
                            counter.name, '(', counterID, ')');
                        if(!counter.disabled) server.sendMsg({
                            update: {
                                topObjects: true,
                                objectsCounters: true,
                                historyVariables: true,
                                variablesExpressions: true
                            },
                            updateCountersIDs: [counterID]
                        });
                        callback(err, counterID)
                    });
                });
            }
        });
    });
}

/**
 * Update the counter
 * @param {Array<number>} objectsIDs linked object IDs
 * @param {Object} counter counter properties
 * @param {Object} counterParameters counter parameters
 * @param {Array<Object>} updateEvents counter update events parameters
 * @param {Object} variables counter variables data
 * @param {function(Error)|function()} callback callback(err)
 */
function updateCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {

    counterSaveDB.updateCounter(counter, function(err, counterID) {
        if(err) return callback(new Error('Error updating counter in counters table: ' + err.message +
        ': "' + JSON.stringify(counter, null, 4) + '"'));

        updateCounterParameters(counterID, counterParameters, function(err) {
            if(err) return callback(err);

            counterSaveDB.deleteVariables(counterID, function(err) {
                if(err) return callback(err);

                counterSaveDB.insertVariables(counterID, variables, function(err) {
                    if(err) return callback(new Error('Error inserting counter ' + counterID + ': ' + err.message +
                        '; variables: ' + JSON.stringify(variables, null, 4)));

                    updateUpdateEvents(counterID, updateEvents, function(err) {
                        if(err) return callback(err);

                        updateObjectsCountersRelations(counterID, objectsIDs, counter.name, function(err) {
                            if(err) return callback(err);

                            //updateVariablesRef=oldCounterName: update variables references when counter name is changed
                            if(!counter.updateVariablesRef) return callback();

                            counterSaveDB.updateVariablesRefs(counter.updateVariablesRef, counter.name,
                                function(err) {
                                if(err) {
                                    return callback(new Error('Can\'t update variables refers after change counter name from ' +
                                        counter.updateVariablesRef + ' to ' + counter.name + ': ' + err.message));
                                }

                                callback();
                            });
                        });
                    })
                })
            })
        })
    })
}

/**
 * Insert the counter
 * @param {Array<number>} objectsIDs linked object IDs
 * @param {Object} counter counter properties
 * @param {Object} counterParameters counter parameters
 * @param {Array<Object>} updateEvents counter update events parameters
 * @param {Object} variables counter variables data
 * @param {function(Error)|function(null, number)} callback callback(err, counterID)
 */
function insertCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {
    counterSaveDB.insertCounter(counter, function(err, counterID) {
        if(err) return callback(new Error('Error inserting counter into counters table: ' + err.message +
        ': ' + JSON.stringify(counter, null, 4)));

        counterSaveDB.insertCounterParameters(counterID, counterParameters, function(err) {
            if(err) {
                return callback(new Error('Error inserting counter ' + counterID +': ' + err.message +
                    '; parameters: '+ JSON.stringify(counterParameters, null, 4)));
            }

            counterSaveDB.insertVariables(counterID, variables, function(err) {
                if(err) {
                    return callback(new Error('Error inserting counter ' + counterID + ': ' + err.message +
                        '; variables: ' + JSON.stringify(variables, null, 4)));
                }

                counterSaveDB.insertUpdateEvents(counterID, updateEvents, function(err) {
                    if(err) {
                        return callback(new Error('Error inserting counter ' + counterID + ': ' + err.message +
                            '; update events: '+ JSON.stringify(updateEvents, null, 4)));
                    }

                    var objectsCountersIDs = objectsIDs.map(function (objectID) {
                        return {
                            objectID: objectID,
                            counterID: counterID
                        }
                    });

                    counterSaveDB.saveObjectsCountersIDs(objectsCountersIDs, function(err) {
                        if(err) {
                            return callback(new Error('Error inserting counter ' + counterID + ': ' +
                                err.message +
                                '; objects to counter relations: ' +
                                JSON.stringify(objectsCountersIDs, null, 4)));
                        }

                        callback(null, counterID);
                    })
                })
            });
        })
    })
}

/**
 * Update counter parameters
 * @param {number} counterID counter ID
 * @param {Object} counterParameters object with counter parameters: { name1: val1, name2: val2, ... }
 * @param {function(Error)|function()} callback callback(err)
 */
function updateCounterParameters(counterID, counterParameters, callback) {
    // existingParameters: [{name:..., value: ...}, {}, ....]
    countersDB.getCounterParameters(counterID, function(err, existingParameters) {
        if(err) return callback(new Error('Can\'t get existing parameters for counter ' + counterID + ': ' + err.message));

        var existingParameterNames = existingParameters.map(existingParameter => existingParameter.name);
        var parametersNamesForUpdate = Object.keys(counterParameters);
        var parametersNamesForRemove = existingParameterNames.filter(function(existingParameterName) {
            return parametersNamesForUpdate.indexOf(existingParameterName) === -1;
        });
        log.info('Existing parameters: ', existingParameterNames, '; updating parameters: ', parametersNamesForUpdate,
            '; parameters for remove: ', parametersNamesForRemove);

        counterSaveDB.deleteCounterParameters(counterID, parametersNamesForRemove, function(err) {
            if(err) {
                return callback(new Error('Error removing counter ' + counterID + ': ' + err.message +
                    ' parameters:' + JSON.stringify(parametersNamesForRemove)));
            }

            counterSaveDB.updateCounterParameters(counterID, counterParameters,
                function (err, notUpdatedParameters) {
                if(err) {
                    return callback(new Error('Error updating counter ' + counterID + ': ' + err.message) +
                        ' parameters: ' + JSON.stringify(counterParameters));
                }
                if(!Object.keys(notUpdatedParameters).length) return callback();

                counterSaveDB.insertCounterParameters(counterID, notUpdatedParameters, function(err) {
                    if(err) {
                        return callback(new Error('Error inserting counter ' + counterID + ': ' + err.message +
                            '; parameters: '+ JSON.stringify(notUpdatedParameters)));
                    }

                    callback();
                })
            })
        });
    });
}

/**
 * Update counter update events
 * @param {number} counterID counter ID
 * @param {Array<Object>} updateEvents array of the objects with update events like
 * [{counterID:, objectID:, expression:, mode: 0|1|2|3, objectFilter:, description:, updateEventOrder:}, …]
 * @param {function(Error)|function()} callback callback(err)
 */
function updateUpdateEvents(counterID, updateEvents, callback) {
    countersDB.getUpdateEvents(counterID, function(err, existingEvents) {
        if(err) return callback(new Error('Error getting update events for counter ' + counterID + ': ' + err.message));

        var eventsForRemoving = existingEvents.filter(function(event) {
            return !searchUpdateEvent(updateEvents, event);
        });

        var eventsForInserting = updateEvents.filter(function(event) {
            return !searchUpdateEvent(existingEvents, event);
        });

        log.debug('Existing events: ', existingEvents);
        log.debug('New events from action: ', updateEvents);
        log.debug('Events for inserting: ', eventsForInserting);
        log.debug('Events for removing: ', eventsForRemoving);

        // in counterSaveDB.deleteUpdateEvents set if(!eventsForRemoving.length) return callback();
        counterSaveDB.deleteUpdateEvents(counterID, eventsForRemoving, function(err) {
            if(err) {
                return callback(new Error('Error deleting counter ' + counterID + ': ' + err.message +
                    ' update events ' + JSON.stringify(eventsForRemoving, null, 4)));
            }

            // in counterSaveDB.insertUpdateEvents set if(!eventsForInserting.length) return callback();
            counterSaveDB.insertUpdateEvents(counterID, eventsForInserting, function(err) {
                if(err) {
                    return callback(new Error('Error inserting counter ' + counterID + ': ' + err.message +
                        '; update events: '+ JSON.stringify(eventsForInserting, null, 4)));
                }

                callback();
            })
        })
    })
}

/**
 * Try to find updateEvent in an array of the updateEvents
 * @param {Array<Object>} updateEvents
 * @param {Object} updateEvent
 * @return {boolean} true if updateEvent was found in the updateEvents array, else false
 */
function searchUpdateEvent(updateEvents, updateEvent) {
    for(var i = 0; i < updateEvents.length; i++) {
        if(updateEvents[i].counterID === updateEvent.counterID &&
            updateEvents[i].objectID === updateEvent.objectID &&
            updateEvents[i].expression === updateEvent.expression &&
            updateEvents[i].mode === updateEvent.mode &&
            updateEvents[i].objectFilter === updateEvent.objectFilter &&
            updateEvents[i].description === updateEvent.description &&
            updateEvents[i].updateEventOrder === updateEvent.updateEventOrder
        ) return true;
    }
    return false;
}


/**
 * Update objects to counter relations
 * @param {number} counterID counter ID
 * @param {Array<number>} objectIDs array with object IDs
 * @param {string} counterName counter name (used for log)
 * @param {function(Error)|function()} callback callback(err)
 */
function updateObjectsCountersRelations(counterID, objectIDs, counterName, callback) {

    counterSaveDB.getObjectsToCounterRelations(counterID, function(err, existingObjectsIDsObj) {
        if (err) {
            return callback(new Error('Error getting objects to counters relations for counter ' +
                counterID + ': ' + err.message));
        }

        // existingObjectsIDsObj: [{objectID:...}, {objectID: ...}, ...]. convert it to plain array
        var existingObjectsIDs = existingObjectsIDsObj.map(function(obj) { return obj.objectID });

        countersDB.getObjectCounterID(existingObjectsIDs[0], counterID, function(err, row) {
            if(err || !row) {
                return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                    existingObjectsIDs[0] + ' and counter: ' + counterName + ': ' +
                    (err ? err.message : 'relation is not found in database') ));
            }

            // remove duplicates from existing OCIDs
            var objectsCountersPairsForDeleting = existingObjectsIDs.filter(function(objectID, pos) {
                return objectIDs.indexOf(objectID) === -1 && existingObjectsIDs.indexOf(objectID) === pos;
            }).map(function (objectID) {
                return {
                    objectID: objectID,
                    counterID: counterID
                }
            });

            var objectsCountersIDsForDeleting = [];
            async.eachSeries(objectsCountersPairsForDeleting, function (objectCounterPairForDeleting, callback) {
                countersDB.getObjectCounterID(objectCounterPairForDeleting.objectID, counterID, function (err, row) {
                    if (err || !row) return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                        objectCounterPairForDeleting.objectID + ' and counter: ' + counterName + ': ' +
                        (err ? err.message : 'relation is not found in database')));

                    objectsCountersIDsForDeleting.push(row.id);
                    callback();
                });

            }, function (err) {
                if (err) return callback(err);

                // in counterSaveDB.deleteObjectCounterID set if(!objectsCountersPairsForDeleting.length) return callback();
                // delete existing OCIDs
                counterSaveDB.deleteObjectCounterID(objectsCountersPairsForDeleting, function(err) {
                    if(err) {
                        callback(new Error('Error updating counter ' + counterName +
                            ' when deleting objects to counter relations: ' + err.message +
                            ': ' +  JSON.stringify(objectsCountersPairsForDeleting)));
                    }

                    if(objectsCountersIDsForDeleting.length) {
                        // on delete some objectsCountersIDs
                        log.info('Sending message to the server and history for remove object links for the counter ',
                            counterName, '(', counterID, '); OCIDs: ', objectsCountersIDsForDeleting);
                        server.sendMsg({
                            removeCounters: objectsCountersIDsForDeleting,
                            description: 'This objects to counter ' + counterName +
                                ' relations was removed from database when updating counter'
                        });

                        // delete history only if all objects to counter relations are deleting
                        history.connect('actionCounterSettings', function () {
                            history.del(objectsCountersIDsForDeleting, function (err) {
                                if (err) log.error(err.message);
                            });
                        });
                    }

                    // Don't wait for the records to be removed from history
                    // This can last a long time when the housekeeper is working.

                    //existing 5,9,10
                    //new      9,10,12
                    // also remove duplicates
                    var objectsCountersPairsForInserting = objectIDs.filter(function(objectID, pos) {
                        return existingObjectsIDs.indexOf(objectID) === -1 && objectIDs.indexOf(objectID) === pos;
                    }).map(function (objectID) {
                        return {
                            objectID: objectID,
                            counterID: counterID
                        }
                    });

                    log.debug('Current ObjectsIDs for counter ', counterName, ' is: ', existingObjectsIDs,
                        ', new objectIDs: ', objectIDs,
                        ' objectsCountersIDs for inserting: ', objectsCountersPairsForInserting,
                        ' objectsCountersIDs for deleting: ', objectsCountersPairsForDeleting);

                    // in counterSaveDB.saveObjectsCountersIDs set if(!objectsCountersPairsForInserting) return callback()
                    counterSaveDB.saveObjectsCountersIDs(objectsCountersPairsForInserting, function(err) {
                        if(err) {
                            return callback(new Error('Error updating counter ' + counterName +
                                ' while inserting new objects to counters relations :' + err.message +
                                '; OCIDs: '+ JSON.stringify(objectsCountersPairsForInserting)));
                        }

                        callback();
                    })
                });
            });
        });
    });
}