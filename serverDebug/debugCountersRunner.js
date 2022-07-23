/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../lib/log')(module);
const thread = require("../lib/threads");
const path = require("path");
var Conf = require('../lib/conf');
const confDebugServer = new Conf('config/debugServer.json');



var debugCountersRunner = {
    stop: function(callback) {callback()},
    kill: function () {},
};

var isDisableNow = confDebugServer.get().disable,
    alwaysDisable = confDebugServer.get().alwaysDisable;

module.exports = debugCountersRunner;


// starting counterDebugger child process and IPC system
debugCountersRunner.start = function (_callback) {
    var callback = function(err, isCounterDebuggerExit) {
        if(typeof _callback === 'function') return _callback(err, isCounterDebuggerExit);
        if(err) log.error(err.message)
    };

    if(alwaysDisable) {
        log.info('Counter debugger is disabled in the configuration and can\'t be started after a configuration change without restart ALEPIZ');
        return callback();
    }

    var counterDebuggerProcess = new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'debugCountersServer.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 20000,
        module: 'counterDebugger',
    }, function(err, counterDebuggerProcess) {
        if(err) return callback(new Error('Can\'t initializing counterDebugger process: ' + err.message));

        counterDebuggerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run counterDebugger process: ' + err.message));

            log.info('Counter debugger server has been started ',
                (isDisableNow ? 'and is waiting to be enabled in configuration: ' : ': '), confDebugServer.get());
            callback();
        });
    });

    debugCountersRunner.stop = counterDebuggerProcess.stop;
    debugCountersRunner.kill = counterDebuggerProcess.kill;
};