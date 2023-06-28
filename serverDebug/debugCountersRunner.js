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


/**
 * Starting Debugger child process and IPC system
 * @param {function(Error)} [_callback] callback(err)
 * @return {*}
 */
debugCountersRunner.start = function (_callback) {
    var callback = function(err) {
        if(typeof _callback === 'function') return _callback(err);
        if(err) log.error(err.message)
    };

    if(alwaysDisable) {
        log.info('Debugger is disabled in the configuration and can\'t be started after a configuration change ' +
            'without restart ALEPIZ');
        return callback();
    }

    var counterDebuggerProcess = new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'debugCountersServer.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 20000,
        module: 'Debugger',
    }, function(err, counterDebuggerProcess) {
        if(err) return callback(new Error('Can\'t initializing counterDebugger process: ' + err.message));

        counterDebuggerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run counterDebugger process: ' + err.message));

            log.info('Debugger server has been started ',
                (isDisableNow ? 'and is waiting to be enabled in configuration: ' : ': '), confDebugServer.get());
            callback();
        });
    });

    debugCountersRunner.stop = counterDebuggerProcess.stop;
    debugCountersRunner.kill = counterDebuggerProcess.kill;
};