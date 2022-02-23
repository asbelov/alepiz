/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../lib/log')(module);
const path = require('path');
const proc = require("../lib/proc");

var actionServer = {};
module.exports = actionServer;

// will initialize after server start
actionServer.stop = function(callback) { callback();  };
actionServer.start = function (_callback) {

    var callback = function(err) {
        if(typeof _callback === 'function') return _callback(err);
        if(err) log.error(err.message);
    };

    new proc.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'actionServer.js'),
        restartAfterErrorTimeout: 1000, // was 500
        killTimeout: 1000,
        module: 'actionServer',
    }, function (err, actionServerProcess) {
        if(err) return callback(new Error('Can\'t initializing action server: ' + err.message));

        actionServerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run action server: ' + err.message));

            actionServer.stop = actionServerProcess.stop;
            callback();
        });
    });
};
