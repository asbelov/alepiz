/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var async = require('async');
var db = require('../lib/db');
var rightsDB = require('../models_db/usersRolesRightsDB');

var objectsDB = {};
module.exports = objectsDB;

// Using objectsNames instead of IDs, because in browser URL we use objects names for usability
// and when we want to create objects list from browser URL, we known only objects names
objectsDB.filterObjects = function(objectsNames, user, callback) {

    var typesFunc = {
        0: merge,
        1: intersect,
        2: exclude
    };

    // for nothing return top of the objects
    if (!objectsNames || !objectsNames.length) return getTopObjects(user, callback);
    // for one selected object return all included objects
    if (objectsNames.length === 1) return getIncludedObjects(user, objectsNames, callback);

    getIncludedObjects(user, objectsNames, function (err, includedObjectsArray) {
        if(err) return callback(err);

        var includedObjects = {};
        includedObjectsArray.forEach(function (row) {
            var parentObjectID = row.parentObjectID;
            delete row.parentObjectID;
            if(!includedObjects[parentObjectID]) includedObjects[parentObjectID] = [row];
            else includedObjects[parentObjectID].push(row);
        });

        var parentObjectsIDs = Object.keys(includedObjects).map(function (id) {
            return Number(id);
        });

        getInteractions(parentObjectsIDs, function (err, interactions, interactionsArray, types, notInInteractions) {
            if(err) return callback(err);
            //console.log(includedObjects)
            //console.log(interactions, interactionsArray, types, notInInteractions);
            var result = [], groupSize = 0, allGroups = [];
            for(var type in types) {
                if(typeof typesFunc[type] !== 'function') return callback(new Error('Found unknown object interaction type ' + type));

                var groups = makeGroups(interactions, interactionsArray, type);

                //console.log('groups: ', type, groups);

                groups.forEach(function (group) {
                    // used for debug
                    if(group.length > groupSize) groupSize = group.length;
                    var parentObject = group.pop();
                    var prepared = includedObjects[parentObject];
                    group.forEach(function (parentObjectID) {
                        prepared = typesFunc[type](prepared, includedObjects[parentObjectID]);
                    });
                    group.push(parentObject); // save group content for debug
                    //console.log('Res for ', group, ': ', prepared);
                    result = merge(result, prepared);
                });

                // used for debug
                allGroups.push({
                    type: type,
                    group: groups,
                });
            }

            notInInteractions.forEach(function (parentID) {
                result = merge(result, includedObjects[parentID]);
            });

            if(groupSize > 2) {
                log.info('Complex interaction: parent: ', objectsNames, '; interactions: ', interactions,
                    '; nonInteractions: ', notInInteractions, '; groups: ', allGroups, '; result: ', result);
            }

            callback(null, result);
        })
    });
};

// get up level objects when "To Top" pressed
function getTopObjects(user, callback) {
    db.all('SELECT * FROM objects WHERE sortPosition < 10', function(err, rows) {
        if(err) return callback('Can\'t get objects information for top objects: ' + err.message);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: rows,
            errorOnNoRights: false
        }, callback)
    });
}

/*
return objects included in objectsNames

user: userName,
objectNames: [objectName1, objectName2, ...] case insensitive

callback(null, includedObjectsArray), where
includedObjectsArray: [{parentObjectID, id, name, description, sortPosition, color, disabled}, {}, ...],
 */
function getIncludedObjects(user, objectsNames, callback) {

    var stmt = db.prepare('SELECT obj.id AS parentObjectID, objects.id AS id, objects.name AS name, ' +
        'objects.description AS description, objects.sortPosition AS sortPosition, objects.color AS color, ' +
        'objects.disabled AS disabled ' +
        'FROM objects ' +
        'JOIN interactions ON interactions.objectID2 = objects.id AND interactions.type = 0 ' +
        'JOIN objects obj ON interactions.objectID1 = obj.id '+
        'WHERE obj.name = ? GROUP BY objects.id COLLATE NOCASE', function(err) {
        if(err) {
            return callback(new Error('Error preparing query for getting objects included in ' +
                objectsNames.join(', ') + ': ' + err));
        }

        var includedObjectsArray = [];
        async.eachLimit(objectsNames, 50,function (objectName, callback) {
            stmt.all(objectName, function(err, rows) {
                if(err) callback(new Error('Error getting objects included in ' + objectName + ': ' + err));
                Array.prototype.push.apply(includedObjectsArray, rows);
                callback();
            });
        }, function (err) {
            if(err) return callback(err);

            rightsDB.checkObjectsIDs({
                user: user,
                IDs: includedObjectsArray,
                errorOnNoRights: false
            }, callback);
        });
    });
}

