/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require("path");
const collectors = require("../lib/collectors");
const os = require("os");
const countersDB = require("../models_db/countersDB");
const threads = require("../lib/threads");
const exitHandler = require('../lib/exitHandler');
const async = require("async");
const serverCache = require('./serverCache');
const storeUpdateEventsData = require('./storeUpdateEventsData');
const Conf = require("../lib/conf");
const conf = new Conf('config/common.json');
const confServer = new Conf('config/server.json');

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
var serversNumber;
var serverName;
var collectorsNames = [];


var cfg;
var processedObjects = new Map(),
    processedID = 1,
    startMemUsageTime = 0,
    stopServerInProgress = 0,
    childrenInfo = {},
    childrenProcesses,
    activeCollectors = {},
    separateCollectors = {},
    runCollectorSeparately = {},
    updateEventsStatus = new Map(),
    updateEventsStatusFilePath,
    cache = {},
    countersForRemove = new Set(),
    needToUpdateCache = new Set(),
    lastFullUpdateTime = Date.now(),
    updateCacheInProgress = 0,
    receivingValues = 0;

function initBuildInServer(collectorsNamesStr, _serverID, callback) {
    serverID = _serverID;
    serverName = collectorsNamesStr.length > 25 ? collectorsNamesStr.substring(0, 20) + '..' : collectorsNamesStr;
    collectorsNames = collectorsNamesStr.split(',');
    serversNumber = 1;

    log.info('Starting server ', serverID, ' for collectors ', collectorsNamesStr);
    cfg = confServer.get('servers')[serverID];
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

    storeUpdateEventsData.loadUpdateEventsData([updateEventsStatusFilePath], serverID, function (err, _updateEventsStatus) {
        updateEventsStatus = _updateEventsStatus;

        collectors.get(null, function (err, collectorsObj) {
            if (err) return callback(err);

            for (var name in collectorsObj) {
                if (collectorsObj[name].active) activeCollectors[name] = true;
                else if (collectorsObj[name].separate) separateCollectors[name] = true;
                else if (collectorsObj[name].runCollectorSeparately) runCollectorSeparately[name] = true;
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

    // if the server is killed by timeout, there will still be a saved update event state
    storeUpdateEventsData.saveUpdateEventsStatus(updateEventsStatusFilePath, updateEventsStatus);
    childrenProcesses.stopAll(function(err) {
        if(err) {
            log.error('Error stopping children: ', err.message, '. Stopping server...');
        } else {
            log.warn('Children were stopped successfully. Stopping server...');
        }
        storeUpdateEventsData.saveUpdateEventsStatus(updateEventsStatusFilePath, updateEventsStatus);

        stopServerInProgress = 0;
        if(typeof callback === 'function') callback();
    });
}

function runChildren(callback) {

    var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length / serversNumber);
    processedObjects.clear();

    runCollectorSeparately = {};
    serverCache.createCache(null, function(err, _cache) {
        if(err) return callback(new Error('Error when loading data to cache: ' + err.message));
        cache = _cache;

        log.info('Starting ', childrenNumber, ' children for server: ', serverName,
            '. CPU cores number: ', os.cpus().length, ', servers number: ', serversNumber);
        childrenProcesses = new threads.parent({
            childProcessExecutable: path.join(__dirname, 'childGetCountersValue.js'),
            onMessage: processChildMessage,
            childrenNumber: childrenNumber,
            killTimeout: killTimeout-3000, // less than server killTimeout
            args: [serverName, '%:childID:%'],
            restartAfterErrorTimeout: 0, // we will restart server with all children after exit one of children
            onChildExit: function() {
                log.error('One child was terminated unexpectedly. Restarting server');
            },
            module: 'childGetCountersValue:'+serverName,
        }, function(err, childrenProcesses) {
            if(err) return callback(err);

            childrenProcesses.startAll(function (err) {
                if(err) return callback(err);

                log.info('Sending cache data first time:',
                    (cache.variables ? ' history for counters: ' + Object.keys(cache.variables).length : ''),
                    (cache.variablesExpressions ? ' expressions for counters: ' + Object.keys(cache.variablesExpressions).length : ''),
                    (cache.objectsProperties ? ' properties for objects: ' + Object.keys(cache.objectsProperties).length : ''),
                    (cache.countersObjects ? ' objects: ' + Object.keys(cache.countersObjects.objects).length +
                        ', counters: ' + Object.keys(cache.countersObjects.counters).length +
                        ', objectName2OCID: ' + Object.keys(cache.countersObjects.objectName2OCID).length : ''));

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

// message = {err, result, parameters, collectorName}
function processCounterResult (message) {
    var objectCounterID = message.parameters.$id;
    if(!processedObjects.has(objectCounterID)) {
        processedObjects.set(objectCounterID, {
            active: true,
        });
    }

    processedObjects.get(objectCounterID)[processedID] = true;

    message.processedID = processedID++;
    childrenProcesses.send(message);
}


function updateCache() {
    if((!needToUpdateCache.size &&
            (!cfg.fullUpdateCacheInterval || Date.now() - lastFullUpdateTime < cfg.fullUpdateCacheInterval) ) ||
        (updateCacheInProgress && Date.now() - updateCacheInProgress < cfg.updateCacheInterval)) return;

    if (updateCacheInProgress) {
        log.warn('The previous cache update operation was not completed in ',
            Math.round((Date.now() - updateCacheInProgress)/60000), '/', (cfg.updateCacheInterval / 60000) , 'min');
    }
    updateCacheInProgress = Date.now();
    var objectsAndCountersForUpdate = Array.from(needToUpdateCache.values());
    needToUpdateCache = new Set();
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
                if (message.update.historyVariables) Array.prototype.push.apply(updateMode.getHistoryVariables, Object.values(countersIDs));
                if (message.update.variablesExpressions) Array.prototype.push.apply(updateMode.getVariablesExpressions, Object.values(countersIDs));
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
    serverCache.createCache(updateMode, function(err, cache) {
        if(err) {
            updateCacheInProgress = 0;
            return log.error('Error when loading data to cache: ', err.message);
        }

        removeCounters(function () {
            if(cache) {
                cache.fullUpdate = !updateMode;

                /*
                log.info('Sending cache data:',
                    (cache.variables ? ' history for counters: ' + Object.keys(cache.variables).length : ''),
                    (cache.variablesExpressions ? ' expressions for counters: ' + Object.keys(cache.variablesExpressions).length : ''),
                    (cache.objectsProperties ? ' properties for objects: ' + Object.keys(cache.objectsProperties).length : ''),
                    (cache.countersObjects ? ' objects: ' + Object.keys(cache.countersObjects.objects).length +
                        ', counters: ' + Object.keys(cache.countersObjects.counters).length +
                        ', objectName2OCID: ' + Object.keys(cache.countersObjects.objectName2OCID).length : ''));
                 */

                childrenProcesses.sendToAll(cache, function (err) {
                    if (err) log.error('Error sending cache: ', err.message);
                });

            } else log.info('Creating empty cache. Nothing to send to children');

            // getting data again from updated top level counters (f.e. with active collectors)
            var topProperties = {};
            async.eachLimit(objectsAndCountersForUpdate, 10000, function (message, callback) {
                if ((message.update && !message.update.topObjects) ||
                    ((!message.updateObjectsIDs || !message.updateObjectsIDs.length) &&
                        (!message.updateCountersIDs || !message.updateCountersIDs.length))) return callback();

                countersDB.getCountersForFirstCalculation(collectorsNames, message.updateObjectsIDs, message.updateCountersIDs,
                    function (err, properties) {
                        if (err) {
                            // protect for "Maximum call stack size exceeded"
                            //setTimeout(callback, 0);
                            callback();
                            return log.error(err.message);
                        }
                        serverCache.recordsFromDBCnt += properties.length;

                        /*
                        properties.forEach(function (property, idx) {
                            // filter update counters on own server
                            if (idx % serversNumber === serverID) topProperties[property.OCID] = property;
                        });

                         */

                        properties.forEach(function (property) {
                            topProperties[property.OCID] = property;
                        });
                        // protect for "Maximum call stack size exceeded"
                        //setTimeout(callback, 0);
                        callback();
                    });
            }, function () {
                var properties = Object.values(topProperties);
                if (!properties.length) {
                    updateCacheInProgress = 0;
                    if(needToUpdateCache.size) updateCache();
                    return;
                }

                getCountersValues(properties, undefined,true);
                updateCacheInProgress = 0;
                if(needToUpdateCache.size) updateCache();
            });
        });
    });
}

function removeCounters(callback) {
    if(!countersForRemove.size) return callback()

    var copyCountersForRemove = Array.from(countersForRemove.values());
    countersForRemove = new Set();

    var OCIDs = copyCountersForRemove.map(function (message) {
        log.info('Remove counters reason: ', message.description, ': ', message.removeCounters);
        return message.removeCounters;
    });

    childrenProcesses.sendAndReceive({removeCounters: OCIDs}, function() {
        // remove OCIDs from updateEventsStatus Map
        // remove processed active collectors for add it again with new parameters
        OCIDs.forEach(function (OCID) {
            for(var key of updateEventsStatus.keys()) {
                var OCIDs = key.split('-'); // key = <parentOCID>-<OCID>
                if (OCID === Number(OCIDs[0]) || OCID === Number(OCIDs[1])) updateEventsStatus.delete(key);
            }

            if (processedObjects.has(OCID) && processedObjects.get(OCID).active) processedObjects.delete(OCID);
        });

        callback();
    });
}

function printChildrenMemUsage() {

    // reload server configuration
    cfg = confServer.get('servers')[serverID];

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
                log.exit('Memory usage too high ', serverMemoryUsage, 'Mb/', cfg.maxMemUsage,
                    'Mb from ', (new Date(startMemUsageTime).toLocaleString()), ', restarting counter server process');

                // stopServer() included in exitHandler.exit() function
                exitHandler.exit(13, 10000); // process.exit(13)
            }
        }
    } else startMemUsageTime = 0;

    log.info(serverName,' DB queries: ', serverCache.recordsFromDBCnt,
        '. Rcv from children: ', receivingValues,
        '. Mem usage: ', serverMemoryUsage,'Mb', (cfg.maxMemUsage ? '/' + cfg.maxMemUsage + 'Mb' : ''),
        (startMemUsageTime ?
            '. High mem usage lasts ' + Math.round((Date.now() - startMemUsageTime) / 1000) + '/' +
            memUsageMaxTime / 1000 + 'sec' : ''),
        '; update cache queue: ', needToUpdateCache.size,
        '; in progress: ', updateCacheInProgress ? (new Date(updateCacheInProgress)).toLocaleString() : 'false');

    serverCache.recordsFromDBCnt = receivingValues = 0;
}

function waitingForObjects(callback) {

    // topProperties: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID: <counterID>, objectID: <objectID>}, {...}...]
    countersDB.getCountersForFirstCalculation(collectorsNames, null, null, function (err, allTopProperties) {
        if (err) return callback(err);

        if (allTopProperties && allTopProperties.length) {
            serverCache.recordsFromDBCnt += allTopProperties.length;
            log.info('Getting ', allTopProperties.length, ' counter values at first time for ', collectorsNames);

            getCountersValues(allTopProperties);
        } else log.warn('Can\'t find counters without dependents for starting data collection for ', collectorsNames);

        callback();
    });
}

function processServerMessage(message) {

    if (message.throttlingPause) {
        childrenProcesses.sendToAll(message);
    }

    // message: { removeCounters: [<OCID1>, OCID2, ...], description: ....}
    if(message.removeCounters && message.removeCounters.length) {
        if(!needToUpdateCache.size) needToUpdateCache.add(true);
        //log.info('Receiving request for remove counters for OCIDs: ', message.removeCounters,'. Queuing.');
        countersForRemove.add(message);
        updateCache();
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

    if(message.updateEventKey) {
        updateEventsStatus.set(message.updateEventKey, message.updateEventState);
        return;
    }

    if(message.messagesQueue && message.tid) {
        // save queue data for child
        var id = message.tid;

        if(!childrenInfo[id]) {
            childrenInfo[id] = {
                tid: message.tid,
            };
            log.debug('Registered child tid: ', message.tid, '; message queue: ', message.messagesQueue, 'Mb');
        }
        childrenInfo[id].messagesQueue = Number(message.messagesQueue);
    }

    if (message.value === undefined) return;
    ++receivingValues;

    var objectCounterID = Number(message.objectCounterID), processedObj = processedObjects.get(objectCounterID);

    // may be
    if (!processedObj) {

        if(!message.collector || !activeCollectors[message.collector]) {
            log.warn('Can\'t processing data from passive collector ', message.collector, ' with unreachable OCID for ',
                message.variables.OBJECT_NAME, '(', message.variables.COUNTER_NAME, '): with unreachable OCID: ',
                objectCounterID, ', message: ', message);
            return;
        }

        log.info('Returned data with unreachable OCID ', objectCounterID,' for active collector ', message.collector, ": ", message.variables.OBJECT_NAME,
            '(', message.variables.COUNTER_NAME, ') message: ', message);

        processedObjects.set(objectCounterID, { active: true });
        processedObj = processedObjects.get(objectCounterID);
        processedObj[message.processedID] = true;
    }

    if(!processedObj[message.processedID]) {
        log.warn('Returned data with unreachable processID for ',  message.variables.OBJECT_NAME,
            '(', message.variables.COUNTER_NAME, '): processID: ', message.processedID, ' current processID: ',
            processedID, ', OCID: ', objectCounterID, ', message: ', message);

        if(!processedObj.active) return;

        if(typeof processedObj !== 'object' ||
            Object.keys(processedObj).length === 2) {
            processedObjects.set(objectCounterID, { active: true });
            processedObj = processedObjects.get(objectCounterID);
        }

        processedObj[message.processedID] = true;
    }

    if(!processedObj.active) {
        delete processedObj[message.processedID];
        if (Object.keys(processedObj).length === 1) delete processedObjects.delete(objectCounterID);
    }



    /*
    var values = Array.isArray(message.value) ? message.value : [message.value];

    // properties: [{parentObjectName:.., parentCounter:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
    //     objectName:.., counterName:..., expression:..., mode: <0|1|2|3|4>, groupID, taskCondition, ...}, {...}...]
    //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
    //     2 - update once when expression set to true, then once, when expression set to false
    var properties = message.properties;

    log.debug('Received value[s] ', values, ' from OCID ', objectCounterID, ' getting values for counters depended on ',
        message);
    values.forEach(function (value) {
        if(typeof value === 'object') value = JSON.stringify(value);

        // add parentOCID and add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:%
        // variable
        properties.forEach(function(property) {
            property.parentObjectValue = value;
            property.parentOCID = objectCounterID;
        });

        getCountersValues(properties, message.variables);
    });
     */

    // closure for save message variable
    (function (message) {
        var values = Array.isArray(message.value) ? message.value : [message.value];

        // properties: [{parentObjectName:.., parentCounter:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
        //     objectName:.., counterName:..., expression:..., mode: <0|1|2|3|4>, groupID, taskCondition, ...}, {...}...]
        //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
        //     2 - update once when expression set to true, then once, when expression set to false
        var properties = message.properties;

        log.debug('Received value[s] ', values, ' from OCID ', objectCounterID, ' getting values for depended counters ',
            message);
        async.eachLimit(values, cfg.returnedValuesProcessedLimit || 1000, function (value, callback) {
            if (typeof value === 'object') value = JSON.stringify(value);

            // add parentOCID and add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:%
            // variable
            properties.forEach(function (property) {
                property.parentObjectValue = value;
                property.parentOCID = objectCounterID;
            });

            getCountersValues(properties, message.variables);

            setTimeout(callback, cfg.sleepTimeAfterValueProcessed || 0);
        }, function () {});
    })(message);
}

/*
 get values for specific counters

 properties - [{OCID: <objectCounterID>, collector: <collectorName>, counterID: <counterID>, objectID: <objectID>}, ....]
 parentVariables - variables from parent object {name1: val1, name2: val2, ....}. can be skipped
 */
function getCountersValues(properties, parentVariables, forceToGetValueAgain) {

    if(typeof parentVariables === 'object' && !Object.keys(parentVariables).length) parentVariables = undefined;

    // I don\'t known why, but sometimes data from properties object is replaced by data from other object
    // here we save properties object to filteredProperties
    var filteredProperties = [];
    var activeCounters = [];
    properties.forEach(function (property) {
        var savingProperty = {};
        if(processedObjects.has(Number(property.OCID))) {
            if (processedObjects.get(Number(property.OCID)).active) {
                if (forceToGetValueAgain) {
                    savingProperty.removeCounter = property.counterName + '(' + property.objectName + ')';
                    activeCounters.push(savingProperty.removeCounter);
                } else {
                    log.debug('Counter ', property.counterName, '(', property.objectName,
                        ') is processed to receive data by active collector "', property.collector,
                        '". Skipping add same counter.');
                    return;
                }
            }
            if (runCollectorSeparately[property.collector]) {
                log.debug('Skipping getting value ', property.collector,
                    ', because another collector is running and "runCollectorSeparately" option is set');
                return;
            }
        }

        for(var key in property) {
            savingProperty[key] = property[key];
        }

        filteredProperties.push(savingProperty);
    });


    // they will be removed letter in childGetCountersValue.js getValue()
    if(activeCounters.length) {
        log.info('Counters with an active collector will be removed and updated: ', activeCounters);
    }

    filteredProperties.forEach(function (property) {
        getCounterValue(property, parentVariables);
    });
}

function getCounterValue(property, parentVariables) {

    var objectCounterID = Number(property.OCID);
    var collector = property.collector;
    var isActive = !!activeCollectors[collector]; // convert to boolean

    if(!processedObjects.has(objectCounterID)) {
        processedObjects.set(objectCounterID, {
            active: isActive
        });
    }

    processedObjects.get(objectCounterID)[processedID] = true;

    var key = property.parentOCID + '-' + property.OCID;
    var message = {
        processedID: processedID++,
        property: property,
        parentVariables: parentVariables,
        updateEventState: updateEventsStatus.get(key),
        active: isActive //|| !!separateCollectors[collector]
    };

    childrenProcesses.send(message);
}
