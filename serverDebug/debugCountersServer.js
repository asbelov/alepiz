/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var path = require('path');
var fs = require('fs');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var thread = require('../lib/threads');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confDebugServer = new Conf('config/debugServer.json');

var cfg = confDebugServer.get(); // configuration for each module

log.info('Starting counter debugger server process');
var dataAlreadyDumped = false, counterDebuggerProcess;

var counterDebuggerData = new Map(), logObjectsArr = [], addObjectsInProgress = false;
cfg.logSize = cfg.logSize || 10;
cfg.dumpFile = path.join(conf.get('tempDir') || 'temp', cfg.dumpFile || 'counterDebugger.json');

fs.readFile(cfg.dumpFile, 'utf8', function(err, data) {
    if(err) log.warn('Can\'t read dump file ' + cfg.dumpFile + ': ' + err.message);
    else {
        try {
            counterDebuggerData = new Map(Object.entries(JSON.parse(String(data))));
            log.info('Successfully reading data for ', counterDebuggerData.size, ' objects-counters pairs from ', cfg.dumpFile);
            fs.unlinkSync(cfg.dumpFile);
        } catch (e) {
            log.warn('Can\'t parse dump file ' + cfg.dumpFile + ': ' + e.message);
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
                    log.exit('Counter debugger was disconnected from server unexpectedly. Exiting');
                    dumpData(function() {
                        log.disconnect(function () { process.exit(2) });
                    });
                },
            });
        }
    });

});

function processMessage(message, socket, callback) {
    if(message.tag && message.id) { // get data from counterDebugger
        var key = message.tag + ':' + String(message.id), logObject = counterDebuggerData.get(key);
        if(logObject) {
            var arr = logObject.important.slice();
            Array.prototype.push.apply(arr, logObject.notImportant);
            return callback(null, arr);
        } else return callback(null, []);
    }

    // add data to counterDebugger (at first to the cache)
    if(message && Array.isArray(message) && message.length) Array.prototype.push.apply(logObjectsArr, message);
}

setInterval(function () {
    if(addObjectsInProgress) return;
    addObjectsInProgress = true;
    var copyOfLogObjects = logObjectsArr.slice();
    logObjectsArr = [];

    addToLog(copyOfLogObjects);
    addObjectsInProgress = false;
}, cfg.updateCounterDebuger);

/*
logObjectsArr: [{
        tag: tag,
        id: id,
        data: data,
        important: !!important
    }, ...]
 */
function addToLog(logObjects) {
    logObjects.forEach(function(newLogObject) {

        // add to counter debugger
        if (newLogObject.tag) {
            var tag = newLogObject.tag, id = newLogObject.id;
            if (!id) return log.warn('Message ID is not set when adding data to counter debugger');

            if (!newLogObject.data) return;

            var key = tag + ':' + String(id), logObject = counterDebuggerData.get(key);
            if(!logObject) {
                counterDebuggerData.set(key, {
                    important: [],
                    notImportant: [],
                });

                logObject = counterDebuggerData.get(key);
            }

            var importantLogItem = logObject.important,
                notImportantLogItem = logObject.notImportant,
                importantLength = importantLogItem.length,
                notImportantLength = notImportantLogItem.length;

            if (newLogObject.important) importantLogItem.push(newLogObject.data);
            else notImportantLogItem.push(newLogObject.data);
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
            fs.writeFileSync(cfg.dumpFile, JSON.stringify(Object.fromEntries(counterDebuggerData.entries())), 'utf8');
            log.exit('Dumping counter debugger data is finished to ' + cfg.dumpFile);
        } catch (err) {
            log.exit('Can\'t dump counter debugger data to file ' + cfg.dumpFile + ': ' + err.message);
        }
    }
    if(typeof callback === 'function') return callback();
}
