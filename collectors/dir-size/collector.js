/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-3-22 12:48:02
*/

var fs = require('fs');
var path = require('path');
var async = require('async');
var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

collector.get = function(param, callback) {

    var startTime = Date.now();
    if(!param.dirNames) return callback(new Error('Dir names is not specified: ' + JSON.stringify(param)));
    
    param.sleepTime = Number(param.sleepTime);
    if(param.sleepTime !== parseInt(String(param.sleepTime), 10) || !param.sleepTime) {
        log.warn('Incorrect sleepTime parameter value. Set sleepTime to 1ms: ', param);
        param.sleepTime = 1;
    }
    
    param.warnTimeDirSizeCalculation = Number(param.warnTimeDirSizeCalculation);
    if(param.warnTimeDirSizeCalculation !== parseInt(String(param.warnTimeDirSizeCalculation), 10) || !param.warnTimeDirSizeCalculation) {
        log.warn('Incorrect warnTimeDirSizeCalculation parameter value. Set warnTimeDirSizeCalculation to 5min: ', param);
        param.warnTimeDirSizeCalculation = 300000;
    }
    
    var dirNames = param.dirNames.split(',').map(name => name.trim());
    var excluded = !param.excludedDirs ? [] : param.excludedDirs.split(',').map(function(excl) {
        if(!param.regExpExcludedDirs) return excl.trim();
        try {
            return new RegExp(excl.trim(), 'gi');
        } catch(e) {
            log.warn('Incorrect exclude regExp ' + excl.trim() + ' for ', param, ': ', e.message);
            return null;
        }
    });
    
    var size = 0;
    async.eachSeries(dirNames, function(dirName, callback) {
        getDirSize(dirName, excluded, param.sleepTime, JSON.stringify(param), function(err, childSize) {
            if(err) {
                log.warn(err.message);
                return callback();
            }
            if(!isNaN(childSize)) size += childSize;
            callback();
        });
    }, function() {
        if(Date.now() - startTime > param.warnTimeDirSizeCalculation) {
            log.warn('Size calculation time for ', param, ' too long: ', (Math.round(Date.now() - startTime) / 60000), 'min');
        }
        callback(null, size);
    });
};

function getDirSize(dirName, excluded, sleepTime, paramStr, callback) {
    var size = 0;
    fs.readdir(dirName, {withFileTypes: true}, function(err, dirEntObjects) {
        if(err) return callback(new Error('Can\'t read directory '+ dirName + ' for ' + paramStr + ': ' + err.message));
        
        async.eachSeries(dirEntObjects, function(dirEntObj, callback) {
            for(var i = 0; i < excluded.length; i++) {
                if(!excluded[i]) continue;

                if(typeof excluded[i] === 'string') {
                    if(excluded[i] === dirEntObj.name.toLowerCase())  return callback();
                } else {
                    try {
                        if(excluded[i].test(dirEntObj.name.toLowerCase())) return callback();
                    } catch(e) {
                        log.warn('Can\'t check '+ dirEntObj.name + ' for exclude (' + JSON.stringify(excluded[i]) + ')' + paramStr + ': ' + err.message);
                    }
                }
            }
            
            var filePath = path.join(dirName, dirEntObj.name);
            if(dirEntObj.isDirectory()) {
                getDirSize(filePath, excluded, sleepTime, paramStr, function(err, childSize) {
                	if(err) {
                        log.warn(err.message);
                        return callback();
                    }
                    if(!isNaN(childSize)) size += childSize;
                    callback();
            	});
            } else if(dirEntObj.isFile()) {
                fs.stat(filePath, {bigint: false}, function(err, statStruct) {
                    if(err) {
                        log.warn('Can\'t get file info '+ filePath + ' for ' + paramStr + ': ' + err.message);
                        return callback();
                    }
                    var fileSize = Number(statStruct.size);
                    if(!isNaN(fileSize)) size += fileSize;
                    setTimeout(callback, sleepTime);
                });
            }
        }, function() {
            callback(null, size);
        });
    });
}
