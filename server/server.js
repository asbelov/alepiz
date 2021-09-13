/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const os = require("os");
const path = require("path");
var log = require('../lib/log')(module);

var threads = require('../lib/threads');
var serverCache = require('./serverCache');
const conf = require("../lib/conf");
const IPC = require("../lib/IPC");
const countersDB = require("../models_db/countersDB");
conf.file('config/conf.json');

var cache = {};
var childrenProcesses;
var updateEventExpressionResults = new Map();

if (threads.isMainThread) initServerCommunication();
else return runServer(threads.workerData[0], threads.workerData[1]);  //standalone process

// parent process
function initServerCommunication() {
    var servers = conf.get('servers'),
        stopServerInProgress = 0,
        startServerInProgress = 0,
        serverStarted = false;

    var serverProcess = new threads.parent({
        childrenNumber: servers.length,
        childProcessExecutable: __filename,
        restartAfterErrorTimeout: 0,
        killTimeout: killTimeout,
        onMessage: function (message) {
            log.debug('Parent receiving ', message);
            if (message.restart) {
                stopServer('Receiving "restart" command', function () {
                    startServer('Receiving "restart" command');
                });
            } else if (message.stop) {
                stopServer('Receiving "stop" command', null, true);
            } else if (message.start) {
                startServer('Receiving "start" command');
            } else log.error('Receiving unknown message from child', message);
        },
        onChildExit: function () {
            stopServer('Server process exiting', function () {
                startServer('Server process exiting');
            });
        },
        module: 'server',
        args: ['%:childID:%', servers.length],
    });

    server.start = function (callback) { startServer('Initial start server', callback); }
    server.stop = function (callback) { stopServer('Receiving request for stop server', callback) };

    // sending all messages to servers
    server.sendMsg = function (message) {
        //log.info('Sending message to all servers: ', message);
        serverProcess.sendToAll(message, function (err) {
            if (err) log.error(err.message);
        });
    };

    function startServer(message, callback) {
        if (startServerInProgress || serverStarted) return;

        if (stopServerInProgress) {
            log.error('Can\'t start server while stop server in progress... ');
            return;
        }
        startServerInProgress = Date.now();

        var startTimeout = 0;
        if (!callback) { // server restarted
            startTimeout = killTimeout + 1000;
            log.warn('Waiting while all socket are closed and all processes are killed...');
        }

        setTimeout(function () {
            log.info('Starting server for "', message, '"');
            serverProcess.startAll(function (err) {
                startServerInProgress = 0;
                serverStarted = true;
                if (typeof callback === "function") callback(err);
            });
        }, startTimeout);
    }

    function stopServer(message, callback, isQuiet) {
        if (stopServerInProgress) return;
        if (startServerInProgress) {
            log.error('Can\'t stop server while start server in progress... ');
            return;
        }

        startServerInProgress = Date.now();

        log.warn(message + '. Terminating server...');
        if (!isQuiet) log.exit(message + '. Terminating server...');


        serverProcess.stopAll(function (err) {
            if (err) {
                log.error('Error while terminating server: ', err.message);
                if (!isQuiet) log.exit('Error while terminating server: ', err.message);
            } else {
                log.warn('Server processes and all children terminated successfully');
                if (!isQuiet) log.exit('Server processes and all children terminated successfully');
            }

            stopServerInProgress = 0;
            serverStarted = false;
            if (typeof callback === 'function') callback();
        });
    }
}

