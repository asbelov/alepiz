/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created on 2021-3-22 12:48:02
 */

const log = require('../../lib/log')(module);
const fs = require('fs');
const path = require('path');
const async = require('async');

var collector = {};
module.exports = collector;

collector.get = function(param, callback) {

    var startTime = Date.now();
    if (!param.dirNames) return callback(new Error('Dir names is not specified: ' + JSON.stringify(param)));

    param.sleepTime = Number(param.sleepTime);
    if (param.sleepTime !== parseInt(String(param.sleepTime), 10) || !param.sleepTime) {
        log.warn('Incorrect sleepTime parameter value. Set sleepTime to 1ms: ', param);
        param.sleepTime = 1;
    }

    param.warnTimeDirSizeCalculation = Number(param.warnTimeDirSizeCalculation);
    if (param.warnTimeDirSizeCalculation !== parseInt(String(param.warnTimeDirSizeCalculation), 10) ||
        !param.warnTimeDirSizeCalculation) {
        log.warn('Incorrect warnTimeDirSizeCalculation parameter value. Set warnTimeDirSizeCalculation to 5min: ', param);
        param.warnTimeDirSizeCalculation = 300000;
    }

    var dirNames = param.dirNames.split(',').map(name => name.trim());
    var excluded = !param.excludedDirs ? [] : param.excludedDirs.split(',').map(function(excl) {
        if (!param.regExpExcludedDirs) return excl.trim().toLowerCase();
        try {
            return new RegExp(excl.trim(), 'gi');
        } catch (e) {
            log.warn('Incorrect exclude regExp ', excl.trim(), ': ', e.message, ' for ', param);
            return null;
        }
    });

    var size = 0, allObjectsNum = 0, allFilesNum = 0;
    async.eachLimit(dirNames, 10, function(dirName, callback) {
        fs.stat(dirName, function(err, dirStats) {
            if (err) {
                if (!param.dontLogErrors) {
                    log.warn('Can\'t get file info ', dirName, ': ', err.message, ' for ', JSON.stringify(param));
                }
                return callback();
            }
            if (dirStats.isDirectory()) {
                getDirSize(dirName, excluded, param.sleepTime, JSON.stringify(param), param.dontLogErrors,
                    function(err, childSize, objectsNum, filesNum) {
                    if (err) {
                        if (!param.dontLogErrors) log.warn(err.message);
                        return callback();
                    }
                    if (!isNaN(filesNum)) allFilesNum += filesNum;
                    if (!isNaN(objectsNum)) allObjectsNum += objectsNum;
                    if (!isNaN(childSize)) size += childSize;
                    callback();
                });
            } else if (dirStats.isFile()) {
                var fileSize = Number(dirStats.size);
                ++allFilesNum;
                ++allObjectsNum;
                if (!isNaN(fileSize)) size += fileSize;
                setTimeout(callback, param.sleepTime);
            }
        });
    },
    function() {
        if (Date.now() - startTime > param.warnTimeDirSizeCalculation) {
            log.info('Size calculation time too long: ', Math.round((Date.now() - startTime) / 60000),
                '/', Math.round(param.warnTimeDirSizeCalculation / 60000), 'min. Objects checked: ', allObjectsNum,
                ', files: ', allFilesNum, ', sleep time: ', param.sleepTime, 'ms, dir: ',  param.dirNames,
                '; param: ', param);
        }
        callback(null, size);
    });
};

function getDirSize(dirName, excluded, sleepTime, paramStr, dontLogErrors, callback) {
    var size = 0, allObjectsNum = 0, filesNum = 0;
    fs.readdir(dirName, { withFileTypes: true }, function(err, dirEntObjects) {
        if (err) return callback(new Error('Can\'t read directory ' + dirName + ': ' + err.message + ' for ' + paramStr));

        allObjectsNum = dirEntObjects.length;
        async.eachLimit(dirEntObjects, 40, function(dirEntObj, callback) {
            for (var i = 0; i < excluded.length; i++) {
                if (!excluded[i]) continue;

                if (typeof excluded[i] === 'string') {
                    if (excluded[i] === dirEntObj.name.toLowerCase()) return callback();
                } else {
                    try {
                        if (excluded[i].test(dirEntObj.name)) return callback();
                    } catch (e) {
                        if (!dontLogErrors) {
                            log.warn('Can\'t check ', dirEntObj.name, ' for exclude: ', err.message,
                                '; RegExp: (', excluded[i], '); param: ', paramStr);
                        }
                    }
                }
            }

            var filePath = path.join(dirName, dirEntObj.name);
            if (dirEntObj.isDirectory()) {
                getDirSize(filePath, excluded, sleepTime, paramStr, dontLogErrors, function(err, childSize, childObjectsNum, childFilesNum) {
                    if (err) {
                        if (!dontLogErrors) log.warn(err.message);
                        return callback();
                    }
                    if (!isNaN(childObjectsNum)) allObjectsNum += childObjectsNum;
                    if (!isNaN(childFilesNum)) filesNum += childFilesNum;
                    if (!isNaN(childSize)) size += childSize;
                    callback();
                });
            } else if (dirEntObj.isFile()) {
                fs.stat(filePath, { bigint: false }, function(err, statStruct) {
                    if (err) {
                        if (!dontLogErrors) {
                            log.warn('Can\'t get file info ', filePath, ': ', err.message, ' for ', paramStr);
                        }
                        return callback();
                    }
                    var fileSize = Number(statStruct.size);
                    if (!isNaN(fileSize)) {
                        size += fileSize;
                        ++filesNum;
                    }
                    setTimeout(callback, sleepTime);
                });
            }
        }, function() {
            callback(null, size, allObjectsNum, filesNum);
        });
    });
}