/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

// starting dbServer thread
const log = require('../lib/log')(module);
const thread = require("../lib/threads");
const path = require("path");
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');

var dbServer = {
    stop: function(callback) {
        log.info('DB Server was not initialized for stop');
        callback()
    },
};

module.exports = dbServer;

dbServer.start = function (callback) {
    var cfg = confSqlite.get(); // configuration for each module

    if(cfg.disableServer) {
        log.info('dbServer is disabled in configuration and not started');
        return callback();
    }

    new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'dbServerRouter.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 3000,
        module: 'dbServer',
    }, function(err, dbServerProcess) {
        if(err) return callback(new Error('Can\'t initializing dbServer process: ' + err.message));

        dbServerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run dbServer process: ' + err.message));

            dbServer.stop = dbServerProcess.stop;
            log.info('dbServer was started: ', cfg);
            callback();
        });
    });
};