/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var counterSaveDB = require('../models_db/counterSaveDB');
var countersDB = require('../models_db/countersDB');
var rightsDB = require('../models_db/usersRolesRightsDB');
var prepareUser = require('../lib/utils/prepareUser');
var checkIDs = require('../lib/utils/checkIDs');
var collectors = require('../lib/collectors');
var transaction = require('../models_db/transaction');
var history = require('../models_history/history');
var async = require('async');
var server = require('../lib/server');


server.connect();

var rightsWrapper = {};
module.exports = rightsWrapper;

/*
Delete counter with counterID for db and all counters data from history
user - user name
counterID - counter ID
callback(err)
 */

rightsWrapper.delete = function(user, counterID, callback) {

    if (!counterID || Number(counterID) !== parseInt(String(counterID), 10))
        return callback(new Error('Delete counter: unexpected counter id: ' + counterID));
    else counterID = Number(counterID);

    rightsDB.checkCounterID({
        user: prepareUser(user),
        id: counterID,
        checkChange: true
    }, function (err, counterID) {
        if (err) return callback(err);

        countersDB.getObjectCounterIDForCounter (counterID, function(err, properties){
            if(err) return callback(new Error('Can\'t get properties for counterID: ' + counterID + ': ' + err.message));

            counterSaveDB.delete(counterID, function(err) {
                if(err) return callback(new Error('Can\'t delete counter with ID ' + counterID + ': ' + err.message));

                var objectsCountersIDs = properties.map(function(property){
                    return property.id;
                });

                // on delete counter
                server.sendMsg({
                    removeCounters: objectsCountersIDs,
                    description: 'Counter ID ' + counterID + ' was removed from DB by user ' + user
                });
                history.del(objectsCountersIDs, function(err) {
                    if(err) log.error(err.message);
                });

                // Don't wait for the records to be removed from history.
                // This can last a long time when the housekeeper is working.
                callback();
            });

        });
    });
};

/*
    Save object counter relations

    objectsCountersIDs: array oj objects with object and counter IDs [{objectID:.., counterID:..}, {..}, ...]
    initObjectsIDs: array of objects IDs
    initCountersIDs: array of counters IDs. For each object ID will be linked all initCountersIDs
    callback(err)
 */
rightsWrapper.saveObjectsCountersIDs = function(user, initObjectIDs, initCountersIDs,  callback) {

    checkIDs(initCountersIDs, function(err, countersIDs) {
        if(err && (!Array.isArray(countersIDs) || !countersIDs.length)) return callback(new Error('Incorrect counters IDs: ' + err.message));

        checkIDs(initObjectIDs, function(err, checkedObjectsIDs) {
            if (err && (!Array.isArray(checkedObjectsIDs) || !checkedObjectsIDs.length)) return callback(new Error('Incorrect objects IDs: ' + err.message));

            user = prepareUser(user);

            rightsDB.checkObjectsIDs({
                user: user,
                IDs: checkedObjectsIDs,
                checkChange: true,
                errorOnNoRights: true
            }, function (err, objectsIDs) {
                if (err) return callback(err);

                if(!objectsIDs || !objectsIDs.length) return callback(new Error('Objects IDs are not defined: ' +
                    JSON.stringify(initObjectIDs) + ':' + JSON.stringify(objectsIDs)));

                countersDB.getCountersForObjects(objectsIDs, function(err, rows) {
                    if (err) return callback(err);

                    var objectsCountersIDs = [];
                    for (var i = 0; i < countersIDs.length; i++) {
                        var counterID = countersIDs[i];

                        // don't check user rights to counters because it's will be checking user rights to the linked objects and will
                        // deny to add a new link with the object to the counter
                        objectsIDs.forEach(function (objectID) {

                            var isThisObjectCounterIDExist = false;
                            for(var j = 0; j < rows.length; j++) {
                                var row = rows[j];
                                if(Number(row.counterID) === Number(counterID) && Number(row.objectID) === Number(objectID)) {
                                    isThisObjectCounterIDExist = true;
                                    break;
                                }
                            }

                            if(! isThisObjectCounterIDExist) {
                                objectsCountersIDs.push({
                                    objectID: objectID,
                                    counterID: counterID
                                })
                            }
                        })
                    }
                    if(objectsCountersIDs.length) counterSaveDB.saveObjectsCountersIDs(objectsCountersIDs, function(err) {
                        if(err) return callback(err);
                        callback(null, objectsCountersIDs);
                    });
                    else callback();
                });
            });
        });
    });
};


