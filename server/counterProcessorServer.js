/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const collectors = require("../lib/collectors");
const os = require('os');
const countersDB = require("../models_db/countersDB");
const threads = require("../lib/threads");
const exitHandler = require('../lib/exitHandler');
const async = require("async");
const serverCache = require('./serverCache');
const storeUpdateEventsData = require('./storeUpdateEventsData');
const activeCollector = require("./activeCollector");
const taskServer = require('../serverTask/taskClient');
const history = require('../serverHistory/historyClient');
const debugCounters = require('../serverDebug/debugCounters');
const Conf = require("../lib/conf");

const conf = new Conf('config/common.json');
const confServer = new Conf('config/server.json');
const confMyNode = new Conf('config/node.json');

// not less than 3000 (child diff for killTimeout)
// this timeout also is a sleep time between stop and start when restart occurred
//var killTimeout = 7000; //was before 17.12.2020. did not have time to save update events to file
var killTimeout = 15000;

var counterProcessorServer = {
    init: initBuildInServer,
    send: processServerMessage,
    processCounterResult: processCounterResult,
    stop: stopServer,
};
module.exports = counterProcessorServer;

var serverID;
var serverName;
/**
 * constant array with active collector names for current server
 * @type {string[]}
 */
var collectorNames = [];
var collectorsParam = new Map();


var startMemUsageTime = 0,
    stopServerInProgress = 0,
    getCountersValueThreads,
    activeCollectors = new Set(),
    activeAndSeparateCollectors = new Map(),
    runCollectorSeparately = new Map(),
    /** What OCIDs is being processed now: Map[OCID: { isActiveCollector (true|false), timestamp: <startProcessingTime>}]
     * @type {Map<Number, {isActive: Boolean, timestamp:Number}>}
     */
    processedOCIDs = new Map(),
    updateEventsStatus = new Map(),
    updateEventsStatusFilePath,
    needToUpdateCache = new Set(),
    counterObjectNamesCache = new Map(),
    objectAlepizRelation = new Map(),
    recordsFromDBCnt = 0,
    lastFullUpdateTime = Date.now(),
    updateCacheInProgress = 0,
    minProcessingTime = 0,
    avgProcessingTime = 0,
    maxProcessingTime = 0,
    prevTimeWhenCacheWasUpdated = 0,
    processedCounters = 0;
//separateCollectors = new Set(),

/**
 * Initialize server
 * @param {string} collectorsNamesStr comma-separated names of collectors that are serviced behind the server
 * @param {string} _serverID ID for log
 * @param {function(Error)|function()} callback callback()
 */
function initBuildInServer(collectorsNamesStr, _serverID, callback) {
    serverID = _serverID;
    serverName = collectorsNamesStr.length > 25 ? collectorsNamesStr.substring(0, 20) + '..' : collectorsNamesStr;
    collectorNames = collectorsNamesStr.split(',');

    log.info('Starting server ', serverID, ' for collectors ', collectorsNamesStr);
    var cfg = confServer.get('servers')[serverID];
    initCfgVariables(cfg);

    exitHandler.init(stopServer, collectorsNamesStr);

    // reload configuration every 2 minutes
    setInterval(function () {
        confServer.reload();
        /**
         * @type {{updateEventsDumpFile: string, maxTimeToProcessCounter: number, dontConnectToRemoteHistoryInstances: Boolean}}
         */
        cfg = confServer.get('servers')[serverID];
        initCfgVariables(cfg);
    }, 120000);

    updateEventsStatusFilePath = cfg.updateEventsDumpFile ?
        path.join(__dirname, '..', conf.get('tempDir') || 'temp',
            path.parse(cfg.updateEventsDumpFile).name + '-' +
            serverName.replace(/,.+$/g, '') +
            path.parse(cfg.updateEventsDumpFile).ext) :
        'db/updateEvents-' + serverID + '.json';

    storeUpdateEventsData.loadUpdateEventsData([updateEventsStatusFilePath], serverID,
        function (err, _updateEventsStatus) {
        updateEventsStatus = _updateEventsStatus;

        history.connect(collectorsNamesStr, function () {

            taskServer.connect(collectorsNamesStr, function(err) {
                if (err) return callback(err);

                debugCounters.connect(function () {

                    collectors.getConfiguration(null, function (err, collectorsObj) {
                        if (err) return callback(err);

                        async.eachOf(collectorsObj, function (collector, collectorName, callback) {
                            if(Number(collector.sleepTimeAfterValueProcessed)) {
                                log.info('Set ', collectorName, ':sleepTimeAfterValueProcessed to ',
                                    Number(collector.sleepTimeAfterValueProcessed));
                                collectorsParam.set(collectorName, new Map([
                                    ['timestamp', Date.now()],
                                    ['sleepTimeAfterValueProcessed', Number(collector.sleepTimeAfterValueProcessed)],
                                ]));
                            }

                            if(Number(collector.returnedValuesProcessedLimit)) {
                                log.info('Set ', collectorName, ':returnedValuesProcessedLimit to ',
                                    Number(collector.returnedValuesProcessedLimit));
                                collectorsParam.set(collectorName, new Map([
                                    ['timestamp', Date.now()],
                                    ['returnedValuesProcessedLimit', Number(collector.returnedValuesProcessedLimit)],
                                ]));
                            }
                            if (collector.active) activeCollectors.add(collectorName);
                            /*
                            collector.runCollectorSeparately may contain the maximum time (ms) during which data collection
                            can be performed. If the time is exceeded, it is considered that the data collection is completed,
                            but the server has not received a message about this
                             */
                            else if (collector.runCollectorSeparately) {
                                var maxTimeToProcessCounter = parseInt(collector.runCollectorSeparately);
                                if (isNaN(maxTimeToProcessCounter)) {
                                    maxTimeToProcessCounter = parseInt(String(cfg.maxTimeToProcessCounter), 10)
                                }
                                if (isNaN(maxTimeToProcessCounter)) maxTimeToProcessCounter = 30000;
                                runCollectorSeparately.set(collectorName, maxTimeToProcessCounter);
                            }

                            if (!collector.active && !collector.separate) return callback();

                            activeCollector.connect(collectorName, function (err, collector) {
                                if (err) {
                                    return callback(new Error('Can\'t connect to collector ' + collectorName +
                                        ': ' + err.message));
                                }

                                activeAndSeparateCollectors.set(collectorName, collector);

                                callback();
                            });

                        }, function (err) {
                            if (err) return callback(err);

                            runChildren(function (err) {
                                if (err) return callback(err);

                                waitingForObjects(function (err) {
                                    if (err) return log.error(err.message);
                                    log.info('Counter processor successfully initialized for ', collectorsNamesStr)
                                    callback();
                                });
                            });
                        });
                    });
                });
            });
        }, cfg.dontConnectToRemoteHistoryInstances);
    });
}

