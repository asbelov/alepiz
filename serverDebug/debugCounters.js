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
var clientIPC, cache = new Set(), counterDebuggerProcess;
// sending messages cache to log server each 1 seconds
var sendMessageInProgress = false;


debugCounters.connect = function (callback) {
    // to enable and disable the server without restart
    //if(confDebugServer.get('disable')) return typeof callback === 'function' ? callback(new Error('Counter debugger is disabled in configuration')) : undefined;

    var cfg = confDebugServer.get(); // configuration for each module
    cfg.id = 'counterDebugger';
    clientIPC = new IPC.client(cfg, function (err, msg, isConnecting) {
        if (err) log.error(err.message);
        else if (isConnecting && typeof callback === 'function') {
            callback();
            callback = null; // prevent running callback on reconnect
            // to enable and disable the server without restart
            //if(!confDebugServer.get('disable'))
            sendCache(clientIPC);
        }
    });
};

// starting counterDebugger child process and IPC system
debugCounters.start = function (_callback) {
    var callback = function(err, isCounterDebuggerExit) {
        if(typeof _callback === 'function') return _callback(err, isCounterDebuggerExit);
        if(err) log.error(err.message)
    };

    if(confDebugServer.get('disable')) {
        log.info('Counter debugger is disabled in configuration');
        // to enable and disable the server without restart
        //return callback();
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

            // to enable and disable the server without restart
            //if(!confDebugServer.get('disable'))
            sendCache(counterDebuggerProcess);

            log.info('Counter debugger was started: ', confDebugServer.get());
            callback();
        });
    });

    debugCounters.stop = counterDebuggerProcess.stop;
    debugCounters.kill = counterDebuggerProcess.kill;
};


debugCounters.add = function(tag, id, variablesDebugInfo, important) {
    if(!tag || !id || !variablesDebugInfo || confDebugServer.get('disable')) return;

    for(var variableName in variablesDebugInfo) {
        // clean variablesDebugInfo from simple assignments
        if(String(variablesDebugInfo[variableName].result) === String(variablesDebugInfo[variableName].expression) &&
            variableName !== 'UPDATE_EVENT_STATE') {
            delete variablesDebugInfo[variableName];
        }
    }
    cache.add({
        tag: tag,
        id: id,
        data: variablesDebugInfo,
        important: !!important
    });
};

debugCounters.get = function(tag, id, callback) {
    if(confDebugServer.get('disable')) {
        log.warn('Counter debugger is disabled in configuration')
        return callback();
    }
    if(!tag || !id) {
        return callback(new Error('Tag (' + tag+ ') or id (' + id +
            ') is not set for getting data from counter debugger'));
    }
    clientIPC.sendAndReceive({
        tag: tag,
        id: id
    }, callback);
};

function sendCache(sender) {

    setTimeout(function () {
        if (confDebugServer.get('disable')) {
            cache.clear();
            sendCache(sender);
            return;
        }
        if (sendMessageInProgress || !cache.size) {
            sendCache(sender);
            return;
        }
        sendMessageInProgress = true;

        var myCopyOfCache = Array.from(cache);
        cache.clear();
        sender.send(myCopyOfCache);
        sendMessageInProgress = false;

        sendCache(sender);
    }, (confDebugServer.get('pushIntervalSec') || 3) * 1000).unref();
}