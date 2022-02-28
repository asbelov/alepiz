/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
const proc = require("../lib/proc");
const cache = require("../models_history/historyCache");
const storage = require("../models_history/historyStorage");
const functions = require("../models_history/historyFunctions");
const housekeeper = require("../models_history/historyHousekeeper");
const parameters = require("../models_history/historyParameters");
const IPC = require("../lib/IPC");
const server = require('../server/counterProcessor');

var restartTimestamp = 0, serverIPC, stopHistoryInProgress = false;

var historyProcess = new proc.child({
    module: 'history',
    onDestroy: function() {
        cache.dumpData();
        cache.terminateHousekeeper = true;
        storage.kill();
    },
    onStop: stopHistory,
    onMessage: function(message, callback) {
        processMessage(message, null, callback);
    },
    onDisconnect: function() {  // exit on disconnect from parent
        log.exit('History server was disconnected from parent unexpectedly. Exiting');
        cache.terminateHousekeeper = true;
        storage.stop(function(err) {
            if(err) log.error(err.message);
            cache.dumpData(function() {
                log.disconnect(function () { process.exit(2) });
            });
        });
    },
});

function processMessage(message, socket, callback) {

    if(message.msg === 'add') {
        cache.add(message.id, message.record);
        // callback used only for cleanup callback stack from IPC cluster worker
        // empty data will not be sent to history client
        return callback();
    }

    if(message.msg === 'del') return cache.del(message.IDs, 0, 0,callback);

    if(message.msg === 'getLastValues') return cache.getLastValues(message.IDs, callback);

    if(message.msg === 'getByIdx') {
        return cache.getByIdx (message.id, message.last, message.cnt, message.maxRecordsCnt, message.recordsType,
            function(err, records, isGotAllRequiredRecords, param) {
                callback(err, {
                    records: cache.thinOutRecords(records, message.maxRecordsCnt),
                    all: isGotAllRequiredRecords,
                    param: param,
                });
            });
    }

    if(message.msg === 'getByTime') {
        return cache.getByTime (message.id, message.time, message.interval, message.maxRecordsCnt,
            message.recordsType, function(err, records, isGotAllRequiredRecords, param) {
                callback(err, {
                    records: cache.thinOutRecords(records, message.maxRecordsCnt),
                    all: isGotAllRequiredRecords,
                    param: param,
                });
            });
    }

    if(message.msg === 'getByValue') return cache.getByValue (message.id, message.value, callback);

    if(message.msg === 'func') {
        if(typeof functions[message.funcName] !== 'function')
            return log.error('Unknown history function "',message.funcName,'". Message object: ',message);

        //log.info('Executing history function ',message.funcName,'. Message object: ',message);
        return functions[message.funcName](message.id, message.parameters, callback);
    }

    if (message.type === 'initParameters') {
        var sleepTime = message.data.__restart ? 2000 : 0;
        return setTimeout(function () {
            cache.init(message.data, function (err) {
                if (err) log.error('History init error: ', err.message, '; init parameters: ', message.data);

                // init houseKeeper at 30 minutes after start every 1 hour
                housekeeper.run(parameters);
                log.info('Init housekeeper for run every ', Math.ceil(message.data.housekeeperInterval / 60000), 'min');
                setInterval(function () {
                    housekeeper.run();
                }, message.data.housekeeperInterval);

                initScheduledRestart();

                // starting IPC after all history functions are initializing
                log.info('Starting history storage IPC...');
                parameters.id = 'history';
                //serverIPC = new IPC.cluster(parameters, function(err, msg, socket, messageCallback) {
                serverIPC = new IPC.server(parameters, function(err, msg, socket, messageCallback) {
                    if(err) log.error(err.message);

                    if(socket === -1) {
                        server.sendMsg({throttlingPause: 120000});
                        log.info('Starting history server process and initializing IPC');
                        callback(err);
                    } else if(msg) processMessage(msg, socket, messageCallback);
                });
            });
        }, sleepTime);
    }
}

function stopHistory(callback) {
    if(stopHistoryInProgress) return;
    stopHistoryInProgress = true;
    // dumping data two times for save data when server terminated by stop timeout
    if(restartTimestamp) {
        // add message to log.exit to prevent server.js from restarting for 5 minutes
        log.exit('Scheduled restart of the history server...');

        var myLog = log.warn;
        cache.cacheServiceIsRunning(1);
    } else {
        myLog = log.exit;
    }

    myLog('Stopping history storage service...');
    cache.terminateHousekeeper = true;

    cache.dumpData(function() {
        if(!restartTimestamp) {
            if(cache.cacheServiceIsRunning()) {
                setTimeout(function() {
                    myLog('Cache service is running, waiting...');
                }, 10000);
            }
            cache.terminateCacheService();
        }
        myLog('Stopping history storage processes...');
        storage.stop(function(err) {
            if(err) myLog('Error while stopping storage processes: ' + err.message);
            else myLog('Storage processes successfully stopped');

            if(!serverIPC || typeof serverIPC.stop !== 'function') {
                myLog('IPC is not initialized')
                serverIPC = {
                    stop: function (callback) { callback(); }
                }
            } else myLog('Closing IPC communication...');

            // Stops the server from accepting new connections and keeps existing connections
            serverIPC.stop(function(err) {
                cache.dumpData(function() {
                    myLog('History server is stopped');
                    callback(err);
                }, restartTimestamp);
            });

            setTimeout(function() {
                cache.dumpData(function() {
                    myLog('Timeout occurred while waiting for the closing IPC communication. History server is stopped');
                    callback(err);
                }, restartTimestamp);
            }, 60000);
        });
    }, restartTimestamp);
}

