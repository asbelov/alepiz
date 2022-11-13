/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const async = require('async');
const path = require('path');
const log = require('../../lib/log')(module);
const Conf = require('../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
const runInThread = require('../../lib/runInThread');

var collector = {};
module.exports = collector;

var eventGenerators = [], commonEventGenerator, initializationInProgress = false;
init(()=>{ log.info('First initialization was complete'); });

collector.get = function (param, callback) {
    if(typeof param !== 'object') return callback(new Error('Parameters are not set or error'));

    if(!commonEventGenerator || typeof commonEventGenerator.get !== 'function') {
        log.error('Event generator was not initialized (get), run initialization: ', param);
        setTimeout(function () {
            init(function () {
                collector.getOnce(param, callback);
            });
        }, 100).unref();
    }

    commonEventGenerator.get(param, callback);
    eventGenerators.forEach(eventGenerator => eventGenerator.get(param));

    if(Number(param.eventDuration) === parseInt(String(param.eventDuration), 10)) {
        param.eventDuration = Number(param.eventDuration);

        setTimeout(function(param, callback) {
                param.$variables.UPDATE_EVENT_STATE = 0;
                param.$variables.UPDATE_EVENT_TIMESTAMP = Date.now();
                if(!commonEventGenerator) return log.error('Event generator was not initialized: ', param);
                commonEventGenerator.get(param, callback);
                eventGenerators.forEach(eventGenerator => eventGenerator.get(param));
            }, (!param.eventDuration || param.eventDuration < 1 ? 0 : param.eventDuration * 1000),
            param, callback);
    }
}

// for dashboard server function
collector.getOnce = function (param, callback) {
    if(typeof param !== 'object') return callback(new Error('Parameters are not set or error'));

    if(!commonEventGenerator || typeof commonEventGenerator.getOnce !== 'function') {
        log.error('Event generator was not initialized (getOnce), run initialization: ', param);
        setTimeout(function () {
            init(function () {
                collector.getOnce(param, callback);
            });
        }, 100).unref();
    }

    commonEventGenerator.getOnce(param, callback);
    eventGenerators.forEach(eventGenerator => eventGenerator.get(param));
}


collector.removeCounters = function(OCIDs, callback) {
    if(!OCIDs.length || !commonEventGenerator || typeof commonEventGenerator.removeCounters !== 'function') {
        return callback();
    }

    commonEventGenerator.removeCounters(OCIDs);
    eventGenerators.forEach(eventGenerator => eventGenerator.removeCounters(OCIDs));
    callback();
};

collector.destroy = function(callback) {
    if(!commonEventGenerator|| typeof commonEventGenerator.destroy !== 'function') return callback();

    commonEventGenerator.destroy();
    eventGenerators.forEach(eventGenerator => eventGenerator.destroy());
    commonEventGenerator = null;
    eventGenerators = [];
    callback();
};

function init(callback) {
    if(initializationInProgress) return callback();

    initializationInProgress = true;
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
        runInThread(path.join(__dirname, 'lib', 'eventGenerator.js'), {},
            function (err, eventGenerator) {
            eventGenerators.push(eventGenerator.func);
            eventGenerator.func.init(dbPath, callback);
        });
    }, function () {
        commonEventGenerator = eventGenerators.shift();
        initializationInProgress = false;
        callback();
    });
}