rightsWrapper.saveCounter = function(user, initObjectsIDs, counter, counterParameters, updateEvents, variables, callback) {
    log.debug('Saving counter into the database', counter, '; linked objects: ', initObjectsIDs);

    checkIDs(initObjectsIDs, function(err, checkedIDs) {
        if (err && (!Array.isArray(checkedIDs) || !checkedIDs.length)) return callback(new Error('Incorrect objects IDs: ' + err.message));

        user = prepareUser(user);
        rightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            errorOnNoRights: true
        }, function (err, objectsIDs) {
            if (err) return callback(err);

            if (!counter.name) return callback(new Error('Counter name not specified'));

            if (!counter.collectorID) return callback(new Error('Collector ID not specified'));

            if (counter.groupID === undefined || counter.groupID === null) return callback(new Error('Group ID is not specified'));
            counter.groupID = Number(counter.groupID);

            if (counter.unitID && !Number(counter.unitID)) return callback(new Error('Incorrect unit ID: "' + counter.unitID + '"'));
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
                if (!Number(counter.objectID) || Number(counter.objectID) !== parseInt(String(counter.objectID), 10))
                    return callback(new Error('Unexpected counter id: ' + counter.objectID));
                else counter.objectID = Number(counter.objectID);
            }

            // can be undefined or integer > 0
            if(counter.counterID) {
                if (!Number(counter.counterID) || Number(counter.counterID) !== parseInt(String(counter.counterID), 10))
                    return callback(new Error('Unexpected counter id: ' + counter.counterID));
                else counter.counterID = Number(counter.counterID);

                var checkCounterRights = function(callback) {
                    rightsDB.checkCounterID({
                        user: prepareUser(user),
                        id: counter.counterID,
                        checkChange: true
                    }, callback);
                }
            } else checkCounterRights = function(callback) { callback() };

            checkCounterRights( function(err) {
                if(err) return callback(err);

                // callback(err, counterID)
                saveCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback);
            });
        });
    });
};

function saveCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {

    collectors.checkParameters(counter.collectorID, counterParameters, variables, function(err, preparedCounterParameters){
        if(err) return callback(err);

        counterParameters = preparedCounterParameters;
        log.debug('Successfully checking counter parameters: ', counterParameters);

        transaction.begin(function(err) {
            if(err) return callback(err);

            if(counter.counterID) updateCounter(objectsIDs, counter, counterParameters, updateEvents, variables, function(err) {
                if(err) return transaction.rollback(err, callback);
                transaction.end(function(err) {
                    if(err) return callback(err);

                    // on update counters and counter not disabled
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
                                counter.counterID + ' for stop collect data for disabled counter: ' + err.message));

                            // on disable counter (and possible on update parameters)
                            if(rows.length) server.sendMsg({
                                removeCounters: rows.map(function (row) {
                                    return row.id;
                                }),
                                description: 'Counter ' + JSON.stringify(counter) + ' was updated in database'
                            });
                            callback(err, counter.counterID);
                        })
                    }
                });
            });
            else insertCounter(objectsIDs, counter, counterParameters, updateEvents, variables, function(err, counterID) {
                if(err) return transaction.rollback(err, callback);

                transaction.end(function(err) {
                    if(err) return callback(err);

                    // on create a new not disabled counter
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
        });
    });
}

function updateCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {

    counterSaveDB.updateCounter(counter, function(err, counterID) {
        if(err) return callback(new Error('Error updating counter "' + JSON.stringify(counter) +
            '" in counters table: ' + err.message));

        updateCounterParameters(counterID, counterParameters, function(err) {
            if(err) return callback(err);

            counterSaveDB.deleteVariables(counterID, function(err) {
                if(err) return callback(err);

                counterSaveDB.insertVariables(counterID, variables, function(err) {
                    if(err) return callback(new Error('Error inserting counter ' + counterID +
                        ' variables "' + JSON.stringify(variables) + '": ' + err.message));

                    updateUpdateEvents(counterID, updateEvents, function(err) {
                        if(err) return callback(err);

                        updateObjectsCountersRelations(counterID, objectsIDs, function(err) {
                            if(err) return callback(err);

                            //updateVariablesRef=oldCounterName: update variables references when counter name is changed
                            if(!counter.updateVariablesRef) return callback();

                            counterSaveDB.updateVariablesRefs(counter.updateVariablesRef, counter.name, function(err) {
                                if(err) return callback(new Error('Can\'t update variables refers after change counter name from ' +
                                    counter.updateVariablesRef + ' to ' + counter.name + ': ' + err.message));

                                callback();
                            });
                        });
                    })
                })
            })
        })
    })
}

function insertCounter(objectsIDs, counter, counterParameters, updateEvents, variables, callback) {
    counterSaveDB.insertCounter(counter, function(err, counterID) {
        if(err) return callback(new Error('Error inserting counter "' + JSON.stringify(counter) +
            '" into counters table: ' + err.message));

        counterSaveDB.insertCounterParameters(counterID, counterParameters, function(err) {
            if(err) return callback(new Error('Error inserting counter ' + counterID +
                ' parameters "'+ JSON.stringify(counterParameters) +'": ' + err.message));

            counterSaveDB.insertVariables(counterID, variables, function(err) {
                if(err) return callback(new Error('Error inserting counter ' + counterID +
                    ' variables "' + JSON.stringify(variables) + '": ' + err.message));

                counterSaveDB.insertUpdateEvents(counterID, updateEvents, function(err) {
                    if(err) return callback(new Error('Error inserting counter ' + counterID +
                        ' update events "'+ JSON.stringify(updateEvents) +'": ' + err.message));

                    var objectsCountersIDs = objectsIDs.map(function (objectID) {
                        return {
                            objectID: objectID,
                            counterID: counterID
                        }
                    });

                    counterSaveDB.saveObjectsCountersIDs(objectsCountersIDs, function(err) {
                        if(err) return callback(new Error('Error inserting counter ' + counterID +
                            ' objects to counters relations "' + JSON.stringify(objectsCountersIDs) + '": ' +
                            err.message));

                        callback(null, counterID);
                        /*
                        async.each(objectsCountersIDs, function(obj, callback) {

                            countersDB.getObjectCounterID(obj.objectID, obj.counterID, function(err, row) {
                                if(err || !row) return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                                    row.objectID + ' and counterID: ' + row.counterID + ': ' +
                                    (err ? err.mesage : 'relation is not found in database') ));

                                // don't wait while starage is created
                                history.createStorage(row.id, function(err) {
                                    if(err) log.error('Error creating storage while save counter: ' + err.message);
                                });
                                callback();
                            });
                        }, function(err) {
                            callback(err, counterID);
                        });

                         */
                    })
                })
            });
        })
    })
}

/*
    update counter parameters

    counterID: counter ID
    counterParameters object with counter parameters: { name1: val1, name2: val2, ... }
    callback(err);
 */

