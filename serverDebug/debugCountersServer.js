/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const path = require('path');
const fs = require('fs');
const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const thread = require('../lib/threads');
const counterDB = require('../models_db/countersDB');
const setShift = require('../lib/utils/setShift');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confDebugServer = new Conf('config/debugServer.json');

var dataAlreadyDumped = false,
    counterDebuggerProcess,
    isDisableNow = confDebugServer.get().disable,
    isDisableBefore = isDisableNow,
    counterDebuggerData = new Map(),
    logObjectsCache = new Set(),
    addObjectsInProgress = false,
    dumpFile = path.join(conf.get('tempDir') || 'temp',
    confDebugServer.get('dumpFile') || 'counterDebugger.json'),
    dataReceived = 0,
    lastPrintStat = Date.now(),
    lastObjectsCleanup = Date.now()

/*
    initializing debug server
 */
fs.readFile(dumpFile, 'utf8', function(err, counterDebuggerDataObjStr) {
    var cfg = confDebugServer.get();

    if(err) log.info('Can\'t read dump file ', dumpFile, ': ', err.message);
    else {
        try {
            var counterDebuggerDataObj = JSON.parse(counterDebuggerDataObjStr);
            fs.unlinkSync(dumpFile);
        } catch (e) {
            log.warn('Can\'t parse dump file ', dumpFile, ': ', e.message);
        }

        // Convert from object to Map
        if(counterDebuggerDataObj) {
            for(var key in counterDebuggerDataObj) {
                var logObject = {
                    important: new Set(),
                    notImportant: new Set(),
                };

                if(counterDebuggerDataObj[key]) {
                    if (Array.isArray(counterDebuggerDataObj[key].important)) {
                        counterDebuggerDataObj[key].important.forEach(val => logObject.important.add(val));
                    }

                    if (Array.isArray(counterDebuggerDataObj[key].notImportant)) {
                        counterDebuggerDataObj[key].notImportant.forEach(val => logObject.notImportant.add(val));
                    }
                }
                counterDebuggerData.set(key, logObject);
            }
            log.info('Successfully reading data for ', counterDebuggerData.size, ' objects-counters pairs from ', dumpFile);
        } else {
            log.info('Dump file ', dumpFile, ' not contain objects-counters pairs');
        }
    }

    cfg.id = 'counterDebugger';
    new IPC.server(cfg, function (err, msg, socket, callback) {
        if (err) log.error(err.message);
        if (msg) processMessage(msg, socket, callback);
        if(socket === -1 && !counterDebuggerProcess) { // server starting to listen socket
            counterDebuggerProcess = new thread.child({
                module: 'counterDebugger',
                onDestroy: dumpData,
                onStop: dumpData,
                onMessage: function (message, callback) {
                    processMessage(message, null, callback);
                },
                onDisconnect: function() {  // exit on disconnect from parent (then server will be restarted)
                    log.exit('Debugger was disconnected from server unexpectedly. Exiting');
                    dumpData(function() {
                        log.disconnect(function () { process.exit(2) });
                    });
                },
            });

            processCache();
        }
    });
});

/**
 * Process received message
 * @param {Array|Object} message if Array, then message is a cached debugging data for add to memory. If object, then
 *      message is a require for get data from memory
 * @param {string} message.tag tag of the data
 * @param {number} message.id data id
 * @param socket IPC socket
 * @param {function(null, Array)} callback callback(null, arrayOfDebuggingData)
 */
function processMessage(message, socket, callback) {
    if(message.tag && message.id) { // get data from counterDebugger
        var key = message.tag + ':' + String(message.id), logObject = counterDebuggerData.get(key);
        if(logObject) {
            var arr = Array.from(logObject.important);
            Array.prototype.push.apply(arr, Array.from(logObject.notImportant));
            return callback(null, arr);
        } else return callback(null, []);
    }

    // add data to counterDebugger (at first to the cache)
    if(message && Array.isArray(message) && message.length) {
        message.forEach(item => logObjectsCache.add(item));
    }
}

/**
 * Periodically add data from cache to the debugData
 */
function processCache() {
    var cfg = confDebugServer.get();
    isDisableNow = cfg.disable;
    var pushIntervalSec = isDisableNow ? 90 : (cfg.pushIntervalSec || 3);

    var t = setTimeout(function () {
        processCache();

        if(isDisableNow) {
            if(isDisableBefore) return;
            isDisableBefore = true;
            log.info('Debugger was disabled in configuration');
            logObjectsCache.clear();
            counterDebuggerData.clear();
            return;
        } else if(isDisableBefore) {
            isDisableBefore = false;
            log.info('Debugger was enabled in configuration');
        }

        if(addObjectsInProgress || !logObjectsCache.size) return;

        addObjectsInProgress = true;
        var copyOfLogObjects = new Set(logObjectsCache);
        logObjectsCache.clear();

        addToLog(copyOfLogObjects, cfg);
        addObjectsInProgress = false;

        var now = Date.now();
        if(now - lastPrintStat > 120000) printStat(now);
        if(now - lastObjectsCleanup > 300000) objectsClean();

    }, (pushIntervalSec * 1000));
    t.unref();
}

