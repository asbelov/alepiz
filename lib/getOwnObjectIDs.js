/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const objectsDB = require('../models_db/objectsDB');

const Conf = require('../lib/conf');
const confMyNode = new Conf('config/node.json');

module.exports = getOwnObjectIDs;

var objectsAlepizRelationsCache = new Set(), dataRcvTime = 0, cacheTimeout = 120000;


/**
 * Filters objects and returns objects served by the current instance of ALEPIZ
 * @param {Array} objects - array of objects like [{id:. name:}, ... ]
 * @param {Object|null} actionCfg - if null, then do not check action configuration for noObjectsRequired and applyToOwnObjects
 * @param {Boolean} actionCfg.applyToOwnObjects - if false, then do not filter an objects
 * @param {Boolean} actionCfg.noObjectsRequired - if true, then do not filter an objects
 * @param {function(Error, Array) | function(null, Array)} callback - callback(err, filteredObjects) where
 *  filteredObjects is objects served by the current instance of ALEPIZ like [{id:. name:}, ... ]
 */
function getOwnObjectIDs(objects, actionCfg, callback) {
    if((actionCfg && (actionCfg.noObjectsRequired || !actionCfg.applyToOwnObjects)) ||
        !Array.isArray(objects) || !objects.length
    ) {
        return callback(null, objects);
    }

    var cfg = confMyNode.get();
    var indexOfOwnNode = cfg.indexOfOwnNode;
    var ownerOfUnspecifiedAlepizIDs = cfg.serviceNobodyObjects;

    var allRelatedObjectIDs = new Set(), filteredObjects = [];
    getObjectsAlepizRelation(function (err, objectsAlepizRelationsRows) {
        if(err) log.warn(err.message);
        objectsAlepizRelationsRows.forEach(row => {
            for(var i = 0; i < objects.length; i++) {
                if(indexOfOwnNode === row.alepizID && objects[i].id === row.objectID) {
                    filteredObjects.push(objects[i]);
                    break;
                }
            }
            allRelatedObjectIDs.add(row.objectID);
        });

        if(ownerOfUnspecifiedAlepizIDs) {
            objects.forEach(obj => {
                if (!allRelatedObjectIDs.has(obj.id)) filteredObjects.push(obj);
            });
        }
        callback(null, filteredObjects);
    });
}

/**
 * Get all the objects that are processed by the specified instances of ALEPIZ.
 * Data is returned from the database or from the cache.
 * The cache will be updated from the database no longer than the cacheTimeout of ms
 *
 * @param {function(Error, Set)| function(null, Set)} callback - callback(err, objectsAlepizRelationsCache), where
 *  objectsAlepizRelationsCache is new Set([{objectID:, alepizID:}, ...])
 */
function getObjectsAlepizRelation(callback) {
    if(Date.now() - dataRcvTime < cacheTimeout) return callback(null, objectsAlepizRelationsCache);

    dataRcvTime = Date.now();
    objectsDB.getObjectsAlepizRelation(function (err, objectsAlepizRelationsRows) {
        if (err) {
            return callback(new Error('Can\'t get objectsAlepizRelations from DB: ' + err.message),
                objectsAlepizRelationsCache);
        }
        objectsAlepizRelationsCache = new Set(objectsAlepizRelationsRows);
        callback(null, objectsAlepizRelationsCache);
    });
}