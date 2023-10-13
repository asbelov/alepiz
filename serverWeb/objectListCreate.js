/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const rightsDB = require('../models_db/usersRolesRightsDB');
const prepareUser = require('../lib/utils/prepareUser');
const checkIDs = require('../lib/utils/checkIDs');
const webServerCacheExpirationTime = require('./webServerCacheExpirationTime');
const cache = require('./getDataFromDB');

var objectCacheUpdateTime = 0;
var cachedObjects = new Set();
var cacheObjectNames = new Map();
var cacheObjectIDs = new Map();
var topObjects = new Set();

var interactionCacheUpdateTime = 0;
var cachedInteractionsForIntersectAndExclude = new Map();
var cacheInteractionsForInclude = new Map();
var cacheInteractionsForIncludeReverse = new Map();

var cacheThread;

var objectListCreate = {
    getCacheInteractionsForIncludeReverse: function() { return cacheInteractionsForIncludeReverse },
    getAllInteractions: getAllInteractions,
};
module.exports = objectListCreate;

/**
 * Load data from DB to the cache
 * @param {Object} initCacheThread cache thread for communication
 */
objectListCreate.initCacheThread = function(initCacheThread) {
    cacheThread = initCacheThread;

    // load data to the local cache first time
    getAllObjects(function () {});
    getAllInteractions(function () {});
}

/**
 * Getting a list of objects depending on previously selected objects and their interactions
 * @param {Array} parentObjectsNames -an array of object names. Object names are used instead of IDs because the object
 * names are used in the browser url for convenience and when we want to create a list of objects from the browser url
 * we only know the object names
 * @param {string} username - username for check rights for objects
 * @param {function(Error) | function(null, result: Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: [0|1],
 *     created: number
 * }>)} callback - return Error or an array with objects
 */
objectListCreate.filterObjectsByInteractions = function(parentObjectsNames, username, callback) {

    // for nothing return top of the objects
    if (!parentObjectsNames || !parentObjectsNames.length) return getTopObjects(username, callback);

    getIncludedObjects(username, parentObjectsNames, function (err, includedObjects) {
        if(err) return callback(err);

        var parentObjectsIDs = Object.keys(includedObjects).map(id => Number(id));

        log.debug('Included objects for ', parentObjectsNames, ': ', includedObjects,
            '; parentObjectsIDs: ', parentObjectsIDs)

        // for one selected object return all included objects
        if (parentObjectsNames.length === 1) return callback(null, includedObjects[parentObjectsIDs[0]] || []);

        var result = [], notFoundInteractions = new Set(parentObjectsIDs);
        for(var i = 0; i < parentObjectsIDs.length - 1; i++) {
            var parentObjectID1 = parentObjectsIDs[i];

            for(var j = i + 1; j < parentObjectsIDs.length; j++) {
                var parentObjectID2 = parentObjectsIDs[j];

                var interactionMap = cachedInteractionsForIntersectAndExclude.get(parentObjectID1);
                if(interactionMap) {
                    var interactionType = interactionMap.get(parentObjectID2);
                    if (interactionType === 1) {
                        notFoundInteractions.delete(parentObjectID1);
                        notFoundInteractions.delete(parentObjectID2);
                        result = merge(result,
                            intersect(includedObjects[parentObjectID1], includedObjects[parentObjectID2]));
                    } else if (interactionType === 2) {
                        notFoundInteractions.delete(parentObjectID1);
                        notFoundInteractions.delete(parentObjectID2);
                        result = merge(result,
                            exclude(includedObjects[parentObjectID1], includedObjects[parentObjectID2]));
                    }
                }
            }
        }

        notFoundInteractions.forEach(parentObjectID =>
            result = merge(result, includedObjects[parentObjectID]));

        log.debug('Interaction result for : ', parentObjectsNames ,': ', result);
        callback(null, result);
    });
};

/**
 * Get objects included in parentObjectNames
 * @param {string} username username
 * @param {Array<string>} parentObjectNames an array like [objectName1, objectName2, ...] case insensitive
 * @param {function(Error)|function(null, {number: Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: [0|1],
 *     created: number
 * }>})} callback
 */
