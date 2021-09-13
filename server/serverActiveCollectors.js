/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var path = require('path');
var async = require('async');

var log = require('../lib/log')(module);
var threads = require('../lib/threads');
var collectorsCfg = require('../lib/collectors');
var conf = require('../lib/conf');
const proc = require("../lib/proc");
conf.file('config/conf.json');

var activeCollector = {};
module.exports = activeCollector;

var collectors = {};

if(proc.isMainThread) initServerCommunication();
else runCollector.apply(this, threads.workerData); //standalone thread

activeCollector.startAll = function (callback) {
    collectorsCfg.get(null, function (err, _collectorsObj) {
        if (err) return callback(err);

        collectors = _collectorsObj;

        async.eachOf(collectors, function (collectorCfg, collectorName, callback) {
            // it is not the same as a separate collector. This means that we can receive data from the collector once at a time.
            if (!collectorCfg.active && !collectorCfg.separate || collectorCfg.exclusiveProcess) return callback();

            startCollector(collectorName, function (err, collectorProcess) {
                if (err) { // don't exit if collector is not started
                    log.error('Error starting active collector ', collectorName, ': ' , err.message);
                    return callback();
                }

                collectors.stop = collectorProcess.stop;
                collectors.kill = collectorProcess.kill;

                log.info('Starting ', (collectorCfg.active ? 'active' : 'separate') ,' collector ', collectorName, ' successfully');
                callback();
            });
        }, callback);
    });
}

activeCollector.stopAll = function (callback) {
    async.eachOf(collectors, function (collectorCfg, collectorName, callback) {
        // it is not the same as a separate collector. This means that we can receive data from the collector once at a time.
        if (!collectorCfg.active && !collectorCfg.separate || collectorCfg.exclusiveProcess) return callback();

        if (typeof collectors.stop === 'function') collectors.stop(callback);
    }, callback);
}

function startCollector(collectorName, callback) {
    new threads.parent({
        childProcessExecutable: __filename,
        args: [collectorName],
        childrenNumber: 1,
        module: collectorName,
    }, function(err, collectorProc) {
        if(err) {
            delete collectors[serverAddress + ':' + port];
            return callback(new Error('Error occurred while initializing active collector ' +
                collectorName + ': ' + err.message));
        }

        collectorProc.start(function(err) {
            callback(err, {
                stop: collectorProc.stop,
                kill: collectorProc.kill,
            });
        });
    })
}

function runCollector(collectorName) {
    var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), collectorName, 'collector.js');

    try {
        log.info('Attaching new collector ', collectorName, ': ', collectorPath );
        var collector = require(collectorPath);
    } catch (err) {
        log.error('Error attaching active collector ', collectorName,' code ', collectorPath, ': ', err.message);
    }

    new threads.child({
        module: 'collectorName',
        onMessage: processMessage,
        onStop: function (callback) {
            log.warn('Stopping ' + collectorName);

            if(typeof collector.destroy === 'function') collector.destroy(callback);
            else callback();
        },
        onDestroy: collector.destroy,
    });

    function processMessage(message, callback) {
        if(!message || typeof collector[message.type] !== 'function') {
            log.warn('Unknown active collector or message for ', collectorName, ': ', message);
            return callback();
        }

        // don't use try{}  catch(e){} around collector to speed up
        if (message.data !== undefined) collector[message.type](message.data, callback);
        else collector[message.type](callback);
    }
}