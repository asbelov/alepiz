/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const db = require('../db');
const async = require('async');
const unique = require('../../lib/utils/unique');

var countersDB = {};
module.exports = countersDB;


/*
    Delete counter

    counterID: counter ID
    callback(err)
 */
countersDB.delete = function(counterID, callback) {
    log.info('Deleting counter with ID ', counterID);

    db.run('DELETE FROM counters WHERE counters.id = ?', counterID, callback);
};

/*
    Updating a new counter into the database

    counter: counter object, see SQL query for details
    callback(err, counterID)

    counterID: counter ID of updated counter

 */
countersDB.updateCounter = function(counter, callback) {
    log.info('Updating counter with ID ' + counter.counterID + ' into the database', counter);

    db.run(
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
            $modifyTime: counter.timestamp,
            $description: counter.description,
            $disabled: counter.disabled,
            $debug: counter.debug,
            $taskCondition: counter.taskCondition,

        },
        function(err) {
            if (err) return callback(err);
            callback(null, counter.counterID);
        }
    );
};

/**
 * Inserting a new counter into the database
 * @param {Object} counter - object with a counter parameters
 * @param {string} counter.name - counter name
 * @param {string} counter.collectorID - collector name (collector directory)
 * @param {number} counter.groupID - group ID
 * @param {number} counter.unitID - unit ID
 * @param {number} counter.sourceMultiplier - source multiplier
 * @param {number} counter.keepHistory - days to keep historical data
 * @param {number} counter.keepTrends - days to keep trends
 * @param {string} counter.description counter description
 * @param {0|1} counter.disabled - is counter disabled
 * @param {0|1} counter.debug - need to debug counter
 * @param {number} counter.taskCondition - counter taskCondition
 * @param {number} sessionID - unique sessionID
 * @param {function(Error) | function(null, counterID:number)} callback - callback(err, counterID) where counterID is a new
 * counter ID
 */
