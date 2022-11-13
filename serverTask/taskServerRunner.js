/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const thread = require("../lib/threads");
const Conf = require('../lib/conf');
const confTaskServer = new Conf('config/taskServer.json');

const taskServer = {
    start: taskServerStart,
    stop: function(callback) { if(typeof callback === 'function') callback() },
};
module.exports = taskServer;


function taskServerStart(callback) {
    if(!confTaskServer.get() || confTaskServer.get('disable')) {
        log.warn('Task server is not configured or disabled in configuration. Server not started');
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

        log.info('Starting task server thread');

        taskServerProcess.start(function (err) {
            if (err) return callback(new Error('Can\'t start task server: ' + err.message));

            taskServer.stop = taskServerProcess.stop;
            callback();
        });
    });
}