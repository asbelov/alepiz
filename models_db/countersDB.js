/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 16.08.2015.
 */
var log = require('../lib/log')(module);
var db = require('./db');
var async = require('async');

var countersDB = {};
module.exports = countersDB;

/*
    return all counters for specific objects

    objectsIDs: array of objects IDs
    callback(err, rows)
    rows: [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
    OCID is a objects-counters ID
 */
countersDB.getCountersForObjectsAndGroups = function(objectsIDs, callback) {
    log.debug('Try to get counters for objects ', objectsIDs);

    var rows = [];
    var stmt = db.prepare(
        'SELECT counters.id AS id, counters.name AS name, counters.taskCondition AS taskCondition, \
counters.unitID AS unitID, counters.collectorID AS collectorID, counters.debug AS debug, \
counters.sourceMultiplier AS sourceMultiplier, countersGroups.id AS groupID, objectsCounters.id AS OCID, \
objectsCounters.objectID AS objectID, objects.name AS objectName, objects.description AS objectDescription \
FROM counters \
JOIN countersGroups ON counters.groupID=countersGroups.id \
JOIN objectsCounters ON objectsCounters.counterID=counters.id \
JOIN objects ON objects.id=objectsCounters.objectID \
WHERE objectsCounters.objectID = ? \
ORDER BY countersGroups.name, counters.name, objects.name', function(err) {
        if(err) return callback(err);

        async.eachLimit(objectsIDs,100,function(objectID, callback) {
            stmt.all(objectID, function(err, rowsPart) {
                if(err) return callback(err);
                rows.push.apply(rows, rowsPart);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
}

countersDB.getCountersForGroup = function(groupID, callback) {
    log.debug('Getting all counters for group ', groupID);

    db.all('SELECT * FROM counters WHERE counters.groupID=?', groupID, callback);
};

countersDB.getCounterByID = function(counterID, callback){
    log.debug('Get counter by ID ', counterID);

    db.get('SELECT * FROM counters WHERE counters.id=?', counterID, function(err, counter){
        if(err) return callback(new Error('Can\'t get counter by ID '+counterID+': '+err.message));

        callback(null, counter);
    });
};

countersDB.getCounterParameters = function(counterID, callback){
    log.debug('Getting counter parameters for id '+counterID);
    if(!counterID) return callback();

    db.all('SELECT name, value FROM counterParameters WHERE counterID = ?', counterID, function(err, parameters){
        if(err) return callback(new Error('Can\'t get collector parameters for counter ID '+counterID+': '+err.message));
        callback(null, parameters);
    });
};

/*
    used in history.js for housekeeper procedure and don't require for check user rights

    callback(err, row), where
    row: [{OCID:.., history: .., trends: ...}, ...]
 */
countersDB.getKeepHistoryAndTrends = function(callback){
    log.debug('Getting keep history and trends parameter for all objects');

    db.all('SELECT objectsCounters.id AS OCID, counters.keepHistory AS history, counters.keepTrends AS trends, ' +
        'counters.name AS name ' +
        'FROM counters JOIN objectsCounters ON counters.id=objectsCounters.counterID',
        function(err, row){
            if(err) return callback(new Error('Error getting keep history and trends parameter for all objects: '+err.message));
            callback(null, row);
    });
};

countersDB.getCounterObjects = function(counterID, callback){
    log.debug('Getting objects IDs and objects names for counter id '+counterID);
    if(!counterID) return callback();

    db.all(
'SELECT objects.id AS id, objects.name AS name, objectsCounters.id AS OCID FROM objects \
JOIN objectsCounters ON objectsCounters.objectID=objects.id \
WHERE objectsCounters.counterID=?', counterID, function(err, objects){
            if(err) return callback(new Error('Can\'t get objects for counter ID '+counterID+': '+err.message));
            callback(null, objects);
        }
    );
};

/**
 * SELECT * FROM objectsCounters
 * @param {function} callback callback(err, rows): rows: [{id, objectID, counterID}, ...]
 */
countersDB.getAllObjectsCounters = function(callback) {
    db.all('SELECT * FROM objectsCounters', callback);
};

/** SELECT * FROM counters.
 * @param {function} callback callback(err, rows): rows: [{id, name, collectorID, groupID,unitID, sourceMultiplier,
 *  keepHistory, keepTrends, modifyTime, disabled, debug, taskCondition, created}, ...]
 */
countersDB.getAllCounters = function(callback) {
    db.all('SELECT * FROM counters', callback);
};

countersDB.getAllUpdateEvents = function(callback) {
    db.all('SELECT * FROM countersUpdateEvents', callback);
};

countersDB.getAllParameters = function (callback) {
    db.all('SELECT * FROM counterParameters', callback);
}

countersDB.getVariables = function(counter, callback){
    log.debug('Getting variables for counter: ', counter);

// using LEFT OUTER JOIN because objectID in variables table can be null (null is a reference to the current object,
// linked with counter), but we want to get information for such objects too
    db.all(
        'SELECT variables.name AS name, \
            variables.counterID AS counterID, \
            objects.id AS objectID, \
            objects.name AS objectName, \
            variables.parentCounterName AS parentCounterName, \
            variables.function AS function, \
            variables.functionParameters AS functionParameters, \
            variables.objectName AS objectVariable, \
            variables.description AS description, \
            variables.variableOrder AS variableOrder, \
            objectsCounters.id AS OCID, \
            counters.name AS counterName, \
            parentCounters.id AS parentCounterID \
        FROM variables \
        JOIN counters ON counters.id = variables.counterID \
        JOIN counters parentCounters ON parentCounters.name = variables.parentCounterName COLLATE NOCASE \
        LEFT OUTER JOIN objects ON objects.id = variables.objectID \
        LEFT OUTER JOIN objectsCounters ON objects.id = objectsCounters.objectID AND parentCounters.id = objectsCounters.counterID' +
        (counter ?
            (counter === parseInt(counter, 10) ?
                // GROUP BY variables.id used for remove duplicates with a different parent counter ID
                ' WHERE variables.counterID = ? GROUP BY variables.id' :
                // there may be duplicates with a different parent counter ID and the same parent counter name
                ' WHERE variables.parentCounterName = ? COLLATE NOCASE') : ''),
        counter ? counter : [], callback);
};

countersDB.getVariablesExpressions = function(counterID, callback) {
    log.debug('Getting variables expression for counter ID ', counterID);

    if(!counterID) db.all('SELECT * FROM variablesExpressions', callback);
    else db.all('SELECT * FROM variablesExpressions WHERE variablesExpressions.counterID = ?', counterID, callback);
};

/*
    get objectsCountersID, collectors and countersID for first calculation for all counters

    objectsIDs: result will be filtered by specific array of objects IDs. null - no filter
    counterID: result will be filtered by specific array of counters IDs. null - no filter

    callback(err, data)
    data: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID:.., counterName:..., objectID:.., objectName:..}, {...}...]
 */
countersDB.getCountersForFirstCalculation = function(collectorNames, objectsIDs, countersIDs, callback){
    log.debug('Getting data for independent counters calculation for counters: ', countersIDs,' and objects: ', objectsIDs);

    var queryParameters = collectorNames.slice();

    if(Array.isArray(objectsIDs) && objectsIDs.length) Array.prototype.push.apply(queryParameters, objectsIDs);
    else objectsIDs = null;

    if(Array.isArray(countersIDs) && countersIDs.length) Array.prototype.push.apply(queryParameters, countersIDs);
    else countersIDs = null;

    db.all(
        'SELECT objectsCounters.id AS OCID, counters.collectorID AS collector, counters.id AS counterID, \
        counters.name AS counterName, objectsCounters.objectID AS objectID, objects.name AS objectName, \
        counters.debug AS debug, counters.groupID AS groupID, counters.taskCondition AS taskCondition \
        FROM counters \
        JOIN objects ON objectsCounters.objectID = objects.id \
        JOIN objectsCounters ON objectsCounters.counterID = counters.id \
        LEFT OUTER JOIN countersUpdateEvents ON counters.id = countersUpdateEvents.counterID \
        WHERE objects.disabled != "1" AND counters.disabled != "1" AND countersUpdateEvents.counterID IS NULL AND \
        counters.collectorID IN (' + (new Array(collectorNames.length).fill('?').join(',')) + ')' +
        (objectsIDs ? (' AND objects.id IN (' + (new Array(objectsIDs.length).fill('?').join(',')) + ')') : '') +
        (countersIDs ? (' AND counters.id IN (' + (new Array(countersIDs.length).fill('?').join(',')) + ')') : ''),
        queryParameters, function(err, data){
            if(err) return callback(new Error('Can\'t get data for independent counters calculation from DB: '+err.message));
            callback(null, data);
        }
    )
};


/*
    get counters parameters for specific objects and counters IDs

    OCIDsArray - array with objectCounterIDs
    callback(err, data)
    data = [{OCID: <OCID>, name: <parameter name>, value: <parameter value>}, ...]
    parameter value can be a variable %:<var>:%
*/
countersDB.getCountersParameters = function(OCIDsArray, callback){
    log.debug('Getting parameters for objectCountersIDs ', OCIDsArray);

    var rows = [];
    var stmt = db.prepare(
'SELECT objectsCounters.id AS OCID, counterParameters.name AS name, counterParameters.value AS value \
FROM counterParameters \
JOIN objectsCounters ON counterParameters.counterID=objectsCounters.counterID \
WHERE objectsCounters.id = ?', function(err) {
        if(err) return callback(err);

        async.eachLimit(OCIDsArray, 100,function(objectCounterID, callback) {
            stmt.all(objectCounterID, function(err, param) {
                if(err) return callback(err);
                rows.push.apply(rows, param);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    });
};

/** Get OCID (object counter ID) for specified objectID and counterID
 *
 * @param {number} objectID - objectID
 * @param {number} counterID - counterID
 * @param {function(Error)|function(null, Object)|function(null, undefined): void} callback - return Error or
 * object {id: <OCID>} or undefined if OCID is not found.
 * Used db.get('SELECT id FROM objectsCounters WHERE objectID=$objectID AND counterID=$counterID', ...)
 */
countersDB.getObjectCounterID = function (objectID, counterID, callback){
    log.debug('Getting objectCounterID for objectID: ', objectID, ', counterID: ', counterID);

    db.get('SELECT id FROM objectsCounters WHERE objectID=$objectID AND counterID=$counterID', {
        $objectID: objectID,
        $counterID: counterID
    }, callback) // callback(err, row) where row undefined if not found or row.id
};

countersDB.getObjectCounterIDForCounter = function (counterID, callback){
    log.debug('Getting objectCounterID for counterID: ' + counterID);

    // callback(err, rows) where rows [{id: <OCID1>, objectID:..}, ...]
    db.all('SELECT id, objectID FROM objectsCounters WHERE counterID=?', [counterID], callback)
};

/*
    get all objects IDs and counters IDs by objectsCountersIDs array from objectsCounters table

    OCIDs - objectsCountersIDs array

    callback(err, rows)
    rows: [{id: objectCounterID, objectID: ..., counterID: ...}, {},...]
 */
countersDB.getObjectsCounters = function(OCIDs, callback) {
    //log.info('Getting objectsIDs and counters IDs for objectCountersIDs ', OCIDs);

    // for small count of OCIDs
    if(OCIDs.length < db.maxVariableNumber) {
        db.all('SELECT * FROM objectsCounters WHERE objectsCounters.id IN (' +
            (new Array(OCIDs.length)).fill('?').join(',') + ')', OCIDs, callback);

        return;
    }

    var rows = [];
    var stmt = db.prepare('SELECT * FROM objectsCounters WHERE objectsCounters.id = ?', function(err) {
        if(err) return callback(err);

        async.eachLimit(OCIDs, 100,function(OCID, callback) {
            stmt.all(OCID, function(err, res) {
                if(err) return callback(err);
                rows.push.apply(rows, res);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    });
};

/*
    get all counters IDs and objectsCountersIDs by objects IDs array from objectsCounters table

    objectsIDs - objectsIDs array

    callback(err, rows)
    rows: [{id: objectCounterID, objectID: ..., counterID: ...}, {},...]
 */
countersDB.getCountersForObjects = function(objectsIDs, callback) {
    log.debug('Getting countersIDs and objectCountersIDs for objects IDs: ', objectsIDs);

    // for small count of objectsIDs
    if(objectsIDs.length < db.maxVariableNumber) {
        db.all('SELECT * FROM objectsCounters WHERE objectsCounters.objectID IN (' +
            (new Array(objectsIDs.length)).fill('?').join(',') + ')', objectsIDs, callback);

        return;
    }

    var rows = [];
    var stmt = db.prepare('SELECT * FROM objectsCounters WHERE objectsCounters.objectID = ?', function(err) {
        if(err) return callback(err);

        async.eachLimit(objectsIDs,100,function(objectID, callback) {
            stmt.all(objectID, function(err, res) {
                if(err) return callback(err);
                rows.push.apply(rows, res);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    });
};

/** Get objectCounter IDs, object IDs and counter IDs for specific collector
 * @param {string} collectorName - collector directory name
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows) return error or array of rows like
 * [{id: <OCID>, objectID: <objectID>, counterID: <counterID>}, ....]
 */
countersDB.getObjectsCountersIDsForCollector = function(collectorName, callback) {
    log.debug('Getting OCIDs, objectIDs, counterIDs for collector "', collectorName, '"');

    db.all('SELECT objectsCounters.id AS "id", objectsCounters.objectID AS "objectID", objectsCounters.counterID AS "counterID" \
FROM objectsCounters \
JOIN counters ON counters.id = objectsCounters.counterID \
WHERE counters.collectorID = ?', [collectorName], function(err, rows){
        if(err) {
            return callback(new Error('Error getting OCIDs, objectIDs, counterIDs for collector ' +
                collectorName + ': '+err.message));
        }
        callback(null, rows);
    })
};

/** Get update events for counter ID
 *
 * @param {uint} counterID - counter ID
 * @param {function(Error)|function(null, rows)} callback - callback(err, updateEvents) return error or array with
 * update events like [{counterID:<parentCounterID>, counterName: <counterName>, expression: <updateEventExpression>,
 * mode: <0|1|2>, objectID: <parentObjectID>, objectFilter: <objectsFilter> , description: <updateEventDescription>,
 * updateEventOrder: <updateEventOrder>}, ...];
    mode: 0 - update every time when parent counter received a new value and expression is true,
        1 - update once when parent counter received a new value and expression change state to true,
        2 - update once when expression change state to true and once when expression change state to false
        3 - update once when expression value is changed to false
 */
countersDB.getUpdateEvents = function(counterID, callback) {
    log.debug('Getting update events for counterID: '+counterID);

    db.all('\
SELECT countersUpdateEvents.parentCounterID AS counterID, counters.name AS counterName, \
countersUpdateEvents.expression AS expression, countersUpdateEvents.mode AS mode, \
countersUpdateEvents.parentObjectID AS objectID, countersUpdateEvents.objectFilter AS objectFilter, \
countersUpdateEvents.description AS description, countersUpdateEvents.updateEventOrder AS updateEventOrder, \
    CASE WHEN countersUpdateEvents.parentObjectID IS NULL \
    THEN "" \
    ELSE (SELECT name FROM objects WHERE objects.id=countersUpdateEvents.parentObjectID) \
    END AS name \
FROM countersUpdateEvents \
JOIN counters ON counters.id = countersUpdateEvents.parentCounterID \
WHERE countersUpdateEvents.counterID=?', [counterID], callback) //callback(err, updateEvents)
};

countersDB.getCounterByOCID = function (OCID, callback) {
    db.all(`SELECT counters.name FROM counters 
JOIN objectsCounters ON counters.id = objectsCounters.counterID 
WHERE objectsCounters.id = ?`, OCID, callback);
};

/** Get counter IDs by specific counter names
 *
 * @param {Array[string]} countersNames - array of counter names
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows) return error or array of rows like
 * [{name: <counterName>, id: <counterID>}]
 */
countersDB.getCountersIDsByNames = function (countersNames, callback) {
    if(!countersNames || !countersNames.length) return callback(null, []);
    //db.all('SELECT name, id FROM counters WHERE name IN (' +
    //    (new Array(countersNames.length)).fill('?').join(',') + ') COLLATE NOCASE', countersNames, callback);

    var rows = [];
    var stmt = db.prepare('SELECT name, id FROM counters WHERE name = ? COLLATE NOCASE', function(err) {
        if(err) return callback(err);

        async.eachLimit(countersNames,100,function(counterName, callback) {
            stmt.all(counterName, function(err, res) {
                if(err) return callback(err);
                rows.push.apply(rows, res);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    });
}

/** Get union from variables and variablesExpressions table for parent counters
 *
 * @param {Array[uint]} counterIDs - array of counter IDs
 * @param {function(Error)|function(null, Array[Object])} callback - callback(err, rows) return error or array of rows
 * like [{counterID:<parentCounterID>, counterName:<parentCounterName>, variableName:<variableName>,
 * variableExpression:<variableExpression>,  variableDescription: <variableDescription>},...]
 */
countersDB.getParentCountersVariables = function (counterIDs, callback) {

    const questionsStr = (new Array(counterIDs.length)).fill('?').join(',');
    const twoArraysOfCountersIDs = counterIDs.slice();
    Array.prototype.push.apply(twoArraysOfCountersIDs, counterIDs);

    db.all(`SELECT countersUpdateEvents.parentCounterID AS counterID, counters.name AS counterName, 
variablesExpressions.name AS variableName, 
variablesExpressions.expression AS variableExpression, 
variablesExpressions.description AS variableDescription 
FROM countersUpdateEvents 
JOIN counters ON counters.id=countersUpdateEvents.parentCounterID 
LEFT OUTER JOIN variablesExpressions ON variablesExpressions.counterID = countersUpdateEvents.parentCounterID 
WHERE countersUpdateEvents.counterID IN (${questionsStr}) 
UNION 
SELECT countersUpdateEvents.parentCounterID AS counterID, counters.name AS counterName, 
variables.name AS variableName, 
variables.parentCounterName || ': ' || variables.function || '(' || variables.functionParameters || ')' AS variableExpression, 
variables.description AS variableDescription 
FROM countersUpdateEvents 
JOIN counters ON counters.id=countersUpdateEvents.parentCounterID 
LEFT OUTER JOIN variables ON variables.counterID=countersUpdateEvents.parentCounterID 
LEFT OUTER JOIN variablesExpressions ON variablesExpressions.counterID = countersUpdateEvents.parentCounterID 
WHERE countersUpdateEvents.counterID IN (${questionsStr}) 
GROUP BY variableName, variableExpression ORDER BY counterName`,
        twoArraysOfCountersIDs, callback);
}

countersDB.getAllForCounter = function (counterID, callback) {
    db.all('SELECT * FROM counters WHERE counters.id=?', counterID, function(err, c) {
        if(err) return callback(err);
        db.all('SELECT * FROM counterParameters WHERE counterParameters.counterID=?', counterID, function(err, cp) {
            if(err) return callback(err);
            db.all('SELECT * FROM countersUpdateEvents WHERE countersUpdateEvents.counterID=?', counterID, function(err, cue) {
                if(err) return callback(err);
                db.all('SELECT * FROM variables WHERE variables.counterID=?', counterID, function(err, cv) {
                    if(err) return callback(err);
                    db.all('SELECT * FROM variablesExpressions WHERE variablesExpressions.counterID=?', counterID, function(err, cve) {
                        if(err) return callback(err);
                        db.all('SELECT * FROM countersGroups WHERE countersGroups.id=?', c.map(c => c.groupID), function(err, cg) {
                            if(err) return callback(err);
                            db.all('SELECT * FROM countersUnits WHERE countersUnits.id=?', c.map(c=>c.unitID), function(err, cu) {
                                if(err) return callback(err);
                                callback(null, {
                                    counters: c,
                                    counterParameters: cp,
                                    countersUpdateEvents: cue,
                                    variables: cv,
                                    variablesExpressions: cve,
                                    countersGroups: cg,
                                    countersUnits: cu,
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

countersDB.getOCIDsForVariables = function(objectName, counterID, callback) {
    db.all('\
SELECT objectsCounters.id AS OCID FROM variables \
JOIN counters ON variables.parentCounterName = counters.name COLLATE NOCASE \
JOIN objects ON objects.name=$objectName COLLATE NOCASE \
JOIN objectsCounters ON counters.id=objectsCounters.counterID AND \
    CASE WHEN variables.objectID IS NULL THEN objectsCounters.objectID=objects.id \
    ELSE objectsCounters.objectID=variables.objectID \
    END \
WHERE variables.counterID = $counterID',
        {
            $objectName: objectName,
            $counterID: counterID,
    }, callback);
}

countersDB.getObjectsCountersInfo = function (countersIDs, callback) {

    var rows = [],
        stmt = db.prepare('SELECT counters.name AS counterName, counters.id AS counterID, ' +
        'counters.groupID AS counterGroup, counters.keepHistory AS keepHistory, counters.keepTrends AS keepTrends, ' +
        'counters.description AS counterDescription, counters.debug AS debug, counters.disabled AS disabled, ' +
        'counters.taskCondition AS taskCondition, ' +
        'objects.name AS objectName, objects.id AS objectID, objectsCounters.id AS OCID FROM objectsCounters ' +
        'JOIN counters ON objectsCounters.counterID = counters.id ' +
        'JOIN objects ON objectsCounters.objectID = objects.ID ' +
        'WHERE objectsCounters.counterID = ?', function (err) {
        if(err) return callback(err);

        async.eachLimit(countersIDs, 100, function(counterID, callback) {
            stmt.all(counterID, function (err, _rows) {
                if(err) return callback(err);
                Array.prototype.push.apply(rows, _rows);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
};