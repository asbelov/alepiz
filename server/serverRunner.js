/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created by Alexander Belov on 11.10.2015.
 */

const log = require('../lib/log')(module);
const async = require('async');
const activeCollector = require('./activeCollector');
const Conf = require("../lib/conf");
const confServer = new Conf('config/server.json');


var serverRunner = {};
module.exports = serverRunner;

// not less than 3000 (child diff for killTimeout)
// this timeout also is a sleep time between stop and start when restart occurred
//var killTimeout = 7000; //was before 17.12.2020. did not have time to save update events to file
var killTimeout = 15000;

var activeCollectors = {},
    separateCollectors = {},
    stopServerInProgress = 0,
    startServerInProgress = 0,
    serverStarted = false,
    startServerDelayTimer,
    stopServerDelayTimer;

serverRunner.start = function (callback) { startServer('Initial start server', callback); }
serverRunner.stop = function(callback) { stopServer('Receiving request for stop server', callback) };


function startServer(message, callback) {
    if(confServer.get('disable')) {
        log.info('The counter processor server has been disabled in the configuration');
        return callback();
    }

    if(startServerInProgress || serverStarted) return;
    if(stopServerInProgress) {
        if(Date.now() - stopServerInProgress > 120000) {
            log.error('The stop server process took too long. Let\'s try to start the server...');
            if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
            stopServerInProgress = 0;
        } else {
            log.warn('A request was received to start the server, but a server stop operation is in progress. ' +
                'Start the server later for "', message, '"');
            if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
            startServerDelayTimer = setTimeout(startServer, 15000, message, callback);
            return;
        }
    }
    if (startServerDelayTimer) clearTimeout(startServerDelayTimer);
    startServerInProgress = Date.now();

    var startTimeout = 0;
    if(!callback) { // server restarted
        startTimeout = killTimeout + 1000;
        log.warn('Waiting while all socket are closed and all processes are killed...');
    }

    setTimeout(function () {
        log.info('Starting active collectors for operation "', message, '"');
        activeCollector.startAll(killTimeout, function(collectorName) {
            stopServer('Active collector '+ collectorName + ' terminated unexpectedly', function() {
                startServer('Active collector '+ collectorName + ' terminated unexpectedly');
            });
        },function (err, _activeCollectors, _separateCollectors) {
            activeCollectors = _activeCollectors;
            separateCollectors = _separateCollectors;
            if (err) return log.error(err.message);

            startServerInProgress = 0;
            serverStarted = true;
            startServerDelayTimer = null;
            if (typeof callback === "function") callback(err);
        });
    }, startTimeout);
}

function stopServer(message, callback, isQuiet) {
    if(confServer.get('disable')) return callback();

    if(stopServerInProgress) return;
    if(startServerInProgress) {
        if(Date.now() - startServerInProgress > 60000) {
            log.error('The server startup process took too long. Let\'s try to stop the server...');
            if (isQuiet) log.exit('The server startup process took too long. Let\'s try to stop the server...');
            if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
            startServerInProgress = 0;
        } else {
            if (!isQuiet) log.exit('A request was received to stop the server, but a server start operation is in progress. ' +
                'Stop the server later for: "', message, '"');
            log.warn('A request was received to stop the server, but a server start operation is in progress. ' +
                'Stop the server later for "', message, '"');
            if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
            stopServerDelayTimer = setTimeout(stopServer, 10000, message, callback);
            return;
        }
    }
    if (stopServerDelayTimer) clearTimeout(stopServerDelayTimer);
    stopServerInProgress = Date.now();

    log.warn(message + '. Terminating server...');
    if(!isQuiet) log.exit(message + '. Terminating server...');

    async.parallel([
        function (callback) {
            stopActiveAndSeparateCollectors(activeCollectors, 'active', isQuiet, callback);
        },
        function (callback) {
            stopActiveAndSeparateCollectors(separateCollectors, 'separate', isQuiet, callback);
        }
    ],function () {
        stopServerInProgress = 0;
        serverStarted = false;
        stopServerDelayTimer = null;
        if (typeof callback === 'function') callback();
    });
}

function stopActiveAndSeparateCollectors(collectors, type, isQuiet, callback) {
    log.warn('Terminating ', type,' collectors: ', Object.keys(collectors).join(', '));
    if(!isQuiet) log.exit('Terminating ', type,' collectors: ', Object.keys(collectors).join(', '));
    async.eachOf(collectors, function(collector, name, callback) {
        if(!collector || typeof collector.stop !== 'function') return callback();
        collector.stop(function(err) {
            if(err) {
                log.error('Error while terminating ', type, ' collector ' + name + ': ', err.message);
                if(!isQuiet) log.exit('Error while terminating ', type, ' collector ' + name + ': ', err.message);
            } else {
                log.warn('Successfully terminated ', type ,' collector ', name);
                if(!isQuiet) log.exit('Successfully terminated ', type ,' collector ', name);
            }

            if(typeof callback === 'function') callback();
        });
    }, callback);
}