function runServer(serverID, serversNumber) {
    serverID = Number(serverID);
    serversNumber = Number(serversNumber);
    var cfg = conf.get('servers')[serverID];

    cfg.id = 'server';
    new threads.child({
        module: 'server#' + serverID,
        onMessage: processChildMessage,
    });

    runChildren(cfg, serverID, function (err) {
        if (err) return log.error(err.message);

        serverProcess = new proc.child({
            module: 'server',
            onStop: stopServer,
            onDestroy: childrenProcesses.killAll,
        });

        waitingForObjects(serversNumber, serverID, function (err, topCounters) {
            if (err) return log.error(err.message);

            log.info('All children are running. Getting ', topCounters.length, ' counters values at first time.');
            topCounters.forEach(function (property) {
                childrenProcesses.send({
                    c: [property.OCID],
                });
            });
        });
    });

    function runChildren(cfg, serverID, callback) {

        var childrenNumber = cfg.childrenNumber || Math.floor(os.cpus().length / serversNumber);
        var updateCacheInterval = (cfg.updateCacheInterval || 60) * 1000;

        serverCache.createCache(null, function (err, _cache) {
            if (err) return callback(new Error('Error when loading data to cache: ' + err.message));
            cache = _cache;

            log.info('Starting ', childrenNumber, ' children for serverID: ', serverID,
                '. CPU cores number: ', os.cpus().length, ', servers number: ', serversNumber);
            childrenProcesses = new threads.parent({
                childProcessExecutable: path.join(__dirname, 'child.js'),
                onMessage: processChildMessage,
                childrenNumber: childrenNumber,
                killTimeout: killTimeout - 3000, // less then server killTimeout
                args: [serverID, '%:childID:%'],
                restartAfterErrorTimeout: 0, // we will restart server with all children after exit one of children
                onChildExit: function () {
                    log.exit('One child was terminated unexpectedly. Restarting server');
                    sendRestartToParent();
                },
                module: 'childGetCountersValue',
            }, function (err, childrenProcesses) {
                if (err) return callback(err);

                childrenProcesses.startAll(function (err) {
                    if (err) return callback(err);

                    log.info('Sending cache data first time:',
                        (cache.variables ? ' history for counters: ' + Object.keys(cache.variables).length : ''),
                        (cache.variablesExpressions ? ' expressions for counters: ' + Object.keys(cache.variablesExpressions).length : ''),
                        (cache.objectsProperties ? ' properties for objects: ' + Object.keys(cache.objectsProperties).length : ''),
                        (cache.countersObjects ? ' objects: ' + Object.keys(cache.countersObjects.objects).length +
                            ', counters: ' + Object.keys(cache.countersObjects.counters).length +
                            ', objectName2OCID: ' + Object.keys(cache.countersObjects.objectName2OCID).length : ''));

                    childrenProcesses.sendToAll(cache, function (err) {
                        if (err) return callback(err);

                        // print message with children memory usage to log every 60 sec
                        // also update children cache
                        setInterval(function () {
                            //printChildrenMemUsage();
                            updateCache();
                        }, updateCacheInterval);
                        callback();
                    });
                });
            });
        });
    }


    function waitingForObjects(serversNumber, serverID, callback) {
        var howOftenTryToFindIndependentCountersAtStart = conf.get('sqlite:howOftenTryToFindIndependentCountersAtStart') ? Number(conf.get('sqlite:howOftenTryToFindIndependentCountersAtStart')) : 10000;

        // topProperties: [{OCID, collector, counterID, counterName, objectID}, objectName, debug, groupID, taskCondition}...]
        countersDB.getCountersForFirstCalculation(null, null, function (err, allTopProperties) {
            if (err) return callback(err);

            if (allTopProperties && allTopProperties.length) {
                var topProperties = allTopProperties.filter(function (prop, idx) {
                    return idx % serversNumber === serverID;
                });
                return callback(null, topProperties);
            }

            log.warn('Can\'t find counters without dependents for starting data collection. Restarting server after ', howOftenTryToFindIndependentCountersAtStart / 1000, ' sec');
            setTimeout(waitingForObjects, howOftenTryToFindIndependentCountersAtStart, serversNumber, serverID, callback);
        });
    }

    function processChildMessage(message) {
        if (!message) return;

        if (Array.isArray(message)) {
            var OCIDs = message[0];
            var variables = message[1];
            var prevUpdateEventExpressionResult = message[2];
            var parentOCID = message[3];
            var values = Array.isArray(message[4]) ? message[4] : [message[4]];

            if (parentOCID) {
                if (prevUpdateEventExpressionResult === undefined) {
                    if (updateEventExpressionResults.has(parentOCID)) {
                        prevUpdateEventExpressionResult = updateEventExpressionResults.get(parentOCID);
                    }
                } else {
                    updateEventExpressionResults.set(parentOCID, prevUpdateEventExpressionResult);
                }
            }

            values.forEach(function (value) {
                if (typeof value === 'object') value = JSON.stringify(value);

                OCIDs.forEach(function (OCID) {
                    var message = [
                        OCID,
                        variables,
                        prevUpdateEventExpressionResult,
                        parentOCID,
                        value,
                    ];
                    childrenProcesses.send(message);
                });
            });
        }
    }
}
