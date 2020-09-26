/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 26.07.2015.
 */
var conf = require('../lib/conf');
var fs = require('fs');
var path = require('path');
var async = require('async');
var log = require('../lib/log')(module);
var rmTree = require('../lib/utils/rmTree');


var collectors = {};
module.exports = collectors;

collectors.get = function(collectorName, callback){
    getCollectors(collectorName, function(err, collectors){
        if(err) return callback(err);
        if(!collectorName) return callback(null, collectors);
        return callback(null, collectors[collectorName]);
    });
};

collectors.getCollectorPath = function(collectorName) {
    return path.join(__dirname, '..', conf.get('collectors:dir'), collectorName);
};

collectors.getCollectorCode = function(collectorName, callback){
    log.debug('Begin getting body of collector.js file for '+collectorName);
    var collectorCodePath = path.join(__dirname, '..', conf.get('collectors:dir'), collectorName, 'collector.js');
    log.debug('Path to collector code file is :'+collectorCodePath);
    fs.readFile(collectorCodePath, 'utf8', callback);
};

function getCollectors(collectorName, callback) {
    log.debug('Begin getting collectors configuration for ', collectorName === null ? 'all collectors' : collectorName);
    var collectorsPath = path.join(__dirname, '..', conf.get('collectors:dir'));
    var collectors = {};

    fs.readdir(collectorsPath, function(err, collectorDirs) {
        if(err) return callback(err);

        async.each(collectorDirs, function(collectorDir, callback) {

            if(collectorName && collectorName.toLowerCase() !== collectorDir.toLowerCase()) return callback();
            var configPath = path.join(collectorsPath, collectorDir, 'config.json');
            fs.readFile(configPath, function(err, fileBody) {
                if(err) return callback();
                try{
                    collectors[collectorDir] = JSON.parse(String(fileBody));
                } catch(e) {
                    delete(collectors[collectorDir]);
                    return callback(new Error('Can\'t parse config file '+configPath+': '+ e.message));
                }
                return callback();
            });
        }, function(err) {
            if(err) log.debug('Error getting collectors: '+err.message);
            return callback(err, collectors);
        });
    });
}

collectors.checkParameters = function(collectorName, parameters, variables, callback) {
    getParameters(collectorName, function(err, initParameters) {
        if(err) return callback(err);
        if(!initParameters){
            log.debug('Collector '+collectorName+' has no parameters');
            return callback();
        }

        var checkedParameters = {};
        for(var name in initParameters) {
            if(!initParameters.hasOwnProperty(name)) continue;
            var val = parameters[name];

            log.debug('Checking collector: '+collectorName+' parameter "'+name+'"="'+val+'", type "'+initParameters[name].checkAs+'". ' +
                'Can be empty: '+initParameters[name].canBeEmpty);

            if(val === undefined || val === '') {
                if(initParameters[name].canBeEmpty) {
                    checkedParameters[name] = null;
                    continue;
                }
                err = new Error('Required parameter '+name+' for collector '+collectorName+' is not set');
                log.debug(err.message, parameters);
                return callback(err);
            }

            // sync function, closure
            (function(name) {
                checkParameter(val, initParameters[name].checkAs, variables, function (err, newVal) {
                    if (err) {
                        err = new Error('Error checking parameter "' + name + '" for collector "' + collectorName + '": ' + err.message);
                        log.debug(err.message);
                        return callback(err);
                    }
                    checkedParameters[name] = newVal;
                });
            })(name);

            // callback with error send above in sync function checkParameter. only returning from loop here
            // because we can't break loop inside callback of checkParameter function
            if(checkedParameters[name] === undefined) return;
        }
        return callback(null, checkedParameters);
    });
};

collectors.checkParameter = checkParameter;

