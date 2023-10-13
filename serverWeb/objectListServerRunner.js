/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const thread = require('../lib/threads');
const path = require('path');
const runInThread = require('../lib/runInThread');
const webServerCacheExpirationTime = require('./webServerCacheExpirationTime');
const async = require('async');
const Conf = require('../lib/conf');
const IPC = require('../lib/IPC');
const confWebServer = new Conf('config/webServer.json');


var objectLstWebServer = {
    stop: function(callback) {callback()},
    kill: function () {},
};

module.exports = objectLstWebServer;
var cachedHistory = new Map();

// clear history cache
setInterval(function () {
    cachedHistory.forEach((value, OCID) => {
        if(value.timestamp < Date.now() - webServerCacheExpirationTime()) cachedHistory.delete(OCID);
    });
    log.info('History data for objects filters in the cache: ', cachedHistory.size, ' OCIDs');
}, 300000)

var objectListCache = new Map([[
    'getAllObjects', {
        updateTime: 0,
        data: {
            objects: new Set(),
            topObjects: new Set(),
            objectNames: new Map(),
            objectIDs: new Map(),
        },
    }], [
        'getAllInteractions', {
        updateTime: 0,
        data: {
            interactions: new Set(),
            interactionsForInclude: new Map(),
            interactionsForIncludeReverse: new Map(),
            interactionsForIntersectAndExclude: new Map(),
        },
    }], [
        'initCounterNames2IDs', {
        updateTime: 0,
        data: new Map(),
    }], [
        'getOCID2ObjectID', {
        updateTime: 0,
        data: {
            OCIDs: new Map(),
            OCID2ObjectID: new Map(),
        },
    }], [
        'getObjectProperties', {
        updateTime: 0,
        data: new Map(),
    }],
]);

/**
 * Starting object list threads
 * @param {function(Error)|function()} callback callback(err)
 */
log.info('Starting object list server...');
objectLstWebServer.start = function (callback) {
    runInThread(path.join(__dirname, 'getDataFromDB.js'), {}, function (err, webServerCacheThread) {
        // if(err) child thread do not return errors

        new thread.parent({
            childrenNumber: Number(confWebServer.get('childrenNumber')) || 20,
            childProcessExecutable: path.join(__dirname, 'objectListServer.js'),
            restartAfterErrorTimeout: 0,
            module: 'objectLstWebServer',
            onMessage: function(cacheType, callback) {
                getDataFromCache(cacheType, webServerCacheThread, callback)
            },
        }, function (err, objectListServerTread) {
            if (err) return callback(new Error('Can\'t initializing objectListServer thread: ' + err.message));

            // used for update cache data when action change it
            var cfg = confWebServer.get();
            cfg.id = 'webServer';

            objectListServerTread.start(function (err) {
                if (err) return callback(new Error('Can\'t run objectListServer thread: ' + err.message));

                new IPC.server(cfg, function (err, message/*, socket, callback*/) {
                    if (err) log.error(err.message);
                    if (message) processCacheUpdateMessage(message);
                });

                var updateCacheType = '';
                function processCacheUpdateMessage(message) {
                    objectListServerTread.sendToAll(message);

                    // update cache when objects changed
                    var cacheType =
                        message.operation === 'insertInteractions' || message.operation === 'deleteInteractions' ?
                            'getAllInteractions' : 'getAllObjects';

                    // prevent multiple cache update
                    if(cacheType === updateCacheType) return;
                    updateCacheType = cacheType;

                    var cache = objectListCache.get(cacheType);
                    cache.updateTime = Date.now(); // prevent multiple cache update
                    webServerCacheThread.func[cacheType](function(err, newData) {
                        if(newData) cache.data = newData;
                        updateCacheType = '';
                    });
                }

                var objectList = {};

                objectList.filterObjectsByInteractions = function (parentObjectsNames, username, callback) {
                    objectListServerTread.sendAndReceive({
                        func: 'filterObjectsByInteractions',
                        parentObjectsNames: parentObjectsNames,
                        username: username,
                    }, callback);
                }

                objectList.searchObjects = function (searchStr, username, callback) {
                    objectListServerTread.sendAndReceive({
                        func: 'searchObjects',
                        searchStr: searchStr,
                        username: username,
                    }, callback);
                }

                objectList.getObjectsByNames = function (objectsNames, username, callback) {
                    objectListServerTread.sendAndReceive({
                        func: 'getObjectsByNames',
                        objectsNames: objectsNames,
                        username: username,
                    }, callback);
                }

                objectList.getObjectsByIDs = function (objectIDs, username, callback) {
                    objectListServerTread.sendAndReceive({
                        func: 'getObjectsByIDs',
                        objectIDs: objectIDs,
                        username: username,
                    }, callback);
                }

                objectList.applyFilterToObjects = function (filterNamesStr, filterExpression, objects, callback) {
                    objectListServerTread.sendAndReceive({
                        func: 'applyFilterToObjects',
                        filterNamesStr: filterNamesStr,
                        filterExpression: filterExpression,
                        objects: objects,
                    }, callback);
                }

                objectList.getObjectsFilterConfig = webServerCacheThread.func.getObjectsFilterConfig;

                log.info('Starting to load data to the cache...');
                async.each(Array.from(objectListCache.keys()), function (cacheType, callback) {
                    var cache = objectListCache.get(cacheType);
                    updateCacheType = cacheType;
                    webServerCacheThread.func[cacheType](function (err, newData) {
                        cache.updateTime = Date.now();
                        if (newData) cache.data = newData;
                        updateCacheType = '';
                        callback();
                    });
                }, function () {
                    log.info('Object list server initialized');
                    callback(null, objectList);
                })
            });
            objectLstWebServer.stop = objectListServerTread.stop;
            objectLstWebServer.kill = objectListServerTread.kill;
        });
    });
}

/**
 * Get data from DB to the cache
 * @param {string|Object} cacheType
 * @param {Object } webServerCacheThread
 * @param {function(null, *)} callback
 * @return {*}
 */
function getDataFromCache(cacheType, webServerCacheThread, callback) {
    if(cacheType === 'history') return callback(null, cachedHistory);

    if(typeof cacheType === 'object') {
        if(cacheType.OCID && typeof cacheType.value === 'object') cachedHistory.set(cacheType.OCID, cacheType.value);
        return;
    }

    var cache = objectListCache.get(cacheType);

    var callbackAlreadyCalled = false;
    if (cache.updateTime) {
        callbackAlreadyCalled = true;
        callback(null, cache.data);
        if(cache.updateTime > Date.now() - webServerCacheExpirationTime()) {
            return;
        }
        // set the time here for getting data from the database once when data was received to the cache before
        cache.updateTime = Date.now();
    }

    webServerCacheThread.func[cacheType](function(err, newData) {
        // first time getting data from DB
        cache.updateTime = Date.now();
        if(newData) cache.data = newData;
        if(!callbackAlreadyCalled) callback(null, cache.data);
    });
}