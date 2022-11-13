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
var collectorsNames = [];


var startMemUsageTime = 0,
    stopServerInProgress = 0,
    childrenThreads,
    activeCollectors = new Set(),
    runCollectorSeparately = new Map(),
    /** What OCIDs is being processed now: Map[OCID: { isActiveCollector (true|false), timestamp: <startProcessingTime>}]
     * @type {Map<Number, {Boolean, Number}>}
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
    processedCounters = 0;
//separateCollectors = new Set(),

function initBuildInServer(collectorsNamesStr, _serverID, callback) {
    serverID = _serverID;
    serverName = collectorsNamesStr.length > 25 ? collectorsNamesStr.substring(0, 20) + '..' : collectorsNamesStr;
    collectorsNames = collectorsNamesStr.split(',');

    log.info('Starting server ', serverID, ' for collectors ', collectorsNamesStr);
    var cfg = confServer.get('servers')[serverID];
    initCfgVariables(cfg);

    exitHandler.init(stopServer, collectorsNamesStr);

    // reload configuration every 2 minutes
    setInterval(function () {
        confServer.reload();
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

        collectors.getConfiguration(null, function (err, collectorsObj) {
            if (err) return callback(err);

            for (var name in collectorsObj) {
                if (collectorsObj[name].active) activeCollectors.add(name);
                //else if (collectorsObj[name].separate) separateCollectors.set(name);
                /*
                collectorsObj[name].runCollectorSeparately may contain the maximum time (ms) during which data collection
                can be performed. If the time is exceeded, it is considered that the data collection is completed,
                but the server has not received a message about this
                 */
                else if (collectorsObj[name].runCollectorSeparately) {
                    var maxTimeToProcessCounter = parseInt(collectorsObj[name].runCollectorSeparately);
                    if(isNaN(maxTimeToProcessCounter)) {
                        maxTimeToProcessCounter = parseInt(confServer.maxTimeToProcessCounter)
                    }
                    if(isNaN(maxTimeToProcessCounter)) maxTimeToProcessCounter = 30000;
                    runCollectorSeparately.set(name, maxTimeToProcessCounter);
                }
            }

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
}

function initCfgVariables(cfg) {
    cfg.updateCacheInterval = (cfg.updateCacheInterval || 60) * 1000;

    cfg.fullUpdateCacheInterval = cfg.fullUpdateCacheInterval * 1000;
    if(cfg.fullUpdateCacheInterval !== parseInt(String(cfg.fullUpdateCacheInterval) ||
        cfg.fullUpdateCacheInterval < 600000)
    ) {
        cfg.fullUpdateCacheInterval = 1800000;
    }
}