/**
 * Initialize configuration variables
 * @param {Object} cfg configuration parameters
 * @param {number} cfg.updateCacheInterval time interval for update cache in sec
 * @param {number} cfg.fullUpdateCacheInterval time interval for full update cache in sec
 */
function initCfgVariables(cfg) {
    cfg.updateCacheInterval = (cfg.updateCacheInterval || 60) * 1000;

    cfg.fullUpdateCacheInterval = cfg.fullUpdateCacheInterval * 1000;
    if(cfg.fullUpdateCacheInterval !== parseInt(String(cfg.fullUpdateCacheInterval) ||
        cfg.fullUpdateCacheInterval < 600000)
    ) {
        cfg.fullUpdateCacheInterval = 1800000;
    }
}

/**
 * Stop the server
 * @param {function()} callback callback
 */
function stopServer(callback) {
    if(stopServerInProgress) return;
    stopServerInProgress = Date.now();
    log.info('Stopping server ', serverName, '...');

    // if the server is killed by timeout, there will still be a saved update event state
    storeUpdateEventsData.saveUpdateEventsStatus(updateEventsStatusFilePath, updateEventsStatus);
    getCountersValueThreads.stopAll(function(err) {
        if(err) {
            log.error('Error stopping children: ', err.message, '. Exiting for ', serverName, '...');
        } else {
            log.warn('Children were stopped successfully. Exiting for ', serverName, '...');
        }
        storeUpdateEventsData.saveUpdateEventsStatus(updateEventsStatusFilePath, updateEventsStatus);

        stopServerInProgress = 0;
        if(typeof callback === 'function') callback();
    });
}

/**
 * Run getCountersValue child threads for collect data
 * @param {function(Error)|function()} callback callback
 */
