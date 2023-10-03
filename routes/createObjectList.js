/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const objectsDB = require('../models_db/objectsDB');
const rightsDB = require('../models_db/usersRolesRightsDB');
const prepareUser = require('../lib/utils/prepareUser');
const checkIDs = require('../lib/utils/checkIDs');
const webServerCacheExpirationTime = require('../serverWeb/webServerCacheExpirationTime');

var objectCacheUpdateTime = 0;
var loadObjectsToCacheInProgress = false;
var cachedObjects = new Set();
var cacheObjectNames = new Map();
var cacheObjectIDs = new Map();
var topObjects = new Set();

var interactionCacheUpdateTime = 0;
var loadInteractionToCacheInProgress = false;
var cachedInteractionsRow = new Set();
var cachedInteractionsForIntersectAndExclude = new Map();
var cacheInteractionsForInclude = new Map();
var cacheInteractionsForIncludeReverse = new Map();

// load data from DB to the cache
getAllInteractions(function (err) {
    if(err) throw err;
});

getAllObjects(function (err) {
    if(err) throw err;
});

var objectsFilter = {
    cacheInteractionsForIncludeReverse: cacheInteractionsForIncludeReverse,
};
module.exports = objectsFilter;

/**
 * Getting a list of objects depending on previously selected objects and their interactions
 * @param {Array} parentObjectsNames -an array of object names. Object names are used instead of IDs because the object
 * names are used in the browser url for convenience and when we want to create a list of objects from the browser url
 * we only know the object names
 * @param {string} user - username for check rights for objects
 * @param {function(Error) | function(null, result: Array)} callback - return Error or an array with objects like
 * [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
objectsFilter.filterObjectsByInteractions = function(parentObjectsNames, user, callback) {

    // for nothing return top of the objects
    if (!parentObjectsNames || !parentObjectsNames.length) return getTopObjects(user, callback);

    getIncludedObjects(user, parentObjectsNames, function (err, includedObjects) {
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

/*
return objects included in objectsNames

user: userName,
objectNames: [objectName1, objectName2, ...] case insensitive

callback(null, includedObjectsArray), where
includedObjectsArray: [{parentObjectID, id, name, description, sortPosition, color, disabled, created}, {}, ...],
 */
function getIncludedObjects(user, parentObjectNames, callback) {

    getAllObjects(function () {
        getAllInteractions(function () {
            var includedObjects = {};
            async.each(parentObjectNames, function (parentObjectName, callback) {
                var parentObject = cacheObjectNames.get(parentObjectName.toLowerCase());
                if(!parentObject || !parentObject.id) return callback();

                var setOfChildObjectIDs = cacheInteractionsForInclude.get(parentObject.id);
                if(!setOfChildObjectIDs || !setOfChildObjectIDs.size) return callback();
                rightsDB.checkObjectsIDs({
                    user: user,
                    IDs: Array.from(setOfChildObjectIDs),
                    errorOnNoRights: false
                }, function (err , checkedChildObjectIDs) {
                    checkedChildObjectIDs.forEach(checkedChildObjectID => {
                        if(!includedObjects[parentObject.id]) includedObjects[parentObject.id] = [];
                        includedObjects[parentObject.id].push(cacheObjectIDs.get(checkedChildObjectID));
                    });
                    callback(err);
                });
            }, function (err) {
                callback(err, includedObjects);
            });
        });
    });
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

    var excludeArray = [], IDs2 = rows2.map(function (row) {
        if(IDs1.indexOf(row.id) === -1) excludeArray.push(row);
        return row.id;
    }); // exclude.id ~ [7,8,9]

    rows1.forEach(function (row) {
        if(IDs2.indexOf(row.id) === -1) excludeArray.unshift(row);
    }); // exclude.id ~ [1,2,3,7,8,9]

    return excludeArray;
}

/*
merge two rows and remove duplicates
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

//
// searchStr = <searchPattern1><logical operator><searchPattern2><logical operator>,
//      f.e. %object1%|object2&object3
// for search perform SQL LIKE. It is case-insensitive, and you can use symbols "%" and "_":
// '%' - any symbols
// '_' - any symbol (only one)
objectsFilter.searchObjects = function(searchStr, username, callback){

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
objectsFilter.getObjectsByNames = function(objectsNames, username, callback) {

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
 * @param {string} username - username for check rights to objects
 * @param {Array|string|number} initObjectIDs - array of objects IDs or comma separated string with IDs or single ID
 * @param {function(Error)|function(null, Array)} callback - callback(err, objects) return array of objects
 * like [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:...,
 * disabled:..., color:...}, {...},...]
 */
objectsFilter.getObjectsByIDs = function(username, initObjectIDs, callback) {

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
        if(loadObjectsToCacheInProgress || objectCacheUpdateTime > Date.now() - webServerCacheExpirationTime()) return;
    }

    loadObjectsToCacheInProgress = true;
    // start to update the cache
    objectsDB.getAllObjects(function (err, rows) {
        if(err) log.error('Can\'t get object data from DB: ', err.message);
        else {
            cachedObjects = new Set(rows);
            topObjects.clear();
            cacheObjectIDs.clear();
            cacheObjectNames.clear();
            rows.forEach(row => {
                if(row.sortPosition < 10) topObjects.add(row);
                cacheObjectIDs.set(row.id, row);
                cacheObjectNames.set(row.name.toLowerCase(), row);
            });
        }
        loadObjectsToCacheInProgress = false;
        if(!err) objectCacheUpdateTime = Date.now();
        if (!callbackAlreadyCalled) callback();
        log.info('Loading object data to the cache: ', cachedObjects.size, ' objects');
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
        if(loadInteractionToCacheInProgress || interactionCacheUpdateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
    }

    loadInteractionToCacheInProgress = true;
    // start to update the cache
    objectsDB.getAllInteractions(function (err, rows) {
        if(err) log.error('Can\'t get interactions data from DB: ', err.message);
        else {
            cachedInteractionsRow = new Set(rows);

            rows.forEach(function (row) {
                if(row.type === 0) {
                    if(!cacheInteractionsForInclude.has(row.objectID1)) {
                        cacheInteractionsForInclude.set(row.objectID1, new Set());
                    }

                    if(!cacheInteractionsForIncludeReverse.has(row.objectID2)) {
                        cacheInteractionsForIncludeReverse.set(row.objectID2, new Set());
                    }

                    cacheInteractionsForInclude.get(row.objectID1).add(row.objectID2);
                    cacheInteractionsForIncludeReverse.get(row.objectID2).add(row.objectID1);
                } else {
                    if(!cachedInteractionsForIntersectAndExclude.has(row.objectID1)) {
                        cachedInteractionsForIntersectAndExclude.set(row.objectID1, new Map());
                    }
                    if(!cachedInteractionsForIntersectAndExclude.has(row.objectID2)) {
                        cachedInteractionsForIntersectAndExclude.set(row.objectID2, new Map());
                    }

                    cachedInteractionsForIntersectAndExclude.get(row.objectID1).set(row.objectID2, row.type);
                    cachedInteractionsForIntersectAndExclude.get(row.objectID2).set(row.objectID1, row.type);
                }
            });
        }
        loadInteractionToCacheInProgress = false;
        if(!err) interactionCacheUpdateTime = Date.now();
        if(!callbackAlreadyCalled) callback();
        log.info('Loading interaction data to the cache: ', cacheInteractionsForInclude.size,
            ' interactions for include, ', cachedInteractionsForIntersectAndExclude.size,
            ' interactions for intersect and exclude');
    });
}


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
