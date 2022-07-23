/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var Conf = require('../lib/conf');
const confDebugServer = new Conf('config/debugServer.json');

var debugCounters = {
    stop: function(callback) {callback()},
    kill: function () {},
};
module.exports = debugCounters;
var clientIPC,
    cache = new Set(),
    isDisableNow = confDebugServer.get().disable,
    alwaysDisable = confDebugServer.get().alwaysDisable,
    isDisabledBefore = isDisableNow,
// sending messages cache to log server each 1 seconds
    sendMessageInProgress = false;

debugCounters.connect = function (callback) {
    if(alwaysDisable) return typeof callback === 'function' ? callback() : undefined;

    sendCache();

    // to enable and disable the server without restart
    if(isDisableNow) return typeof callback === 'function' ? callback() : undefined;

    connect(callback);
};

debugCounters.add = function(tag, id, variablesDebugInfo, important) {
    if(!tag || !id || !variablesDebugInfo || isDisableNow || alwaysDisable) return;

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
    if(isDisableNow || alwaysDisable) {
        log.warn('Can\'t get data: counter debugger is disabled in configuration')
        return callback();
    }
    if(!tag || !id) {
        return callback(new Error('Tag (' + tag+ ') or id (' + id +
            ') is not set for getting data from counter debugger'));
    }

    if(clientIPC && typeof clientIPC.sendAndReceive === 'function') {
        clientIPC.sendAndReceive({
            tag: tag,
            id: id
        }, callback);
    } else callback();
};

function connect (callback) {
    var cfg = confDebugServer.get(); // configuration for each module
    cfg.id = 'counterDebugger';
    cfg.reconnectDelay = 0;
    cfg.connectOnDemand = true;
    cfg.disconnectOnIdleTime = 180000;
    clientIPC = new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.error(err.message);
        else if (_clientIPC) {
            clientIPC = _clientIPC;
            if(typeof callback === 'function') {
                callback();
                callback = null; // prevent running callback on reconnect
            }
        }
    });
}

function sendCache() {
    var cfg = confDebugServer.get();
    isDisableNow = cfg.disable;
    var pushIntervalSec = isDisableNow ? 90 : (cfg.pushIntervalSec || 3);

    setTimeout(function () {
        sendCache();

        if (isDisableNow) {
            if(isDisabledBefore) return;
            clientIPC && clientIPC.disconnect();
            delete(clientIPC);
            clientIPC = null;
            isDisabledBefore = true;
            cache.clear();
            return;
        } else if(isDisabledBefore) {
            isDisabledBefore = false;
            return connect();
        }

        if (sendMessageInProgress || !cache.size) return;
        sendMessageInProgress = true;

        var myCopyOfCache = Array.from(cache);
        cache.clear();
        clientIPC.send(myCopyOfCache);
        sendMessageInProgress = false;

    }, (pushIntervalSec * 1000)).unref();
}