/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const Conf = require('../lib/conf');
const writeLog = require('./writeLog');
const createMessage = require('./createMessage');
const fs = require('fs');
const async = require('async');
const path = require('path');
const confLog = new Conf('config/log.json');

module.exports = logRotate;

function logRotate(logDir) {
    const cfg = confLog.get();
    if(!Number(cfg.daysToKeepLogs)) return;

    if(!logDir) logDir = cfg.dir || 'logs';
    log('Log rotation started. Removing files older then ' + cfg.daysToKeepLogs + ' days from ' + logDir);

    var now = new Date();
    var lastDayToKeepLogs = new Date(now.setDate(now.getDate() - cfg.daysToKeepLogs));
    var removedLogFiles = [];

    fs.readdir(logDir, {withFileTypes: true}, function(err, logFiles){
        if(err) return log('Can\'t read dir ' + logDir + ': ' + err.message, 'E');

        async.each(logFiles, function (logFileObj, callback) {

            var logFileName = logFileObj.name;
            if (logFileName === cfg.exitLogFileName) return callback(); // skip rotate exit.log file
            if(logFileObj.isDirectory()) {
                logRotate(path.join(logDir, logFileName));
                return callback();
            }

            if (!/\.\d\d\d\d\d\d$/.test(logFileName)) {
                //log('File ' + logFileName + ' is not a log file. Skip it', 'D');
                return callback();
            }

            logFileName = path.join(logDir, logFileName);

            fs.stat(logFileName, function (err, stats) {

                if (err) {
                    log('Can\'t stat log file ' + logFileName + ': ' + err.message, 'E');
                    return callback();
                }

                if (!stats.isFile()) {
                    //log(logFileName + ' is not a file, skip it', 'D');
                    return callback();
                }

                if (stats.birthtime >= lastDayToKeepLogs) return callback();

                fs.access(logFileName, fs.constants.W_OK, function (err) {
                    if (err) {
                        log('Can\'t remove log file ' + logFileName + ': ' + err.message, 'E');
                        return callback();
                    }

                    fs.unlink(logFileName, function (err) {
                        if (err) {
                            log('Can\'t remove log file ' + logFileName + ': ' + err.message, 'E');
                            return callback();
                        }

                        if (!fs.existsSync(logFileName)) {
                            removedLogFiles.push(logFileName.replace(/^.+[\\/]/, ''));
                        } else {
                            log('Can\'t remove log file ' + logFileName +
                                ': file exist after removing', 'E');
                        }
                        return callback();
                    });
                })
            })
        }, function () {
            log('Log rotation is finished for ' + logDir + '. Removed: ' +
                (removedLogFiles.length ? removedLogFiles.join(', ') : 'nothing'), 'I');

            // running logRotate at next day at 00:10:00.000
            var d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(0, 10, 0, 0);
            var timer = setTimeout(logRotate, d - (new Date()));
            timer.unref();
        });
    });
}

function log(message, level) {
    writeLog(createMessage([message], level || 'I', 'logRotate'));
}