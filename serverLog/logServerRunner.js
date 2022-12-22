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

logServer.start = function (_callback) {
    var callback = function(err, isLogServerExit) {
        if(typeof _callback === 'function') return _callback(err, isLogServerExit);
        if(err) log.error(err.message);
    };

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

            logServer.stop = logServerProcess.stop;
            logServer.kill = logServerProcess.kill;

            log.info('logServer was started');
            callback();
        });
    });
};