/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var db = require('../lib/db');
var async = require('async');

var counterSaveDB = {};
module.exports = counterSaveDB;


/*
    Delete counter

    counterID: counter ID
    callback(err)
 */
counterSaveDB.delete = function(counterID, callback) {
    log.debug('Deleting counter with ID ', counterID);

    db.run('DELETE FROM counters WHERE counters.id = ?', counterID, callback);
};

/*
    Updating a new counter into the database

    counter: counter object, see SQL query for details
    callback(err, counterID)

    counterID: counter ID of updated counter

 */
counterSaveDB.updateCounter = function(counter, callback) {
    log.debug('Updating counter with ID '+counter.counterID+' into the database', counter);

    db.run (
        'UPDATE counters SET name = $name, collectorID = $collectorID,' +
        'groupID = $groupID, unitID=$unitID, sourceMultiplier = $sourceMultiplier,' +
        'keepHistory=$keepHistory, keepTrends=$keepTrends, modifyTime=$modifyTime, description=$description, ' +
        'disabled=$disabled, debug=$debug, taskCondition=$taskCondition ' +
        'WHERE counters.id = $counterID', {
            $name: counter.name,
            $collectorID: counter.collectorID,
            $groupID: counter.groupID,
            $unitID: counter.unitID,
            $sourceMultiplier: counter.sourceMultiplier,
            $keepHistory: counter.keepHistory,
            $keepTrends: counter.keepTrends,
            $counterID: counter.counterID,
            $modifyTime: Date.now(),
            $description: counter.description,
            $disabled: counter.disabled,
            $debug: counter.debug,
            $taskCondition: counter.taskCondition,

        }, function(err) {
            if(err) return callback(err);
            callback(null, counter.counterID);
        }
    );
};

/*
    Inserting a new counter into the database

    counter: counter object, see SQL query for details
    callback(err, counterID)

    counterID: counter ID of inserted counter

 */
counterSaveDB.insertCounter = function(counter, callback) {
    log.debug('Inserting new counter into the database: ', counter);

    db.run (
        'INSERT INTO counters (name, collectorID, groupID, unitID, sourceMultiplier, keepHistory, keepTrends, ' +
        'modifyTime, created, description, disabled, debug, taskCondition) ' +
        'VALUES ($name, $collectorID, $groupID, $unitID, $sourceMultiplier, $keepHistory, $keepTrends, ' +
        '$modifyTime, $created, $description, $disabled, $debug, $taskCondition)', {
            $name: counter.name,
            $collectorID: counter.collectorID,
            $groupID: counter.groupID,
            $unitID: counter.unitID,
            $sourceMultiplier: counter.sourceMultiplier,
            $keepHistory: counter.keepHistory,
            $keepTrends: counter.keepTrends,
            $modifyTime: Date.now(),
            $created: Date.now(),
            $description: counter.description,
            $disabled: counter.disabled,
            $debug: counter.debug,
            $taskCondition: counter.taskCondition,
        }, function(err) {
            if(err) return callback(err);
            callback(null, Number(this.lastID));
        }
    );
};


/*
    Update counter parameters from database

    counterID: counter ID
    counterParameters: counter parameters  {name1: value, name2: value:...}
    callback(err, notUpdatedParameters)

    notUpdatedParameters: parameters, which not updated (f.e. they are not existing in DB) {name1: value, name2: value:...}
 */

counterSaveDB.updateCounterParameters = function(counterID, counterParameters, callback) {
    log.debug('Updating counter parameters into the database for counterID: ', counterID, counterParameters);

    var stmt = db.prepare('UPDATE counterParameters set name=$name, value=$value, counterID=$counterID WHERE counterID=$counterID AND name=$name',
        function(err){
            if(err) return callback(err);

            var notUpdatedParameters = {};

            // eachOfSeries used for possible transaction rollback if error occurred
            async.eachOfSeries(counterParameters, function(value, name, callback) {
                stmt.run( {
                    $counterID: counterID,
                    $name: name,
                    $value: value
                }, function(err) {
                    if(err) return callback(err);

                    // count of changes
                    if(this.changes !== 1) notUpdatedParameters[name] = value;
                    callback();
                });
            }, function(err) {
                stmt.finalize();
                if(err) return callback(err);
                callback(null, notUpdatedParameters);
            });
        }
    );
};

/*
    Insert counter parameters from database

    counterID: counter ID
    counterParameters: counter parameters  {name1: value, name2: value:...}
    callback(err)
 */


