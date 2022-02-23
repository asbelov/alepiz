/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var path = require('path');

// for Windows service.
// Default working directory is windows\system32, __dirname is the directory name of the current module (alepiz.js)
process.chdir(path.join(__dirname, '..'));

var installService = require('../lib/installService');
if(installService.init()) return;

var service = require('os-service');

var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');

var log = require('../lib/log')(module);
const proc = require("../lib/proc");

console.log('Starting ALEPIZ... (', process.pid, ')');

new proc.parent({
    childrenNumber: 1,
    childProcessExecutable: path.join(__dirname, '..', 'lib', 'alepizRunner.js'),
    restartAfterErrorTimeout: 10000,
    killTimeout: (conf.get('serviceStopTimeout') || 120000) + 30000,
    module: 'alepiz',
}, function (err, alepizProcess) {
    if(err) return log.throw('Can\'t initializing Alepiz: ' + err.message);

    service.run (function() {
        alepizProcess.stop(function () {
            service.stop(0);
        });
    });

    alepizProcess.start(function (err) {
        if(err) return log.throw('Can\'t initializing Alepiz: ' + err.message);

        console.log('Alepiz started successfully (', process.pid, ')');
    });
});