function updateCounterParameters(counterID, counterParameters, callback) {

    // existingParameters: [{name:..., value: ...}, {}, ....]
    countersDB.getCounterParameters(counterID, function(err, existingParameters) {
        if(err) return callback(new Error('Can\'t get existing parameters for counter ' + counterID + ': ' + err.message));

        var parametersNamesForRemoving = existingParameters.map(function(existingParameter) {
            return existingParameter.name;
        }).filter(function(existingParameterName) {
            return Object.keys(counterParameters).indexOf(existingParameterName) === -1;
        });

        counterSaveDB.deleteCounterParameters(counterID, parametersNamesForRemoving, function(err) {
            if(err) return callback(new Error('Error removing counter ' + counterID +
                ' parameters "' + JSON.stringify(parametersNamesForRemoving) + '": ' + err.message));

            counterSaveDB.updateCounterParameters(counterID, counterParameters, function (err, notUpdatedParameters) {
                if(err) return callback(new Error('Error updating counter ' + counterID +
                    ' parameters "' + JSON.stringify(counterParameters) + '": ' + err.message));

                if(!Object.keys(notUpdatedParameters).length) return callback();

                counterSaveDB.insertCounterParameters(counterID, notUpdatedParameters, function(err) {
                    if(err) return callback(new Error('Error inserting counter ' + counterID +
                        ' parameters "'+ JSON.stringify(notUpdatedParameters) +'": ' + err.message));

                    callback();
                })
            })
        });
    });
}

function updateUpdateEvents(counterID, updateEvents, callback) {
    countersDB.getUpdateEvents(counterID, function(err, existingEvents) {
        if(err) return callback(new Error('Error getting update events for counter ' + counterID + ': ' + err.message));

        var eventsForRemoving = existingEvents.filter(function(event) {
            return updateEventCompare(updateEvents, event);
        });

        var eventsForInserting = updateEvents.filter(function(event) {
            return updateEventCompare(existingEvents, event);
        });

        if(eventsForRemoving.length) var deleteUpdateEvents = counterSaveDB.deleteUpdateEvents;
        else deleteUpdateEvents = function(counterID, eventsForRemoving, callback) { callback() };

        log.debug('Existing events: ', existingEvents);
        log.debug('New events from action: ', updateEvents);
        log.debug('Events for inserting: ', eventsForInserting);
        log.debug('Events for removing: ', eventsForRemoving);

        deleteUpdateEvents(counterID, eventsForRemoving, function(err) {
            if(err) return callback(new Error('Error deleting counter ' + counterID + ' update events "' +
                JSON.stringify(eventsForRemoving) + '": ' + err.message));

            if(!eventsForInserting.length) return callback();

            counterSaveDB.insertUpdateEvents(counterID, eventsForInserting, function(err) {
                if(err) return callback(new Error('Error inserting counter ' + counterID +
                    ' update events "'+ JSON.stringify(eventsForInserting) +'": ' + err.message));

                callback();
            })
        })
    })

    function updateEventCompare(updateEvents, event) {
        for(var i = 0; i < updateEvents.length; i++) {
            if(updateEvents[i].counterID === event.counterID &&
                updateEvents[i].objectID === event.objectID &&
                updateEvents[i].expression === event.expression &&
                updateEvents[i].mode === event.mode &&
                updateEvents[i].objectFilter === event.objectFilter &&
                updateEvents[i].description === event.description &&
                updateEvents[i].updateEventOrder === event.updateEventOrder
            ) return false;
        }
        return true;
    }
}

