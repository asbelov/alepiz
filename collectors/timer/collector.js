/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

var timers = new Map(), wakeUpper = null, shiftInterval = 13000;

/** Check every 50ms, that required time interval was occurred for save long time timers

 */
collector.get = function(param, callback) {
    if (!param || !param.wakeupInterval) return callback(new Error('Parameter "wakeupInterval" is not specified'));

    var wakeupInterval = Number(param.wakeupInterval);
    if (wakeupInterval !== parseInt(String(wakeupInterval), 10) || wakeupInterval < 1) {
        return callback(new Error('Parameter "wakeupInterval" is incorrect: "' + param.wakeupInterval + '"'));
    }

    var shift = wakeupInterval * 1000 >= shiftInterval ? timers.size * shiftInterval : 0;
    timers.set(param.$id, {
        wakeupInterval: wakeupInterval * 1000,
        shift: shift,
        prevRest: -1,
        callback: callback,
    });
    log.info('Adding a new timer for objectCounterID: ', param.$id, ' with interval ', wakeupInterval, 's; shift: ', shift, 'ms');

    if(!wakeUpper) {
        log.info('Initializing timer collector');
        wakeUpper = setInterval(function () {
            var now = Date.now();
            timers.forEach((timer) => {
                var rest = (now + timer.shift) % timer.wakeupInterval;
                if(timer.prevRest !== -1 && timer.prevRest > rest) {
                    if(timer.wakeupInterval > 20000) {
                        log.info('Timer ', timer.wakeupInterval, ': ', (new Date(now)).toLocaleString(), ': cur: ',
                            rest, '; prev: ', timer.prevRest, '; now: ', now, '; shift: ', timer.shift);
                    }
                    timer.callback(null, now);
                }
                timer.prevRest = rest;
            });
        }, 50);
    }
};

collector.removeCounters = function(OCIDs, callback) {
    if(!timers.size) return callback();

    var removedTimers = [];
    OCIDs.forEach(function(OCID) {
        if(timers.has(OCID)) {
            var timer = timers.get(OCID);
            removedTimers.push({
                OCID: OCID,
                wakeupInterval: timer.wakeupInterval,
            });
            timers.delete(OCID);
        }
    });
    if(removedTimers.length) log.info('Complete removed timers: ', removedTimers);
    callback();
};

collector.destroy = function (callback) {
    clearInterval(wakeUpper);
    wakeUpper = null;
    log.info('Complete destroyed timer counters ', Object.fromEntries(timers));
    timers = new Map();
    callback();
};