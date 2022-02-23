/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const path = require("path");
const fs = require("fs");
var log = require('../lib/log')(module);

var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confLog = new Conf('config/log.json');
const confWebServer = new Conf('config/webserver.json');
const confHistory = new Conf('config/history.json');

var newDirs = makeDirs();

var dbClient = require('../serverDB/dbClient');
var initDB = require('../models_db/createDB/createAllDB');
var history = require('../models_history/history');
var server = require('../server/counterProcessor');
var webServer = require('../serverWeb/webServerClient');
var actionServer = require('../serverActions/actionServerRunner');
var backupServer = require('../lib/dbBackup');
var taskServer = require('../serverTask/taskServerRunner');
var dynamicLog = require('../serverDebug/debugCounters');
var IPC = require('../lib/IPC');
const proc = require("../lib/proc");
const v8 = require('v8');

var stopTimeout = Number(conf.get('serviceStopTimeout')) || 120000;

start(function() {
    scheduleRestart();

    new proc.child({
        module: 'alepiz',
        onStop: onStop,
        onDisconnect: onDestroy,
        onDestroy: onDestroy,
    });
    const totalHeapSize = v8.getHeapStatistics().total_available_size;
    const totalHeapSizeGb = (totalHeapSize / 1024 / 1024 / 1024).toFixed(2);

    log.info('ALEPIZ initializing successfully, total heap size: ', totalHeapSizeGb, 'Gb');
});

function onStop(callback) {
    setTimeout(onDestroy, stopTimeout, callback);

    stop(function() {
        if(typeof callback === 'function') callback();
        callback = null;
    });
}

function onDestroy(callback) {
    if(callback) log.exit('ALEPIZ was not stopped in timeout ' + (stopTimeout / 1000) + ' sec. Exiting');
    else log.exit('Alepiz got an unplanned exit');

    log.exit('Trying stop the server...');
    server.stop(function () {});

    history.dump(function() {
        log.disconnect(function () {
            //waiting for the server to stop
            setTimeout(process.exit, 15000, 6); // process.exit(6) for search
        });
    });
    if(typeof callback === 'function') callback();
    callback = null;
    log.disconnect(function () { process.exit(2) });
}

function restart() {
    if(history.cacheServiceIsRunning()){
        log.warn('Waiting for finishing saving data to DB before restart ALEPIZ...');
        return setTimeout(restart, 15000);
    }

    log.warn('Restarting ALEPIZ...');
    stop(function() {
        start(function() {
            scheduleRestart();
        });
    });
}

function scheduleRestart() {
    var restartTime = conf.get('restartTime') ? conf.get('restartTime').split(/[^0-9]+/) : 'none';
    if(!Array.isArray(restartTime) || restartTime.length !== 2 ||
        Number(restartTime[0]) !== parseInt(String(restartTime[0]), 10) ||
        Number(restartTime[1]) !== parseInt(String(restartTime[1]), 10) ||
        restartTime[0] > 24 || restartTime[1] > 59
    ) return;

    var d = new Date();
    d.setHours(Number(restartTime[0]), Number(restartTime[1]), 0, 0);

    if(d.getTime() - Date.now() < 0) d.setDate(d.getDate() + 1);
    log.info('Next restart will be at ', d.toLocaleTimeString());
    setTimeout(restart, d.getTime() - Date.now());
}

function start(callback) {
    IPC.service();

    log.start(function(err) {
        if (err) {
            console.error(err.message);
            process.exit(127);
        }
        log.info('Starting ALEPIZ...');
        if(newDirs.length) log.warn('Creating dirs: ', newDirs.join(', '));

        log.info('Starting DB server');
        dbClient.start(function (err) {
            if (err) {
                log.exit('Error while starting dbServer: ', err.stack);
                log.disconnect(function () { process.exit(11) });
                return;
            }

            log.info('Initializing database');
            initDB(function (err) {
                if (err) {
                    log.exit('Error while initialising DataBase: ', err.stack);
                    log.disconnect(function () { process.exit(11) });
                    return;
                }

                log.info('Starting backup server');
                backupServer.start(function (err) {
                    if (err) {
                        log.exit('Error while starting backup server: ' + err.stack);
                        log.disconnect(function () { process.exit(11) });
                        return;
                    }

                    log.info('Starting history storage');
                    history.start(confHistory.get(), function (err) {
                        if (err) {
                            log.exit('Error starting history storage server: ' + err.stack);
                            log.disconnect(function () { process.exit(11) });
                            return;
                        }

                        log.info('Starting action server');
                        actionServer.start(function (err) {
                            if (err) {
                                log.exit('Error starting action server: ' + err.stack);
                                log.disconnect(function () { process.exit(11) });
                                return;
                            }

                            log.info('Starting task server');
                            taskServer.start(function (err) {
                                if (err) {
                                    log.exit('Error starting task server: ' + err.stack);
                                    log.disconnect(function () { process.exit(11) });
                                    return;
                                }

                                log.info('Starting web server');
                                webServer.start(function(err) {
                                    if (err) {
                                        log.exit('Error starting web server: ' + err.stack);
                                        log.disconnect(function () { process.exit(11) });
                                        return;
                                    }

                                    log.info('Starting dynamic log server');
                                    dynamicLog.start(function (err) {
                                        if (err) {
                                            log.exit('Error starting dynamic log: ' + err.stack);
                                            log.disconnect(function () { process.exit(11) });
                                            return;
                                        }

                                        // server must start at the end, because at first start it can't call callback
                                        // while you don't add objects and counters
                                        log.info('Starting main server process');
                                        server.start(function (err) {
                                            if (err) {
                                                log.exit('Error starting server: ' + err.stack);
                                                log.disconnect(function () { process.exit(11) });
                                                return;
                                            }


                                            log.info('All ALEPIZ components have been successfully launched');
                                            callback();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function stop(callback) {
    // waiting for a stop
    log.exit('Waiting for the history server to stop...');
    history.stop(function () {

        log.exit('Waiting for the server to stop...');
        server.stop(function () {

            log.exit('Waiting for the web server to stop...');
            webServer.stop(function() {

                log.exit('Waiting for the backup server to stop...');
                backupServer.stop(function () {

                    log.exit('Waiting for the dynamic log to stop...');
                    dynamicLog.stop(function () {

                        log.exit('Waiting for the task server to stop');
                        taskServer.stop(function () {

                            log.exit('Waiting for the action server to stop');
                            actionServer.stop(function () {

                                log.exit('Waiting for the dbServer to stop');
                                dbClient.stop(function () {

                                    log.exit('Waiting for the log server to stop...');
                                    log.stop(function () {
                                        log.exit('All services are stopped');

                                        setTimeout(callback, 500);
                                    });
                                })
                            });
                        });
                    });
                });
            });
        });
    });
}


function makeDirs() {
    var newDirs = [], dirs = confHistory.get('db').map(function (dirEnt) {
        return dirEnt.relative ? path.join(__dirname, '..', dirEnt.path) : dirEnt.path;
    });

    Array.prototype.push.apply(dirs, [
        path.join(__dirname, '..', conf.get('tempDir') || 'temp'),
        path.join(__dirname, '..', confWebServer.get('privatePath') || 'private'),
        path.join(__dirname, '..', confLog.get('dir') || 'logs'),
    ]);

    dirs.forEach(function (newDir) {
        try {
            if(!fs.existsSync(newDir)) {
                fs.mkdirSync(newDir, {recursive: true, mode: 0o700});
                newDirs.push(newDir);
            }
        } catch (e) {}
    });

    return newDirs;
}