function getIncludedObjects(username, parentObjectNames, callback) {

    getAllObjects(function () {
        getAllInteractions(function () {
            var includedObjects = {};
            async.each(parentObjectNames, function (parentObjectName, callback) {
                var parentObject = cacheObjectNames.get(parentObjectName.toLowerCase());
                if(!parentObject || !parentObject.id) {
                    log.error('Object is ', parentObject, ' not found in the cache cacheObjectNames');
                    return callback();
                }

                var setOfChildObjectIDs = cacheInteractionsForInclude.get(parentObject.id);
                if(!setOfChildObjectIDs || !setOfChildObjectIDs.size) {
                    log.debug('Object ', parentObjectName,
                        ' has no included objects in the cache cacheInteractionsForInclude');
                    return callback();
                }
                rightsDB.checkObjectsIDs({
                    user: username,
                    IDs: Array.from(setOfChildObjectIDs),
                    errorOnNoRights: false
                }, function (err , checkedChildObjectIDs) {
                    if(setOfChildObjectIDs.size !== checkedChildObjectIDs.length) {
                        log.debug('User ', username, ' has no rights for all child objects for view. Parent: ',
                            parentObjectName);
                    }
                    checkedChildObjectIDs.forEach(checkedChildObjectID => {
                        var childObject = cacheObjectIDs.get(checkedChildObjectID);
                        if(!childObject) {
                            log.error('Can\'t find object ID ', checkedChildObjectID,
                                ' in the object cache cacheObjectIDs');
                            return;
                        }

                        if(!includedObjects[parentObject.id]) includedObjects[parentObject.id] = [];
                        includedObjects[parentObject.id].push(childObject);
                    });
                    callback();
                });
            }, function (err) {
                callback(err, includedObjects);
            });
        });
    });
}

/**
 * intersect two rows
 * @param {Array<Object>} rows1
 * @param {Array<Object>} rows2
 * @return {Array<Object>}
 */
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
 */

/**
 * exclude two rows
 * @param {Array<Object>} rows1
 * @param {Array<Object>} rows2
 * @return {Array<Object>}
 * @example
 * row1.id ~ [1,2,3,4,5,6]
 * row2.id ~ [4,5,6,7,8,9]
 * stage1: exclude.id ~ [7,8,9]
 * stage2: exclude.id ~ [1,2,3,7,8,9]
 */

function exclude(rows1, rows2) {
    var IDs1 = rows1.map(function (row) {
        return row.id;
    });

    var excludeArray = [], IDs2 = rows2.map(function (row) {
        if(IDs1.indexOf(row.id) === -1) excludeArray.push(row);
        return row.id;
    }); // exclude.id ~ [7,8,9]

    rows1.forEach(function (row) {
        if(IDs2.indexOf(row.id) === -1) excludeArray.unshift(row);
    }); // exclude.id ~ [1,2,3,7,8,9]

    return excludeArray;
}

/**
 * merge two rows and remove duplicates
 * @param {Array<Object>} rows1
 * @param {Array<Object>} rows2
 * @return {Array<Object>}
 */
function merge(rows1, rows2) {
    if(!rows1.length) return rows2;

    var mergeArray = [];
    var IDs1 = rows1.map(function (row) {
        mergeArray.push(row);
        return row.id;
    });

    rows2.forEach(function (row) {
        if(IDs1.indexOf(row.id) === -1) mergeArray.push(row);
    });

    return mergeArray;
}

/**
 * Global searching required objects
 * @param {string} searchStr search string for global search
 * @param {string} username username
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     name: string,
 *     description: string,
 *     sortPosition: number,
 *     color: string|null,
 *     disabled: [0|1],
 *     created: number
 * }>)} callback
 */
objectListCreate.searchObjects = function(searchStr, username, callback){

    var searchRE = createSearchStrRE(searchStr);
    if(typeof searchRE === 'string') return callback(new Error(searchRE));


    getAllObjects(function () {

        var filteredObjects = [];
        cachedObjects.forEach(row => {
            if(searchRE.test(row.name)) filteredObjects.push(row);
            searchRE.lastIndex = 0;
        })

        rightsDB.checkObjectsIDs({
            user: prepareUser(username),
            IDs: filteredObjects,
            errorOnNoRights: false
        }, callback);
    });
};


/**
 * Create regExp for search the objects
 * @param initSearchStr initial search string
 * @return {RegExp|string} regExp for search or error string if can't create the regExp
 */