function stopServer(callback) {
    if(stopServerInProgress) return;
    stopServerInProgress = Date.now();
    log.info('Stopping server ', serverName, '...');

    // if the server is killed by timeout, there will still be a saved update event state
    storeUpdateEventsData.saveUpdateEventsStatus(updateEventsStatusFilePath, updateEventsStatus);
    childrenThreads.stopAll(function(err) {
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

function runChildren(callback) {

    var cfg = confServer.get('servers')[serverID];
    var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length);
    processedOCIDs.clear();
    serverCache(null,
        function(err, cache, _counterObjectNames, _objectAlepizRelation, _recordsFromDBCnt) {
        if(err) return callback(new Error('Error when loading data to cache: ' + err.message));

        counterObjectNamesCache = _counterObjectNames;
        objectAlepizRelation = _objectAlepizRelation;
        recordsFromDBCnt = _recordsFromDBCnt;
        log.info('Starting ', childrenNumber, ' children for server: ', serverName,
            '. CPU cores number: ', os.cpus().length);
        childrenThreads = new threads.parent({
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

                log.info('Sending cache data first time:',
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

/** Process result from parent active or separate collector
 *
 * @param message - message = {err, result, parameters, collectorName}
 */
function processCounterResult (message) {
    var OCID = Number(message.parameters.$id);
    if(!processedOCIDs.has(OCID)) processedOCIDs.set(OCID, {
        isActive: true,
        timestamp: Date.now(),
    }); // active collector
    childrenThreads.send(message);
}


function updateCache() {
    var cfg = confServer.get('servers')[serverID];

    if((!needToUpdateCache.size &&
            (!cfg.fullUpdateCacheInterval || Date.now() - lastFullUpdateTime < cfg.fullUpdateCacheInterval) ) ||
        (updateCacheInProgress && Date.now() - updateCacheInProgress < cfg.updateCacheInterval)) return;

    if (updateCacheInProgress) {
        log.warn('The previous cache update operation was not completed in ',
            Math.round((Date.now() - updateCacheInProgress)/60000), '/', (cfg.updateCacheInterval / 60000) , 'min');
    }
    updateCacheInProgress = Date.now();
    var objectsAndCountersForUpdate = Array.from(needToUpdateCache.values());
    needToUpdateCache.clear();
    if(cfg.fullUpdateCacheInterval && Date.now() - lastFullUpdateTime > cfg.fullUpdateCacheInterval) {
        var updateMode = null;
        lastFullUpdateTime = Date.now();
    } else {
        updateMode = {
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

    // Update cache for || Reload all data to cache for (added for simple search)
    /*
    log.info((updateMode ? 'Update' : 'Reload all data to') + ' cache for: ', objectsAndCountersForUpdate.length,
        '; counters for remove: ', countersForRemove.size, '; update mode: ', updateMode);

     */
    serverCache(updateMode,
        function(err, cache, __counterObjectNames, _objectAlepizRelation, _recordsFromDBCnt) {
        if(err) {
            updateCacheInProgress = 0;
            return log.error('Error when loading data to cache: ', err.message);
        }

        counterObjectNamesCache = __counterObjectNames;
        if(_objectAlepizRelation) objectAlepizRelation = _objectAlepizRelation;
        recordsFromDBCnt = _recordsFromDBCnt;
        if(cache) {
            cache.fullUpdate = !updateMode;

            /*
             log.info('Sending cache data first time:',
                (cache.variablesHistory.size ? ' history for counters: ' + cache.variablesHistory.size : ''),
                (cache.variablesExpressions.size ? ' expressions for counters: ' + cache.variablesExpressions.size : ''),
                (cache.objectsProperties.size ? ' properties for objects: ' + cache.objectsProperties.size : ''),
                (cache.countersObjects.objects ? ' objects: ' + cache.countersObjects.objects.size : ''),
                (cache.countersObjects.counters ? ', counters: ' + cache.countersObjects.counters.size : ''),
                (cache.countersObjects.objectName2OCID ?
                    ', objectName2OCID: ' + cache.countersObjects.objectName2OCID.size : ''));
             */

            childrenThreads.sendToAll(cache, function (err) {
                if (err) log.error('Error sending cache: ', err.message);
            });

        } else log.info('Creating empty cache. Nothing to send to children');

        // getting data again from updated top level counters (f.e. with active collectors)
        var topCounters = new Set(), topOCIDs = new Set();
        async.eachLimit(objectsAndCountersForUpdate, 10000, function (message, callback) {
            if ((message.update && !message.update.topObjects) ||
                ((!message.updateObjectsIDs || !message.updateObjectsIDs.length) &&
                    (!message.updateCountersIDs || !message.updateCountersIDs.length))) return callback();

            countersDB.getCountersForFirstCalculation(collectorsNames,
                message.updateObjectsIDs, message.updateCountersIDs,function (err, counters) {
                    if (err) {
                        callback();
                        return log.error(err.message);
                    }
                    recordsFromDBCnt += counters.length;

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
            if (topCounters.size) getCountersValues(topCounters, undefined,true);
            updateCacheInProgress = 0;
            if(needToUpdateCache.size) updateCache();
        });
    });
}

function removeCounters(countersForRemove, callback) {
    if(!countersForRemove) return typeof callback === 'function' && callback();

    log.info('Remove counters reason: ', countersForRemove.description, '. OCIDs: ', countersForRemove.removeCounters);
    var OCIDs = countersForRemove.removeCounters;

    childrenThreads.sendAndReceive({removeCounters: OCIDs}, function() {
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

function printChildrenMemUsage() {

    // reload server configuration
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
        '. Mem usage: ', serverMemoryUsage, (cfg.maxMemUsage ? '/' + cfg.maxMemUsage : ''), 'Mb',
        '; update cache queue: ', needToUpdateCache.size,
        (updateCacheInProgress ? '; in progress: ' + (new Date(updateCacheInProgress)).toLocaleString() : ''),
        '; records from DB: ', recordsFromDBCnt);

    recordsFromDBCnt = processedCounters = 0;
}

function waitingForObjects(callback) {

    // allTopCounters: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID:.., counterName:..., objectID:.., objectName:..}, {...}...]
    countersDB.getCountersForFirstCalculation(collectorsNames, null, null,
        function (err, allTopCounters) {
        if (err) return callback(err);

        if (allTopCounters && allTopCounters.length) {
            recordsFromDBCnt += allTopCounters.length;

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
                    ' counter values at first time for ', collectorsNames,
                    ' for objects related to nodeID: ', indexOfOwnNode);
                getCountersValues(filteredCounters);
            } else {
                log.info('Can\'t find counters without dependents for starting data collection for ', collectorsNames,
                    ' for nodeID: ', indexOfOwnNode);
            }
        } else log.info('Can\'t find counters without dependents for starting data collection for ', collectorsNames);

        // do not call the setTimeout(waitingForObjects, 300000, callback).unref(), because a callback
        // is needed here to start monitoring. After adding objects, they will start being monitored
        callback();
    });
}

function processServerMessage(message) {

    if (message.throttlingPause) {
        childrenThreads.sendToAll(message);
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

function processChildMessage(message) {
    if(!message) return;

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

    if(message.OCID) {
        // delete processedOCIDs when finished getting data from not active collector
        if(processedOCIDs.has(message.OCID) && processedOCIDs.get(message.OCID).isActive === false) {
            processedOCIDs.delete(Number(message.OCID));
        }
        ++processedCounters;
    }

    if (message.value === undefined) return;

    var values = Array.isArray(message.value) ? message.value : [message.value];

    var dependedCounters = message.dependedCounters;

    //log.debug('Received value[s] ', values, ' from OCID ', OCID, ' getting values for depended on counters ', message);
    // run confServer.get() without parameters for speedup
    var cfg = confServer.get().servers[serverID];
    async.eachLimit(values, cfg.returnedValuesProcessedLimit || 1000, function (value, callback) {
        // can be received from collector JavaScript
        if (typeof value === 'object') value = JSON.stringify(value);
        else if(value instanceof Set) value = JSON.stringify(Array.from(value));
        else if(value instanceof Map) value = JSON.stringify(Object.fromEntries(value));

        // add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:% variable
        dependedCounters.forEach(function (counter) {
            counter.parentObjectValue = value;
        });

        getCountersValues(dependedCounters, message.variables, false, cfg);

        setTimeout(callback, cfg.sleepTimeAfterValueProcessed || 0).unref();
    }, function () {});
}

/**
 * Return string "<counterName> (<objectName>)" or "OCID: <OCID>" if cache is not ready for log
 * @param {Number} OCID - objectCounter ID
 * @returns {string} - string "<counterName> (<objectName>)" or "OCID: <OCID>" if cache is not ready
 */
function getCounterAndObjectName(OCID) {
    try {
        var counterObject = counterObjectNamesCache.get(OCID);
        return counterObject.objectName + ' (' +  counterObject.counterName + ')';
    } catch (e) {
        return 'OCID: ' + String(OCID);
    }
}

/*
 get values for specific counters

 counters - Set({parentOCID:, OCID:, collector:, updateEventExpression:, updateEventMode:}, ....]
 parentVariables - variables from parent object {name1: val1, name2: val2, ....}. can be skipped
 */
function getCountersValues(counters, parentVariables, forceToGetValueAgain, cfg) {

    if(typeof parentVariables === 'object' && !Object.keys(parentVariables).length) parentVariables = undefined;

    var filteredCounters = [];
    var activeCounters = [];
    counters.forEach(function (counter) {
        var OCID = counter.OCID;
        if(processedOCIDs.has(OCID)) {
            // if active collector
            var processedOCID = processedOCIDs.get(OCID);
            if (processedOCID.isActive) {
                if (forceToGetValueAgain) {
                    counter.removeCounter = true;
                    activeCounters.push(getCounterAndObjectName(OCID));
                } else {
                    log.info('Counter ', getCounterAndObjectName(OCID),
                        ' is processed to receive data by active collector ', counter.collector,
                        ' from ', (new Date(processedOCID.timestamp)).toLocaleString(),'. Skipping add same counter: ',
                        counter);
                    return;
                }
            }
            if (runCollectorSeparately.has(counter.collector)) {
                var processingTime = Date.now() - processedOCID.timestamp;
                if(processingTime < runCollectorSeparately.get(counter.collector)) {
                    log.info('Skipping getting a value for the ', getCounterAndObjectName(OCID),
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
        log.info('Counters with an active collector will be removed and updated: ', activeCounters);
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
        childrenThreads.send(counter);

        setTimeout(callback, cfg.sleepTimeAfterValueProcessed || 0).unref();
    }, function() {});
}