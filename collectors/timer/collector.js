/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

var timers = new Map();

collector.get = function(param, callback) {
    if(!param || !param.wakeupInterval) return callback(new Error('Parameter "wakeupInterval" is not specified'));

    var wakeupInterval = Number(param.wakeupInterval);
    if(wakeupInterval !== parseInt(String(wakeupInterval), 10) || wakeupInterval < 1) {
        return callback(new Error('Parameter "wakeupInterval" is incorrect: "' + param.wakeupInterval + '"'));
    }

    var timerID = setInterval(function () {
        callback(null, Date.now());
    }, wakeupInterval * 1000);

    timers.set(param.$id, {
        timerID: timerID,
        wakeupInterval: wakeupInterval,
    });
    log.info('Adding a new timer for objectCounterID: ', param.$id, ' with interval ', wakeupInterval, ' sec');
};

collector.removeCounters = function(OCIDs, callback) {
    if(!timers.size) return callback();

    var removedTimers = [];
    OCIDs.forEach(function(OCID) {
        if(timers.has(OCID)) {
            var timer = timers.get(OCID);
            clearInterval(timer.timerID);
            removedTimers.push({
                OCID: OCID,
                wakeupInterval: timer.wakeupInterval,
            });
            timers.delete(OCID)
        }
    });
    if(removedTimers.length) log.info('Complete removed timers: ', removedTimers);
    callback();
};

collector.destroy = function (callback) {
	log.debug('Receiving signal for destroying collector');
    
    timers.forEach(function (timer) {
        clearInterval(timer.timerID);
    });

    log.info('Complete destroyed timer counters ', Object.fromEntries(timers));
    timers = new Map();

    callback();
};
