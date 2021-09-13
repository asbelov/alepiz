/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var activeCollector = require('./activeCollector');
var conf = require('../lib/conf');
conf.file('config/conf.json');


var server = {};
module.exports = server;


var stopServerInProgress = 0,
    startServerInProgress = 0,
    serverStarted = false,
    nextCommand = {},
    killTimeout = 15000,
    activeCollectors = new Map();


server.start = function (callback) { startServer('Initial start server', callback); }
server.stop = function (callback) { stopServer('Receiving request for stop server', callback) };

server.connect = function (callback) {
    if (typeof callback !== 'function') callback = function (err) { if(err) log.error(err.message); }

    async.each(Array.from(activeCollectors.keys()), activeCollector.connect, callback);
};

// sending all messages to servers
server.sendMsg = function (message, callback) {
    log.debug('Sending message to servers: ', message);
    activeCollectors.forEach(function (collectorProcess) {
        collectorProcess.sendMsg(message, callback);
    });
};

server.disconnect = activeCollector.disconnect;

function startServer(message, callback) {
    if (stopServerInProgress) {
        log.warn('Try to start server but stop server in progress since ', (new Date(stopServerInProgress)).toLocaleString(),'. Start server message: ', message);
        nextCommand = {
            message: message,
            callback: callback,
            type: 'startServer',
        };
        return;
    }
    if (serverStarted) {
        log.warn('Try to start server but server already started. Start server message: ', message);
        return;
    }

    if (startServerInProgress) {
        log.warn('Try to start server but start server in progress since ', (new Date(startServerInProgress)).toLocaleString(),'. Start server message: ', message);
        nextCommand = {
            message: message,
            callback: callback,
            type: 'startServer',
        };
        return;
    }
    startServerInProgress = Date.now();
    log.info('Starting all active collectors: ', message);
    activeCollector.startAll(killTimeout, onExitCollector, function (err, _activeCollectors) {
        if(err) return callback(err);
        activeCollectors = _activeCollectors; // new Map()

        if (nextCommand.type === 'stopServer') stopServer(nextCommand.message, nextCommand.callback, nextCommand.isQuiet);
    });

    function onExitCollector(collectorName) {
        activeCollector.startCollector(collectorName, killTimeout, onExitCollector, function (err, collectorProcess) {
            if(err) return callback(err);
            activeCollectors.set(collectorName, collectorProcess);
        });
    }
}

function stopServer(message, callback, isQuiet) {
    if (startServerInProgress) {
        log.warn('Try to stop server but start server in progress since ', (new Date(startServerInProgress)).toLocaleString(), '. Stop server message: ', message);
        nextCommand = {
            message: message,
            callback: callback,
            isQuiet: isQuiet,
            type: 'stopServer',
        };
        return;
    }

    if(stopServerInProgress) {
        log.warn('Try to stop server but stop server in progress since ', (new Date(stopServerInProgress)).toLocaleString(), '. Stop server message: ', message);
        nextCommand = {
            message: message,
            callback: callback,
            isQuiet: isQuiet,
            type: 'stopServer',
        };
        return;
    }
    stopServerInProgress = Date.now();

    log.warn('Terminating collectors: ', Array.from(activeCollectors.keys()).join(', '));
    if (!isQuiet) log.exit('Terminating collectors: ', Array.from(activeCollectors.keys()).join(', '));
    async.each(Array.from(activeCollectors.keys()), function (collectorName, callback) {
        var activeCollector = activeCollectors.get(collectorName);
        if (!activeCollector || typeof activeCollector.stop !== 'function') return callback();
        activeCollector.stop(function (err) {
            if (err) {
                log.error('Error while terminating ', activeCollector.type, ' collector ' + collectorName + ': ', err.message);
                if (!isQuiet) log.exit('Error while terminating ', activeCollector.type, ' collector ' + collectorName + ': ', err.message);
            } else {
                log.warn('Successfully terminated ', activeCollector.type, ' collector ', collectorName);
                if (!isQuiet) log.exit('Successfully terminated ', activeCollector.type, ' collector ', collectorName);
            }

            callback();
        });
    }, callback);
}