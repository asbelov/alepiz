/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var db = require('./db');

var objectsDB = {};
module.exports = objectsDB;

objectsDB.getAllObjects = function(callback) {
    db.all('SELECT * FROM objects', callback);
};

/*
    get objects information by object IDs or names
    Check user rights before using this functions
    IDs - an array of object IDs
    or
    names - an array of object names with exact comparison
    or
    namesLike  - an array of object names with SQL LIKE comparison

    callback(err, objects)
    objects = [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:.., disabled:..., color:...}, {...},...]

    SQLite LIKE operator is case-insensitive. It means "A" LIKE "a" is true. However, for Unicode characters that are
    not in the ASCII ranges, the LIKE operator is case sensitive e.g., "Ä" LIKE "ä" is false.
*/
objectsDB.getObjectsByIDs = function(IDs, callback) {
    // SELECT * FROM objects WHERE id=?
    getObjectsByX(IDs, 'id=', '', callback);
};

objectsDB.getObjectsByNames = function(names, callback) {
    // SELECT * FROM objects WHERE name=?
    getObjectsByX(names, 'name=', 'COLLATE NOCASE', callback);
};

objectsDB.getObjectsLikeNames = function(namesLike, callback) {
    // SELECT * FROM objects WHERE name LIKE ?
    getObjectsByX(namesLike, 'name LIKE ', 'ESCAPE "\\" COLLATE NOCASE', callback);
};

function getObjectsByX(IDs, condition, suffix, callback) {
    if(!IDs || !IDs.length) return callback(null, []);

    var rows = [];
    var stmt = db.prepare('SELECT * FROM objects WHERE ' + condition + '? ' + suffix + ' ORDER BY name', function(err) {
        if(err) return callback(err);
        async.each(IDs, function(ID, callback) {
            stmt.all(ID, function(err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            })
        }, function(err) {
            stmt.finalize();
            callback(err, rows);
        })
    })
}

/** Get interactions for specified objects IDs. Check user rights before using it functions
 * @param {Array} IDs - array of objects IDs
 * @param {function(Error)|function(null, Array)} callback - callback(err, interactions)
 *
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
objectsDB.getInteractions = function(IDs, callback){
    var questionStr = IDs.map(function(){return '?'}).join(',');

    // copy array of IDs to new array IDForSelect
    var IDsForSelect = IDs.slice();
    // add array IDs to array IDForSelect
    IDsForSelect.push.apply(IDsForSelect, IDs);

    db.all('SELECT objects1.name AS name1, objects1.description AS description1, interactions.objectID1 AS id1, ' +
        'objects2.name AS name2, objects2.description AS description2, interactions.objectID2 AS id2, ' +
        'interactions.type AS type FROM interactions ' +
        'JOIN objects objects1 ON objects1.id=interactions.objectID1 ' +
        'JOIN objects objects2 ON objects2.id=interactions.objectID2 ' +
        'WHERE interactions.objectID1 IN ('+questionStr+') OR interactions.objectID2 IN ('+questionStr+') ' +
        'ORDER BY objects2.sortPosition, objects2.name, objects1.sortPosition, objects1.name',
        IDsForSelect, callback);
};

/*
Checks if objects (objectsNames) are in specific groups (groupsNames)

 groupsNames: objects names in !!lower case!!, which include searched objects i.e. groups of objects
 objectsNames: check is this objects names in !!lower case!! in a groups
 callback(err, objectsNames), where objectsNames is an array of objects names
 // function can be used for less than 999 objects, according  SQLITE_MAX_VARIABLE_NUMBER, which defaults to 999
// https://www.sqlite.org/limits.html
 */
