/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const collectors = require("../../lib/collectors");
const async = require("async");
const path = require("path");
const runInThread = require("../../lib/runInThread");
const Conf = require("../../lib/conf");
const confCollectors = new Conf('config/collectors.json');

var isConnectingToCollectors = 0, callbacks = [];

module.exports = connectingCollectors;

/**
 * Connect to active and passive collectors and return an object with the same functions to manage all collectors.
 * If connectingCollectors() is executed multiple times, it keeps all callback functions while connecting to all collectors.
 * And after connecting to all collectors, it runs all saved callbacks with the collectorsObj parameter.
 * @param {Object} childThread object for send message to the counterProcessorServer for send message to
 * active collectors
 * @param {function(Error)|function(null, collectorsObj: Object)} callback callback(err, collectorsObj), where
 *  collectorsObj is an object like {<collectorName1>: <collectorObj1>, <collectorName2>: <collectorObj2>,...},
 *  where collectorObj is an object with collector parameters from config.json and collector control functions
 *
 */
function connectingCollectors(childThread, callback) {

    // already connected
    if(isConnectingToCollectors === 2) return callback();
    callbacks.push(callback);

    // connection in progress
    if(isConnectingToCollectors === 1) return;

    isConnectingToCollectors = 1;
    collectors.getConfiguration(null, function(err, collectorsObj) {
        if (err) {
            isConnectingToCollectors = 0;
            callbacks.forEach(callback => callback(new Error('Can\'t get collectors configuration: ' + err.message)));
            callbacks = [];
        }

        //log.debug('Collectors: ', collectorsObj); collectorsObj is too big

        async.each(Object.keys(collectorsObj), function (collectorName, callback) {

            if(collectorsObj[collectorName].active || collectorsObj[collectorName].separate) {
                var collector = connectToActiveCollector(childThread, collectorName);
                collectorsObj[collectorName] = createNewCollectorObject(collectorsObj[collectorName], collector);
                return callback();
            }

            var collectorPath = path.join(__dirname, '..', '..', confCollectors.get('dir'), collectorName, 'collector');

            if (collectorsObj[collectorName].runCollectorAsThread) {
                //log.info('Starting passive collector ', collectorName, ' in thread: ', collectorPath);
                runInThread(collectorPath, {},function (err, collectorObj) {
                    if (err) {
                        log.error('Error starting passive collector ', collectorName, ' code ', collectorPath,
                            ' as a thread: ', err.message);
                    } else {
                        collectorsObj[collectorName] =
                            createNewCollectorObject(collectorsObj[collectorName], collectorObj.func);
                    }
                    callback();
                });
            } else {
                // empty require cache for collector
                if (require.cache[require.resolve(collectorPath)]) delete require.cache[require.resolve(collectorPath)];
                try {
                    //log.info('Attaching passive collector ', collectorName, ': ', collectorPath);
                    collectorsObj[collectorName] =
                        createNewCollectorObject(collectorsObj[collectorName], require(collectorPath));
                } catch (err) {
                    log.error('Error attaching passive collector ', collectorName, ' code ', collectorPath, ': ', err.message);
                }
                return callback();
            }

        }, function (err) {
            if(err) {
                isConnectingToCollectors = 0;
                callbacks.forEach(callback => callback(new Error('Can\'t connect to collectors: ' + err.message)));
                callbacks = [];
                return;
            }
            isConnectingToCollectors = 2;
            callbacks.forEach(callback => callback(null, collectorsObj));
            callbacks = [];
        });
    });
}

/**
 * Add collector functions to the collector configuration object
 * @param {Object} collectorCfg collector configuration (from config.json)
 * @param {Object} collector collector control functions (from activeCollector.connect() or
 *  run passive collector as a thread or
 *  attach passive collector by require(<collectorName>)
 * @returns {Object} object contain collectorCfg object and collector object
 */
function createNewCollectorObject(collectorCfg, collector) {
    for(var key in collector) {
        collectorCfg[key] = collector[key];
    }

    return collectorCfg;
}

/**
 * Connecting to active or separate collectors via parent counterProcessorServer.js
 * @param {Object} childThread object for send data to the parent
 * @param {string} collectorName collector name
 * @return {{removeCounters: removeCounters, throttlingPause: throttlingPause, get: get, destroy: destroy, send: send}}
 */
function connectToActiveCollector(childThread, collectorName) {
    return {
        // active and separate collectors return the result in their counterProcessorServer and do not need
        // to call the callback through network IPC using sendAndReceive function
        get: function (param) {
            childThread.send({
                collectorName: collectorName,
                type: 'get',
                data: param,
            });
        },

        // sending data to collector usually from actions
        send: function (param, callback) {
            childThread.send({
                collectorName: collectorName,
                type: 'getOnce',
                data: param,
            }, callback);
        },

        removeCounters: function (OCIDs, callback) {
            childThread.sendAndReceive({
                collectorName: collectorName,
                type: 'removeCounters',
                data: OCIDs
            }, callback);
        },

        throttlingPause: function (throttlingPause, callback) {
            childThread.sendAndReceive({
                collectorName: collectorName,
                type: 'throttlingPause',
                data: throttlingPause
            }, callback);
        },

        destroy: function (callback) {
            childThread.sendAndReceive({
                collectorName: collectorName,
                type: 'destroy',
            }, callback);
        },
    }
}