function checkParameter(val, checkAs, variables, callback) {

    if(!checkAs) return callback(null, val);

    if(/%:.+:%/.test(String(val))) {
        log.debug('Collector parameter "' + val + '" has variables and can not be checked by ' + checkAs);
        return callback(null, val);
    }

    checkAs = checkAs.toLowerCase();

    if(checkAs === 'integer') {
        if (String(val).match(/^ *-? *[0-9 ]+ *$/)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not an integer: ' + val));
    }

    if(checkAs === 'uinteger') {
        if (String(val).match(/^ *[0-9 ]+ *$/)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not an unsigned integer: ' + val));
    }

    if(checkAs === 'unzinteger') {
        if (String(val).match(/^ *[1-9 ][0-9 ]* *$/)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not an unsigned non-zero integer: ' + val));
    }

    if(checkAs === 'timeInterval') {
        if (String(val).match(/^ *[0-9 ]+\.?[0-9 ]*?[smhdw]? *$/i)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a time interval (500, 10s, 3.5h, 1m, 2d, 4w etc): ' + val));
    }

    if(checkAs === 'bytes') {
        if (String(val).match(/^ *[0-9 ]+\.?[0-9 ]*?([KMG]?[b]|) *$/i)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a bytes (100, 20Kb, 30Mb, 1.1Gb etc): ' + val));
    }

    if(checkAs === '24clock') {
        if (String(val).match(/^ *(2[0-3]|[01]?[0-9]):([0-5]?[0-9])(:[0-5]?[0-9]|) *$/i)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a 24-hour clock (23:25, 21:45:30 etc): ' + val));
    }

    if(checkAs === '1224clock') {
        if (String(val).match(/^ *(^(1[0-2]|0?[1-9]):([0-5]?[0-9])(:[0-5]?[0-9]|)( ?[AP]M)?$)|(^(2[0-3]|[01]?[0-9]):([0-5]?[0-9])(:[0-5]?[0-9]|)$) *$/i)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a 12 or 24-hour clock (23:25, 21:45:30, 1:32Am, 10:40:30 pm etc): ' + val));
    }

    if(checkAs === 'date') {
        if (String(val).match(/^ *([0]?[1-9]|[1|2][0-9]|[3][0|1])[./-]([0]?[1-9]|[1][0-2])[./-]([0-9]{4}|[0-9]{2}) *$/i)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a date DD.MM.YYYY(20.07.20, 31/08/2020, 14-06-2021 etc): ' + val));
    }

    if(checkAs === 'zeroone') {
        if (String(val).match(/^ *[01] *$/)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not 0 or 1: ' + val));
    }

    if(checkAs === 'float') {
        if(String(val).match(/^ *-? *[0-9 ]+\.?[0-9 ]*? *$/)) return callback(null, Number(val.replace(/ /g, '')));
        return callback(new Error('Value is not a float: '+ val));
    }

    if(checkAs === 'tcpport') {
        val = Number(String(val).replace(/ /g, ''));
        if(val > 0 && val < 65536) return callback(null, val);
        return callback(new Error('Value is not a TCP port: '+ val));
    }

    if(checkAs === 'hostorip') {
        // host name also can contain not standard '_' and can beginning from digit
        var pattern = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$|^(([0-9a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-_]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-_]*[A-Za-z0-9])$|^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
        if(pattern.test(String(val))) return callback(null, val);
        return callback(new Error('Value is not a valid IP address or internet host name: '+ val));
    }

    callback(new Error('Unknown checkAs: '+checkAs+', can\'t checking value: '+val));
}

function getParameters(collectorName, callback) {
    if(!collectorName) {
        var err = new Error('Collector name not specified for getting parameters for collector');
        log.debug(err.message);
        return callback(err);
    }

    getCollectors(collectorName, function(err, collectors) {
        if(err) return callback(err);

        var collector = collectors[collectorName];
        if(!collector || !collector.parameters) {
            err = new Error('Error getting parameter for collector '+collectorName);
            log.debug(err.message);
            return callback(err);
        }
        callback(null, collector.parameters);
    });
}

collectors.save = function(ID, collector, code, oldID, callback) {
    log.debug('Saving collector ', ID);
    var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), ID);

    fs.stat(collectorPath, function(err, stats) {
        // if path exists and it is not a changing of the old collector
        if(!err && oldID !== ID)  return callback(new Error('Collector with ID ' + ID + ' already exists'));

        try{
            var configPath = path.join(collectorPath, 'config.json');
            var codePath = path.join(collectorPath, 'collector.js');

            if(!stats) {
                log.debug('Collector directory not exists, make it: ' + collectorPath);
                fs.mkdirSync(collectorPath);
            }

            log.debug('Saving collector configuration to ' + configPath);
            fs.writeFileSync(configPath, JSON.stringify(collector, null, 4),'utf8');

            log.debug('Saving collector code to '+codePath);
            fs.writeFileSync(codePath, code,'utf8');

            if(oldID && oldID !== ID) {
                var oldCollectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), oldID);
                log.debug('Deleting old collector ', oldCollectorPath);
                rmTree.sync(oldCollectorPath);
            }
            log.debug('Saving collector ', ID, ' done');
            callback();
        } catch(err) {
            return callback(new Error('Can\'t create collector with ID ' + ID + ': ' + err.message));
        }
    });
};


collectors.delete = function(ID, callback) {
    log.debug('Delete collector '+ ID);
    try {
        var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), ID);
        rmTree.sync(collectorPath);
        log.debug('Delete collector '+ID+' done');
        callback();
    } catch(err) {
        return callback(new Error('Can\'t delete collector with ID '+ID+': '+err.message));
    }
};
