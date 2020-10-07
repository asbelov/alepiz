/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.10.2015.
 */
var async = require('async');
var os = require('os');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');

var conf = require('../lib/conf');
conf.file('config/conf.json');

var collectors = require('../lib/collectors');
var activeCollector = require('../lib/activeCollector');
var countersDB = require('../models_db/countersDB');
var objectsDB = require('../models_db/objectsDB');
var objectsPropertiesDB = require('../models_db/objectsPropertiesDB');
var checkIDs = require('../lib/utils/checkIDs');

var server = {};
module.exports = server;

// not less then 3000 (child diff for killTimeout)
// this timeout also is a sleep time between stop and start when restart occurred
var killTimeout = 7000;

if(module.parent) initServerCommunication();
else return runServer(process.argv[2], process.argv[3]);  //standalone process

// parent process
function initServerCommunication() {
    var servers = conf.get('servers'),
        clientsIPC = [],
        activeCollectors = {},
        separateCollectors = {},
        stopServerInProgress = 0,
        startServerInProgress = 0,
        serverStarted = false,
        startServerDelayTimer,
        stopServerDelayTimer;

    var serverProcess = new proc.parent({
        childrenNumber: servers.length,
        childProcessExecutable: __filename,
        restartAfterErrorTimeout: 0,
        killTimeout: killTimeout,
        onMessage: function(message) {
            log.debug('Parent receiving ', message);
            if(message.restart) {
                stopServer('Receiving "restart" command', function () {
                    startServer('Receiving "restart" command');
                });
            } else if(message.stop) {
                stopServer('Receiving "stop" command', null, true);
            } else if(message.start) {
                startServer('Receiving "start" command');
            } else log.error('Receiving unknown message from child', message);
        },
        onChildExit: function() {
            stopServer('Server process exiting', function () {
                startServer('Server process exiting');
            });
        },
        module: 'server',
        args: ['%:childID:%', servers.length],
    });

    server.start = function (callback) { startServer('Initial start server', callback); }
    server.stop = function(callback) { stopServer('Receiving request for stop server', callback) };

    server.connect = function() {
        servers.forEach(function (cfg) {
            cfg.id = 'server:'+cfg.serverPort;
            var clientIPC = new IPC.client(cfg, function (err, /* data */) {
                if (err) log.error(err.message);
                clientsIPC.push(clientIPC);
            });
        });
    };

    // sending all messages to servers
    server.sendMsg = function(message) {
        log.debug('Sending message to servers: ', message);
        clientsIPC.forEach(function (clientIPC) {
            clientIPC.send(message, function (err) {
                if (err) log.error(err.message);
            });
        });
    };

    server.disconnect = function(callback) {
        log.info('Disconnecting from servers');
        async.each(clientsIPC, function(clientIPC, callback) {
            clientIPC.disconnect();
            callback();
        }, callback);
    };

    function startServer(message, callback) {
        if(startServerInProgress || serverStarted) return;
        if(stopServerInProgress) {
            if(Date.now() - stopServerInProgress > 120000) {
                log.error('The stop server process took too long. Let\'s try to start the server...');
                if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
                stopServerInProgress = 0;
            } else {
                log.warn('A request was received to start the server, but a server stop operation is in progress. ' +
                    'Start the server later for "', message, '"');
                if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
                startServerDelayTimer = setTimeout(startServer, 15000, message, callback);
                return;
            }
        }
        if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
        startServerInProgress = Date.now();

        var startTimeout = 0;
        if(!callback) { // server restarted
            startTimeout = killTimeout + 1000;
            log.warn('Waiting while all socket are closed and all processes are killed...');
        }

        setTimeout(function () {
            log.info('Starting server components: active collectors for operation "', message, '"');
            activeCollector.startAll(killTimeout, function() {
                stopServer('Active collector terminated unexpectedly', function() {
                    startServer('Active collector terminated unexpectedly');
                });
            },function (err, _activeCollectors, _separateCollectors) {
                activeCollectors = _activeCollectors;
                separateCollectors = _separateCollectors;
                if (err) return log.error(err.message);

                log.info('All active collectors are started. Starting server for "', message, '"');
                serverProcess.startAll(function (err) {
                    startServerInProgress = 0;
                    serverStarted = true;
                    startServerDelayTimer = null;
                    if (typeof callback === "function") callback(err);
                });
            });
        }, startTimeout);
    }

    function stopServer(message, callback, isQuiet) {
        if(stopServerInProgress) return;
        if(startServerInProgress) {
            if(Date.now() - startServerInProgress > 60000) {
                log.error('The server startup process took too long. Let\'s try to stop the server...');
                if (isQuiet) log.exit('The server startup process took too long. Let\'s try to stop the server...');
                if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
                startServerInProgress = 0;
            } else {
                if (!isQuiet) log.exit('A request was received to stop the server, but a server start operation is in progress. ' +
                    'Stop the server later for: "', message, '"');
                log.warn('A request was received to stop the server, but a server start operation is in progress. ' +
                    'Stop the server later for "', message, '"');
                if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
                stopServerDelayTimer = setTimeout(stopServer, 10000, message, callback);
                return;
            }
        }
        if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
        stopServerInProgress = Date.now();

        log.warn(message + '. Terminating server...');
        if(!isQuiet) log.exit(message + '. Terminating server...');

        async.parallel([
            function (callback) {
                stopActiveAndSeparateCollectors(activeCollectors, 'active', isQuiet, callback);
            },
            function (callback) {
                stopActiveAndSeparateCollectors(separateCollectors, 'separate', isQuiet, callback);
            }
        ],function () {

            serverProcess.stopAll(function (err) {
                if (err) {
                    log.error('Error while terminating server: ', err.message);
                    if(!isQuiet) log.exit('Error while terminating server: ', err.message);
                } else {
                    log.warn('Server processes and all children terminated successfully');
                    if(!isQuiet) log.exit('Server processes and all children terminated successfully');
                }

                stopServerInProgress = 0;
                serverStarted = false;
                stopServerDelayTimer = null;
                if (typeof callback === 'function') callback();
            });
        });
    }

    function stopActiveAndSeparateCollectors(collectors, type, isQuiet, callback) {
        log.warn('Terminating ', type,' collectors: ', Object.keys(collectors).join(', '));
        if(!isQuiet) log.exit('Terminating ', type,' collectors: ', Object.keys(collectors).join(', '));
        async.eachOf(collectors, function(collector, name, callback) {
            if(!collector || typeof collector.stop !== 'function') return callback();
            collector.stop(function(err) {
                if(err) {
                    log.error('Error while terminating ', type, ' collector ' + name + ': ', err.message);
                    if(!isQuiet) log.exit('Error while terminating ', type, ' collector ' + name + ': ', err.message);
                } else {
                    log.warn('Successfully terminated ', type ,' collector ', name);
                    if(!isQuiet) log.exit('Successfully terminated ', type ,' collector ', name);
                }

                if(typeof callback === 'function') callback();
            });
        }, callback);
    }
}