counterSaveDB.insertCounterParameters = function(counterID, counterParameters, callback) {
    log.debug('Inserting counter parameters into the database for counterID: ', counterID, ': ', counterParameters);

    var stmt = db.prepare('INSERT INTO counterParameters (name, value, counterID) VALUES ($name, $value, $counterID)',
        function(err){
            if(err) return callback(err);

            // eachOfSeries used for possible transaction rollback if error occurred
            async.eachOfSeries(counterParameters, function(value, name, callback) {
                stmt.run( {
                    $counterID: counterID,
                    $name: name,
                    $value: value
                }, function(err) {
                    if(err) return callback(err);

                    // count of changes
                    callback();
                });
            }, function(err) {
                stmt.finalize();
                callback(err);
            });
        });
};

/*
    Delete counter parameters from database

    counterID: counter ID
    counterParametersNames: counter parameters  names [name1, name2, ....]
    callback(err)
 */

counterSaveDB.deleteCounterParameters = function(counterID, counterParametersNames, callback) {

    if(!counterParametersNames.length) return callback();

    log.debug('Remove counter parameters for counterID: ', counterID, counterParametersNames);

    var questionStr = counterParametersNames.map(function(){return '?'}).join(',');

    var counterIDAndCounterParameters = [counterID];
    Array.prototype.push.apply(counterIDAndCounterParameters, counterParametersNames);

    db.run('DELETE FROM counterParameters WHERE counterParameters.counterID = ? AND counterParameters.name IN ('+
        questionStr+')', counterIDAndCounterParameters, callback);
};

counterSaveDB.getObjectsToCounterRelations = function(counterID, callback) {
    db.all('SELECT objectID FROM objectsCounters WHERE counterID=?', counterID, callback);
};

/*
    Save objects counters IDs

    objectsCountersIDs = [{objectID:...,  counterID:...}, ... ]
    callback(err)
 */
counterSaveDB.saveObjectsCountersIDs = function (objectsCountersIDs, callback) {
    log.debug('Inserting object to counter relations into the database: ', objectsCountersIDs);

    var stmt = db.prepare('INSERT INTO objectsCounters (objectID, counterID) VALUES ($objectID, $counterID)');
    async.eachSeries(objectsCountersIDs, function(obj, callback) {
        stmt.run({
            $objectID: obj.objectID,
            $counterID: obj.counterID
        }, function(err) {
            if(err) return callback(new Error('Error inserting object (' + obj.objectID + ') to counter (' + obj.counterID
                + ') relations to the database: ' + err.message));
            callback();
        });
    }, function(err) {
        stmt.finalize();
        callback(err);
    });
};

/*
    Delete objects counters relations

    OCID = [{objectID:...,  counterID:...}, ... ]
    callback(err)
 */
counterSaveDB.deleteObjectCounterID = function (objectsCountersIDs, callback) {
    log.info('Delete object to counter relations from the database: ', objectsCountersIDs);

    var stmt = db.prepare('DELETE FROM objectsCounters WHERE objectID=$objectID AND counterID=$counterID');
    async.eachSeries(objectsCountersIDs, function(obj, callback) {
        stmt.run({
            $objectID: obj.objectID,
            $counterID: obj.counterID
        }, function(err) {
            if(err) return callback(new Error('Error deleting object (' + obj.objectID + ') to counter (' + obj.counterID
                + ') relations from the database: ' + err.message));
            callback();
        });
    }, function(err) {
        stmt.finalize();
        callback(err);
    });
};

/*
    Insert update events for counter

    counterID: counter ID
    updateEvents: array of objects with update events
    [{objectID:<parent object ID>, expression:<string with expression>, mode: <0|1|2|3|4>, objectFilter}, {..}, ...]
    callback(err)
 */
counterSaveDB.insertUpdateEvents = function(counterID, updateEvents, callback) {
    log.debug('Trying to insert update events for ', counterID, ':', updateEvents);

    var stmt = db.prepare('INSERT INTO countersUpdateEvents (counterID, parentCounterID, parentObjectID, expression, ' +
        'mode, objectFilter, description, updateEventOrder) ' +
        'VALUES ($counterID, $parentCounterID, $parentObjectID, $expression, $mode, $objectFilter, ' +
        '$description, $updateEventOrder)',
        function(err) {
            if(err) return callback(err);

            async.eachSeries(updateEvents, function(updateEvent, callback) {
                stmt.run({
                    $counterID: counterID,
                    $parentCounterID: updateEvent.counterID,
                    $parentObjectID: updateEvent.objectID,
                    $expression: updateEvent.expression,
                    $mode: updateEvent.mode,
                    $objectFilter: updateEvent.objectFilter ? updateEvent.objectFilter : null,
                    $description: updateEvent.description,
                    $updateEventOrder: updateEvent.updateEventOrder,
                }, callback);
            }, function(err) {
                stmt.finalize();
                callback(err);
            })
        });
};


