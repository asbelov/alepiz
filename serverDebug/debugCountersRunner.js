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

module.exports = debugCountersRunner;

/**
 * Starting Debugger child process and IPC system
 * @param {function(Error)|function()} callback callback(err)
 */
debugCountersRunner.start = function (callback) {
    /**
     *
     * @type {{
     *      alwaysDisable: Boolean,
     *      isDisableNow: Boolean
     * }}
     */
    var cfg = confDebugServer.get()

    if(cfg.alwaysDisable) {
        log.info('Debugger is disabled in the configuration and can\'t be started after a configuration change ' +
            'without restart ALEPIZ');
        return callback();
    }

    var counterDebuggerThread = new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'debugCountersServer.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 20000,
        module: 'Debugger',
    }, function(err, counterDebuggerProcess) {
        if(err) return callback(new Error('Can\'t initializing counterDebugger thread: ' + err.message));

        counterDebuggerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run counterDebugger thread: ' + err.message));

            log.info('Debugger server has been started ',
                (cfg.isDisableNow ? 'and is waiting to be enabled in configuration: ' : ': '), confDebugServer.get());
            callback();
        });
    });

    debugCountersRunner.stop = counterDebuggerThread.stop;
    debugCountersRunner.kill = counterDebuggerThread.kill;
};