// forked server process
function runServer(serverID, serversNumber) {

    var cfg = conf.get('servers')[Number(serverID)];
    var processedObjects = {},
        processedID = 1,
        serverProcess,
        startTime = Date.now(),
        startMemUsageTime = 0,
        memUsageTime = (cfg.memUsageTime || 180) * 1000,
        stopServerInProgress = 0,
        childrenInfo = {},
        childrenProcesses,
        activeCollectors = {},
        separateCollectors = {},
        runCollectorSeparately = {},
        updateEventsStatus = {},
        countersParametersDBCache = {},
        cache = {},
        countersForRemove = [],
        needToUpdateCache = [],
        lastFullUpdateTime = Date.now(),
        updateCacheInterval = (cfg.updateCacheInterval || 60) * 1000,
        updateCacheInProgress = false,
        recordsFromCacheCnt = 0,
        recordsFromDBCnt = 0,
        receivingValues = 0;

    var fullUpdateCacheInterval = cfg.fullUpdateCacheIntervalfullUpdateCacheInterval * 1000;
    if(fullUpdateCacheInterval !== parseInt(String(fullUpdateCacheInterval) || fullUpdateCacheInterval < 600000)) {
        fullUpdateCacheInterval = 1800000;
    }
    serverID = Number(serverID);
    serversNumber = Number(serversNumber);


    var serverPort = cfg.serverPort;
    cfg.serverPort = cfg.serverPortChildrenIPC;
    cfg.id = 'server4Child';

    var serverIPC = new IPC.server(cfg, function(err, message, socket) {
        if (err) log.error(err);
        if (message) processChildMessage(message, socket);

        // server starting to listen socket
        if (socket === -1) {
            cfg.serverPort = serverPort;
            cfg.id = 'server';
            new IPC.server(cfg, function (err, message, socket) {
                if (err) log.error(err);
                if (message) processServerMessage(message, socket);

                // server starting to listen socket
                if (socket === -1) {
                        collectors.get(null, function (err, collectorsObj) {
                            if (err) return log.error(err.message);

                            for(var name in collectorsObj) {
                                if (collectorsObj[name].active) activeCollectors[name] = true;
                                else if (collectorsObj[name].separate) separateCollectors[name] = true;
                                else if (collectorsObj[name].runCollectorSeparately) runCollectorSeparately[name] = true;
                            }

                            runChildren(function (err) {
                                if (err) return log.error(err.message);

                                serverProcess = new proc.child({
                                    module: 'server',
                                    onStop: stopServer,
                                    onDestroy: childrenProcesses.killAll,
                                });

                                waitingForObjects(function (err, topProperties) {
                                    if (err) return log.error(err.message);

                                    log.info('All children are running. Getting ', topProperties.length ,' counters values at first time.');
                                getCountersValues(topProperties, false, function (err) {
                                    if (err) log.error(err.message);

                                    var memUsage = Math.round(process.memoryUsage().rss / 1048576);
                                    try {
                                        global.gc();
                                        log.debug('Checking for able to run garbage collection on server... Before ', memUsage, 'Mb, after ',
                                            Math.round(process.memoryUsage().rss / 1048576), 'Mb');
                                    } catch (e) {
                                        log.error('Please run nodejs with parameter "--expose-gc" for able to run garbage collector: ', e.message);
                                    }
                                });
                            });
                        });
                    });
                }
            });
        }
    });

    function stopServer(callback) {
        if(stopServerInProgress) return;
        stopServerInProgress = Date.now();

        childrenProcesses.stopAll(function(err) {
            if(err) {
                log.error('Error stopping children: ', err.message, '. Stopping server...');
            } else {
                log.warn('Children was stopped successfully. Stopping server...');
            }

            stopServerInProgress = 0;
            if(typeof callback === 'function') callback();
        });
    }

    function runChildren(callback) {

        var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length / serversNumber);
        processedObjects = {};

        runCollectorSeparately = {};
        createCache(null, function(err, _cache) {
            if(err) return callback(new Error('Error when loading data to cache: ' + err.message));
            cache = _cache;

            log.info('Starting ', childrenNumber, ' children for serverID: ', serverID,
                '. CPU cores number: ', os.cpus().length, ', servers number: ', serversNumber);
            childrenProcesses = new proc.parent({
                childProcessExecutable: 'lib/childGetCountersValue.js',
                onMessage: processChildMessage,
                childrenNumber: childrenNumber,
                killTimeout: killTimeout-3000, // less then server killTimeout
                args: [serverID],
                restartAfterErrorTimeout: 0, // we will restart server with all children after exit one of children
                onChildExit: function() {
                    log.exit('One of child was terminated unexpectedly. Restarting server');
                    sendRestartToParent();
                },
                module: 'childGetCountersValue',
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

                    // use serverIPC instead childrenProcesses at first time for send cache before sending and processing data
                    var sendMessageToChildren = cfg.userProcIPCForSendCache ? childrenProcesses : serverIPC;
                    sendMessageToChildren.sendToAll(cache, function (err) {
                        if(err) return callback(err);

                        // print message with children memory usage to log every 60 sec
                        // also update children cache
                        setInterval(function() {
                            printChildrenMemUsage();
                            updateCache();
                        }, updateCacheInterval);
                        callback();
                    });
                });
            });
        });
    }

    function updateCache() {
        if((!needToUpdateCache.length &&
            (!fullUpdateCacheInterval || Date.now() - lastFullUpdateTime < fullUpdateCacheInterval) ) ||
            updateCacheInProgress) return;

        updateCacheInProgress = true;
        var objectsAndCountersForUpdate = needToUpdateCache.slice();
        needToUpdateCache = [];
        if(fullUpdateCacheInterval && Date.now() - lastFullUpdateTime > fullUpdateCacheInterval) {
            var updateMode = null;
            lastFullUpdateTime = Date.now();
            countersParametersDBCache = {};
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
                    if (message.update.historyVariables) Array.prototype.push.apply(updateMode.getHistoryVariables, message.updateCountersIDs);
                    if (message.update.variablesExpressions) Array.prototype.push.apply(updateMode.getVariablesExpressions, message.updateCountersIDs);
                }
                if (message.updateObjectsIDs && message.updateObjectsIDs.length && message.update.objectsProperties)
                    Array.prototype.push.apply(updateMode.geObjectsProperties, message.updateObjectsIDs);
            }
        }

        log.info((updateMode ? 'Update' : 'Reload all data to') + ' cache for: ', objectsAndCountersForUpdate, '; counters for remove: ', countersForRemove, '; update mode: ', updateMode);
        createCache(updateMode, function(err, cache) {
            if(err) {
                updateCacheInProgress = false;
                return log.error('Error when loading data to cache: ', err.message);
            }

            removeCounters(function () {
                if(cache) {
                    cache.fullUpdate = !updateMode;
                    // clean cache data with counters parameters
                    if(cache.countersObjects && cache.countersObjects.counters) {
                        for (var i = 0; i < objectsAndCountersForUpdate.length; i++) {
                            var message = objectsAndCountersForUpdate[i];

                            if (!message || !message.update || !message.update.objectsCounters ||
                                !message.updateCountersIDs || !message.updateCountersIDs.length) continue;

                            var countersList = [];
                            message.updateCountersIDs.forEach(function (counterID) {

                                var counter = cache.countersObjects.counters[counterID];
                                if (counter && typeof counter.objectsIDs === 'object') {
                                    var objectsList = [];
                                    for (var objectID in counter.objectsIDs) {

                                        var OCID = counter.objectsIDs[objectID];
                                        if (countersParametersDBCache[OCID]) {
                                            objectsList.push(cache.countersObjects.objects[objectID] || 'UNKNOWN (' + objectID + ')');
                                            delete countersParametersDBCache[OCID];
                                        }
                                    }
                                    if (objectsList.length) countersList.push(counter.counterName + ' (' + objectsList.join('; ') + ') ');
                                }
                            });

                            if(countersList.length) {
                                log.info('Clearing cached counters parameters for: ', countersList.join('; '));
                            }
                        }
                    }

                    log.info('Sending cache data:',
                        (cache.variables ? ' history for counters: ' + Object.keys(cache.variables).length : ''),
                        (cache.variablesExpressions ? ' expressions for counters: ' + Object.keys(cache.variablesExpressions).length : ''),
                        (cache.objectsProperties ? ' properties for objects: ' + Object.keys(cache.objectsProperties).length : ''),
                        (cache.countersObjects ? ' objects: ' + Object.keys(cache.countersObjects.objects).length +
                            ', counters: ' + Object.keys(cache.countersObjects.counters).length +
                            ', objectName2OCID: ' + Object.keys(cache.countersObjects.objectName2OCID).length : ''));

                    var sendMessageToChildren = cfg.userProcIPCForSendCache ? childrenProcesses : serverIPC;
                    sendMessageToChildren.sendToAll(cache);
                }

                // getting data again from updated top level counters (f.e. with active collectors)
                var topProperties = {};
                async.eachLimit(objectsAndCountersForUpdate, 100,function(message, callback) {
                    if((message.update && !message.update.topObjects) ||
                        ((!message.updateObjectsIDs || !message.updateObjectsIDs.length) &&
                            (!message.updateCountersIDs || !message.updateCountersIDs.length))) return callback();

                    countersDB.getCountersForFirstCalculation(message.updateObjectsIDs, message.updateCountersIDs, function (err, properties) {
                        if (err) {
                            callback();
                            return log.error(err.message);
                        }
                        recordsFromDBCnt += properties.length;

                        properties.forEach(function (property) {
                            topProperties[property.OCID] = property;
                        });
                        callback();
                    });
                }, function() {
                    var properties = Object.values(topProperties);
                    if(!properties.length) {
                        updateCacheInProgress = false;
                        return;
                    }
                    log.info('Objects or counters are updated ', objectsAndCountersForUpdate.length, ' times. Getting data from: ', properties.map(function (prop) {
                        return prop.objectName + '(' + prop.counterName + ')';
                    }));
                    getCountersValues(properties, true, function (err) {
                        updateCacheInProgress = false;
                        if (err) log.error(err.message);
                    });
                });
            });
        });
    }

    function removeCounters(callback) {
        if(!countersForRemove.length) return callback()

        var copyCountersForRemove = countersForRemove.slice();
        countersForRemove = [];

        var OCIDs = copyCountersForRemove.map(function (message) {
            log.info('Remove counters reason: ', message.description, ': ', message.removeCounters);
            return message.removeCounters;
        });

        var sendMessageToChildren = cfg.userProcIPCForServerRemoveCounters ? childrenProcesses : serverIPC;
        sendMessageToChildren.sendAndReceive({removeCounters: OCIDs}, function() {
            // remove OCIDs from updateEventsStatus object
            // remove processed active collectors for add it again with new parameters
            OCIDs.forEach(function (OCID) {
                Object.keys(updateEventsStatus).forEach(function (key) {
                    var OCIDs = key.split('-'); // key = <parentOCID>-<OCID>

                    if (OCID === Number(OCIDs[0]) || OCID === Number(OCIDs[1])) delete updateEventsStatus[key];
                });

                if (processedObjects[OCID] && processedObjects[OCID].active) delete processedObjects[OCID];
            });

            callback();
        });
    }

    function createCache(updateMode, callback) {
        if(updateMode && (!updateMode.updateObjectsCounters && !updateMode.getHistoryVariables.length &&
            !updateMode.getVariablesExpressions.length && !updateMode.geObjectsProperties.length)) return callback();

        async.parallel({
            countersObjects: function(callback) {
                if(updateMode  && !updateMode.updateObjectsCounters) return callback();
                
                getDataForCheckDependencies(function(err, counters, objects, objectName2OCID) {
                    callback(err, {
                        counters: counters,
                        objects: objects,
                        objectName2OCID: objectName2OCID
                    });
                });
            },
            variables: function(callback) {
                if(updateMode && !updateMode.getHistoryVariables.length) return callback();
                getVariables(null, countersDB.getVariables, 'counterID', callback);
            },
            variablesExpressions: function(callback) {
                if(updateMode && !updateMode.getVariablesExpressions.length) return callback();
                getVariables(null, countersDB.getVariablesExpressions, 'counterID', callback);
            },
            objectsProperties: function(callback) {
                if(updateMode && !updateMode.geObjectsProperties.length) return callback();
                getVariables(updateMode ? updateMode.geObjectsProperties : null, objectsPropertiesDB.getProperties, 'objectID', callback);
            }
        }, callback); // function(err, cache){}
    }

    function getDataForCheckDependencies(callback) {
        var counters = {}, objects = {}, objectName2OCID = {};

        countersDB.getAllObjectsCounters(function(err, rowsOCIDs) {
            if (err) return callback(err);

            countersDB.getAllCounters(function(err, rowsCounters) {
                if (err) return callback(err);

                countersDB.getAllUpdateEvents(function(err, rowsUpdateEvents) {
                    if (err) return callback(err);

                    objectsDB.getAllObjects(function(err, rowsObjects) {
                        if (err) return callback(err);

                        recordsFromDBCnt += rowsOCIDs.length + rowsCounters.length + rowsUpdateEvents.length + rowsObjects.length;

                        rowsObjects.forEach(function (row) {
                            if(row.disabled) return;
                            objects[row.id] = row.name;
                        });

                        rowsCounters.forEach(function (row) {
                            if(row.disabled) return;

                            counters[row.id] = {
                                objectsIDs: {},
                                dependedUpdateEvents: {}, // {parentCounterID1: { expression, mode, parentObjectID, counterID}, ... }
                                counterID: row.id,
                                collector: row.collectorID,
                                counterName: row.name,
                                debug: row.debug,
                                taskCondition: row.taskCondition,
                                groupID: row.groupID,
                            };
                        });

                        rowsUpdateEvents.forEach(function (row) {
                            if(!counters[row.parentCounterID] || !counters[row.counterID] ||
                                (row.parentObjectID && !objects[row.parentObjectID])) return;

                            counters[row.parentCounterID].dependedUpdateEvents[row.counterID] = {
                                counterID: row.counterID,
                                expression: row.expression,
                                mode: row.mode,
                                objectFilter: row.objectFilter,
                                parentObjectID: row.parentObjectID
                            };
                        });

                        rowsOCIDs.forEach(function (row) {
                            if(!counters[row.counterID] || !objects[row.objectID]) return;
                            counters[row.counterID].objectsIDs[row.objectID] = row.id;

                            var objectNameInUpperCase = objects[row.objectID].toUpperCase();
                            if(!objectName2OCID[objectNameInUpperCase]) objectName2OCID[objectNameInUpperCase] = {};
                            objectName2OCID[objectNameInUpperCase][row.counterID] = row.id;
                        });

                        //console.log(counters);

                        callback(null, counters, objects, objectName2OCID);
                    });
                });
            });
        });
    }

    function getVariables(initIDs, func, key, callback) {
        var variables = {};

        checkIDs(initIDs, function (err, IDs) {
            //if(err) log.error(err.message);
            // when initIDs is not set, IDs will be set to []
            if(err && !IDs.length) IDs = null;

            func(IDs, function(err, rows) {
                if (err) return callback(err);
                recordsFromDBCnt += rows.length;

                rows.forEach(function (row) {
                    var id = row[key];
                    if(!variables[id]) variables[id] = [row];
                    else variables[id].push(row);
                });

                callback(null, variables);
            });
        })
    }

    function printChildrenMemUsage() {

        var serverMemoryUsage = Math.round(process.memoryUsage().rss / 1048576);
        var childrenMemoryUsage = 0;
        log.info(serverID, ': ', Object.keys(childrenInfo).map(function(pid) {
            var child = childrenInfo[pid];
            if(child.memUsage && Number(child.memUsage)) childrenMemoryUsage += Number(child.memUsage);
            return 'PID ' + pid + ':' + (child.memUsage ? child.memUsage : '?') + 'Mb';
        }).join('; '));

        log.info('Server ', serverID,' records from cache/DB: ', recordsFromCacheCnt, '/', recordsFromDBCnt,
            '. Receiving values from children: ', receivingValues,
            '. Memory usage for server (', serverMemoryUsage,'Mb) and children (', childrenMemoryUsage ,
            'Mb) is ', serverMemoryUsage + childrenMemoryUsage, 'Mb (', serverID, ')',
            (startMemUsageTime ? '. High memory usage lasts ' + Math.round((Date.now() - startMemUsageTime) / 1000) + 'sec' : ''));

        /*
        // Server also will be restarted when no counters created.
        if(recordsFromCacheCnt === 0 && recordsFromDBCnt === 0) {
            log.exit('Server records from cache/DB: ' + recordsFromCacheCnt + '/' + recordsFromDBCnt + '. Restarting server.');
            sendRestartToParent();
        }
        */

        recordsFromDBCnt = recordsFromCacheCnt = receivingValues = 0;
    }

    function waitingForObjects(callback) {
        var howOftenTryToFindIndependentCountersAtStart = conf.get('sqlite:howOftenTryToFindIndependentCountersAtStart') ? Number(conf.get('sqlite:howOftenTryToFindIndependentCountersAtStart')) : 10000;

        // topProperties: [{OCID: <objectsCountersID>, collector: <collectorID>, counterID: <counterID>, objectID: <objectID>}, {...}...]
        countersDB.getCountersForFirstCalculation(null, null, function (err, allTopProperties) {
            if (err) return callback(err);

            if (allTopProperties && allTopProperties.length) {
                var topProperties = allTopProperties.filter(function (prop, idx) {
                    return idx % serversNumber === serverID;
                });
                recordsFromDBCnt += topProperties.length;
                return callback(null, topProperties);
            }

            log.warn('Can\'t find counters without dependents for starting data collection. Restarting server after ', howOftenTryToFindIndependentCountersAtStart / 1000, ' sec');
            setTimeout(waitingForObjects, howOftenTryToFindIndependentCountersAtStart, callback);
        });
    }

    function sendRestartToParent() {
        log.debug('Receiving "restart" message. Send restart to parent');
        // send restart back to parent, because restart message can be received not from parent
        serverProcess.send({ restart: 1 });
    }

    function processServerMessage(message, socket) {

        // send restart|stop|start back to parent, because restart message can be received not from parent
        if (message.restart) return sendRestartToParent();
        if (message.stop) return serverProcess.send({ stop: 1 });
        if (message.start) return serverProcess.send({ start: 1 });

        if (message.throttlingPause) {
            var sendMessageToChildren = cfg.userProcIPCForServerRemoveCounters ? childrenProcesses : serverIPC;
            sendMessageToChildren.sendToAll(message);
        }

        // message: { removeCounters: [<OCID1>, OCID2, ...], description: ....}
        if(message.removeCounters && message.removeCounters.length) {
            if(!needToUpdateCache.length) needToUpdateCache.push(true);
            log.debug('Receiving request for remove counters for OCIDs: ', message.removeCounters,'. Queuing.');
            countersForRemove.push(message);
            return
        }

        if (message.updateObjectsIDs) {
            log.debug('Receiving request for update objects IDs: ', message.updateObjectsIDs,'. Queuing.');
            needToUpdateCache.push(message);
            return;
        }

        if (message.updateCountersIDs) {
            log.debug('Receiving request for update counters IDs: ', message.updateCountersIDs,'. Queuing.');
            needToUpdateCache.push(message);
            return;
        }

        processChildMessage(message, socket);
        //log.error('Server received incorrect message: ', message);
    }

    function processChildMessage(message, socket) {
        if(!message) return;

        if(message.updateEventKey) {
            updateEventsStatus[message.updateEventKey] = message.updateEventState;
            return;
        }

        if(message.memUsage && message.pid) {
            // save memUsage and queue data for child
            if(!childrenInfo[message.pid]) {
                childrenInfo[message.pid] = {
                    socket: socket
                };
                log.debug('Registered child PID: ', message.pid, '; memory usage: ', message.memUsage, 'Mb');
            }
            childrenInfo[message.pid].memUsage = Number(message.memUsage);

            var totalMemoryUsage = Math.round(process.memoryUsage().rss / 1048576);
            for(var pid in childrenInfo) {
                if(childrenInfo[pid].memUsage && Number(childrenInfo[pid].memUsage)) {
                    totalMemoryUsage += childrenInfo[pid].memUsage;
                }
            }

            if(cfg.maxMemUsageForChildMb && cfg.maxMemUsageForChildMb < message.memUsage &&
                Date.now() - startTime > 300000 &&
                Date.now() - log.lastExitRecord() > 300000
            ) {
                printChildrenMemUsage();
                log.warn('Maximum memory usage ', cfg.maxMemUsageForChildMb, 'Mb occurred for child PID ', message.pid,
                    ' (', message.memUsage, 'Mb). Restarting server ', serverID);
                log.exit('Maximum memory usage ', cfg.maxMemUsageForChildMb, 'Mb occurred for child PID ', message.pid,
                    ' (', message.memUsage, 'Mb). Restarting server ', serverID);

                sendRestartToParent();
            } else if(totalMemoryUsage > (cfg.maxMemUsageTotalMb || 16384) &&
                Date.now() - startTime > 300000 &&
                Date.now() - log.lastExitRecord() > 300000
            ) {
                if(!startMemUsageTime) startMemUsageTime = Date.now();
                else if(Date.now() - startMemUsageTime > memUsageTime) {
                    printChildrenMemUsage();
                    startMemUsageTime = 0;
                    var memUsage = Math.round(process.memoryUsage().rss / 1048576);
                    try {
                        global.gc();
                        log.info('Processing garbage collection on server... Before ', memUsage, 'Mb, after ',
                            Math.round(process.memoryUsage().rss / 1048576), 'Mb');
                    } catch (e) {
                        log.warn('Please run nodejs with parameter "--expose-gc" for able to run garbage collector: ', e.message);
                    }

                    totalMemoryUsage = Math.round(process.memoryUsage().rss / 1048576);
                    for (pid in childrenInfo) {
                        if (childrenInfo[pid].memUsage && Number(childrenInfo[pid].memUsage)) {
                            totalMemoryUsage += childrenInfo[pid].memUsage;
                        }
                    }
                    if (totalMemoryUsage > (cfg.maxMemUsageTotalMb || 16384) &&
                        Date.now() - startTime > 300000 &&
                        Date.now() - log.lastExitRecord() > 300000
                    ) {
                        log.warn('Maximum memory usage ', cfg.maxMemUsageTotalMb, 'Mb occurred for server and all children (',
                            totalMemoryUsage, 'Mb). Restarting server ', serverID);
                        log.exit('Maximum memory usage ', cfg.maxMemUsageTotalMb, 'Mb occurred for server and all children (',
                            totalMemoryUsage, 'Mb). Restarting server ', serverID);

                        sendRestartToParent();
                    }
                }
            } else startMemUsageTime = 0;
            return;
        }

        if (message.value === undefined) return;
        ++receivingValues;

        var objectCounterID = message.objectCounterID;

        // may be
        if (!processedObjects[objectCounterID]) {

            if(!message.collector || !activeCollectors[message.collector]) {
                log.warn('Can\'t processing data from passive collector ', message.collector, ' with unreachable OCID for ', message.variables.OBJECT_NAME,
                    '(', message.variables.COUNTER_NAME, '): with unreachable OCID: ', objectCounterID, ', message: ', message);
                return;
            }

            log.info('Returned data with unreachable OCID ', objectCounterID,' for active collector ', message.collector, ": ", message.variables.OBJECT_NAME,
                '(', message.variables.COUNTER_NAME, ') message: ', message);

            processedObjects[objectCounterID] = { active: true };
            processedObjects[objectCounterID][message.processedID] = true;
        }

        if(!processedObjects[objectCounterID][message.processedID]) {
            log.warn('Returned data with unreachable processID for ',  message.variables.OBJECT_NAME,
                '(', message.variables.COUNTER_NAME, '): processID: ', message.processedID, ' current processID: ',
                processedID, ', OCID: ', objectCounterID, ', message: ', message);

            if(!processedObjects[objectCounterID].active) return;

            if(typeof processedObjects[objectCounterID] !== 'object' ||
                Object.keys(processedObjects[objectCounterID]).length === 2)
                processedObjects[objectCounterID] = { active: true };

            processedObjects[objectCounterID][message.processedID] = true;
        }

        if(!processedObjects[objectCounterID].active) {
            delete processedObjects[objectCounterID][message.processedID];
            if (Object.keys(processedObjects[objectCounterID]).length === 1) delete processedObjects[objectCounterID];
        }


        var values = Array.isArray(message.value) ? message.value : [message.value];

        // properties: [{parentObjectName:.., parentCounter:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
        //     objectName:.., counterName:..., expression:..., mode: <0|1|2|3|4>, groupID, taskCondition, ...}, {...}...]
        //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
        //     2 - update once when expression set to true, then once, when expression set to false
        var properties = message.properties;

        log.debug('Received value[s] ', values, ' from OCID ', objectCounterID, ' getting values for depended counters ', message);

        async.eachLimit(values, 20, function(value, callback) {
            if(typeof value === 'object') value = JSON.stringify(value);

            // add parentOCID and add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:% variable
            properties.forEach(function(property) {
                property.parentObjectValue = value;
                property.parentOCID = objectCounterID;
            });

            getCountersValues(properties, message.variables, callback);
        }, function(err) {
            if(err) {
                log.error(err.message);
            }
        });
    }

    /*
     get values for specific counters

     properties - [{OCID: <objectCounterID>, collector: <collectorName>, counterID: <counterID>, objectID: <objectID>}, ....]
     parentVariables - variables from parent object {name1: val1, name2: val2, ....}. can be skipped
     callback(err)
     */
    function getCountersValues(properties, parentVariables, callback) {

        if(typeof parentVariables !== 'object') {
            var forceToGetValueAgain = parentVariables;
            parentVariables = undefined;
        } else if(!Object.keys(parentVariables).length) parentVariables = undefined;

        // I don\'t known why, but some times data from properties object is replaced by data from other object
        // here we save properties object to filteredProperties
        var objectsCountersIDs = [], filteredProperties = [], activeOCIDs = [], activeCounters = [];
        properties.forEach(function (property) {
            if(processedObjects[property.OCID]) {
                if (processedObjects[property.OCID].active) {
                    if (forceToGetValueAgain) {
                        activeOCIDs.push(property.OCID);
                        //delete processedObjects[property.OCID];
                        activeCounters.push(property.counterName + '(' + property.objectName + ')');
                    } else {
                        log.debug('Counter ', property.counterName, '(', property.objectName, ') is processed to receive data by active collector "', property.collector, '". Skipping add same counter.');
                        return;
                    }
                }
                if (runCollectorSeparately[property.collector]) {
                    log.debug('Skipping getting value ' + property.collector + ', because another collector is running and "runCollectorSeparately" option is set');
                    return;
                }
            }
            objectsCountersIDs.push(property.OCID);

            var savingProperty = {};
            for(var key in property) {
                savingProperty[key] = property[key];
            }

            filteredProperties.push(savingProperty);
        });

        var removeCounters = function (callback) {
            if(!activeOCIDs.length) return callback()
            log.info('Counters with active collector now processed but required for update. Removing: ', activeCounters);
            var sendMessageToChildren = cfg.userProcIPCForServerRemoveCounters ? childrenProcesses : serverIPC;
            sendMessageToChildren.sendAndReceive({ removeCounters: activeOCIDs }, callback);
        }

        var getCountersParameters = function(objectsCountersIDs, callback) {

            var cachedParametersData = [];
            var notCachedOCIDs = objectsCountersIDs.filter(function (OCID) {
                if(!countersParametersDBCache[OCID]) return true;
                Array.prototype.push.apply(cachedParametersData, countersParametersDBCache[OCID]);
                return false;
            });

            // make copy of counter parameters
            recordsFromCacheCnt += cachedParametersData.length;
            if(!notCachedOCIDs.length) return callback(null, cachedParametersData);

            // TODO: use counterID instead OCID, load data to cache at init time
            // [{OCID: <OCID>, name: <parameter name>, value: <parameter value>}, ...]
            countersDB.getCountersParameters(notCachedOCIDs, function (err, parametersData) {
                if(err) return callback(new Error('Can\'t get counter parameters for OCIDs: ' + notCachedOCIDs + ': ' + err.message));

                recordsFromDBCnt += parametersData.length;
                log.debug('Getting parameters from DB for OCIDs: ', notCachedOCIDs, ': ', parametersData);

                // for counters without parameters
                notCachedOCIDs.forEach(function (OCID) {
                    countersParametersDBCache[OCID] = [];
                });

                if(parametersData && parametersData.length) {
                    parametersData.forEach(function (parameter) {
                        countersParametersDBCache[parameter.OCID].push(parameter);
                    });

                    if (cachedParametersData.length) Array.prototype.push.apply(parametersData, cachedParametersData);
                }

                // make copy of counter parameters
                callback(err, parametersData);
            });
        };

        removeCounters(function () {
            getCountersParameters(objectsCountersIDs, function (err, parametersData) {
                if (err) return callback(err);

                var countersParameters = {};
                parametersData.forEach(function (obj) {
                    var objectCounterID = obj.OCID;
                    if (!countersParameters[objectCounterID]) countersParameters[objectCounterID] = [];

                    countersParameters[objectCounterID].push({
                        name: obj.name,
                        value: obj.value
                    });
                });

                log.debug('Parameters for counters for OCIDs: ' ,objectsCountersIDs, ': ', countersParameters, '; properties: ', filteredProperties);

                async.eachLimit(filteredProperties, 200,function (property, callback) {
                    getCounterValue(countersParameters[property.OCID], property, parentVariables, callback);
                }, callback)
            });
        });
        // parametersData = [{OCID: <OCID>, name: <parameter name>, value: <parameter value>}, ...]
    }

    function getCounterValue(counterParameters, property, parentVariables, callback) {

        var objectCounterID = property.OCID;
        var collector = property.collector;
        var isActive = !!activeCollectors[collector]; // convert to boolean

        if(!processedObjects[objectCounterID]) {
            processedObjects[objectCounterID] = {
                active: isActive
            };
        }

        processedObjects[objectCounterID][processedID] = true;

        var key = property.parentOCID + '-' + property.OCID;
        var message = {
            processedID: processedID++,
            property: property,
            counterParameters: counterParameters,
            parentVariables: parentVariables,
            updateEventState: updateEventsStatus[key],
            active: isActive //|| !!separateCollectors[collector]
        };

        var sendMessageToChildren = cfg.userProcIPCForServer ? childrenProcesses : serverIPC;
        sendMessageToChildren.send(message, callback);
    }
}