countersDB.insertCounter = function(counter, sessionID, callback) {
    const id = unique.createHash(JSON.stringify(counter) + sessionID);
    log.info('Inserting new counter ', id, ' into the database: ', counter);

    db.run(
        'INSERT INTO counters (id, name, collectorID, groupID, unitID, sourceMultiplier, keepHistory, keepTrends, ' +
        'modifyTime, created, description, disabled, debug, taskCondition) ' +
        'VALUES ($id, $name, $collectorID, $groupID, $unitID, $sourceMultiplier, $keepHistory, $keepTrends, ' +
        '$modifyTime, $created, $description, $disabled, $debug, $taskCondition)', {
            $id: id,
            $name: counter.name,
            $collectorID: counter.collectorID,
            $groupID: counter.groupID,
            $unitID: counter.unitID,
            $sourceMultiplier: counter.sourceMultiplier,
            $keepHistory: counter.keepHistory,
            $keepTrends: counter.keepTrends,
            $modifyTime: counter.timestamp,
            $created: counter.timestamp,
            $description: counter.description,
            $disabled: counter.disabled,
            $debug: counter.debug,
            $taskCondition: counter.taskCondition,
        },
        function(err, info) {
            if (err) return callback(err);
            callback(null, this.lastID === undefined ? info.lastInsertRowid : this.lastID);
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

countersDB.updateCounterParameters = function(counterID, counterParameters, callback) {
    log.info('Updating counter parameters into the database for counterID: ', counterID, counterParameters);

    var stmt = db.prepare('UPDATE counterParameters set name=$name, value=$value, counterID=$counterID WHERE counterID=$counterID AND name=$name',
        function(err) {
            if (err) return callback(err);

            var notUpdatedParameters = {};

            // eachOfSeries used for possible transaction rollback if error occurred
            async.eachOfSeries(counterParameters, function(value, name, callback) {
                stmt.run({
                    $counterID: counterID,
                    $name: name,
                    $value: value === null ? null : String(value),
                }, function(err, info) {
                    if (err) return callback(err);

                    // count of changes
                    var changes = info && info.changes !== undefined ? info.changes : this.changes;
                    if (changes !== 1) notUpdatedParameters[name] = value;
                    callback();
                });
            }, function(err) {
                stmt.finalize();
                if (err) return callback(err);
                callback(null, notUpdatedParameters);
            });
        }
    );
};

/**
 * Insert counter parameters from database for specific counterID
 * @param {Number} counterID - counter ID
 * @param {Object} counterParameters - objects with a counter parameters like {<name>: <value>, ....}
 * @param {function(Error|undefined)} callback - callback(err)
 */
countersDB.insertCounterParameters = function(counterID, counterParameters, callback) {
    log.info('Inserting counter parameters into the database for counterID: ', counterID, ': ', counterParameters);

    var stmt = db.prepare(
        'INSERT INTO counterParameters (id, name, value, counterID) VALUES ($id, $name, $value, $counterID)',
        function(err) {
            if (err) return callback(err);

            // eachOfSeries used for possible transaction rollback if error occurred
            async.eachOfSeries(counterParameters, function(value, name, callback) {
                const id = unique.createHash(counterID.toString(36) + name + value);

                stmt.run({
                    $id: id,
                    $counterID: counterID,
                    $name: name,
                    $value: value === null ? null : String(value),
                }, function(err) {
                    if (err) return callback(err);

                    // count of changes
                    callback();
                });
            }, function(err) {
                stmt.finalize();
                callback(err);
            });
        }
    );
};

/*
    Delete counter parameters from database

    counterID: counter ID
    counterParametersNames: counter parameters  names [name1, name2, ....]
    callback(err)
 */

countersDB.deleteCounterParameters = function(counterID, counterParametersNames, callback) {

    if (!counterParametersNames.length) return callback();

    log.info('Remove counter parameters for counterID: ', counterID, counterParametersNames);

    var questionStr = counterParametersNames.map(function() { return '?' }).join(',');

    var counterIDAndCounterParameters = [counterID];
    Array.prototype.push.apply(counterIDAndCounterParameters, counterParametersNames);

    db.run('DELETE FROM counterParameters WHERE counterParameters.counterID = ? AND counterParameters.name IN (' +
        questionStr + ')', counterIDAndCounterParameters, callback);
};

/**
 * Get objectIDs which linked to the specific counterID, using SELECT objectID FROM objectsCounters WHERE counterID=?
 * @param {uint} counterID - counterID
 * @param {function} callback - callback(err, rows), where rows [{objectID:...}, {objectID:...}, ....]
 */
countersDB.getObjectsToCounterRelations = function(counterID, callback) {
    db.all('SELECT objectID FROM objectsCounters WHERE counterID=?', counterID, callback);
};

/**
 * Save object counter IDs
 * @param {Array} objectsCountersIDs - array of the objectID and counterID [{objectID:...,  counterID:...}, ... ]
 * @param {function} callback - callback(err)
 */
countersDB.saveObjectsCountersIDs = function(objectsCountersIDs, callback) {
    if(!objectsCountersIDs.length) return callback();

    log.info('Inserting object to counter relations into the database: ', objectsCountersIDs);

    var stmt = db.prepare('INSERT INTO objectsCounters (id, objectID, counterID) VALUES ($id, $objectID, $counterID)',
        function(err) {
        if (err) return callback(err);
        async.eachSeries(objectsCountersIDs, function(obj, callback) {
            const id = unique.createHash(obj.objectID.toString(36) + obj.counterID.toString(36));

            stmt.run({
                $id: id,
                $objectID: obj.objectID,
                $counterID: obj.counterID
            }, function(err) {
                if (err) return callback(new Error('Error inserting object (' + obj.objectID + ') to counter (' + obj.counterID +
                    ') relations to the database: ' + err.message));
                callback();
            });
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Delete objects counters relations
 * @param {Array} objectsCountersIDs is not an OCID, there is an array of object IDs and counter IDs
 * [{objectID:...,  counterID:...}, ... ]
 * @param {function} callback - callback(err)
 */
countersDB.deleteObjectCounterID = function(objectsCountersIDs, callback) {
    if(!objectsCountersIDs.length) return callback();

    log.info('Delete object to counter relations from the database: ', objectsCountersIDs);

    var stmt = db.prepare('DELETE FROM objectsCounters WHERE objectID=$objectID AND counterID=$counterID', function(err) {
        if (err) return callback(err);
        async.eachSeries(objectsCountersIDs, function(obj, callback) {
            stmt.run({
                $objectID: obj.objectID,
                $counterID: obj.counterID
            }, function(err) {
                if (err) return callback(new Error('Error deleting object (' + obj.objectID + ') to counter (' + obj.counterID +
                    ') relations from the database: ' + err.message));
                callback();
            });
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/**
 * Insert update events for specific counterID
 * @param {Number} counterID - counter ID
 * @param {Array} updateEvents -Array of objects with update event data.
 * [{counterID:, objectID:, expression:, mode:, objectFilter:, description:, updateEventOrder:}, ...] where
 * counterID, objectID is a parentCounterID ans parentObjectID, mode: <0|1|2|3|4>
 * @param {function(Error)|function()} callback - callback(err)
 */
countersDB.insertUpdateEvents = function(counterID, updateEvents, callback) {
    if(!updateEvents.length) return callback();

    log.info('Insert update events for ', counterID, ':', updateEvents);

    var stmt = db.prepare('INSERT INTO countersUpdateEvents (id, counterID, parentCounterID, parentObjectID, expression, ' +
        'mode, objectFilter, description, updateEventOrder) ' +
        'VALUES ($id, $counterID, $parentCounterID, $parentObjectID, $expression, $mode, $objectFilter, ' +
        '$description, $updateEventOrder)',
        function(err) {
            if (err) return callback(err);

            async.eachSeries(updateEvents, function(updateEvent, callback) {
                const id = unique.createHash(counterID.toString(36) + JSON.stringify(updateEvent));

                stmt.run({
                    $id: id,
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
        }
    );
};


/*
    delete update events for counter

    counterID: counter ID
    updateEvents: array of objects with update events
        [{objectID:<parent object ID>, expression:<string with expression>, mode: <0|1|2|3|4>}, {..}, ...]
    callback(err)
 */
countersDB.deleteUpdateEvents = function(counterID, updateEvents, callback) {
    if(!updateEvents.length) return callback();

    log.info('Delete update events from database for counterID: ', counterID, updateEvents);

    var queryParams = [],
        queryStr = [];

    updateEvents.forEach(function(updateEvent) {
        queryParams.push(counterID, updateEvent.counterID, updateEvent.mode);
        var partOfQueryStr = '(counterID=? AND parentCounterID=? AND mode=?';

        if (updateEvent.objectID) {
            queryParams.push(updateEvent.objectID);
            partOfQueryStr += ' AND parentObjectID=?';
        } else partOfQueryStr += ' AND parentObjectID IS NULL';

        if (updateEvent.expression) {
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
/**
 * Inserting new variables for specific counterID (historical or expression)
 * @param {Number} counterID - counter ID
 * @param {Object} variables - Object with variables, like {<variableName>:{variableParameters}, ...} See example bellow
 * @param {function(Error|undefined)} callback - callback(err)
 * @example
 * Historical variable:
 * {
 *     objectID:,
 *     parentCounterName:,
 *     function:,
 *     functionParameters:,
 *     objectName:,
 *     description:,
 *     variableOrder:
 * }
 *
 * Expression variable:
 * {
 *     expression:,
 *     description:,
 *     variableOrder:
 * }
 */
countersDB.insertVariables = function(counterID, variables, callback) {
    log.info('Insert variables for ', counterID, ': ', variables);

    var stmt = db.prepare(
        'INSERT INTO variables (id, counterID, name, objectID, parentCounterName, function, functionParameters, objectName, ' +
        'description, variableOrder) ' +
        'VALUES ($id, $counterID, $name, $objectID, $parentCounterName, $function, $functionParameters, $objectName,' +
        '$description, $variableOrder)',
        function(err) {
            if (err) return callback(err);

            var stmtExpression = db.prepare(
                'INSERT INTO variablesExpressions (id, counterID, name, expression, description, variableOrder) ' +
                'VALUES ($id, $counterID, $name, $expression, $description, $variableOrder)',

                function(err) {
                    if (err) return callback(err);

                    // eachSeries used for transaction
                    async.eachSeries(Object.keys(variables), function(name, callback) {
                        const id = unique.createHash(counterID.toString(36) + name + JSON.stringify(variables[name]));

                        if (variables[name].expression) {

                            log.debug('Inserting variable expression ' + name, variables[name]);
                            stmtExpression.run({
                                $id: id,
                                $counterID: counterID,
                                $name: name,
                                $expression: variables[name].expression,
                                $description: variables[name].description || null,
                                $variableOrder: variables[name].variableOrder,
                            }, callback);
                        } else {

                            log.debug('Inserting variable ' + name, variables[name]);
                            stmt.run({
                                $id: id,
                                $counterID: counterID,
                                $name: name,
                                $objectID: variables[name].objectID || null,
                                $parentCounterName: variables[name].parentCounterName,
                                $function: variables[name].function,
                                $functionParameters: variables[name].functionParameters !== undefined ? variables[name].functionParameters : null,
                                $objectName: variables[name].objectName || null,
                                $description: variables[name].description || null,
                                $variableOrder: variables[name].variableOrder,
                            }, callback)
                        }
                    }, function(err) {
                        stmtExpression.finalize();
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
countersDB.deleteVariables = function(counterID, callback) {
    log.info('Remove all variables for counter ID ', counterID);

    db.run('DELETE FROM variables WHERE variables.counterID = ?', counterID, function(err) {
        if (err) return callback(new Error('Can\'t delete previous variables for counter ID ' + counterID + ': ' + err.message));

        db.run('DELETE FROM variablesExpressions WHERE variablesExpressions.counterID = ?', counterID, function(err) {
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
countersDB.updateVariablesRefs = function(oldCounterName, newCounterName, callback) {
    log.info('Updating variables refers for counter ', oldCounterName, '->', newCounterName);

    db.run('UPDATE variables SET parentCounterName = $newCounterName WHERE parentCounterName = $oldCounterName COLLATE NOCASE', {
        $newCounterName: newCounterName.toUpperCase(),
        $oldCounterName: oldCounterName
    }, callback);
};