/*
    delete update events for counter

    counterID: counter ID
    updateEvents: array of objects with update events
        [{objectID:<parent object ID>, expression:<string with expression>, mode: <0|1|2|3|4>}, {..}, ...]
    callback(err)
 */
counterSaveDB.deleteUpdateEvents = function (counterID, updateEvents, callback) {
    log.debug('Delete update events from database for counterID: ', counterID, updateEvents);

    var queryParams = [], queryStr = [];

    updateEvents.forEach(function(updateEvent) {
        queryParams.push(counterID, updateEvent.counterID, updateEvent.mode);
        var partOfQueryStr = '(counterID=? AND parentCounterID=? AND mode=?';

        if(updateEvent.objectID) {
            queryParams.push(updateEvent.objectID);
            partOfQueryStr += ' AND parentObjectID=?';
        } else partOfQueryStr += ' AND parentObjectID IS NULL';

        if(updateEvent.expression) {
            queryParams.push(updateEvent.expression);
            partOfQueryStr += ' AND expression=?';
        } else partOfQueryStr += ' AND expression IS NULL';

        partOfQueryStr += ')';
        queryStr.push(partOfQueryStr);

    });

    db.run('DELETE FROM countersUpdateEvents WHERE ' + queryStr.join(' OR '), queryParams, callback)
};

/*
    Inserting new variables for counter

    counterID: counter ID
    variables: {name1: {expression: <expression> }, name2: {},...} or
        {objectID:.., parentCounterName:.., function:.., functionParameters:..., objectName:...}

    callback(err)
 */
counterSaveDB.insertVariables = function (counterID, variables, callback) {
    log.debug('Insert variables for ', counterID, ': ', variables);

    var stmt = db.prepare(
        'INSERT INTO variables (counterID, name, objectID, parentCounterName, function, functionParameters, objectName, ' +
        'description, variableOrder) ' +
        'VALUES ($counterID, $name, $objectID, $parentCounterName, $function, $functionParameters, $objectName,' +
        '$description, $variableOrder)',
        function(err){
            if(err) return callback(err);

            var stmtExpression = db.prepare(
                'INSERT INTO variablesExpressions (counterID, name, expression, description, variableOrder) ' +
                'VALUES ($counterID, $name, $expression, $description, $variableOrder)',

                function(err){
                    if(err) return callback(err);

                    // eachSeries used for transaction
                    async.eachSeries(Object.keys(variables), function(name, callback) {
                        if(variables[name].expression) {

                            log.debug('Inserting variable expression '+name, variables[name]);
                            stmtExpression.run({
                                $counterID: counterID,
                                $name: name,
                                $expression: variables[name].expression,
                                $description: variables[name].description,
                                $variableOrder: variables[name].variableOrder,
                            }, callback);
                        } else {

                            log.debug('Inserting variable ' + name, variables[name]);
                            stmt.run({
                                $counterID: counterID,
                                $name: name,
                                $objectID: variables[name].objectID,
                                $parentCounterName: variables[name].parentCounterName,
                                $function: variables[name].function,
                                $functionParameters: variables[name].functionParameters,
                                $objectName: variables[name].objectName,
                                $description: variables[name].description,
                                $variableOrder: variables[name].variableOrder,
                            }, callback)
                        }
                    }, function(err) {
                        stmt.finalize();
                        callback(err);
                    })
                }
            );
        }
    );
};

/*
    When update counter, delete previous variables

    counterID: counter ID
    callback(err)
*/
counterSaveDB.deleteVariables = function (counterID, callback){
    log.debug('Remove all variables for counter ID ', counterID);

    db.run('DELETE FROM variables WHERE variables.counterID = ?', counterID, function(err){
        if(err) return callback(new Error('Can\'t delete previous variables for counter ID '+counterID+': '+err.message));

        db.run('DELETE FROM variablesExpressions WHERE variablesExpressions.counterID = ?', counterID, function (err) {
            if (err) return callback(new Error('Can\'t delete previous variables with expressions for counter ID ' + counterID + ': ' + err.message));
            callback();
        });
    });
};

/*
    Update parent counter name for variables when counter name is changed
    newCounterName: new counter name
    oldCounterName: old counter name

    callback(err)

 */
counterSaveDB.updateVariablesRefs = function(oldCounterName, newCounterName, callback) {
    log.debug('Updating variables refers for counter ', oldCounterName , '->', newCounterName);

    db.run ('UPDATE variables SET parentCounterName = $newCounterName WHERE parentCounterName = $oldCounterName COLLATE NOCASE', {
            $newCounterName: newCounterName.toUpperCase(),
            $oldCounterName: oldCounterName
        }, callback);
};