function runChildren(callback) {

    var cfg = confServer.get('servers')[serverID];
    var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length);
    processedOCIDs.clear();
    serverCache(null, serverName,
        function(err, cache, _counterObjectNames, _objectAlepizRelation, _recordsFromDBCnt) {
        if(err) return callback(new Error('Error when loading data to cache: ' + err.message));

        counterObjectNamesCache = _counterObjectNames;
        objectAlepizRelation = _objectAlepizRelation;
        recordsFromDBCnt = _recordsFromDBCnt;
        log.info('Starting ', childrenNumber, ' children for server: ', serverName,
            '. CPU cores number: ', os.cpus().length);
        getCountersValueThreads = new threads.parent({
            childProcessExecutable: path.join(__dirname, 'child', 'getCountersValue.js'),
            onMessage: processChildMessage,
            childrenNumber: childrenNumber,
            killTimeout: killTimeout-3000, // less than server killTimeout
            args: [serverName, '%:childID:%'],
            restartAfterErrorTimeout: 0, // we will restart server with all children after exit one of children
            onChildExit: function(err) {
                log.error('One child was terminated unexpectedly with error\\exit code: ', err, '. Restarting server...');
            },
            module: 'childGetCountersValue:'+serverName,
        }, function(err, childrenProcesses) {
            if(err) return callback(err);

            childrenProcesses.startAll(function (err) {
                if(err) return callback(err);

                log.info('Sending cache data to the child at first time:',
                    (cache.variablesHistory.size ? ' history for counters: ' + cache.variablesHistory.size : ''),
                    (cache.variablesExpressions.size ? ' expressions for counters: ' + cache.variablesExpressions.size : ''),
                    (cache.objectsProperties.size ? ' properties for objects: ' + cache.objectsProperties.size : ''),
                    (cache.countersObjects.objects ? ' objects: ' + cache.countersObjects.objects.size : ''),
                    (cache.countersObjects.counters ? ', counters: ' + cache.countersObjects.counters.size : ''),
                    (cache.countersObjects.objectName2OCID ?
                        ', objectName2OCID: ' + cache.countersObjects.objectName2OCID.size : ''));

                childrenProcesses.sendToAll(cache, function (err) {
                    if(err) {
                        log.error('Error sending cache to some child: ', err.message);
                        return callback(err);
                    }

                    // print message with children memory usage to log every 60 sec
                    // also update children cache
                    setInterval(function() {
                        printChildrenMemUsage();
                        updateCache();
                    }, cfg.updateCacheInterval);
                    callback();
                });
            });
        });
    });
}

/**
 * Process result returned from parent active or separate collector
 * @param {Object} message
 *      message = {err, result, parameters, collectorName}
 * @param {Error} message.err
 * @param {{timestamp: number, value: number|string|boolean|null|undefined}} message.result {timestamp:.., value:...}
 * @param {Object} message.parameters
 * @param {string} message.collectorName
 */
function processCounterResult (message) {
    var OCID = Number(message.parameters.$id);
    if(!processedOCIDs.has(OCID)) processedOCIDs.set(OCID, {
        isActive: activeCollectors.has(message.collectorName),
        timestamp: Date.now(),
    }); // active collector

    if(message.result && message.result.timestamp) {
        var processingTime = Date.now() - message.result.timestamp;
        if(processingTime > 0) {
            if (minProcessingTime === 0 || minProcessingTime > processingTime) minProcessingTime = processingTime;
            if (maxProcessingTime < processingTime) maxProcessingTime = processingTime;
            if (avgProcessingTime === 0) avgProcessingTime = processingTime;
            else avgProcessingTime = (avgProcessingTime + processingTime) / 2;
        }
    }
    getCountersValueThreads.send(message);
}


