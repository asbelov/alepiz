/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const webSecrets = require('./webSecrets');
const thread = require("../lib/threads");
const path = require("path");
const Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');


var webServerRunner = {
    start: webServerStart,
    stop: function (callback) { if(typeof callback === 'function') return callback(); },
    kill: function (callback) { if(typeof callback === 'function') return callback(); },
};

module.exports = webServerRunner;

function webServerStart (callback) {
    if(confWebServer.get('disable')) {
        log.info('The web server has been disabled in the configuration');
        return callback();
    }

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

        webServerRunner.stop = webServerProcess.stop;
        webServerRunner.kill = webServerProcess.kill;
    });
}
