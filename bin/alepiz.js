/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var path = require('path');
var fs = require('fs');
// for windows service.
// Default working directory is windows\system32, __dirname is the directory name of the current module (www.js)
process.chdir(path.join(__dirname, '..'));

var service = require('os-service');

var log = require('../lib/log')(module);
var initDB = require('../models_db/createDB/createAllDB');
var history = require('../models_history/history');
var replicationServer = require('../lib/replicationServer');
var server = require('../lib/server');
var webServer = require('../lib/webServer');
var actionServer = require('../lib/actionServer');
var backupServer = require('../lib/dbBackup');
var taskServer = require('../lib/taskServer');
var dynamicLog = require('../lib/dynamicLog');

var conf = require('../lib/conf');
conf.file('config/conf.json');

service.run (function () {
    setTimeout(function() {
        log.exit('Service was not stopped in timeout. Exiting');

        history.dump(function() {
            process.exit(6); // for simple searching process.exit(6)
        });
    }, conf.get('serviceStopTimeout') || 120000);

    stop(function() {
        service.stop(0);
    });
});


/*
  Command line:
  --install, -i - install service
  --remove, -r - remove service
*/
var serviceName = conf.get('serviceName') || 'ALEPIZ';
if (process.argv[2] === "--install" || process.argv[2] === "-i") {
    var options = {
        displayName: conf.get('serviceDisplayName') || 'ALEPIZ',
        nodePath: path.isAbsolute(conf.get('nodePath')) ? conf.get('nodePath') : path.join(__dirname, '..', conf.get('nodePath')),
        nodeArgs: ['--experimental-worker', '--expose-gc', '--max-old-space-size='+String(conf.get('maxMemSize') || 4096)],
        programArgs: ["--runAsService"], // if this argument passed, then program running as service
    };

    service.add (serviceName, options, function(err) {
        if (err) console.error('Error while install service', serviceName, ': ', err);
        else console.log('Service', serviceName,'installed successfully');

        process.exit(0);
    });
} else if (process.argv[2] === "--remove" || process.argv[2] === "-r") {
    service.remove (serviceName, function(err) {
        if (err) console.error('Error while remove service', serviceName, ': ', err);
        else console.log('Service', serviceName,'removed successfully');

        process.exit(0);
    });
} /* else if (process.argv[2] === "--run") {// Run service program code...} else {// Show usage...}*/

start(function() {
    scheduleRestart();
    log.info('ALEPIZ initializing successfully');
});


function restart() {
    if(history.cacheServiceIsRunning()){
        log.warn('Waiting for finishing saving data to DB before restart ALEPIZ');
        return setTimeout(restart, 60000);
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
    log.start(function(err) {
        if (err) {
            console.error(err.message);
            process.exit(127);
        }

        log.info('Starting ALEPIZ: initializing database');
        initDB(function (err) {
            if (err) {
                log.exit('Error while initialising DataBase: ', err.stack);
                setTimeout(function () {
                    process.exit(11);
                }, 3000);
                return;
            }

            log.info('Starting replication server');
            replicationServer.start(function(err) {
                if (err) {
                    log.exit('Error while starting replication server: ' + err.stack);
                    setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                        process.exit(11);
                    }, 1000);
                    return;
                }

                log.info('Starting backup server');
                backupServer.start(function (err) {
                    if (err) {
                        log.exit('Error while starting backup server: ' + err.stack);
                        setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                            process.exit(11);
                        }, 1000);
                        return;
                    }

                    log.info('Starting history storage');
                    history.start(conf.get('history'), function (err) {
                        if (err) {
                            log.exit('Error starting history storage server: ' + err.stack);
                            setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                                process.exit(11);
                            }, 1000);
                            return;
                        }

                        log.info('Starting action server');
                        actionServer.start(function (err) {
                            if (err) {
                                log.exit('Error starting action server: ' + err.stack);
                                setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                                    process.exit(11);
                                }, 1000);
                                return;
                            }

                            log.info('Starting task server');
                            taskServer.start(function (err) {
                                if (err) {
                                    log.exit('Error starting task server: ' + err.stack);
                                    setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                                        process.exit(11);
                                    }, 1000);
                                    return;
                                }

                                log.info('Starting web server');
                                webServer.start(function(err) {
                                    if (err) {
                                        log.exit('Error starting web server: ' + err.stack);
                                        setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                                            process.exit(11);
                                        }, 1000);
                                        return;
                                    }

                                    log.info('Starting dynamic log server');
                                    dynamicLog.start(function (err) {
                                        if (err) {
                                            log.exit('Error starting dynamic log: ' + err.stack);
                                            setTimeout(function () { // don't run history.stop(). it will replace unsavedData.json
                                                process.exit(11);
                                            }, 1000);
                                            return;
                                        }

                                        // server must start at the end, because at first start it can't call callback
                                        // while you don't add objects and counters
                                        log.info('Starting main server process');
                                        server.start(callback);
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
    log.exit('Waiting for the web server to stop...');
    webServer.stop(function() {

        log.exit('Waiting for the server to stop...');

        server.stop(function () {

            log.exit('Waiting for the dynamic log to stop...');
            dynamicLog.stop(function () {

                log.exit('Waiting for the task server to stop');
                taskServer.stop(function () {

                    log.exit('Waiting for the action server to stop');
                    actionServer.stop(function () {

                        log.exit('Waiting for the history server to stop...');
                        history.stop(function () {

                            log.exit('Waiting for the backup server to stop...');
                            backupServer.stop(function () {

                                log.exit('Waiting for the replication server to stop...');
                                replicationServer.stop(function () {

                                    log.exit('Waiting for the log server to stop...');
                                    log.stop(function () {
                                        log.exit('All services are stopped');

                                        setTimeout(callback, 500);
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
