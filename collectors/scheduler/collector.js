/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-7-14 23:33:05
*/
var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

var schedules = {};

collector.get = function(prms, callback) {
    if(!prms || !prms.time) return callback(new Error('Parameter "time" is not specified'));
    
    var timeParts = prms.time.split(/[^\d]+/);
    
    if(timeParts.length !== 2 || 
       Number(timeParts[0]) < 0 || Number(timeParts[0]) > 23 || 
       Number(timeParts[1]) < 0 || Number(timeParts[0]) > 59) {
        return callback(new Error('Incorrect parameter "time": ' + prms.time + '. Waiting for time in format HH:MM (f.e. 13:25)'));
    }
    var time = Number(timeParts[0]) * 3600000 + Number(timeParts[1]) * 60000;

    if(!time) {
        return callback(new Error('Can\'t parse parameter "time": ' + prms.time + '. Waiting for time in format HH:MM (f.e. 13:25)'));
    }

    schedule(prms.$id, time, callback);
};

/*
    destroy objects when reinitialize collector
    destroy function is not required and can be skipping

    callback(err);
*/
collector.destroy = function(callback) {
    for(var id in schedules) {
        clearTimeout(schedules[id]);
    }
    log.info('Removed all schedulers: ', Object.keys(schedules));
    schedules = {};
    callback();
};

/*
    remove counters with objectCounterIDs (OCIDs) when remove object
    removeCounters is not required and can be skipping

    OCIDs - array of objectsCountersIDs
    callback(err);

    objectCounterID of specific counter you can get from $id parameter
    from the counter parameters, sending to collector.get(prms, callback) function
*/
collector.removeCounters = function(OCIDs, callback) {
    var removedSchedulers = [];
    OCIDs.forEach(function(id) {
        if(!schedules[id]) return;
        
        removedSchedulers.push(id);
        clearTimeout(schedules[id]);
        delete schedules[id];
    });
    
    if(removedSchedulers.length) log.info('Removed schedulers for OCIDs ', removedSchedulers, ' from ', OCIDs);
    callback();
};

function schedule(id, time, callback) {
    var todayMidnight = new Date();
    todayMidnight.setHours(0,0,0,0);
    var runTime = todayMidnight.getTime() + time;
    
    var now = Date.now();
    if(now >= runTime) runTime += 86400000;

    log.info('Waiting for ', new Date(runTime).toLocaleString(), ' for OCID: ', id);
    
    schedules[id] = setTimeout(function() {
        schedule(id, time, callback);
        log.info('Starting at ', new Date(runTime).toLocaleString(), ' for OCID: ', id);
        callback(null, Date.now());
    }, runTime - now);    
}