/**
 * Add data to cache
 * @param {Set<{tag: string, id: number, data: Object, important: Boolean}>} logObjects
 * @param {Object} cfg debugger configuration parameters
 */
function addToLog(logObjects, cfg) {
    logObjects.forEach(function(newLogObject) {
        var tag = newLogObject.tag, id = newLogObject.id, data = newLogObject.data;
        if (!tag || !data) return;
        if (!id) return log.warn('Message ID is not set when adding data to Debugger');

        ++dataReceived;
        var key = tag + ':' + String(id), logObject = counterDebuggerData.get(key);
        if(!logObject) {
            counterDebuggerData.set(key, {
                important: new Set(),
                notImportant: new Set(),
            });

            logObject = counterDebuggerData.get(key);
        }

        var importantLogItem = logObject.important,
            notImportantLogItem = logObject.notImportant,
            importantLength = importantLogItem.size,
            notImportantLength = notImportantLogItem.size;

        if (newLogObject.important) importantLogItem.add(data);
        else notImportantLogItem.add(data);

        var logSize = cfg[tag] && Number(cfg[tag].size) === parseInt(String(cfg[tag].size), 10) ?
            Number(cfg[tag].size) : (cfg.logSize || 10);

        if (importantLength + notImportantLength >= logSize) {
            if (importantLength > notImportantLength) setShift(importantLogItem);
            else setShift(notImportantLogItem);
        }
    });
}

/**
 * Printing statistic to the log file
 * @param {number} now Date.now();
 */
function printStat(now) {
    log.info('Received: ', Math.round(dataReceived /  ((now - lastPrintStat) / 60000) ),
        '/min. OCIDs in debug: ', counterDebuggerData.size);
    dataReceived = 0;
    lastPrintStat = now;
}

/**
 * Read counters from DB and clean counters debug cache from counters without debug attribute
 */
function objectsClean() {
    lastObjectsCleanup = Date.now();

    counterDB.getAllCounters(function (err, counterRows) {
        if(err) return log.error('Can\'t get counters information: ', err.message);

        counterDB.getAllObjectsCounters(function (err, OCIDRows) {
            if(err) return log.error('Can\'t get OCIDs information: ', err.message);

            var OCIDsWithDebug = new Set(),
                removedObjects = 0,
                countersWithDebug = new Set();
            counterRows.forEach(counter => {
                if(!counter.debug) return;

                countersWithDebug.add(counter.name);
                OCIDRows.forEach(OCID => {
                    if(OCID.counterID === counter.id) {
                        OCIDsWithDebug.add(OCID.id);
                    }
                });
            });

            counterDebuggerData.forEach((logObject, key) => {
                var OCID = Number(key.replace(/^[^:]+:/, ''));
                if(!OCIDsWithDebug.has(OCID)) {
                    counterDebuggerData.delete(key);
                    ++removedObjects;
                }
            });

            log.info('Cleaning: ',
                (removedObjects ?
                    'removed ' + removedObjects + ' OCIDs' :
                    'nothing to remove'), '. Found ', countersWithDebug.size, ' counters with debug: ',
                Array.from(countersWithDebug).join('; '));
        });
    });
}

/**
 * Create cache dump (JSON) to file before exit.
 * Data from dump file will be loaded to cache on next startup
 * @param {function(void)} [callback] callback()
 */
function dumpData(callback) {
    if(!dataAlreadyDumped) {
        dataAlreadyDumped = true;
        var dumpFile = path.join(conf.get('tempDir') || 'temp',
            confDebugServer.get('dumpFile') || 'counterDebugger.json');
        try {
            // default flag: 'w' - file created or truncated if exist
            //fs.writeFileSync(_dumpFD, JSON.stringify(cache, null, 4),'utf8');

            ///Convert {Map()} counterDebuggerData to {Object} counterDebuggerDataObj
            var counterDebuggerDataObj = {};
            counterDebuggerData.forEach((logObject, key) => {
                var importantLogItem = logObject.important,
                    notImportantLogItem = logObject.notImportant;

                counterDebuggerDataObj[key] = {
                    important: [],
                    notImportant: [],
                }
                importantLogItem.forEach(val => {counterDebuggerDataObj[key].important.push(val)});
                notImportantLogItem.forEach(val => {counterDebuggerDataObj[key].notImportant.push(val)})
            });

            // default flag: 'w' - file created or truncated if exist
            fs.writeFileSync(dumpFile, JSON.stringify(counterDebuggerDataObj), 'utf8');
            // for debug
            //fs.writeFileSync(dumpFile, JSON.stringify(counterDebuggerDataObj, null, 4), 'utf8');
            log.exit('Dumping Debugger data is finished to ' + dumpFile);
        } catch (err) {
            log.exit('Can\'t dump Debugger data to file ', dumpFile, ': ', err.message);
        }
    }
    if(typeof callback === 'function') return callback();
}