/*
Return Interactions for parent objects

parentObjectsIDs: [parentID1, parentID2, ...]

callback(err, interactions, interactionsArray, types, notInInteractions);
interactions: {
        <interactionsType 1|2>: {
                <id1>: {
                    <id2>: idx1 // interactions position index in interactionsArray
                    <id3>: idx2 // interactions position index in interactionsArray
                }
            }
        }, .....
interactionsArray: [{objectID1:.., objectID2:.., type:...}, {}...]
types: {1: true, 2: true}
nonInteractions: [id1, id2, id3....]

 */

function getInteractions(parentObjectsIDs, callback) {

    var stmt = db.prepare('SELECT * FROM interactions WHERE ' +
        'interactions.type > 0 AND (interactions.objectID1=? OR interactions.objectID2=?)', function (err) {
        if(err) {
            return callback(new Error('Can\'t prepare query for getting interactions for objects: ' +
                parentObjectsIDs.join(', ') + ': ' + err.message));
        }

        var interactions = {},
            interactionsArray = [],
            interactionsIDs = {},
            types = {},
            notInInteractions = [];
        async.eachLimit(parentObjectsIDs, 50,function (id, callback) {
            stmt.all([id, id], function (err, rows) {
                if(err) return callback(new Error('Can\'t get interactions for object: ' + id + ': ' + err.message));
                //console.log('interactions for ', id,': ', rows)

                var foundInteractionsCnt = 0;
                rows.forEach(function (row) {
                    // skip interaction with an unselected object
                    if(parentObjectsIDs.indexOf(row.objectID1) === -1 ||
                        parentObjectsIDs.indexOf(row.objectID2) === -1) return;

                    ++foundInteractionsCnt;

                    // prevents adding one interaction several times
                    if(interactionsIDs[row.id]) return;
                    interactionsIDs[row.id] = true;

                    if(!interactions[row.type]) {
                        interactions[row.type] = {};
                        types[row.type] = true;
                    }
                    if(!interactions[row.type][row.objectID1]) interactions[row.type][row.objectID1] = {};
                    if(!interactions[row.type][row.objectID2]) interactions[row.type][row.objectID2] = {};

                    var idx = interactionsArray.length;
                    interactionsArray[idx] = row;
                    interactions[row.type][row.objectID1][row.objectID2] = idx;
                    interactions[row.type][row.objectID2][row.objectID1] = idx;
                });

                if(!foundInteractionsCnt) notInInteractions.push(id);

                callback();
            });
        }, function (err) {
            callback(err, interactions, interactionsArray, types, notInInteractions);
        });
    });
}

/*
return groups for interactions.

 */
function makeGroups(interactions, interactionsArray, type) {

    var groups = [], interactionsArrayIdx = 0;
    while(true) {
        // try to find not in group interaction. All in group interactions are marked as null
        for(var newGroup = []; interactionsArrayIdx < interactionsArray.length; interactionsArrayIdx++) {
            if(interactionsArray[interactionsArrayIdx]) { // not null
                if(Number(interactionsArray[interactionsArrayIdx].type) !== Number(type)) continue;
                // creating new group
                newGroup = [
                    interactionsArray[interactionsArrayIdx].objectID1,
                    interactionsArray[interactionsArrayIdx].objectID2
                ];
                interactionsArray[interactionsArrayIdx] = null; // now this interaction in group. mark as null
                break;
            }
        }
        //console.log('newGroup: ', newGroup);
        // all interactions now in a group. break main loop
        if(!newGroup.length) break;

        // forEach(...) does not work when we use newGroup.push(...) inside the loop
        for(var i = 0; i < newGroup.length; i++) {

            // try to find the interaction of the current object from the group (newGroup[i]) with objects that are not yet in the group
            var notInGroupIDs = Object.keys(interactions[type][newGroup[i]]).filter(function (id) {
                return newGroup.indexOf(id) === -1;
            });
            // continue if these interactions are not found
            if(!notInGroupIDs.length) continue;

            // try to find the interaction of objects that are not yet in the group with other objects from a group
            notInGroupIDs.forEach(function (ID1) {
                var indices = []; // there will be indices of the found interactions for interactionArray
                newGroup.forEach(function (ID2) {
                    if(newGroup[i] !== ID2 && interactions[type][ID1][ID2] !== undefined) {
                        indices.push(interactions[type][ID1][ID2]);
                    }
                });

                // cross interaction found. Add an objectID to the group and mark these interactions in InteractionsArray as null.
                if(indices.length === newGroup.length - 1) {
                    newGroup.push(Number(ID1));
                    //console.log('newGroup add: ', newGroup);
                    interactionsArray[interactions[type][ID1][newGroup[i]]] = null;
                    indices.forEach(function (idx) {
                        interactionsArray[idx] = null;
                    });
                }
            });
        }

        // add a new group with interactions to the groups array
        groups.push(newGroup);
    }

    return groups;
}

