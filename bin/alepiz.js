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

const defaultStopTimeout = 180000;

console.log((new Date()).toLocaleString(), 'Starting ALEPIZ... (', process.pid, ')');

new proc.parent({
    childrenNumber: 1,
    childProcessExecutable: path.join(__dirname, '..', 'lib', 'alepizRunner.js'),
    restartAfterErrorTimeout: 10000,
    killTimeout: (conf.get('serviceStopTimeout') || 120000) + 30000,
    module: 'alepiz',
}, function (err, alepizProcess) {
    if(err) return log.throw('Can\'t initializing Alepiz: ' + err.message);

    service.run (function() {
        const stopTimeout = Number(conf.get('serviceStopTimeout')) || defaultStopTimeout;
        var t = setTimeout(function() {
            log.exit('ALEPIZ was not stopped in timeout ' + (stopTimeout / 1000) + ' sec. Exiting');
        }, stopTimeout + 60000);
        t.unref();

        alepizProcess.stop(function () {
            setTimeout(process.exit, 10000, 6);
            service.stop(0);
        });
    });

    alepizProcess.start(function (err) {
        if(err) return log.throw('Can\'t initializing Alepiz: ' + err.message);

        console.log((new Date()).toLocaleString(), 'Alepiz started successfully (', process.pid, ')');
    });
});