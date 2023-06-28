/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const connectToRemoteNodes = require('../lib/connectToRemoteNodes');
const Conf = require('../lib/conf');
const confDebugServer = new Conf('config/debugServer.json');

var debugCounters = {
    stop: function(callback) {callback()},
    kill: function () {},
};

module.exports = debugCounters;

var clientIPC,
    allClientIPC = new Map(),
    connectionInitialized = false,
    cache = new Set(),
    isDisableNow = confDebugServer.get().disable,
    alwaysDisable = confDebugServer.get().alwaysDisable,
    isDisabledBefore = isDisableNow,
    sendMessageInProgress = false;

/**
 * Connect to the debug server and start periodically send cached debugging data to the sever
 * @param {function(void)} [callback] callback()
 */
debugCounters.connect = function (callback) {
    if(alwaysDisable) return typeof callback === 'function' ? callback() : undefined;

    sendCachedDataToServer();

    // to enable and disable the server without restart
    if(isDisableNow) return typeof callback === 'function' ? callback() : undefined;

    connect(callback);
};

/**
 * Add data to the debug server
 * @param {string} tag tag for debugging data
 * @param {number} id data id
 * @param {Object} variablesDebugInfo data for debug
 * @param {Boolean} important is this debugging data important
 */
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

/**
 * Get data from debug server
 * @param {string} tag tag for debugging data
 * @param {number} id data id
 * @param {function(void)|function(Error)|function(null, Array) } callback callback(err, arrayOfDebuggingData)
 */
debugCounters.get = function(tag, id, callback) {
    if(isDisableNow || alwaysDisable) {
        log.warn('Can\'t get data: counter debugger is disabled in configuration')
        return callback();
    }
    if(!tag || !id) {
        return callback(new Error('Tag (' + tag + ') or id (' + id +
            ') is not set for getting data from counter debugger'));
    }

    if(!clientIPC || typeof clientIPC.sendExt !== 'function') return callback();

    var debugResults = [];
    async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
        if (typeof clientIPC.sendExt !== 'function') return callback();
        clientIPC.sendExt({
            tag: tag,
            id: id
        }, {
            sendAndReceive: true,
            dontSaveUnsentMessage: true,
        }, function(err, result) {
            if(Array.isArray(result)) Array.prototype.push.apply(debugResults, result);

            if(err) log.info(err.message);
            callback();
        });

    }, function() {
        return callback(null, debugResults);
    });
};

/**
 * Connect to the server
 * @param {function(void)} callback callback()
 */
function connect (callback) {
    if(connectionInitialized) return callback();

    var cfg = confDebugServer.get(); // configuration for each module
    cfg.id = 'debug';
    cfg.reconnectDelay = 0;
    cfg.connectOnDemand = true;
    cfg.socketTimeout = 1800000;
    clientIPC = new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.error(err.message);

        if (_clientIPC) {
            clientIPC = _clientIPC;
            log.info('Initialized connection to the debug server: ', cfg.serverAddress, ':', cfg.serverPort);

            connectToRemoteNodes('debug', cfg.id, function (err, _allClientIPC) {
                if(!_allClientIPC) {
                    log.warn('No remote nodes specified for debug');
                    _allClientIPC = new Map();
                }
                _allClientIPC.set(cfg.serverAddress + ':' + cfg.serverPort, clientIPC);
                allClientIPC = _allClientIPC;
                connectionInitialized = true;
                callback();
            });
        }
    });
}

/**
 * Start sending cached debugging data to the server every pushIntervalSec sec
 */
function sendCachedDataToServer() {
    var cfg = confDebugServer.get();
    isDisableNow = cfg.disable;
    var pushIntervalSec = isDisableNow ? 90 : (cfg.pushIntervalSec || 3);

    var t = setTimeout(function () {
        sendCachedDataToServer();

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
            return connect(()=>{});
        }

        if (sendMessageInProgress || !cache.size) return;
        sendMessageInProgress = true;

        var myCopyOfCache = Array.from(cache);
        cache.clear();
        clientIPC.send(myCopyOfCache);
        sendMessageInProgress = false;

    }, (pushIntervalSec * 1000));
    t.unref();
}