/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
const proc = require("../lib/proc");
const cache = require("./historyCache");
const storage = require("./historyStorage");
const housekeeper = require("./historyHousekeeper");
const IPC = require("../lib/IPC");
const server = require('../server/counterProcessor');
const parameters = require('./historyParameters');
const Conf = require("../lib/conf");
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());


var serverIPC, stopHistoryInProgress = false;

new proc.child({
    module: 'history',
    onDestroy: function() {
        cache.dumpData();
        cache.terminateHousekeeper = true;
        storage.kill();
    },
    onStop: stopHistory,
    onMessage: function(message, callback) {
        processMessages(message, callback);
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

function processMessages(message, callback) {
    if (message.type === 'init') {
        cache.init(function (err) {
            if (err) return log.throw('History init error: ', err.message);

            // init houseKeeper at 30 minutes after start every 1 hour
            housekeeper.run();
            log.info('Init housekeeper for run every ',
                Math.ceil(parameters.housekeeperInterval / 60000), 'min');
            setInterval(function () {
                housekeeper.run();
            }, parameters.housekeeperInterval);

            // starting IPC after all history functions are initializing
            log.info('Starting history storage IPC...');
            parameters.id = 'history';
            serverIPC = new IPC.server(parameters, function(err, msg, socket, messageCallback) {
                if(err) log.error(err.message);

                if(socket === -1) {
                    server.sendMsg({throttlingPause: 120000});
                    log.info('Starting history server process and initializing IPC');
                    callback(err);
                } else if(msg) processIPCMessages(msg, socket, messageCallback);
            });
        });
    } else if (message.type === 'makeDump') cache.dumpData(callback);
}

function processIPCMessages(message, socket, callback) {

    if(message.msg === 'add') return cache.add(message.id, message.record);

    if(message.msg === 'del') return cache.del(message.IDs, 0, 0);

    if(message.msg === 'getLastValues') return cache.getLastValues(message.IDs, callback);

    if(message.msg === 'getByIdx') {
        return cache.getByIdx (message.id, message.last, message.cnt, message.maxRecordsCnt, message.recordsType,
            function(err, records, isGotAllRequiredRecords) {
                callback(err, {
                    records: cache.thinOutRecords(records, message.maxRecordsCnt),
                    all: isGotAllRequiredRecords,
                });
            });
    }

    if(message.msg === 'getByTime') {
        return cache.getByTime (message.id, message.time, message.interval, message.maxRecordsCnt,
            message.recordsType, function(err, records, isGotAllRequiredRecords) {
                callback(err, {
                    records: cache.thinOutRecords(records, message.maxRecordsCnt),
                    all: isGotAllRequiredRecords,
                });
            });
    }

    if(message.msg === 'getByValue') return cache.getByValue (message.id, message.value, callback);

    log.warn('Unknown message ', message);
}

function stopHistory(callback) {
    if(stopHistoryInProgress) return;
    stopHistoryInProgress = true;
    // dumping data two times for save data when server terminated by stop timeout

    log.exit('Stopping history storage service...');
    cache.terminateHousekeeper = true;

    cache.dumpData(function() {
        if(cache.cacheServiceIsRunning()) {
            setTimeout(function() {
                log.exit('Cache service is running, waiting...');
            }, 10000);
        }
        cache.terminateCacheService();

        log.exit('Stopping history storage processes...');
        storage.stop(function(err) {
            if(err) log.exit('Error while stopping storage processes: ' + err.message);
            else log.exit('Storage processes successfully stopped');

            if(!serverIPC || typeof serverIPC.stop !== 'function') {
                log.exit('IPC is not initialized')
                serverIPC = {
                    stop: function (callback) { callback(); }
                }
            } else log.exit('Closing IPC communication...');

            // Stops the server from accepting new connections and keeps existing connections
            serverIPC.stop(function(err) {
                cache.dumpData(function() {
                    log.exit('History server is stopped');
                    callback(err);
                });
            });

            setTimeout(function() {
                cache.dumpData(function() {
                    log.exit('Timeout occurred while waiting for the closing IPC communication. History server is stopped');
                    callback(err);
                });
            }, 60000);
        });
    });
}