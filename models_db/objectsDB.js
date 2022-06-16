/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var db = require('./db');

var objectsDB = {};
module.exports = objectsDB;
/*
 Delete objects.
 Check user rights before using this functions
 IDs - array objects IDs
 callback(err)
*/
objectsDB.deleteObjects = function(IDs, callback) {
    log.debug('Deleting objects IDs: ', IDs);

    var stmt = db.prepare('DELETE FROM objects WHERE id=?', function(err) {
        if(err) return callback(err);

        async.eachSeries(IDs, function(ID, callback) {
            stmt.run(ID, callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

/*
 renaming objects with IDs in initIDs to names in newObjectsNamesStr
 Check user rights before using this functions
 objects - [{id: XX, name: "newObjectName1"}, {..},.... ]
 callback(err)
 */
objectsDB.renameObjects = function(objects, callback) {
    log.debug('Renaming objects: ', objects);

    var stmt = db.prepare('UPDATE objects SET name=? WHERE id=?', function(err){
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(objects, function(object, callback){
                stmt.run([object.name, object.id], callback);
            }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

objectsDB.getAllObjects = function(callback) {
    db.all('SELECT * FROM objects', callback);
};

/*
 add new objects into a database.

 newObjectNames - array of new objects names
 description - description for new object names
 order - sort position for new objects.  Top objects has order < 10 objectsFilterDB.js
 callback(err, newObjectsIDs),
 newObjectsIDs - array of a new objects IDs;
 newObjects - object like {<objectName1>: <objectID1>, ...}
 */
objectsDB.addObjects = function(newObjectsNames, description, order, disabled, callback){
    log.debug('Add objects: ', newObjectsNames, ', description: ', description, ', order: ', order, ', disabled: ', disabled);

    // Prepare statement for inserting new objects into a database
    var stmt = db.prepare('INSERT INTO objects (name, description, sortPosition, disabled, created) VALUES ' +
        '($name,$description,$sortPosition, $disabled, $created)', function(err) {
        if(err) return callback(err);

        // array with IDs of a new objects, which inserting
        var newObjectsIDs = [], newObjects = {};
        // async inserting new objects into a database. series used for transaction rollback if error and
        // save order of newObjectsIDs
        async.eachSeries(newObjectsNames, function(name, callback){
            stmt.run({
                $name: name,
                $description: description,
                $sortPosition: order,
                $disabled: disabled,
                $created: Date.now(),
            }, function (err, info) {
                if(err) return callback(err);
                // push new object ID into array
                var newObjectID = this.lastID === undefined ? info.lastInsertRowid : this.lastID;
                newObjectsIDs.push(newObjectID);
                newObjects[name] = newObjectID;
                callback();
            });
        }, function(err){
            stmt.finalize();
            if(err) return callback(err);
            callback(null, newObjectsIDs, newObjects);
        });
    });
};

// Update description and sort position for objects with IDs
// Check user rights before using this functions
// IDs - array of objects IDs
// description - object description one for all
// order - object sort position in an objects' menu, one for all.  Top objects has order < 10 objectsFilterDB.js
// disabled - 1|0|undefined if unchanged
// callback(err, true|undefined), where "true" if objects information are updated
//
// undefined description or order are not updated
objectsDB.updateObjectsInformation = function (IDs, description, order, disabled,  callback) {
    log.debug('Update objects IDs: ', IDs, '; description: ', description, '; order; ', order, '; disabled: ', disabled);

    var subQuery = [];
    if(disabled !== undefined) subQuery.push('disabled=$disabled');
    if(order !== undefined) subQuery.push('sortPosition=$order');
    if(description) subQuery.push('description=$description');
    if(!subQuery.length) return callback();

    var stmt = db.prepare('UPDATE objects SET ' + subQuery.join(', ') + ' WHERE id=$id', function(err) {
        if(err) return callback(err);
        async.eachSeries(IDs, function(ID, callback) {

            var updateData = {
                $id: ID,
                $disabled: (disabled ? 1 : 0)
            };
            if(order !== undefined) updateData.$order = order;
            if(description) updateData.$description = description;

            stmt.run(updateData, callback);
        }, function(err) {
            stmt.finalize();
            callback(err, true);
        });
    })
};


// inserting new objects interactions
// interactions = [{id1: <objectID1>, id2: <objectID2>, type: <interactionType>}]
// callback(err)
objectsDB.insertInteractions = function(interactions, callback){

    var stmt = db.prepare('INSERT INTO interactions (objectID1, objectID2, type) VALUES (?,?,?)', function(err){
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(interactions, function(interaction, callback){
            stmt.run([interaction.id1, interaction.id2, interaction.type], callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
};

// deleting some objects interactions
// Check user rights before using it functions
// interactions = [{id1:<objectID1>, id2: <objectID2>, type: <interactionType>}]
// callback(err)
objectsDB.deleteInteractions = function(interactions, callback){
    if(!interactions.length) return callback();

    var stmt = db.prepare('DELETE FROM interactions WHERE objectID1=? AND objectID2=? AND type=?', function(err) {
        if(err) return callback(err);

        // eachSeries used for possible transaction rollback if error occurred
        async.eachSeries(interactions, function(interaction, callback){
            stmt.run([interaction.id1, interaction.id2, interaction.type], callback);
        }, function(err) {
            stmt.finalize();
            callback(err);
        });
    });
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