objectsDB.getObjectsFromGroups = function(groupsNames, objectsNames, callback){

    var questionStrForGroups = groupsNames.map(function(){return '?'}).join(',');
    var questionStrForObjects = objectsNames.map(function(){return '?'}).join(',');

    // copy groupsNames array to queryParameters
    var queryParameters = groupsNames.slice();
    // add objectsNames array to queryParameters array
    queryParameters.push.apply(queryParameters, objectsNames);

    db.all('SELECT objects.name AS name FROM objects '+
        'JOIN interactions ON objects.id = interactions.objectID2 AND interactions.type = 0 '+
        'JOIN objects topObjects ON interactions.objectID1=topObjects.id '+
        'WHERE LOWER(topObjects.name) IN ('+questionStrForGroups+') AND ' +
        'LOWER(objects.name) IN ('+questionStrForObjects+')', queryParameters,
        function(err, rows){
            if(err) return callback(new Error('Error while checking, is objects "'+objectsNames.join(', ')+
                '" are including in objects "'+groupsNames.join(', ')+'": '+err.message));

            callback(null, rows.map(function(object){ return object.name.toLowerCase() }));
    });
};

/*
    getting objectsCountersIDs for specific objectID

    objectID - object ID
    callback(err, row)

    rows: [{id: <OCID1>}, {id: <OCID2>}, ...]
 */

objectsDB.getObjectsCountersIDs = function (objectsIDs, callback){
    log.debug('Getting objectsCountersIDs for objectsIDs: ', objectsIDs);

    // used for remove too big array of objects. don\'t optimize and don\'t use IN() in select
    var rows = [];
    var stmt = db.prepare('SELECT * FROM objectsCounters WHERE objectID=?', function(err) {
        if(err) return callback(err);

        async.eachLimit(objectsIDs, 20,function(objectID, callback) {
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

objectsDB.getObjectsByOCIDs = function (OCIDs, callback) {
    var stmt = db.prepare('SELECT objects.name AS name, objects.id AS objectID, objectsCounters.id AS OCID ' +
        'FROM objects ' +
        'JOIN objectsCounters ON objectsCounters.objectID = objects.id ' +
        'WHERE objectsCounters.id = ?', function (err) {
        if(err) return callback(err);

        var rows = [];
        async.each(OCIDs, function (OCID, callback) {
            stmt.all(OCID, function (err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            });
        }, function (err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
}


objectsDB.getObjectsAndCountersByOCIDs = function (OCIDs, callback) {
    var stmt = db.prepare('\
SELECT objectsCounters.id AS OCID, counters.name AS counterName, objects.name AS objectName FROM objects \
JOIN objectsCounters ON objects.id = objectsCounters.objectID \
JOIN counters ON counters.id = objectsCounters.counterID \
WHERE objectsCounters.id = ?', function (err) {
        if(err) return callback(err);

        var rows = [];
        async.each(OCIDs, function (OCID, callback) {
            stmt.all(OCID, function (err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            });
        }, function (err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
}

/**
 * Get Alepiz IDs and Alepiz names using SELECT * FROM alepizIDs
 * @param {function} callback - callback(err, rows), where rows: [{id, name}, ....]
 */
objectsDB.getAlepizIDs = function (callback) {
    db.all('SELECT * FROM alepizIDs', callback);
}

/**
 * Get object relationship to Alepiz instances for specific objectIDs using
 *  SELECT * FROM objectsAlepizRelation WHERE objectsAlepizRelation.objectID = ?
 * @param {Array} objectIDs - array of the objectIDs list
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows) ,where rows is array like
 *  [{id:, objectID:, alepizID: }, ...]
 */
objectsDB.getObjectsAlepizRelationByObjectIDs = function (objectIDs, callback) {
    var stmt = db.prepare('SELECT * FROM objectsAlepizRelation WHERE objectsAlepizRelation.objectID = ?', function (err) {
        if(err) return callback(err);

        var rows = [];
        async.each(objectIDs, function (objectID, callback) {
            stmt.all(objectID, function (err, subRows) {
                if(err) return callback(err);

                rows.push.apply(rows, subRows);
                callback();
            });
        }, function (err) {
            stmt.finalize();
            callback(err, rows);
        });
    });
}

/**
 * Get all object relationships to Alepiz instances
 * @param {function(Error)|function(null, Array)} callback - callback(err, rows), where rows is array like
 *  [{objectID:, alepizName:}, ....]
 */
objectsDB.getObjectsAlepizRelation = function (callback) {
    db.all('SELECT objectsAlepizRelation.objectID AS objectID, alepizIDs.name AS alepizName \
        FROM objectsAlepizRelation \
        JOIN alepizIDs ON objectsAlepizRelation.alepizID = alepizIDs.id', callback);
}