function updateCache() {
    /**
     * @type {{
     *     minUpdateCacheInterval: number,
     *     updateCacheInterval: number,
     *     fullUpdateCacheInterval: number,
     * }}
     */
    var cfg = confServer.get('servers')[serverID];

    if((!needToUpdateCache.size &&
            (!cfg.fullUpdateCacheInterval || Date.now() - lastFullUpdateTime < cfg.fullUpdateCacheInterval) ) ||
        (updateCacheInProgress && Date.now() - updateCacheInProgress < cfg.updateCacheInterval)) return;

    if (updateCacheInProgress) {
        log.warn('The previous cache update operation was not completed in ',
            Math.round((Date.now() - updateCacheInProgress)/60000), '/', (cfg.updateCacheInterval / 60000) , 'min');
    }

    if(Date.now() - prevTimeWhenCacheWasUpdated < (Number(cfg.minUpdateCacheInterval) || 60000)) {
        log.debug('The previous cache update operation was performed less then ',
            (Number(cfg.minUpdateCacheInterval) || 180000), 'ms ago. Cache update will be started in ',
            (Date.now() - prevTimeWhenCacheWasUpdated), 'ms');
        setTimeout(updateCache, Date.now() - prevTimeWhenCacheWasUpdated);
        return;
    }

    updateCacheInProgress = Date.now();
    var objectsAndCountersForUpdate = Array.from(needToUpdateCache.values());
    needToUpdateCache.clear();
    if(cfg.fullUpdateCacheInterval && Date.now() - lastFullUpdateTime > cfg.fullUpdateCacheInterval) {
        var updateMode = null;
        lastFullUpdateTime = Date.now();
    } else {
        updateMode = {
            serverName: serverName,
            updateObjectsCounters: false,
            getHistoryVariables: [],
            getVariablesExpressions: [],
            geObjectsProperties: []
        };
        for (var i = 0; i < objectsAndCountersForUpdate.length; i++) {
            var message = objectsAndCountersForUpdate[i];
            if (!message.update) {
                updateMode = null;
                break;
            }
            if (message.update.objectsCounters) updateMode.updateObjectsCounters = true;
            if (message.updateCountersIDs && message.updateCountersIDs.length) {

                // remove equals counters IDs. Use Object.values for save Number type for counterID
                var countersIDs = {};
                message.updateCountersIDs.forEach(counterID => countersIDs[counterID] = counterID);
                if (message.update.historyVariables) {
                    Array.prototype.push.apply(updateMode.getHistoryVariables, Object.values(countersIDs));
                }
                if (message.update.variablesExpressions) {
                    Array.prototype.push.apply(updateMode.getVariablesExpressions, Object.values(countersIDs));
                }
            }
            if (message.updateObjectsIDs && message.updateObjectsIDs.length && message.update.objectsProperties) {
                // remove equals objects IDs. Use Object.values for save Number type for objectID
                var objectsIDs = {};
                message.updateObjectsIDs.forEach(objectID => objectsIDs[objectID] = objectID);
                Array.prototype.push.apply(updateMode.geObjectsProperties, Object.values(objectsIDs));
            }
        }
    }

    serverCache(updateMode, serverName,
        function(err, cache, __counterObjectNames, _objectAlepizRelation, _recordsFromDBCnt) {
        if(err) {
            updateCacheInProgress = 0;
            prevTimeWhenCacheWasUpdated = Date.now();
            return log.error('Error when loading data to the cache: ', err.message);
        }

        counterObjectNamesCache = __counterObjectNames;
        if(_objectAlepizRelation) objectAlepizRelation = _objectAlepizRelation;
        recordsFromDBCnt = _recordsFromDBCnt;
        if(cache) {
            cache.fullUpdate = !updateMode;
            getCountersValueThreads.sendToAll(cache, function (err) {
                if (err) log.error('Error sending cache: ', err.message);
            });

        } else log.info('The cache update is complete, but an empty cache has been created.');

        // getting data again from updated top level counters (f.e. with active collectors)
        var topCounters = new Set(), topOCIDs = new Set();
        async.eachLimit(objectsAndCountersForUpdate, 10000, function (message, callback) {
            if ((message.update && !message.update.topObjects) ||
                ((!message.updateObjectsIDs || !message.updateObjectsIDs.length) &&
                    (!message.updateCountersIDs || !message.updateCountersIDs.length))) return callback();

            countersDB.getCountersForFirstCalculation(collectorNames,
                message.updateObjectsIDs, message.updateCountersIDs,function (err, counters) {
                    if (err) {
                        callback();
                        return log.error(err.message);
                    }
                    recordsFromDBCnt += counters.length;

                    /**
                     * @description Configuration of the current Alepiz node
                     * @type {{indexOfOwnNode: number, serviceNobodyObjects: Boolean}}
                     */
                    var cfg = confMyNode.get();
                    var indexOfOwnNode = cfg.indexOfOwnNode;
                    var ownerOfUnspecifiedAlepizIDs = cfg.serviceNobodyObjects;

                    counters.forEach(function (property) {
                        var objectsAlepizIDs = objectAlepizRelation.get(property.objectID);
                        //if(property.objectName === 'ALEPIZ') console.log('!!!', indexOfOwnNode, objectsAlepizIDs, ownerOfUnspecifiedAlepizIDs, objectAlepizRelation)
                        if ((objectsAlepizIDs === undefined && ownerOfUnspecifiedAlepizIDs) ||
                            (Array.isArray(objectsAlepizIDs) && objectsAlepizIDs.indexOf(indexOfOwnNode) !== -1)) {
                            topCounters.add(property);
                            topOCIDs.add(property.OCID);
                            //if(property.objectName === 'ALEPIZ') console.log('!!!! add ALEPIZ')
                        }
                    });
                    callback();
                });
        }, function () {
            if(cache) {
                log.info('Cache update completed for ', serverName,
                    ', data for update: ', objectsAndCountersForUpdate.length,
                    ', mode: ', (updateMode ? 'full' : 'partial'),
                    ' hist: ',
                    (updateMode && updateMode.getHistoryVariables ? updateMode.getHistoryVariables.length : 0),
                    '/', cache.variablesHistory.size,
                    '; expr: ',
                    (updateMode && updateMode.getVariablesExpressions ? updateMode.getVariablesExpressions.length : 0),
                    '/', cache.variablesExpressions.size,
                    '; props: ',
                    (updateMode && updateMode.geObjectsProperties ? updateMode.geObjectsProperties.length : 0),
                    '/', cache.objectsProperties.size,
                    '; active counters: ', topCounters.size,
                    (cache.countersObjects.objects ? ' objects: ' + cache.countersObjects.objects.size : ''),
                    (cache.countersObjects.counters ? ', counters: ' + cache.countersObjects.counters.size : ''),
                    (cache.countersObjects.objectName2OCID ?
                        ', objectName2OCID: ' + cache.countersObjects.objectName2OCID.size : ''));
            }

            if (topCounters.size) getCountersValues(topCounters, undefined,true);

            updateCacheInProgress = 0;
            prevTimeWhenCacheWasUpdated = Date.now();
            if(needToUpdateCache.size) updateCache();
        });
    });
}