function updateObjectsCountersRelations(counterID, objectsIDs, callback) {

    counterSaveDB.getObjectsToCounterRelations(counterID, function(err, existingObjectsIDsObj) {
        if (err) return callback(new Error('Error getting objects to counters relations for counter ' + counterID + ': ' + err.message));

        // existingObjectsIDsObj: [{objectID:...}, {objectID: ...}, ...]. convert it to plain array
        var existingObjectsIDs = existingObjectsIDsObj.map(function(obj) { return obj.objectID });

        /*
        existing 5,9,10
        new        9,10,12
         */

        // also remove duplicates
        var objectsCountersPairsForInserting = objectsIDs.filter(function(objectID, pos) {
            return existingObjectsIDs.indexOf(objectID) === -1 && objectsIDs.indexOf(objectID) === pos;
        }).map(function (objectID) {
            return {
                objectID: objectID,
                counterID: counterID
            }
        });

        // also remove duplicates
        var objectsCountersPairsForDeleting = existingObjectsIDs.filter(function(objectID, pos) {
            return objectsIDs.indexOf(objectID) === -1 && existingObjectsIDs.indexOf(objectID) === pos;
        }).map(function (objectID) {
            return {
                objectID: objectID,
                counterID: counterID
            }
        });

        countersDB.getObjectCounterID(existingObjectsIDs[0], counterID, function(err, row) {
            if(err || !row) return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                existingObjectsIDs[0] + ' and counterID: ' + counterID + ': ' +
                (err ? err.mesage : 'relation is not found in database') ));

                log.debug('Current ObjectsIDs for counterID ', counterID, ' is: ', existingObjectsIDs,
                    ', new objectsIDs: ', objectsIDs,
                    ' objectsCountersIDs for inserting: ', objectsCountersPairsForInserting,
                    ' objectsCountersIDs for deleting: ', objectsCountersPairsForDeleting);

                if(!objectsCountersPairsForDeleting.length)
                    var deleteObjectsCountersIDs = function(callback) { callback(); };
                else deleteObjectsCountersIDs = function(callback) {

                    var objectsCountersIDsForDeleting = [];
                    async.eachLimit(objectsCountersPairsForDeleting, 1000,function (objectCounterPairForDeleting, callback) {
                        countersDB.getObjectCounterID(objectCounterPairForDeleting.objectID, counterID, function (err, row) {

                            if (err || !row) return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                                objectCounterPairForDeleting.objectID + ' and counterID: ' + counterID + ': ' +
                                (err ? err.mesage : 'relation is not found in database')));

                            objectsCountersIDsForDeleting.push(row.id);
                            callback();
                        });

                    }, function (err) {
                        if (err) return callback(err);

                        counterSaveDB.deleteObjectCounterID(objectsCountersPairsForDeleting, function(err) {
                            if(err) return callback(err);

                            // on delete some objectsCountersIDs
                            server.sendMsg({
                                removeCounters: objectsCountersIDsForDeleting,
                                description: 'This objects to counters relations was removed from database'
                            });

                            // delete history only if all objects to counter relations are deleting
                            history.del(objectsCountersIDsForDeleting, function(err) {
                                if(err) log.error(err.message);
                            });

                            // Don't wait for the records to be removed from history.
                            // This can last a long time when the housekeeper is working.
                            callback();
                        });
                    }
                );
            };

            deleteObjectsCountersIDs(function(err) {
                if(err) return callback(new Error('Error updating counter ' + counterID +
                    ' when deleting objects to counters relations "' +
                    JSON.stringify(objectsCountersPairsForDeleting) + '": ' + err.message));

                // no objectsCountersIDs for inserting
                if(!objectsCountersPairsForInserting.length) return callback();

                counterSaveDB.saveObjectsCountersIDs(objectsCountersPairsForInserting, function(err) {
                    if(err) return callback(new Error('Error updating counter ' + counterID +
                        ' while inserting new objects to counters relations "' +
                        JSON.stringify(objectsCountersPairsForInserting) + '": ' +  err.message));

                    callback();
                    /*
                    async.each(objectsCountersPairsForInserting, function(obj, callback) {

                        countersDB.getObjectCounterID(obj.objectID, obj.counterID, function(err, row) {
                            if(err || !row) return callback(new Error('Can\'t get objectCounterID for objectID: ' +
                                row.objectID + ' and counterID: ' + row.counterID + ': ' +
                                (err ? err.mesage : 'relation is not found in database') ));

                            // don't wait while starage is created
                            history.createStorage(row.id, function(err) {
                                if(err) log.error('Error creating storage while save counter: ' + err.message);
                            });
                            callback();
                        });
                    }, callback);
                     */
                })
            });
        });
    });
}