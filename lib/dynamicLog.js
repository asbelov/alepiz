/*
 * Copyright © 2019. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var dynamicLog = {
    stop: function(callback) {callback()},
    kill: function () {},
};
module.exports = dynamicLog;

var cfg = conf.get('dynamicLog'); // configuration for each module


if(module.parent) initServerCommunication();
else runServerProcess(); //standalone process

function initServerCommunication() {

    var clientIPC, cache = [], dynamicLogProcess;
    cfg.pushIntervalSec = cfg.pushIntervalSec || 3;

    dynamicLog.connect = function (callback) {
        if(cfg.disable) return typeof callback === 'function' ? callback(new Error('Dynamic log disabled in configuration')) : undefined;

        cfg.id = 'dynamicLog';
        clientIPC = new IPC.client(cfg, function (err, msg, isConnecting) {
            if (err) log.error(err.message);
            else if (isConnecting && typeof callback === 'function') {
                callback();
                callback = null; // prevent running callback on reconnect
                if(!cfg.disable) sendCache(cfg.pushIntervalSec, clientIPC);
            }
        });
    };

    // starting dynamicLog child process and IPC system
    dynamicLog.start = function (_callback) {
        var callback = function(err, isDynamicLogExit) {
            if(typeof _callback === 'function') return _callback(err, isDynamicLogExit);
            if(err) log.error(err.message)
        };

        if(cfg.disable) {
            log.info('Dynamic log is disabled in configuration and not started');
            return callback();
        }

        dynamicLogProcess = new proc.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            restartAfterErrorTimeout: 2000,
            killTimeout: 1000,
            module: 'dynamicLog',
        }, function(err, dynamicLogProcess) {
            if(err) return callback(new Error('Can\'t initializing dynamicLog process: ' + err.message));

            dynamicLogProcess.start(function (err) {
                if(err) return callback(new Error('Can\'t run dynamicLog process: ' + err.message));

                // sending messages cache to log server each 1 seconds
                if(!cfg.disable) sendCache(cfg.pushIntervalSec, dynamicLogProcess);

                log.info('Dynamic log was started: ', cfg);
                callback();
            });
        });

        dynamicLog.stop = dynamicLogProcess.stop;
        dynamicLog.kill = dynamicLogProcess.kill;
    };


    dynamicLog.add = function(tag, id, data, important) {
        if(!tag || !id || !data || cfg.disable) return;
        cache.push({
            tag: tag,
            id: id,
            data: data,
            important: !!important
        });
    };

    dynamicLog.get = function(tag, id, callback) {
        if(cfg.disable) return callback(new Error('Dynamic log is disabled in configuration'));
        if(!tag || !id) return callback(new Error('Tag (' + tag+ ') or id (' + id + ') is not set for getting data from dynamic log'));
        clientIPC.sendAndReceive({
            tag: tag,
            id: id
        }, callback);
    };

    function sendCache(pushIntervalSec, sender) {
        // sending messages cache to log server each 1 seconds
        var sendMessageInProgress = false;

        setInterval(function () {
            if (sendMessageInProgress || !cache.length) return;
            sendMessageInProgress = true;

            var myCopyOfCache = cache.slice();
            cache = [];
            sender.send(myCopyOfCache);
            sendMessageInProgress = false;
        }, pushIntervalSec * 1000);
    }
}

function runServerProcess() {
    log.info('Starting dynamicLog server process');
    var dataAlreadyDumped = false, dynamicLogProcess;

    var dynamicLog = {}, logObjects = [], addObjectsInProgress = false;
    cfg.logSize = cfg.logSize || 10;
    cfg.dumpFile = cfg.dumpFile || 'db/dynamicLog.json';
    cfg.updateDynamicLog = cfg.updateDynamicLog || 500;

    fs.readFile(cfg.dumpFile, 'utf8', function(err, data) {
        if(err) log.warn('Can\'t read dump file ' + cfg.dumpFile + ': ' + err.message);
        else {
            try {
                dynamicLog = JSON.parse(String(data));
            } catch (e) {
                log.warn('Can\'t parse dump file ' + cfg.dumpFile + ': ' + e.message);
            }
        }

        cfg.id = 'dynamicLog';
        new IPC.server(cfg, function (err, msg, socket, callback) {
            if (err) log.error(err.message);
            if (msg) processMessage(msg, socket, callback);
            if(socket === -1 && !dynamicLogProcess) { // server starting to listen socket
                dynamicLogProcess = new proc.child({
                    module: 'dynamicLog',
                    onDestroy: dumpData,
                    onStop: dumpData,
                    onMessage: function (message, callback) {
                        processMessage(message, null, callback);
                    },
                    onDisconnect: function() {  // exit on disconnect from parent (then server will be restarted)
                        log.exit('Dynamic log was disconnected from server unexpectedly. Exiting');
                        dumpData(function() {
                            process.exit(2);
                        });
                    },
                });
            }
        });

    });

    function processMessage(message, socket, callback) {
        if(message.tag) { // get data from dynamicLog
            if (dynamicLog[message.tag] && dynamicLog[message.tag][message.id]) {
                var arr = dynamicLog[message.tag][message.id].important.slice();
                Array.prototype.push.apply(arr, dynamicLog[message.tag][message.id].notImportant);
                return callback(null, arr);
            } else return callback(null, []);
        }

        // add data to dynamicLog (at first to the cache)
        if(message && Array.isArray(message) && message.length) Array.prototype.push.apply(logObjects, message);
    }

    setInterval(function () {
        if(addObjectsInProgress) return;
        addObjectsInProgress = true;
        var copyOfLogObjects = logObjects.slice();
        logObjects = [];

        addToLog(copyOfLogObjects);
        addObjectsInProgress = false;
    }, cfg.updateDynamicLog);

    /*
    logObjects: [{
            tag: tag,
            id: id,
            data: data,
            important: !!important
        }, ...]
     */
    function addToLog(logObjects) {
        logObjects.forEach(function(logObject) {

            // add to dynamic log
            if (logObject.tag) {
                var tag = logObject.tag, id = logObject.id;
                if (!id) return log.warn('Message ID is not set when adding data to dynamic log');

                if (!logObject.data) return;

                if (typeof dynamicLog[tag] !== 'object') dynamicLog[tag] = {};
                if (!dynamicLog[tag][id]) {
                    dynamicLog[tag][id] = {
                        important: [],
                        notImportant: []
                    };
                }
                var importantLogItem = dynamicLog[tag][id].important,
                    notImportantLogItem = dynamicLog[tag][id].notImportant,
                    importantLength = importantLogItem.length,
                    notImportantLength = notImportantLogItem.length;

                if (logObject.important) importantLogItem.push(logObject.data);
                else notImportantLogItem.push(logObject.data);
                var logSize = cfg[tag] && Number(cfg[tag].size) === parseInt(String(cfg[tag].size), 10) ? Number(cfg[tag].size) : cfg.logSize;

                if (importantLength + notImportantLength > logSize) {
                    if (importantLength > notImportantLength) importantLogItem.shift();
                    else notImportantLogItem.shift();
                }
            }
        });
    }

    /*
    Create cache dump (JSON) to file before exit.
    Data from dump file will be loaded to cache on next startup
    */
    function dumpData(callback) {
        if(!dataAlreadyDumped) {
            dataAlreadyDumped = true;
            try {
                // default flag: 'w' - file created or truncated if exist
                //fs.writeFileSync(_dumpFD, JSON.stringify(cache, null, 4),'utf8');
                fs.writeFileSync(cfg.dumpFile, JSON.stringify(dynamicLog), 'utf8');
                log.exit('Dumping dynamic log data is finished to ' + cfg.dumpFile);
            } catch (err) {
                log.exit('Can\'t dump dynamic log data to file ' + cfg.dumpFile + ': ' + err.message);
            }
        }
        if(typeof callback === 'function') return callback();
    }
}
