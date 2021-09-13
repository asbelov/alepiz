/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const collectorsCfg = require("../lib/collectors");
const async = require("async");
const activeCollector = require("../lib/activeCollector");
const path = require("path");
const conf = require("../lib/conf");
conf.file('config/conf.json');

var isConnectingToCollectors = 0;
var collectors = {};

module.exports = {
    connect: attachCollectors,
    destroy: destroyCollectors,
};

function attachCollectors(callback) {

    // already connected
    if(isConnectingToCollectors === 2) return callback();
    // connection in progress
    if(isConnectingToCollectors === 1) return setTimeout(attachCollectors, 1000, callback);

    isConnectingToCollectors = 1;
    collectorsCfg.get(null, function(err, collectorsObj) {
        if (err) {
            isConnectingToCollectors = 0;
            destroyCollectors(function() {
                callback(new Error('Can\'t get collectors: ' + err.nessage));
            })
        }

        log.debug('Collectors: ', collectorsObj);
        var callbackAlreadyCalled = {};

        async.each(Object.keys(collectorsObj), function (name, callback) {

            if(collectorsObj[name].active || collectorsObj[name].separate) {
                activeCollector.connect(name, function(err, collector) {
                    // don't use return callback because error can occurred several times
                    if(err) return log.error('Can\'t connect to collector ', name, ': ', err.message);

                    for(var key in collector) {
                        collectorsObj[name][key] = collector[key];
                    }

                    // don't call callback again when reconnect to collector
                    if(!callbackAlreadyCalled[name]) {
                        callbackAlreadyCalled[name] = true;
                        callback();
                    }
                    log.debug('Connected to ', (collectorsObj[name].active ? 'active' : 'separate'), ' collector: ', name, ': OK');
                });
                return;
            }

            var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), name, 'collector');

            // empty require cache for collector
            if (require.cache[require.resolve(collectorPath)]) delete require.cache[require.resolve(collectorPath)];

            try {
                var collector = require(collectorPath);
                for(var key in collector) {
                    collectorsObj[name][key] = collector[key];
                }
                log.debug('Attaching passive collector ', name, ': OK');
            } catch (err) {
                log.error('Error attaching to passive collector ' + name + ': ' + err.message);
            }
            callback();
        }, function (err) {
            if(err) {
                isConnectingToCollectors = 0;
                destroyCollectors(function() {
                    callback(new Error('Can\'t get collectors: ' + err.nessage));
                })
            }
            isConnectingToCollectors = 2;
            callback(err, collectorsObj);
        });
    });
}

function destroyCollectors(callback) {
    log.warn('Destroying child with PID: ', process.pid);

    // destroy collectors, with 'destroy' function
    async.each(Object.keys(collectors), function (name, callback) {

        // don\'t destroy active and separate collectors. it destroyed from server
        if (collectors[name].active || collectors[name].separate ||
            !collectors[name].destroy || typeof collectors[name].destroy !== 'function') return callback();

        log.debug('Collector ', name, ' has a destroy method, destroying collector: ', collectors[name]);
        collectors[name].destroy(function (err) {
            if (err) log.warn('Error destroying collector ', name, ': ', err.message);
            else log.warn('Collector ', name, ' was destroyed');

            callback();
        });
    }, callback); // error is not returned
}
