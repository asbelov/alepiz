/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../lib/log')(module);
var webSecrets = require('./webSecrets');
const thread = require("../lib/threads");
const path = require("path");

var webServerClient = {};
module.exports = webServerClient;

webServerClient.start = function (_callback) {
    var callback = function(err) {
        if(typeof _callback === 'function') return _callback(err);
        if(err) log.error(err.message)
    };

    webSecrets.checkAndCreate(function(err) {
        if (err) return callback(err);

        var webServerProcess = new thread.parent({
            childrenNumber: 1,
            childProcessExecutable: path.join(__dirname, 'webServer.js'),
            restartAfterErrorTimeout: 0,
            killTimeout: 3000,
            module: 'webServer',
        }, function (err, webServerProcess) {
            if (err) return callback(new Error('Can\'t initializing webServer process: ' + err.message));

            webServerProcess.start(function (err) {
                if (err) return callback(new Error('Can\'t run webServer process: ' + err.message));

                log.info('webServer was started');
                callback();
            });
        });

        webServerClient.stop = webServerProcess.stop;
        webServerClient.kill = webServerProcess.kill;
    });
};
