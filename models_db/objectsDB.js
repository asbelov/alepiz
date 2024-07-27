/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require('async');
const log = require('../lib/log')(module);
const db = require('./db');

var objectsDB = {};
module.exports = objectsDB;

/**
 * Get all data from objects table using SELECT * FROM objects
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: [0|1],
 *     created: number
 * }>)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
objectsDB.getAllObjects = function(callback) {
    db.all('SELECT * FROM objects', callback);
};

/**
 * Get data from interactions =table using SELECT * FROM interactions
 * @param {function(Error)|function(null, Array<{
 *  id: number,
 *  objectID1: number,
 *  objectID2: number,
 *  type: 0|1|2
 * }>)} callback callback(err, rows), where rows is [{id:<objectID>, ObjectID1:, objectID2: type:}, ... ]
 */
objectsDB.getAllInteractions = function (callback) {
    db.all('SELECT * FROM interactions', callback);
}

/**
 * Get objects by object IDs and sorted by object names using SELECT * FROM objects WHERE id=?
 * @param {Array<number>} objectIDs an array with object IDs
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: 0|1,
 *     created: number
 * }>)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
objectsDB.getObjectsByIDs = function(objectIDs, callback) {
    // SELECT * FROM objects WHERE id=?
    getObjectsByX(objectIDs, 'id=', '', callback);
};

/**
 * Get objects by object names and sorted by object names
 * (exact comparison case insensitive) using SELECT * FROM objects WHERE name=?
 * @param {Array<string>} objectNames an array with object names
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: 0|1,
 *     created: number
 * }>)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
objectsDB.getObjectsByNames = function(objectNames, callback) {
    // SELECT * FROM objects WHERE name=?
    getObjectsByX(objectNames, 'name=', 'COLLATE NOCASE', callback);
};

/**
 * Get objects by object names and sorted by object names
 * (SQL LIKE comparison case insensitive) using SELECT * FROM objects WHERE name LIKE ? ESCAPE "\\" COLLATE NOCASE
 * SQLite LIKE operator is case-insensitive. It means "A" LIKE "a" is true. However, for Unicode characters that are
 * not in the ASCII ranges, the LIKE operator is case sensitive e.g., "Ä" LIKE "ä" is false.
 * @param {Array<string>} objectNamesLike an array with object names in SQL like format
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: 0|1,
 *     created: number
 * }>)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
objectsDB.getObjectsLikeNames = function(objectNamesLike, callback) {
    // SELECT * FROM objects WHERE name LIKE ?
    getObjectsByX(objectNamesLike, 'name LIKE ', 'ESCAPE "\\" COLLATE NOCASE', callback);
};

/**
 * Function for get object various information
 * @param {Array<number|string>} params object IDs or object names
 * @param {'id='|'name='|'name LIKE '} condition
 * @param {''|'COLLATE NOCASE'|'ESCAPE "\\" COLLATE NOCASE'} suffix
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: 0|1,
 *     created: number
 * }>)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
function getObjectsByX(params, condition, suffix, callback) {
    if(!params || !params.length) return callback(null, []);

    var stmt =
        db.prepare('SELECT * FROM objects WHERE ' + condition + '? ' + suffix + ' ORDER BY name', function(err) {
        if(err) return callback(err);
        getSTMTResult(stmt, params, callback);
    });
}

/**
 * Get result for the prepared SQL statement
 * @param {Object} stmt prepared SQL statement
 * @param {Array<number|string>} params an array of the SQL query parameters
 * @param {function(Error)|function(null, Array)} callback callback(err, rows) where rows is an array with objects
 */
function getSTMTResult(stmt, params, callback) {
    var rows = [];
    async.eachSeries(params, function(param, callback) {
        stmt.all(param, function(err, subRows) {
            if(err) return callback(err);

            rows.push.apply(rows, subRows);
            callback();
        })
    }, function(err) {
        stmt.finalize();
        callback(err, rows);
    })
}

/** Get interactions for specified object IDs
 * @param {Array<number>} objectIDs array of object IDs
 * @param {function(Error)|function(null, Array<{
 *     name1: string,
 *     description1: string,
 *     id1: number,
 *     name2: string,
 *     description2: string,
 *     id2: number,
 *     type: number,
 * }>)} callback - callback(err, interactions) where interactions described
 * at example bellow
 * @example
 * // interactions returned by callback(err, interactions)
 * interactions - [{
 *      name1: <objName1>, description1: <objDescription1>, id1: <id1>,
 *      name2: <objName2>, description2: <objDescription2>, id2: <id2>,
 *      type: <interactionType1>},
 *      {...},...]
 * interaction types: 0 - include; 1 - intersect, 2 - exclude
 * function can be used for less than 999 objects, according  SQLITE_MAX_VARIABLE_NUMBER, which defaults to 999
 * https://www.sqlite.org/limits.html
 */
objectsDB.getInteractions = function(objectIDs, callback){
    var questionStr = objectIDs.map(function(){return '?'}).join(',');

    // copy array of object IDs to new array IDForSelect
    var IDsForSelect = objectIDs.slice();
    // add array IDs to array IDForSelect
    IDsForSelect.push.apply(IDsForSelect, objectIDs);

    db.all('SELECT objects1.name AS name1, objects1.description AS description1, interactions.objectID1 AS id1, ' +
        'objects2.name AS name2, objects2.description AS description2, interactions.objectID2 AS id2, ' +
        'interactions.type AS type FROM interactions ' +
        'JOIN objects objects1 ON objects1.id=interactions.objectID1 ' +
        'JOIN objects objects2 ON objects2.id=interactions.objectID2 ' +
        'WHERE interactions.objectID1 IN (' + questionStr + ') OR interactions.objectID2 IN (' + questionStr + ') ' +
        'ORDER BY objects2.sortPosition, objects2.name, objects1.sortPosition, objects1.name',
        IDsForSelect, callback);
};

