/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const thread = require("../lib/threads");
const path = require("path");

var logServer = {
    stop: function(callback) {
        log.info('Log server was not initialized for stop');
        callback()
    },
    kill: function () {
        log.info('Log server was not initialized for kill');
    },
};

module.exports = logServer;

/**
 * Starting log server
 *
 * @param {function(Error)|function()} callback callback(err) function will be called after the log server is started
 */
logServer.start = function (callback) {
    new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'logServer.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 300,
        module: 'log',
    }, function(err, logServerProcess) {
        if(err) return callback(new Error('Can\'t initializing logServer: ' + err.message));

        logServerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run logServer: ' + err.message));

            /**
             * Stopping log server
             * @param {function()} callback callback(err) function will be called after the log server is stopped
             */
            logServer.stop = logServerProcess.stop;

            /**
             * Killing log server
             */
            logServer.kill = logServerProcess.kill;

            log.info('logServer was started');
            callback();
        });
    });
};