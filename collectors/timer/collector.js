/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

var timers = {},
    isServerRunning = false,
    timerID;

collector.get = function(prms, callback) {
    if(!prms || !prms.wakeupInterval) return callback(new Error('Parameter "wakeupInterval" is not specified'));

    if(Number(prms.wakeupInterval) !== parseInt(prms.wakeupInterval, 10)) return callback(new Error('Parameter "wakeupInterval" is incorrect: "' + prms.wakeupInterval + '"'));
    
    if(!isServerRunning) {
        isServerRunning = true;
        timerID = setInterval(function() {
            var counter = Math.round(Date.now() / 1000 );
            for(var OCID in timers) {
                if(!timers.hasOwnProperty(OCID)) continue;

                var timer = timers[OCID];

                if(timer.prevCounter !== counter &&
                    counter / timer.interval === Math.round(counter / timer.interval) ) {
                    log.debug('Starting ', OCID, '; time interval: ', timer.interval, '; counter: ', counter);
                    timer.prevCounter = counter;
                    timer.callback(null, counter*1000);
                }
            }
        }, 333); // 1000 or less for increase accuracy
    }
    
    log.info('Adding a new timer for objectCounterID: ', prms.$id, ' with interval ', prms.wakeupInterval);
    timers[prms.$id] = {
        interval: parseInt(prms.wakeupInterval, 10),
        callback: callback
    };
};

collector.removeCounters = function(OCIDs, callback) {
    if(!Object.keys(timers).length) return callback();

    var removedOCIDs = [];
    OCIDs.forEach(function(OCID) {
        if(timers[OCID] !== undefined) {
            removedOCIDs.push(OCID);
            delete timers[OCID];
        }
    });
    if(removedOCIDs.length) log.info('Complete removed timers for objectsCountersIDs: ', removedOCIDs);
    callback();
};

collector.destroy = function (callback) {
	log.debug('Receiving signal for destroying collector');
    
    if(timerID !== undefined) {
        clearInterval(timerID);
        timerID = undefined;
    }
    
    timers = {};
    isServerRunning = false;
    
    log.info('Complete destroyed timer counter');    
    callback();
};
