/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const thread = require("../lib/threads");
const Conf = require('../lib/conf');
const confTaskServer = new Conf('config/taskServer.json');

var cfg = confTaskServer.get();

const taskServer = {};
module.exports = taskServer;

// before init real stop function
taskServer.stop = function(callback) {
    callback()
};

taskServer.start = function (callback) {
    if(!cfg) {
        log.warn('Task server is not configured. Server not started');
        return callback();
    }

    new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'taskServer.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        module: 'taskServer',
    }, function (err, taskServerProcess) {
        if (err) return callback(new Error('Can\'t initializing task server: ' + err.message));

        log.info('Starting task server process');

        taskServerProcess.start(function (err) {
            if (err) return callback(new Error('Can\'t start task server: ' + err.message));

            taskServer.stop = taskServerProcess.stop;
            callback();
        });
    });
}