/**
 * Removing counters from data collection
 * @param {Object} countersForRemove countersForRemove object with OCIDs for remove and description
 * @param {Array<number>} countersForRemove.removeCounters an array with OCIDs for remove
 * @param {string} countersForRemove.description description of why counters are being deleted
 * @param {function()} [callback] callback()
 */
function removeCounters(countersForRemove, callback) {
    if(!countersForRemove) return typeof callback === 'function' && callback();

    log.info('Remove counters reason: ', countersForRemove.description, '. OCIDs: ', countersForRemove.removeCounters);
    var OCIDs = countersForRemove.removeCounters;

    getCountersValueThreads.sendAndReceive({removeCounters: OCIDs}, function() {
        // remove OCIDs from updateEventsStatus Map
        // remove processed active collectors for add it again with new parameters
        OCIDs.forEach(function (OCID) {
            for(var key of updateEventsStatus.keys()) {
                var OCIDs = key.split('-'); // key = <parentOCID>-<OCID>
                if (OCID === Number(OCIDs[0]) || OCID === Number(OCIDs[1])) updateEventsStatus.delete(key);
            }

            if (processedOCIDs.has(OCID)) processedOCIDs.delete(OCID);
        });

        typeof callback === 'function' && callback();
    });
}

/**
 * Print statistic to the log
 */
function printChildrenMemUsage() {

    // reload server configuration
    /**
     * @type {{memUsageMaxTime: number, maxMemUsage: number}}
     */
    var cfg = confServer.get('servers')[serverID];

    // memory usage before restart server by default not more 1 minute
    const memUsageMaxTime = cfg.memUsageMaxTime || 60000;

    // memory usage in Mb
    var serverMemoryUsage = Math.round(process.memoryUsage().rss / 1048576);

    if(cfg.maxMemUsage && serverMemoryUsage > cfg.maxMemUsage) {
        // run garbage collection
        try { global.gc(); } catch (e) {}
        serverMemoryUsage = Math.round(process.memoryUsage().rss / 1048576);

        if(serverMemoryUsage > cfg.maxMemUsage) {
            if (!startMemUsageTime) startMemUsageTime = Date.now();
            else if (Date.now() - startMemUsageTime > memUsageMaxTime) {
                log.exit('Memory usage too high ', serverMemoryUsage, '/', cfg.maxMemUsage,
                    'Mb from ', (new Date(startMemUsageTime).toLocaleString()), ', restarting counter server process');

                // stopServer() included in exitHandler.exit() function
                exitHandler.exit(13, 10000); // process.exit(13)
            }
        }
    } else startMemUsageTime = 0;

    log.info(serverName,
        (startMemUsageTime ?
            ' High mem usage ' + serverMemoryUsage + 'Mb lasts ' +
            Math.round((Date.now() - startMemUsageTime) / 1000) + '/' +
            memUsageMaxTime / 1000 + 'sec' : ''),
        ' Counters processed: ', processedCounters, ', in processing: ', processedOCIDs.size,
        ', upd events: ', updateEventsStatus.size,
        ', processing time min/avg/max: ', minProcessingTime, '/', Math.round(avgProcessingTime), '/', maxProcessingTime,
        '. Mem usage: ', serverMemoryUsage, (cfg.maxMemUsage ? '/' + cfg.maxMemUsage : ''), 'Mb',
        '; update cache queue: ', needToUpdateCache.size,
        (updateCacheInProgress ? '; in progress: ' + (new Date(updateCacheInProgress)).toLocaleString() : ''),
        '; records from DB: ', recordsFromDBCnt);

    recordsFromDBCnt = processedCounters = minProcessingTime = avgProcessingTime = maxProcessingTime = 0;
}

/**
 * Waiting for counters without dependents for starting data collection
 * After adding objects, they will start being monitored
 * @param {function(Error)|function()} callback callback(err)
 */
