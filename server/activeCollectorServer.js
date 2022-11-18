/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const Conf = require("../lib/conf");
const confCollectors = new Conf('config/collectors.json');
const confServer = new Conf('config/server.json');
const collectorsCfg = require("../lib/collectors");
const async = require("async");
const path = require("path");
const runInThread = require("../lib/runInThread");
const history = require("../serverHistory/historyClient");
const IPC = require("../lib/IPC");
const proc = require("../lib/proc");

/*
 node.exe = process.argv[0]
 __filename = process.argv[1]
 collectorNamesStr = process.argv[2] (comma separated collector names)
 serverAddress = process.argv[3] (server IP address for IPC)
 serverPort = process.argv[4] (server port for IPC)
 */
var collectorNamesStr = process.argv[2];
var serverAddress = process.argv[3];
var serverPort = process.argv[4];

var stopInProgress = false;
var collectorNames = collectorNamesStr.split(',');
var collectorsObj = {};
var serversIDs = {};
var mainCollectorsCfg = confServer.get('collectors');

runInThread(path.join(__dirname, 'counterProcessorServer'), {moduleName: collectorNamesStr},
    function (err, counterProcessorServerThreadObj) {
    if(err) return log.error(err.message);

    var counterProcessorServer = counterProcessorServerThreadObj.func;

    collectorsCfg.getConfiguration(null, function (err, collectorsParam) {
        if (err) return log.error(err.message);

        async.eachSeries(collectorNames, function (collectorName, callback) {
            var collectorPath = path.join(__dirname, '..', confCollectors.get('dir'), collectorName, 'collector.js');

            if(mainCollectorsCfg[collectorName]) {
                if (mainCollectorsCfg[collectorName].serverID) {
                    serversIDs[mainCollectorsCfg[collectorName].serverID] = true;
                }
            }

            if (collectorsParam[collectorName].runCollectorAsThread) {
                log.info('Starting collector thread ', collectorName, ': ', collectorPath);
                runInThread(collectorPath, {
                    get: {
                        permanentCallback: true,
                    }},function (err, collectorObj) {
                    if (err) {
                        log.error('Error starting active collector ', collectorName, ' code ', collectorPath,
                            ' as a thread: ', err.message);
                    } else collectorsObj[collectorName] = collectorObj.func;
                    callback();
                });
            } else {
                try {
                    log.info('Attaching collector ', collectorName, ': ', collectorPath);
                    collectorsObj[collectorName] = require(collectorPath);
                } catch (err) {
                    log.error('Error attaching active collector ', collectorName, ' code ', collectorPath, ': ', err.message);
                }
                return callback();
            }
        }, function () {

            var serversIDsArr = Object.keys(serversIDs);
            var serverID = serversIDsArr[0];
            if(!serversIDsArr.length) {
                var allServersIDs = Object.keys(confServer.get('servers'));
                serverID = allServersIDs[0];
                log.warn('ServerID for ', collectorNamesStr, ' is not configured. Will be used ', serverID);
            } else if(serversIDsArr.length > 1) {
                log.warn('Configured multiple serverIDs for ', collectorNamesStr, '(', serversIDsArr,
                    '). Will be used ', serverID);
            }

            counterProcessorServer.init(collectorNamesStr, serverID, function (err) {
                if (err) return log.error(err.message);
                history.connect(serverPort, function () {
                    var serverProcess;
                    new IPC.server({
                        serverAddress: serverAddress,
                        serverPort: serverPort,
                        id: collectorNamesStr,
                    }, function (err, message, socket, callback) {
                        if (err) {
                            if (stopInProgress) return;
                            log.warn('IPC server error: ', err.message);
                            /*
                            stopInProgress = true;

                            log.exit(err.message);
                            counterProcessorServer.stop(function () {
                                destroyCollectors(function () {
                                    log.disconnect(function () {
                                        process.exit(2)
                                    });
                                });
                            });
                            */
                            return;
                        }

                        // on bind
                        if (socket === -1) {
                            log.info('Active collectors ', collectorNamesStr, ' starting and listening ',
                                serverAddress, ':', serverPort, ' for IPC');
                            stopInProgress = false;
                            serverProcess = new proc.child({
                                module: 'activeCollector',
                                onStop: function (callback) {
                                    if (stopInProgress) return callback();
                                    stopInProgress = true;
                                    log.warn('Stopping ' + collectorNamesStr);

                                    counterProcessorServer.stop(function () {
                                        destroyCollectors(callback);
                                    });
                                },
                                onDestroy: destroyCollectors,
                                onDisconnect: function () {  // exit on disconnect from parent (then server will be restarted)
                                    log.exit('Active collectors ' + collectorNamesStr +
                                        ' was disconnected from parent unexpectedly. Exiting');
                                    log.disconnect(function () {
                                        process.exit(2)
                                    });
                                },
                            });

                            // for make possible to send restart command to the parent from counterProcess
                            return;
                        }

                        //if(message) log.warn('!!!msg ', message)

                        // message for server
                        if(message.server) {
                            //log.warn('!!!Send2server ', message);
                            //log.warn('!!!processServerMessage ', message)
                            // send restart|stop|start back to parent, because restart message can be received not from parent
                            if (message.server.restart && serverProcess) return serverProcess.send({ restart: 1 });
                            if (message.server.stop && serverProcess) return serverProcess.send({ stop: 1 });
                            if (message.server.start && serverProcess) return serverProcess.send({ start: 1 });

                            return counterProcessorServer.send(message.server);

                        }

                        // message for collector
                        if (!message || !message.type || !message.name ||
                            !collectorsObj[message.name] || typeof collectorsObj[message.name][message.type] !== 'function') {
                            callback();
                            // some collectors do not have some methods
                            //log.info('Unknown active collector message for ', collectorNamesStr, ': ', message);
                            return;
                        }

                        try {
                            if (message.data !== undefined) {
                                if (message.type !== 'get') {
                                    collectorsObj[message.name][message.type](message.data, callback);
                                } else { // save collector data to history
                                    collectorsObj[message.name].get(message.data, function (err, result) {
                                        //if(Number(message.data.id$) === 155101) log.warn('Add record ', message.data.$id, ':', result, ': ', message);
                                        //log.warn('Add record ', message.data.$id, ':', result, ': ', message);
                                        if(message.data.$variables) {
                                            var preparedResult = history.add(message.data.$id, result)
                                            counterProcessorServer.processCounterResult({
                                                err: err,
                                                result: preparedResult,
                                                parameters: message.data,
                                                collectorName: message.name,
                                                taskCondition: message.$taskCondition,
                                            });

                                        } else {
                                            // not for a counterProcessor.
                                            // f.e. it may be a result for the event-generator actions
                                            callback(err, result);
                                        }
                                    });
                                }
                            } else collectorsObj[message.name][message.type](callback);
                        } catch (e) {
                            log.error('Error running collector function ', collectorNamesStr, ': ', message.name, '.',
                                message.type, ': ', e.stack, ' (data: ', message.data, ')');
                        }
                    });
                }, true);
            });
        });

        function destroyCollectors(callback) {
            async.eachOf(collectorsObj, function (collector, collectorName, callback) {
                if (collector && typeof collector.destroy === 'function') {
                    collector.destroy(function (err) {
                        if (err) log.error(collectorName, ': ', err.message);
                        callback();
                    });
                } else callback();
            }, function () {
                log.warn('All active and separate collectors are stopped');
                if (typeof callback === 'function') callback();
            });
        }
    });
});