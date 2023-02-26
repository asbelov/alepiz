/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const Conf = require('../lib/conf');
const fs = require('fs');
const async = require('async');
const path = require('path');
const confLog = new Conf('config/log.json');

module.exports = logRotateRunner;

/**
 * Starting log rotation every 00:10:00 o'clock
 */
function logRotateRunner() {
    logRotate();

    // running logRotate at next day at 00:10:00.000
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 10, 0, 0);
    var timer = setTimeout(logRotateRunner, d - (new Date()));
    timer.unref();
}

/**
 * Rotate log in specific directory
 * @param {string} [logDir] log directory. If not specified, then the root directory of the log
 */
function logRotate(logDir) {
    const cfg = confLog.get();
    if(!Number(cfg.daysToKeepLogs) || cfg.daysToKeepLogs < 1) cfg.daysToKeepLogs = 3;

    if(!logDir) logDir = cfg.dir || 'logs';
    log.info('Log rotation started. Removing files older then ' + cfg.daysToKeepLogs + ' days from ' + logDir);

    var now = new Date();
    var lastDayToKeepLogs = new Date(now.setDate(now.getDate() - cfg.daysToKeepLogs));
    var removedLogFiles = [];

    fs.readdir(logDir, {withFileTypes: true}, function(err, logFiles){
        if(err) return log.error('Can\'t read dir ' + logDir + ': ' + err.message);

        async.each(logFiles, function (logFileObj, callback) {

            var logFileName = logFileObj.name;
            if (logFileName === cfg.exitLogFileName) return callback(); // skip rotate exit.log file
            if(logFileObj.isDirectory()) {
                logRotate(path.join(logDir, logFileName));
                return callback();
            }

            if (!/\.\d\d\d\d\d\d$/.test(logFileName)) {
                //log.debug('File ' + logFileName + ' is not a log file. Skip it');
                return callback();
            }

            logFileName = path.join(logDir, logFileName);

            fs.stat(logFileName, function (err, stats) {

                if (err) {
                    log.error('Can\'t stat log file ' + logFileName + ': ' + err.message);
                    return callback();
                }

                if (!stats.isFile()) {
                    //log.debug(logFileName + ' is not a file, skip it');
                    return callback();
                }

                if (stats.birthtime >= lastDayToKeepLogs) return callback();

                fs.access(logFileName, fs.constants.W_OK, function (err) {
                    if (err) {
                        log.error('Error checking access to the log file ' + logFileName + ': ' +
                            err.message);
                        return callback();
                    }

                    fs.unlink(logFileName, function (err) {
                        if (err) {
                            log.error('Can\'t remove log file ' + logFileName + ': ' + err.message);
                            return callback();
                        }

                        if (!fs.existsSync(logFileName)) {
                            removedLogFiles.push(logFileName.replace(/^.+[\\/]/, ''));
                        } else {
                            log.error('Can\'t remove log file ' + logFileName +
                                ': file exist after removing');
                        }
                        return callback();
                    });
                })
            })
        }, function () {
            log.info('Log rotation is finished for ' + logDir + '. Removed: ' +
                (removedLogFiles.length ? removedLogFiles.join(', ') : 'nothing'));
        });
    });
}