function waitingForObjects(callback) {

    // allTopCounters: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID:.., counterName:..., objectID:.., objectName:..}, {...}...]
    countersDB.getCountersForFirstCalculation(collectorNames, null, null,
        function (err, allTopCounters) {
        if (err) return callback(err);

        if (allTopCounters && allTopCounters.length) {
            recordsFromDBCnt += allTopCounters.length;

            /**
             * @description Configuration of the current Alepiz node
             * @type {{indexOfOwnNode: number, serviceNobodyObjects: Boolean}}
             */
            var cfg = confMyNode.get();
            var indexOfOwnNode = cfg.indexOfOwnNode;
            var ownerOfUnspecifiedAlepizIDs = cfg.serviceNobodyObjects;
            var filteredCounters = new Set();

            allTopCounters.forEach(function (property) {
                var objectsAlepizIDs = objectAlepizRelation.get(property.objectID);
                //if(property.objectName === 'ALEPIZ') console.log('!!!', indexOfOwnNode, objectsAlepizIDs, ownerOfUnspecifiedAlepizIDs, objectAlepizRelation)
                if ((objectsAlepizIDs === undefined && ownerOfUnspecifiedAlepizIDs) ||
                    (Array.isArray(objectsAlepizIDs) && objectsAlepizIDs.indexOf(indexOfOwnNode) !== -1)
                ) {
                    filteredCounters.add(property);
                    //if(property.objectName === 'ALEPIZ') console.log('!!!! add ALEPIZ')
                }
            });

            if(filteredCounters.size) {
                log.info('Getting ', filteredCounters.size, '/', allTopCounters.length,
                    ' counter values at first time for ', collectorNames,
                    ' for objects related to nodeID: ', indexOfOwnNode);
                getCountersValues(filteredCounters);
            } else {
                log.info('Can\'t find counters without dependents for starting data collection for ', collectorNames,
                    ' for nodeID: ', indexOfOwnNode);
            }
        } else log.info('Can\'t find counters without dependents for starting data collection for ', collectorNames);

        // do not call the setTimeout(waitingForObjects, 300000, callback).unref(), because a callback
        // is needed here to start monitoring. After adding objects, they will start being monitored
        callback();
    });
}

/**
 * Update collector sleepTimeAfterValueProcessed and returnedValuesProcessedLimit parameter value
 * @param {string} collectorName collector name
 * @param {function(null, Map<>)} callback
 *  callback(null, collectorParameters)
 */
function updateCollectorData(collectorName, callback) {
    var param = collectorsParam.get(collectorName);
    if(!param) {
        param = new Map();
        collectorsParam.set(collectorName, param);
    }
    var timestamp = param.get('timestamp') || 0;
    if(Date.now() - timestamp < 300000) return callback(null, param);

    param.set('timestamp', Date.now());
    var sleepTimeAfterValueProcessed = param.get('sleepTimeAfterValueProcessed');
    var returnedValuesProcessedLimit = param.get('returnedValuesProcessedLimit');

    collectors.getConfiguration(collectorName, function (err, collector) {
        if (err) {
            log.error(err.message);
            if(typeof collector !== 'object')  collector = {};
        }

        var collectorSleepTimeAfterValueProcessed = Number(collector.sleepTimeAfterValueProcessed);
        if(collectorSleepTimeAfterValueProcessed &&
            sleepTimeAfterValueProcessed !== collectorSleepTimeAfterValueProcessed
        ) {
            log.info('Change ', collectorName, ':sleepTimeAfterValueProcessed from ',
                sleepTimeAfterValueProcessed,' to ',
                collectorSleepTimeAfterValueProcessed);
            param.set('sleepTimeAfterValueProcessed', collectorSleepTimeAfterValueProcessed);
        } else if(!collectorSleepTimeAfterValueProcessed && sleepTimeAfterValueProcessed) {
            log.info('Delete ', collectorName, ':sleepTimeAfterValueProcessed = ',
                collector.sleepTimeAfterValueProcessed);
            param.delete('sleepTimeAfterValueProcessed');
        }

        var collectorReturnedValuesProcessedLimit = Number(collector.returnedValuesProcessedLimit);
        if(collectorReturnedValuesProcessedLimit &&
            returnedValuesProcessedLimit !== collectorReturnedValuesProcessedLimit
        ) {
            log.info('Change ', collectorName, ':returnedValuesProcessedLimit from ',
                returnedValuesProcessedLimit,' to ',
                collectorReturnedValuesProcessedLimit);
            param.set('returnedValuesProcessedLimit', collectorReturnedValuesProcessedLimit);
        } else if(!collectorReturnedValuesProcessedLimit && returnedValuesProcessedLimit) {
            log.info('Delete ', collectorName, ':returnedValuesProcessedLimit = ',
                collector.returnedValuesProcessedLimit);
            param.delete('returnedValuesProcessedLimit');
        }

        callback(null, param);
    });
}

function processServerMessage(message) {

    if (message.throttlingPause) {
        getCountersValueThreads.sendToAll(message);
    }

    // message: { removeCounters: [<OCID1>, OCID2, ...], description: ....}
    if(message.removeCounters && message.removeCounters.length) {
        removeCounters(message);
        return
    }

    if (message.updateObjectsIDs) {
        //log.info('Receiving request for update objects IDs: ', message.updateObjectsIDs,'. Queuing.');
        needToUpdateCache.add(message);
        updateCache()
        return;
    }

    if (message.updateCountersIDs) {
        //log.info('Receiving request for update counters IDs: ', message.updateCountersIDs,'. Queuing.');
        needToUpdateCache.add(message);
        updateCache()
        return;
    }

    processChildMessage(message);
    //log.error('Server received incorrect message: ', message);
}