// run after cache service will be completed
function waitForCacheServiceCallback(err) {
    if(err && err.message) log.error('Cache service return error:', err.message);

    if(err !== 1) log.info('Caching service is finished. Restart...');
    restartTimestamp = Date.now();
    cache.cacheServiceIsRunning(1); // 1 mean that restart occurred
    if(!parameters.restartHistory && parameters.restartStorageModifier) {
        setTimeout(afterRestartCleanup, 600000, 600000);

        storage.restartStorageModifierProcess(function(err) {
            if(err) {
                log.error('Error while restarting storage modifier process: ' + err.message);
                historyProcess.stop(12); // exitCode: process.exit(12)
                return;
            }

            var resumeTime = 150000; // 3 min
            log.info('The caching service and the housekeeper is scheduled to resume in ', resumeTime / 60000,' minutes.')
            setTimeout(afterRestartCleanup, resumeTime);
        });
    }

    if(parameters.restartHistory) historyProcess.stop(12); // exitCode: process.exit(12)
}

function afterRestartCleanup(restartTimeout) {
    if(restartTimeout && (!restartTimestamp || Date.now() - restartTimestamp < restartTimeout)) return;
    cache.cacheServiceIsRunning(0);
    cache.terminateCacheService(0);
    restartTimestamp = 0;
    cache.terminateHousekeeper = 0;
    if(!restartTimeout) log.warn('Unpause the cache service and the housekeeper');
    else log.warn('Unpause the cache service and the housekeeper by timeout...');
    housekeeper.run();
}

function initScheduledRestart() {
    parameters.restartHistoryInterval = Number(parameters.restartHistoryInterval);

    if(parameters.restartHistoryInterval === parseInt(String(parameters.restartHistoryInterval), 10) &&
        parameters.restartHistoryInterval > 0
    ) {
        if(parameters.restartHistoryInterval < parameters.cacheServiceInterval * 1.5) {
            log.warn('Restart history time interval is too small (', Math.ceil(parameters.restartHistoryInterval / 60),
                ' min). Setting restart history time interval to ',
                Math.ceil(parameters.cacheServiceInterval * 1.5 / 60), 'min');
            parameters.restartHistoryInterval = parameters.cacheServiceInterval * 1.5;
        }

        log.info('Initializing scheduled restart history storage process every ',
            Math.ceil(parameters.restartHistoryInterval / 60), 'min');
        parameters.restartHistoryInterval *= 1000;

        setInterval(function () {
            if(!parameters.restartHistory && parameters.restartStorageQueryProcesses) {
                log.info('Scheduled restarting history storage query processes...');
                storage.restartStorageQueryProcesses(function(err) {
                    if(err) {
                        log.error('Error while restarting storage query processes: ' + err.message);
                        historyProcess.stop(12); // exitCode: process.exit(12)
                    }
                });
            }

            if(!parameters.restartHistory && !parameters.restartStorageModifier) return;

            cache.terminateHousekeeper = true;
            log.info('Preparing to scheduled restart history storage process...');
            cache.addCallbackToCacheService(waitForCacheServiceCallback);

            // 1 mean that scheduled restart in progress; 2 - wait for cache service in progress
            if(cache.cacheServiceIsRunning() === 1 || cache.cacheServiceIsRunning() === 2) {
                log.warn('The previous scheduled restart time of the history storage process has expired. Restart now...');
                cache.terminateCacheService();
                waitForCacheServiceCallback(1);
            } else if(cache.cacheServiceIsRunning()) { // cache service is running now
                log.info('It is planned to restart history storage after the end of the cache maintenance...');
                cache.cacheServiceIsRunning(2); // wait for cache service in progress
            } else { // cache service is not running now
                log.info('Saving data from cache to history storage before restart...')
                cache.startCacheService();
                setTimeout(cache.cacheServiceIsRunning, 1000, 2); // wait for cache service in progress
            }
        }, Math.round(parameters.restartHistoryInterval - parameters.restartHistoryInterval / 5));
    }
}
