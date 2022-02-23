/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var path = require('path');
var log = require('../../lib/log')(module);
const Conf = require('../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
var runInThread = require('../../lib/runInThread');

var collector = {};
module.exports = collector;

var eventGenerators = [], commonEventGenerator;
init();

collector.get = function (param, callback) {
    if(typeof param !== 'object') return callback(new Error('Parameters are not set or error'));

    if(!commonEventGenerator) return log.error('Event generator was not initialized');

    commonEventGenerator.get(param, callback);
    eventGenerators.forEach(eventGenerator => eventGenerator.get(param));
}

// for dashboard server function
collector.getOnce = function (param, callback) {
    if(typeof param !== 'object') return callback(new Error('Parameters are not set or error'));

    if(!commonEventGenerator) return log.error('Event generator was not initialized');

    commonEventGenerator.getOnce(param, callback);
    eventGenerators.forEach(eventGenerator => eventGenerator.get(param));
}


collector.removeCounters = function(OCIDs, callback) {
    if(!OCIDs.length) return callback();

    commonEventGenerator.removeCounters(OCIDs);
    eventGenerators.forEach(eventGenerator => eventGenerator.removeCounters(OCIDs));
    callback();
};

collector.destroy = function(callback) {
    if(commonEventGenerator) commonEventGenerator.destroy();
    eventGenerators.forEach(eventGenerator => eventGenerator.destroy());
    commonEventGenerator = null;
    eventGenerators = [];
    callback();
};

function init() {
    var cfg = confSettings.get();

    if(Array.isArray(cfg.db) && cfg.db.length) {
        var dbPaths = cfg.db.map(function (obj) {
            if (obj && obj.path && obj.file) {
                if(obj.relative) return path.join(__dirname, '..', '..', obj.path, obj.file);
                else return path.join(obj.path, obj.file);
            } else log.error('Can\'t create DB path from ', cfg.db, ': ', obj);
        });
    } else if (cfg.dbPath && cfg.dbFile) {
        dbPaths = [path.join(__dirname, '..', '..', cfg.dbPath, cfg.dbFile)];
    }

    async.each(dbPaths, function (dbPath, callback) {
        runInThread(path.join(__dirname, 'lib', 'eventGenerator.js'), {
            get: {
                permanentCallback: true,
            }},function (err, eventGenerator) {
            eventGenerators.push(eventGenerator.func);
            eventGenerator.func.init(dbPath, callback);
        });
    }, function () {
        commonEventGenerator = eventGenerators.shift();
    });
}