/**
 * Process data received from the child thread
 * @param {Object} message data received from the child thread
 * @param {number} message.timestamp start time of the counter processing
 * @param {number} message.OCID object counter ID
 * @param {number} message.parentOCID object counter ID of the parent counter
 * @param {*} message.updateEventState update event state
 * @param {*} message.value counter value
 * @param {Set<>} message.dependedCounters
 * @param {string} message.collector collector name
 * @param {Object} message.variables variables from parent object {name1: val1, name2: val2, ....}. can be skipped
 * @param {string} message.collectorName active or separate collector name for send data
 * @param {string} message.type active or separate collector function
 * @param {Array} message.data active or separate collector function parameters
 * @param {{timestamp: timestamp, data: number|string|boolean}} message.historyRecord record for store to the history
 * @param {string} message.objectName object name for log information
 * @param {string} message.counterName counter name for log information
 * @param {string} message.func history function name for calc history variables
 * @param {Array} message.funcParameters history function parameters for calc history variables
 * @param {{objectName: string, counterName: string, counterID: number}} message.debugParam
 * @param {Boolean} message.importance the importance of the message for debug counter server
 * @param {Object} message.variablesDebugInfo - debug information for debug counter server
 * @param {function} [callback] function for return data to getCountersValue
 */
function processChildMessage(message, callback) {
    if(!message) return;

    // calc history variables
    if(message.funcParameters) {
        message.funcParameters.push(callback);
        // send array as a function parameters, i.e. func.apply(this, [prm1, prm2, prm3, ...]) = func(prm1, prm2, prm3, ...)
        // funcParameters = [objectCounterID, prm1, prm2, prm3,..., callback]; callback(err, result),
        // where result = [{data:<data>, }]
        history[message.func].apply(this, message.funcParameters);
        return;
    }

    if(message.collectorName) {
        var collector = activeAndSeparateCollectors.get(message.collectorName);
        if(typeof collector[message.type] !== 'function') {
            return log.error('Active collector ', message.collectorName, ' has not function ', message.type);
        }
        collector[message.type](message.data, callback);
        return;
    }


    if(message.OCID) {
        if(message.historyRecord) history.add(message.OCID, message.historyRecord);

        if(message.objectName && message.counterName) {
            taskServer.checkCondition(message.OCID, message.objectName, message.counterName);
        }

        // add data to debug counter server
        if(message.variablesDebugInfo) {
            debugCounters.add('v', message.OCID, message.variablesDebugInfo, message.importance);
        }

        /*
        Message without counter result:
        {
            parentOCID: param.parentOCID,
            OCID: param.OCID,
            updateEventState: param.updateEventState,
        }
         */
        if(message.updateEventState !== undefined) {
            let updateEventKey = message.parentOCID + '-' + message.OCID;
            updateEventsStatus.set(updateEventKey, message.updateEventState);
            return;
        }

        // delete processedOCIDs when finished getting data from not active collector
        if(processedOCIDs.has(message.OCID) && processedOCIDs.get(message.OCID).isActive === false) {
            processedOCIDs.delete(Number(message.OCID));
        }
        ++processedCounters;
    }

    if(message.timestamp) {
        var processingTime = Date.now() - message.timestamp;
        if(processingTime > 0) {
            if (minProcessingTime === 0 || minProcessingTime > processingTime) minProcessingTime = processingTime;
            if (maxProcessingTime < processingTime) maxProcessingTime = processingTime;
            if (avgProcessingTime === 0) avgProcessingTime = processingTime;
            else avgProcessingTime = (avgProcessingTime + processingTime) / 2;
        }
    }

    if (message.value === undefined) return;

    var values = Array.isArray(message.value) ? message.value : [message.value];

    var dependedCounters = message.dependedCounters;

    //log.debug('Received value[s] ', values, ' from OCID ', OCID, ' getting values for depended on counters ', message);
    // run confServer.get() without parameters for speedup
    /**
     * @type {{returnedValuesProcessedLimit: number, sleepTimeAfterValueProcessed: number}}
     */
    var cfg = confServer.get().servers[serverID];
    updateCollectorData(message.collector, function (err, collectorParam) {

        var sleepTimeAfterValueProcessed = collectorParam.get('sleepTimeAfterValueProcessed');
        if(!sleepTimeAfterValueProcessed) sleepTimeAfterValueProcessed = Number(cfg.sleepTimeAfterValueProcessed) || 0;

        var returnedValuesProcessedLimit = collectorParam.get('returnedValuesProcessedLimit');
        if(!returnedValuesProcessedLimit) returnedValuesProcessedLimit = Number(cfg.returnedValuesProcessedLimit) || 1000;

        async.eachLimit(values, returnedValuesProcessedLimit, function (value, callback) {
            // can be received from collector JavaScript
            if (typeof value === 'object') value = JSON.stringify(value);
            else if(value instanceof Set) value = JSON.stringify(Array.from(value));
            else if(value instanceof Map) value = JSON.stringify(Object.fromEntries(value));

            // add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:% variable
            dependedCounters.forEach(function (counter) {
                counter.parentObjectValue = value;
            });

            getCountersValues(dependedCounters, message.variables, false, cfg);

            if(values.length < 2) return callback();

            setTimeout(callback, sleepTimeAfterValueProcessed);
        }, function () {});
    });
}