// intersect two rows
function intersect(rows1, rows2) {
    var IDs1 = rows1.map(function (row) {
        return row.id;
    });

    return rows2.filter(function (row) {
        return IDs1.indexOf(row.id) !== -1;
    });
}

/*
exclude two rows
row1.id ~ [1,2,3,4,5,6]
row2.id ~ [4,5,6,7,8,9]
 */
function exclude(rows1, rows2) {
    var IDs1 = rows1.map(function (row) {
        return row.id;
    });

    var exclude = [], IDs2 = rows2.map(function (row) {
        if(IDs1.indexOf(row.id) === -1) exclude.push(row);
        return row.id;
    }); // exclude.id ~ [7,8,9]

    rows1.forEach(function (row) {
        if(IDs2.indexOf(row.id) === -1) exclude.unshift(row);
    }); // exclude.id ~ [1,2,3,7,8,9]

    return exclude;
}

/*
merge two rows and remove duplicates
 */
function merge(rows1, rows2) {
    if(!rows1.length) return rows2;

    var merge = [];
    var IDs1 = rows1.map(function (row) {
        merge.push(row);
        return row.id;
    });

    rows2.forEach(function (row) {
        if(IDs1.indexOf(row.id) === -1) merge.push(row);
    });

    return merge;
}

//
// searchStr = <searchPattern1><logical operator><searchPattern2><logical operator>,
//      f.e. %object1%|object2&object3
// for search perform SQL LIKE. It is case insensitive and you can use symbols "%" and "_":
// '%' - any symbols
// '_' - any symbol (only one)
objectsDB.searchObjects = function(searchStr, user, callback){

    // split search string to search patterns (divider is a logical operators '|' and '&')
    var queryParameters = searchStr.split(/[|&]/);

    var subQuery = searchStr.
        replace(/[^|&]/g, ''). // for making subQuery remove all symbols, except "|" or "&"
        replace(/\|/g, ' OR name LIKE ?').
        replace(/&/g, ' AND name LIKE ?');


    db.all('SELECT * FROM objects WHERE name LIKE ?' + subQuery + ' ESCAPE "\\"', queryParameters, function(err, rows) {
        if(err) return callback('Can\'t get objects information for searched objects ' + searchStr + ': ' + err.message);

        rightsDB.checkObjectsIDs({
            user: user,
            IDs: rows,
            errorOnNoRights: false
        }, callback)
    });
};

/*
Get objects information by objects names, using case insensitive compare objects names

objectsNames: array of objects names
user: user name
callback(err, objects)
objects: [{name: ..., id: ..., description: ..., sortPosition:..., color:..., disabled:....}, {...}, ...]
 */
objectsDB.getObjectsByNames = function(objectsNames, user, callback) {

    /* when count of objects are greater then 999 (SQLITE_MAX_VARIABLE_NUMBER), sqlite can\'t create a long query.
        separate objects array to small arrays and check objects rights by parts
       https://www.sqlite.org/limits.html
     */

    var joinedObjects = [], arrayPartsIdx = [0];

    // Math.ceil(.95)=1; Math.ceil(7.004) = 8
    for(var i = 1; i < Math.ceil(objectsNames.length / db.maxVariableNumber); i++) {
        arrayPartsIdx.push(i * db.maxVariableNumber);
    }

    async.eachSeries(arrayPartsIdx, function (idx, callback) {
        var objectNamesPart = objectsNames.slice(idx, idx+ db.maxVariableNumber);

        db.all('SELECT * FROM objects WHERE name IN (' +
            Array(objectNamesPart.length).fill('?').join(',') +
            ') COLLATE NOCASE', objectNamesPart, function(err, rows) {

                if(err) return callback(new Error('Can\'t get objects information: ' + err.message + '; source objects names: ' + objectNamesPart.join(', ')));
                rightsDB.checkObjectsIDs({
                    user: user,
                    IDs: rows,
                    errorOnNoRights: false
                }, function(err, checkedRows) {
                    if(err) return callback(err);

                    Array.prototype.push.apply(joinedObjects, checkedRows);
                    callback();
                })
            });
    }, function (err) {
        if(err) return callback(err);
        callback(null, joinedObjects);
    });
};