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

// sending all messages to active collectors
counterProcessor.sendMsg = function(message) {
    collectorsCfg.getConfiguration(null, function (err, collectorsObj) {
        if (err) {
            return log.error('Can\'t get collectors configuration for send message to active collector servers: ',
                err.message, '; message: ', message);
        }

        var messageAlreadySent = {}, callbackAlreadyCalled = {};

        // async.eachOfSeries is required to send messages one after the other.
        // To avoid sending a message to the same collector[hostPort] several times.
        async.eachOfSeries(collectorsObj, function (collectorCfg, collectorName, callback) {
            // don't send message to not active, not separate collectors
            if (!collectorCfg.active && !collectorCfg.separate) return callback();

            activeCollector.connect(collectorName, function (err, collector) {
                // don't send message again and dont call callback() after reconnect to collector
                if(callbackAlreadyCalled[collectorName]) return;
                // set to true before calling callback
                callbackAlreadyCalled[collectorName] = true;

                // don't send message to collectors for whom the message was sent earlier
                if (messageAlreadySent[collector.hostPort]) return callback();

                if (err) {
                    log.error('Can\'t connect to active collector ', collectorName, ' for send message: ', err.message,
                        '; message: ', message);
                    return callback();
                }

                collector.sendToServer({
                    server: message,
                });
                messageAlreadySent[collector.hostPort] = true;
                callback();
            });
        }, function () {
            log.info('Complete sending message to active collectors: ', Object.keys(messageAlreadySent).join(', '),
                '; message: ', message);
        });
    });
};