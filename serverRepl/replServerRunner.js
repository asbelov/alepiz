/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const path = require('path');
const thread = require("../lib/threads");
const Conf = require('../lib/conf');

const replServer = {
    start: replServerStart,
    stop: function(callback) { if(typeof callback === 'function') callback() },
};
module.exports = replServer;


function replServerStart(callback) {

    new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'replServer.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        module: 'replServer',
    }, function (err, replServerProcess) {
        if (err) return callback(new Error('Can\'t initializing replication server: ' + err.message));

        log.info('Starting replication server thread');

        replServerProcess.start(function (err) {
            if (err) return callback(new Error('Can\'t start replication server: ' + err.message));

            replServer.stop = replServerProcess.stop;
            callback();
        });
    });
}