function createSearchStrRE(initSearchStr) {
    var searchStrRE = '(.*' + initSearchStr.
            // remove empty strings
            split(/[\r\n]/).filter(str => str.trim()).join('\n').
            // escape regExp symbols except *
            replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&').
            // replace '|*&' or '&*|' to '&', don't ask why
            replace(/[&|]\**[&|]/, '&').
            // replace '*' characters to '.*'
            replace(/\*+/g, '.*').
            // replace '_' characters to '.'
            replace(/_/g, '.').
            // replace spaces around and ',', '|', '\r', '\n' characters to '.*)|(.*'
            replace(/\s*[,|\r\n]+\s*/g, '.*)|(.*').
            // replace spaces around and '&' characters to '.*)&(.*'
            replace(/\s*&+\s*/g, '.*)&(.*').
            // remove forward and backward spaces characters
            replace(/^\s+/, '').replace(/\s+$/, '')
        + '.*)';

    try {
        return new RegExp(searchStrRE, 'ig');
    } catch (e) {
        return 'Error creating regExp from object search string:' + initSearchStr + '->' +
            searchStrRE + ':' + e.message;
    }
}

/**
 * get up level objects when "To Top" pressed
 * @param {string} username username
 * @param {function(Error)|function(null, Array)} callback callback(err, rows), where rows is
 * [{id:<objectID>, name:<objectName>, description:<objectDescription>, sortPosition:<object sort position>
 *     color:<objectColor>, disabled:<0|1>}, created:<timestamp>}, ..]
 */
function getTopObjects(username, callback) {
    getAllObjects(function () {
        rightsDB.checkObjectsIDs({
            user: prepareUser(username),
            IDs: Array.from(topObjects),
            errorOnNoRights: false,
        }, callback);
    });
}

/** Get full information about objects by object names using case-insensitive comparison of object names
 *
 * @param {Array<string>} objectsNames - array of object names
 * @param {string} username - username for check user rights for objects
 * @param {function(Error)|function(null, Array)} callback - callback(err, objects) return array of objects
 * like [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:...,
 * disabled:..., color:...}, {...},...]
 */
objectListCreate.getObjectsByNames = function(objectsNames, username, callback) {

    getAllObjects(function () {
        var filteredObjects = [];
        objectsNames.forEach(objectName => {
            var row = cacheObjectNames.get(objectName.toLowerCase());
            if(row) filteredObjects.push(row);
        });

        rightsDB.checkObjectsIDs({
            user: prepareUser(username),
            IDs: filteredObjects,
            errorOnNoRights: false
        }, callback);
    });
};

/** Get objects information by object ID
 * @param {Array|string|number} initObjectIDs - array of objects IDs or comma separated string with IDs or single ID
 * @param {string} username - username for check rights to objects
 * @param {function(Error)|function(null, Array)} callback - callback(err, objects) return array of objects
 * like [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:...,
 * disabled:..., color:...}, {...},...]
 */
objectListCreate.getObjectsByIDs = function(initObjectIDs, username, callback) {

    checkIDs(initObjectIDs, function(err, checkedIDs) {
        if (err) return callback(err);

        rightsDB.checkObjectsIDs({
            user: prepareUser(username),
            IDs: checkedIDs,
            checkView: true,
            errorOnNoRights: true
        }, function (err, checkedObjectIDs) {
            if (err) return callback(err);

            getAllObjects(function () {

                var filteredObjects = [];
                checkedObjectIDs.forEach(objectID => {
                    var row = cacheObjectIDs.get(objectID);
                    if(row) filteredObjects.push(row);
                });
                callback(null, filteredObjects);
            });
        });
    });
};

/**
 * Get all object data from to the cache
 * @param {function()} callback
 */