/**
 * Checks is objects (objectsNames) are in specific groups (groupsNames)
 * this function can be used for less than 999 objects, according  SQLITE_MAX_VARIABLE_NUMBER, which defaults to 999
 * https://www.sqlite.org/limits.html
 * @param {Array<string>} groupsNames
 * @param {Array<string>} objectsNames
 * @param {function(Error)|function(null, Array<string>)} callback callback(err, objectNames), [<objectName1>, <objectName2>,..]
 */
objectsDB.getObjectsFromGroups = function(groupsNames, objectsNames, callback){

    var questionStrForGroups = groupsNames.map(function(){return '?'}).join(',');
    var questionStrForObjects = objectsNames.map(function(){return '?'}).join(',');

    // copy groupNames array to queryParameters
    var queryParameters = groupsNames.slice();
    // add objectNames array to queryParameters array
    queryParameters.push.apply(queryParameters, objectsNames);

    db.all('SELECT objects.name AS name FROM objects ' +
        'JOIN interactions ON objects.id = interactions.objectID2 AND interactions.type = 0 ' +
        'JOIN objects topObjects ON interactions.objectID1=topObjects.id ' +
        'WHERE LOWER(topObjects.name) IN (' + questionStrForGroups + ') AND ' +
        'LOWER(objects.name) IN (' + questionStrForObjects + ')', queryParameters,
        function(err, rows) {
            if(err) {
                return callback(new Error('Error while checking, is objects "' + objectsNames.join(', ') +
                    '" are including in objects "' + groupsNames.join(', ') + '": ' + err.message));
            }

            callback(null, rows.map(object => object.name.toLowerCase()));
    });
};

/**
 * Return OCIDs by objectIDs using SELECT * FROM objectsCounters WHERE objectID=?
 * @param {Array<number>} objectsIDs an array with object IDs
 * @param {function(Error)|function(null, Array)} callback callback(err, rows) ,where rows is
 * [{id:<OCID>, objectID:, counterID:},..]
 */
objectsDB.getObjectsCountersIDs = function (objectsIDs, callback){
    log.debug('Getting objectsCountersIDs for objectsIDs: ', objectsIDs);

    var stmt = db.prepare('SELECT * FROM objectsCounters WHERE objectID=?', function(err) {
        if(err) return callback(err);

        var rows = [];
        async.eachSeries(objectsIDs, function(objectID, callback) {
            stmt.all(objectID, function(err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    })
};

/**
 * Return objectNames, objectIDs, OCIDs by object IDs
 * @param {Array<number>} OCIDs an array of OCIDs
 * @param {function(Error)|function(null, Array)} callback callback(err, rows) ,where rows is
 * [{name:<objectName>, objectID:, OCID:},..]
 */
objectsDB.getObjectsByOCIDs = function (OCIDs, callback) {
    var stmt = db.prepare('SELECT objects.name AS name, objects.id AS objectID, objectsCounters.id AS OCID ' +
        'FROM objects ' +
        'JOIN objectsCounters ON objectsCounters.objectID = objects.id ' +
        'WHERE objectsCounters.id = ?', function (err) {
        if(err) return callback(err);
        getSTMTResult(stmt, OCIDs, callback);
    });
}

/**
 * Return OCID, counterName, objectName by OCID
 * @param {Array<number>} OCIDs an array of OCIDs
 * @param {function(Error)|function(null, Array)} callback callback(err, rows) ,where rows is
 * [{OCID:, counterName:, objectName: },..]
 */
objectsDB.getObjectsAndCountersByOCIDs = function (OCIDs, callback) {
    var stmt = db.prepare('\
SELECT objectsCounters.id AS OCID, counters.name AS counterName, objects.name AS objectName FROM objects \
JOIN objectsCounters ON objects.id = objectsCounters.objectID \
JOIN counters ON counters.id = objectsCounters.counterID \
WHERE objectsCounters.id = ?', function (err) {
        if(err) return callback(err);
        getSTMTResult(stmt, OCIDs, callback);
    });
}

/**
 * Get Alepiz IDs and Alepiz names using SELECT * FROM alepizIDs
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows), where rows: [{id, name}, ....]
 */
objectsDB.getAlepizIDs = function (callback) {
    db.all('SELECT * FROM alepizIDs', callback);
}

/**
 * Get object relationship to Alepiz instances for specific objectIDs using
 *  SELECT * FROM objectsAlepizRelation WHERE objectsAlepizRelation.objectID = ?
 * @param {Array} objectIDs - array of the objectIDs list
 * @param {function(Error)|function(Error, Array)} callback - callback(err, rows) ,where rows is array like
 *  [{id:, objectID:, alepizID: }, ...]
 */
objectsDB.getObjectsAlepizRelationByObjectIDs = function (objectIDs, callback) {
    var stmt = db.prepare('SELECT * FROM objectsAlepizRelation WHERE objectsAlepizRelation.objectID = ?', function (err) {
        if(err) return callback(err);
        getSTMTResult(stmt, objectIDs, callback);
    });
}

/**
 * Get all object relationships to Alepiz instances
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows), where rows is array like
 *  [{objectID:, alepizID:}, ....]
 */
objectsDB.getObjectsAlepizRelation = function (callback) {
    db.all('SELECT objectsAlepizRelation.objectID AS objectID, objectsAlepizRelation.alepizID AS alepizID \
        FROM objectsAlepizRelation', callback);
}