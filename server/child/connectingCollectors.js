/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const collectors = require("../../lib/collectors");
const async = require("async");
const activeCollector = require("../activeCollector");
const path = require("path");
const runInThread = require("../../lib/runInThread");
const Conf = require("../../lib/conf");
const confCollectors = new Conf('config/collectors.json');

var isConnectingToCollectors = 0, callbacks = [];

module.exports = connectingCollectors;

function connectingCollectors(callback) {

    // already connected
    if(isConnectingToCollectors === 2) return callback();
    callbacks.push(callback);

    // connection in progress
    if(isConnectingToCollectors === 1) return;

    isConnectingToCollectors = 1;
    collectors.getConfiguration(null, function(err, collectorsObj) {
        if (err) {
            isConnectingToCollectors = 0;
            callbacks.forEach(callback => callback(new Error('Can\'t get collectors configuration: ' + err.nessage)));
            callbacks = [];
        }

        log.debug('Collectors: ', collectorsObj);

        async.each(Object.keys(collectorsObj), function (collectorName, callback) {

            if(collectorsObj[collectorName].active || collectorsObj[collectorName].separate) {
                activeCollector.connect(collectorName, function(err, collector) {
                    // don't use return callback because error can occur several times
                    if(err) callback(new Error('Can\'t connect to collector ' + collectorName + ': ' + err.message));
                    collectorsObj[collectorName] = collector;
                    callback();
                });
                return;
            }

            var collectorPath = path.join(__dirname, '..', '..', confCollectors.get('dir'), collectorName, 'collector');

            if (collectorsObj[collectorName].runCollectorAsThread) {
                //log.info('Starting passive collector ', collectorName, ' in thread: ', collectorPath);
                runInThread(collectorPath, null,function (err, collectorObj) {
                    if (err) {
                        log.error('Error starting passive collector ', collectorName, ' code ', collectorPath,
                            ' as a thread: ', err.message);
                    } else collectorsObj[collectorName] = collectorObj.func;
                    callback();
                });
            } else {
                // empty require cache for collector
                if (require.cache[require.resolve(collectorPath)]) delete require.cache[require.resolve(collectorPath)];
                try {
                    //log.info('Attaching passive collector ', collectorName, ': ', collectorPath);
                    collectorsObj[collectorName] = require(collectorPath);
                } catch (err) {
                    log.error('Error attaching passive collector ', collectorName, ' code ', collectorPath, ': ', err.message);
                }
                return callback();
            }

        }, function (err) {
            if(err) {
                isConnectingToCollectors = 0;
                callbacks.forEach(callback => callback(new Error('Can\'t connect to collectors: ' + err.nessage)));
                callbacks = [];
                return;
            }
            isConnectingToCollectors = 2;
            callbacks.forEach(callback => callback(null, collectorsObj));
            callbacks = [];
        });
    });
}