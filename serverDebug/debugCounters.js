/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var path = require('path');
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var thread = require('../lib/threads');
var Conf = require('../lib/conf');
const confDebugServer = new Conf('config/debugServer.json');

var debugCounters = {
    stop: function(callback) {callback()},
    kill: function () {},
};
module.exports = debugCounters;

var cfg = confDebugServer.get(); // configuration for each module
var clientIPC, cache = [], counterDebuggerProcess;
cfg.pushIntervalSec = cfg.pushIntervalSec || 3;

debugCounters.connect = function (callback) {
    if(cfg.disable) return typeof callback === 'function' ? callback(new Error('Counter debugger is disabled in configuration')) : undefined;

    cfg.id = 'counterDebugger';
    clientIPC = new IPC.client(cfg, function (err, msg, isConnecting) {
        if (err) log.error(err.message);
        else if (isConnecting && typeof callback === 'function') {
            callback();
            callback = null; // prevent running callback on reconnect
            if(!cfg.disable) sendCache(cfg.pushIntervalSec, clientIPC);
        }
    });
};

// starting counterDebugger child process and IPC system
debugCounters.start = function (_callback) {
    var callback = function(err, isCounterDebuggerExit) {
        if(typeof _callback === 'function') return _callback(err, isCounterDebuggerExit);
        if(err) log.error(err.message)
    };

    if(cfg.disable) {
        log.info('Counter debugger is disabled in configuration and not started');
        return callback();
    }

    counterDebuggerProcess = new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'debugCountersServer.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        module: 'counterDebugger',
    }, function(err, counterDebuggerProcess) {
        if(err) return callback(new Error('Can\'t initializing counterDebugger process: ' + err.message));

        counterDebuggerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run counterDebugger process: ' + err.message));

            // sending messages cache to log server each 1 seconds
            if(!cfg.disable) sendCache(cfg.pushIntervalSec, counterDebuggerProcess);

            log.info('Counter debugger was started: ', cfg);
            callback();
        });
    });

    debugCounters.stop = counterDebuggerProcess.stop;
    debugCounters.kill = counterDebuggerProcess.kill;
};


debugCounters.add = function(tag, id, data, important) {
    if(!tag || !id || !data || cfg.disable) return;
    cache.push({
        tag: tag,
        id: id,
        data: data,
        important: !!important
    });
};

debugCounters.get = function(tag, id, callback) {
    if(cfg.disable) return callback(new Error('Counter debugger is disabled in configuration'));
    if(!tag || !id) return callback(new Error('Tag (' + tag+ ') or id (' + id + ') is not set for getting data from counter debugger'));
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