/**
 * Used for log
 * Return string "<counterName> (<objectName>)" or "OCID: <OCID>" if cache does not ready
 * @param {Number} OCID - objectCounter ID
 * @returns {string} - string "<counterName> (<objectName>)" or "OCID: <OCID>" if cache is not ready
 */
function getCounterAndObjectName(OCID) {
    try {
        var counterObject = counterObjectNamesCache.get(OCID);
        return counterObject.objectName + ' (' +  counterObject.counterName + '): ' + OCID;
    } catch (e) {
        return 'OCID: ' + String(OCID);
    }
}

/**
 * Prepare parameters and send data to the child for getting values for specific counters
 * @param {Set<{parentOCID: number, OCID: number, collector: string, updateEventExpression: string, updateEventMode: number}>} counters
 *      Set({parentOCID:, OCID:, collector:, updateEventExpression:, updateEventMode:}, ....)
 * @param {Object} [parentVariables] variables from parent object {name1: val1, name2: val2, ....}. can be skipped
 * @param {boolean} [forceToGetValueAgain] get value again even for active collector
 * @param {{returnedValuesProcessedLimit: number, sleepTimeAfterValueProcessed: number}} [cfg] current server
 *      configuration from server.json
 * //@return Array<string> topCounterNames = ["<objectName> (<counterName>): <OCID>", ...]
 */
function getCountersValues(counters, parentVariables, forceToGetValueAgain, cfg) {

    if(typeof parentVariables === 'object' && !Object.keys(parentVariables).length) parentVariables = undefined;

    var filteredCounters = [];
    var activeCounters = [];
    //var topCounterNames = [];
    counters.forEach(function (counter) {
        var OCID = counter.OCID;
        var counterAndObjectName = getCounterAndObjectName(counter.OCID);
        //topCounterNames.push(counterAndObjectName);
        if(processedOCIDs.has(OCID)) {
            // if active collector
            var processedOCID = processedOCIDs.get(OCID);
            if (processedOCID.isActive) {
                if (forceToGetValueAgain) {
                    counter.removeCounter = true;
                    activeCounters.push(counterAndObjectName);
                } else {
                    log.info('Counter ', counterAndObjectName,
                        ' is processed to receive data by active collector ', counter.collector,
                        ' from ', (new Date(processedOCID.timestamp)).toLocaleString(),'. Skipping add same counter: ',
                        counter);
                    return;
                }
            }
            if (runCollectorSeparately.has(counter.collector)) {
                var processingTime = Date.now() - processedOCID.timestamp;
                if(processingTime < runCollectorSeparately.get(counter.collector)) {
                    log.info('Skipping getting a value for the ', counterAndObjectName,
                        '. Another counter is processed ', processingTime, 'ms and max processing time set to ',
                        runCollectorSeparately.get(counter.collector),
                        'ms by the "runCollectorSeparately" option for the collector ', counter.collector);
                    return;
                }
            }
        }

        filteredCounters.push(counter);
    });

    // they will be removed letter in getCountersValue.js getValue()
    if(activeCounters.length) {
        log.info('Counters with an active collector will be removed and updated:\n', activeCounters.join('\n'));
    }

    // call confServer.get() without parameters for speedup
    if(!cfg) cfg = confServer.get().servers[serverID];
    async.eachLimit(filteredCounters, cfg.returnedValuesProcessedLimit || 1000, function (counter, callback) {

        processedOCIDs.set(counter.OCID, {
            isActive: activeCollectors.has(counter.collector),
            timestamp: Date.now(),
        });

        var updateEventKey = counter.parentOCID + '-' + counter.OCID;
        counter.parentVariables = parentVariables;
        counter.updateEventState = updateEventsStatus.get(updateEventKey);
        getCountersValueThreads.send(counter);

        var t = setTimeout(callback, cfg.sleepTimeAfterValueProcessed || 0);
        t.unref();
    }, function() {});

    //return topCounterNames;
}