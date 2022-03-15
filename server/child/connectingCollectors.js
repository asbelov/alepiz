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

var isConnectingToCollectors = 0

module.exports = connectingCollectors;

function connectingCollectors(callback) {

    // already connected
    if(isConnectingToCollectors === 2) return callback();
    // connection in progress
    if(isConnectingToCollectors === 1) return setTimeout(connectingCollectors, 1000, callback);

    isConnectingToCollectors = 1;
    collectors.get(null, function(err, collectorsObj) {
        if (err) {
            isConnectingToCollectors = 0;
            callback(new Error('Can\'t get collectors: ' + err.nessage));
        }

        log.debug('Collectors: ', collectorsObj);
        var callbackAlreadyCalled = {};

        async.each(Object.keys(collectorsObj), function (collectorName, callback) {

            if(collectorsObj[collectorName].active || collectorsObj[collectorName].separate) {
                activeCollector.connect(collectorName, function(err, collector) {
                    // don't use return callback because error can occur several times
                    if(err) return log.error('Can\'t connect to collector ', collectorName, ': ', err.message);

                    for(var key in collector) {
                        collectorsObj[collectorName][key] = collector[key];
                    }

                    // don't call callback again when reconnect to collector
                    if(!callbackAlreadyCalled[collectorName]) {
                        callbackAlreadyCalled[collectorName] = true;
                        callback();
                    }
                    log.debug('Connected to ', (collectorsObj[collectorName].active ? 'active' : 'separate'), ' collector: ', collectorName, ': OK');
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
                return callback(new Error('Can\'t get collectors: ' + err.nessage));
            }
            isConnectingToCollectors = 2;
            callback(null, collectorsObj);
        });
    });
}

