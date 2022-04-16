/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const os = require('os');
const countersDB = require("../models_db/countersDB");
const threads = require("../lib/threads");
const exitHandler = require('../lib/exitHandler');
const async = require("async");
const serverMain = require('./serverMain');
const serverCache = require('./serverCache');
const storeUpdateEventsData = require('./storeUpdateEventsData');
const Conf = require("../lib/conf");
const conf = new Conf('config/common.json');
const confServer = new Conf('config/server.json');

// not less than 3000 (child diff for killTimeout)
// this timeout also is a sleep time between stop and start when restart occurred
//var killTimeout = 7000; //was before 17.12.2020. did not have time to save update events to file
var killTimeout = 15000;

var serverController = {
    init: initBuildInServer,
    send: processServerMessage,
    processCounterResult: serverMain.processCounterResult,
    stop: stopServer,
};
module.exports = serverController;

var serverID;
var serversNumber;
var serverName;
var collectorsNames = [];


var cfg;
var processedObjects = new Map(),
    startMemUsageTime = 0,
    stopServerInProgress = 0,
    childrenInfo = {},
    childrenProcesses,
    updateEventsStatus = new Map(),
    updateEventsStatusFilePath,
    cache = {},
    countersForRemove = new Set(),
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

    storeUpdateEventsData.loadUpdateEventsData([updateEventsStatusFilePath], serverID,
        function (err, _updateEventsStatus) {
        updateEventsStatus = _updateEventsStatus;

        runChildren(function (err) {
            if (err) return callback(err);

            serverMain.init({
                childrenProcesses: childrenProcesses,
                processedObjects: processedObjects,
                updateEventsStatus: updateEventsStatus,
            }, function () {
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
    childrenProcesses.stopAll(function(err) {
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

    var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length / serversNumber);
    processedObjects.clear();

    serverCache.createCache(null, null,function(err, _cache) {
        if(err) return callback(new Error('Error when loading data to cache: ' + err.message));
        cache = _cache;

        log.info('Starting ', childrenNumber, ' children for server: ', serverName,
            '. CPU cores number: ', os.cpus().length, ', servers number: ', serversNumber);
        childrenProcesses = new threads.parent({
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
                        serverCache.updateCache(cfg, processUpdatedCache);
                    }, cfg.updateCacheInterval);
                    callback();
                });
            });
        });
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
                log.exit('Memory usage too high ', serverMemoryUsage, '/', cfg.maxMemUsage,
                    'Mb from ', (new Date(startMemUsageTime).toLocaleString()), ', restarting counter server process');

                // stopServer() included in exitHandler.exit() function
                exitHandler.exit(13, 10000); // process.exit(13)
            }
        }
    } else startMemUsageTime = 0;

    log.info(serverName,' DB queries: ', serverCache.recordsFromDBCnt,
        '. Rcv from children: ', receivingValues,
        '. Mem usage: ', serverMemoryUsage, (cfg.maxMemUsage ? '/' + cfg.maxMemUsage : ''), 'Mb',
        (startMemUsageTime ?
            '. High mem usage lasts ' + Math.round((Date.now() - startMemUsageTime) / 1000) + '/' +
            memUsageMaxTime / 1000 + 'sec' : ''),
        '; update cache queue: ', serverCache.needToUpdateCache.size,
        '; in progress: ', serverCache.updateCacheInProgress ? (new Date(serverCache.updateCacheInProgress)).toLocaleString() : 'false');

    serverCache.recordsFromDBCnt = receivingValues = 0;
}

function waitingForObjects(callback) {

    // topProperties: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID: <counterID>, objectID: <objectID>}, {...}...]
    countersDB.getCountersForFirstCalculation(collectorsNames, null, null, function (err, allTopProperties) {
        if (err) return callback(err);

        if (allTopProperties && allTopProperties.length) {
            serverCache.recordsFromDBCnt += allTopProperties.length;
            log.info('Getting ', allTopProperties.length, ' counter values at first time for ', collectorsNames);

            serverMain.getCountersValues(allTopProperties);
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
        if(!serverCache.needToUpdateCache.size) serverCache.needToUpdateCache.add(true);
        //log.info('Receiving request for remove counters for OCIDs: ', message.removeCounters,'. Queuing.');
        countersForRemove.add(message);
        serverCache.updateCache(cfg, processUpdatedCache);
        return
    }

    if (message.updateObjectsIDs) {
        //log.info('Receiving request for update objects IDs: ', message.updateObjectsIDs,'. Queuing.');
        serverCache.needToUpdateCache.add(message);
        serverCache.updateCache(cfg, processUpdatedCache)
        return;
    }

    if (message.updateCountersIDs) {
        //log.info('Receiving request for update counters IDs: ', message.updateCountersIDs,'. Queuing.');
        serverCache.needToUpdateCache.add(message);
        serverCache.updateCache(cfg, processUpdatedCache)
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

    if(message.tid) {
        if(!childrenInfo[message.tid]) {
            childrenInfo[message.tid] = {
                tid: message.tid,
            };
            log.debug('Registered child tid: ', message.tid);
        }
    }

    if (message.value !== undefined) {
        ++receivingValues;
        serverMain.processCounterMessage(message, cfg);
    }
}

function processUpdatedCache(err, cache, updateMode, objectsAndCountersForUpdate) {
    if(err) {
        serverCache.updateCacheInProgress = 0;
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
                serverCache.updateCacheInProgress = 0;
                if(serverCache.needToUpdateCache.size) {
                    serverCache.updateCache(cfg, processUpdatedCache);
                }
                return;
            }

            serverMain.getCountersValues(properties, undefined, true);
            serverCache.updateCacheInProgress = 0;
            if(serverCache.needToUpdateCache.size) {
                serverCache.updateCache(cfg, processUpdatedCache);
            }
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
