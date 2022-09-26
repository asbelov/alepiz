/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created by Alexander Belov on 11.10.2015.
 */

const log = require('../lib/log')(module);
const async = require('async');
const activeCollector = require('./activeCollector');
const collectorsCfg = require("../lib/collectors");


var counterProcessor = {};
module.exports = counterProcessor;

var activeCollectors = {};

counterProcessor.connect = function(callback) {
    if(Object.keys(activeCollectors).length) return callback();

    collectorsCfg.getConfiguration(null, function (err, collectorsObj) {
        if (err) return callback(err);

        async.eachOf(collectorsObj, function (collectorCfg, collectorName, callback) {
            // it is not the same as a separate collector. This means that we can receive data from the collector once at a time.
            if (!collectorCfg.active && !collectorCfg.separate) return callback();

            activeCollector.connect(collectorName, function (err, collector) {
                if (err) log.error('Can\'t connect to collector ', collectorName, ': ', err.message);
                else activeCollectors[collector.hostPort] = collector;
                callback();
            });
        }, function () {
            log.info('Complete connecting to active collectors: ', Object.keys(activeCollectors));
            callback();
        });
    });
};

// sending all messages to servers
counterProcessor.sendMsg = function(message) {
    counterProcessor.connect(function () {
        for(var hostPort in activeCollectors) {
            activeCollectors[hostPort].sendToServer({
                server: message,
            });
        }
    });
};