function getAllObjects(callback) {
    var callbackAlreadyCalled = false;
    if(objectCacheUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(objectCacheUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
        // set the time here for getting data from the database once when data was received to the cache before
        objectCacheUpdateTime = Date.now();
    }

    var getDataFromThread = cacheThread && typeof cacheThread.sendAndReceive === 'function' ?
        function(callback) {
            cacheThread.sendAndReceive('getAllObjects', callback)
        } : cache.getAllObjects;

    getDataFromThread(function(err, data) {
        // first time getting data from DB
        objectCacheUpdateTime = Date.now();
        if(data) {
            cachedObjects = data.objects;
            cacheObjectNames = data.objectNames;
            cacheObjectIDs = data.objectIDs;
            topObjects = data.topObjects;
        }
        if (!callbackAlreadyCalled) callback();
    });
}

/**
 * Get all interaction data from DB to the cache
 * @param {function()} callback callback()
 */
function getAllInteractions(callback) {
    var callbackAlreadyCalled = false;
    if(interactionCacheUpdateTime) {
        callbackAlreadyCalled = true;
        callback();
        if(interactionCacheUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
        // set the time here for getting data from the database once when data was received to the cache before
        interactionCacheUpdateTime = Date.now();
    }

    var getDataFromThread = cacheThread && typeof cacheThread.sendAndReceive === 'function' ?
        function(callback) {
            cacheThread.sendAndReceive('getAllInteractions', callback)
        } : cache.getAllInteractions;

    getDataFromThread(function(err, data) {
        // first time getting data from DB
        interactionCacheUpdateTime = Date.now();
        if(data) {
            cacheInteractionsForInclude = data.interactionsForInclude;
            cacheInteractionsForIncludeReverse = data.interactionsForIncludeReverse;
            cachedInteractionsForIntersectAndExclude = data.interactionsForIntersectAndExclude;
        }
        if(!callbackAlreadyCalled) callback();
    });
}

/**
 * Add new objects tj the cache
 * @param {Object} newObjectsNames object names like {<objectName>: <objectID>, ....}
 * @param {string|undefined} newDescription new description
 * @param {number|undefined} newOrder new object sort position
 * @param {0|1|undefined} disabled disabled or enabled object
 * @param {string|undefined} color objects color
 * @param {number|undefined} createdTimestamp created timestamp
 */
objectListCreate.addNewObjectsToCache = function (newObjectsNames, newDescription, newOrder, disabled,
                                                  color, createdTimestamp) {

    log.info('Add new objects to the cache: ', newObjectsNames)
    for(var newObjectName in newObjectsNames) {
        var row = {
            id: newObjectsNames[newObjectName],
            name: newObjectName,
            description: newDescription,
            sortPosition: newOrder,
            disabled: disabled ? 1 : 0,
            color: color,
            created: createdTimestamp,
        }

        cachedObjects.add(row);
        if(newOrder < 10) topObjects.add(row);
        cacheObjectIDs.set(newObjectsNames[newObjectName], row);
        cacheObjectNames.set(newObjectName.toLowerCase(), row);
    }
    objectCacheUpdateTime = Date.now();
}

/**
 *
 * @param {Array<{id: number, name: string}>} newObjects new object names
 */
objectListCreate.renameObjectsInCache = function (newObjects) {
    log.info('Rename objects in the cache: ', newObjects);

    newObjects.forEach(newObject => {
        var object = cacheObjectIDs.get(newObject.id);
        if(object) {
            var oldObjectName = object.name.toLowerCase();
            object.name = newObject.name;
            cacheObjectNames.set(newObject.name.toLowerCase(), object).delete(oldObjectName);
        }
    });
    objectCacheUpdateTime = Date.now();

    /*
     Dont replace in the cachedObjects and topObjects because elements of this Map are a reference to the newObject
     */
}

/**
 * Update objects data it the cache
 * @param {Array<number>} objectIDs an array with object IDs
 * @param {{
 *     $disabled: 0|1|undefined,
 *     $sortPosition: number|undefined,
 *     $description: string|undefined,
 *     $color: string|undefined,
 * }} updateData object data for update
 */
objectListCreate.updateObjectsInCache = function (objectIDs, updateData) {
    log.info('Change objects data in the cache for ', objectIDs);

    objectIDs.forEach(objectID => {
        var newObject = cacheObjectIDs.get(objectID)
        if(!newObject) return;
        if(updateData.$disabled !== undefined) newObject.disabled = updateData.$disabled;
        if(updateData.$sortPosition !== undefined) newObject.sortPosition = updateData.$sortPosition;
        if(updateData.$description !== undefined) newObject.description = updateData.$description;
        if(updateData.$color !== undefined) newObject.color = updateData.$color;

        /*
         Dont replace in the cacheObjectNames, cachedObjects and topObjects because elements of this Map are
         a reference to the newObject
         */

    });
    objectCacheUpdateTime = Date.now();

}

/**
 * Delete objects from the cache
 * @param {Array<number>} objectIDs an array with object IDs
 */
objectListCreate.deleteObjectsFromCache = function (objectIDs) {
    log.info('Delete removed objects from the cache: ', objectIDs);

    objectIDs.forEach(objectID => {
        cachedObjects.forEach(cachedObject => {
            if(cachedObject.id === objectID) {
                cachedObjects.delete(cachedObject);
            }
        });

        topObjects.forEach(cachedObject => {
            if(cachedObject.id === objectID) {
                cachedObjects.delete(cachedObject);
            }
        });

        var object = cacheObjectIDs.get(objectID);
        if(object) {
            cacheObjectNames.delete(object.name.toLowerCase());
            cacheObjectIDs.delete(objectID);
        }
    });
    objectCacheUpdateTime = Date.now();
}

/**
 * Insert object interactions to the cache
 * @param {Array<{
 *     id1: number,
 *     id2: number,
 *     type: 0|1|2,
 * }>} interactions interactions for inserting
 */
objectListCreate.insertInteractionsToCache = function (interactions) {
    log.info('Add new interactions to the cache: ', interactions);

    interactions.forEach(interactionForInsert => {
        if(interactionForInsert.type === 0) {
            if(!cacheInteractionsForInclude.has(interactionForInsert.id1)) {
                cacheInteractionsForInclude.set(interactionForInsert.id1, new Set());
            }

            if(!cacheInteractionsForIncludeReverse.has(interactionForInsert.id2)) {
                cacheInteractionsForIncludeReverse.set(interactionForInsert.id2, new Set());
            }

            cacheInteractionsForInclude.get(interactionForInsert.id1).add(interactionForInsert.id2);
            cacheInteractionsForIncludeReverse.get(interactionForInsert.id2).add(interactionForInsert.id1);
        } else {
            if(!cachedInteractionsForIntersectAndExclude.has(interactionForInsert.id1)) {
                cachedInteractionsForIntersectAndExclude.set(interactionForInsert.id1, new Map());
            }
            if(!cachedInteractionsForIntersectAndExclude.has(interactionForInsert.id2)) {
                cachedInteractionsForIntersectAndExclude.set(interactionForInsert.id2, new Map());
            }

            cachedInteractionsForIntersectAndExclude.get(interactionForInsert.id1)
                .set(interactionForInsert.id2, interactionForInsert.type);
            cachedInteractionsForIntersectAndExclude.get(interactionForInsert.id2)
                .set(interactionForInsert.id1, interactionForInsert.type);
        }
    });
    interactionCacheUpdateTime = Date.now();
}

/**
 * Delete object interactions from the cache
 * @param {Array<{
 *     id1: number,
 *     id2: number,
 *     type: 0|1|2,
 * }>} interactions interactions for deleting
 */

objectListCreate.deleteInteractionFromCache = function (interactions) {
    log.info('Delete interactions from the cache: ', interactions);

    interactions.forEach(interactionForDelete => {

        if(interactionForDelete.type === 0) {

            if(cacheInteractionsForInclude.has(interactionForDelete.id1)) {
                var interaction = cacheInteractionsForInclude.get(interactionForDelete.id1);
                if(interaction) interaction.delete(interactionForDelete.id2);
                interaction = cacheInteractionsForIncludeReverse.get(interactionForDelete.id2);
                if(interaction) interaction.delete(interactionForDelete.id1);
            } else {

                interaction = cachedInteractionsForIntersectAndExclude.get(interactionForDelete.id1);
                if(interaction) {
                    if(interactionForDelete.type === interaction.get(interactionForDelete.id2)) {
                        interaction.delete(interactionForDelete.id2);
                    }
                }
                interaction = cachedInteractionsForIntersectAndExclude.get(interactionForDelete.id2);
                if(interaction) {
                    if(interactionForDelete.type === interaction.get(interactionForDelete.id1)) {
                        interaction.delete(interactionForDelete.id1);
                    }
                }
            }
        }
    });
    interactionCacheUpdateTime = Date.now();
}
