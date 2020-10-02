/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var calc = require('../lib/calc');

var profiling = {};
module.exports = profiling;

var timers = {};
/*
print statistic every timeInterval seconds
 */
profiling.init = function(timeInterval) {
    if(timeInterval !== parseInt(String(timeInterval), 10) || timeInterval < 10) return;
    setInterval(function() {
        for(var timer in timers) {
            print(timer);
        }
    }, timeInterval * 1000);
};

/*
point for starting to collect timer with name 'timer' and id 'id'.
id can be used for timers with equal names and can be skipped for one timer
 */
profiling.start = function(timer, id) {
    var startTime = process.hrtime.bigint();
    if(id === undefined) id = 0;

    if(!timers[timer]) timers[timer] = {};
    if(!timers[timer][id]) timers[timer][id] = {};
    timers[timer][id].start = startTime;
};

/*
point for stopping to collect timer with name 'timer' and id 'id'.
id can be used for timers with equal names and can be skipped for one timer
 */
profiling.stop = function(timer, id) {
    var endTime = process.hrtime.bigint();
    if(id === undefined) id = 0;

    if(!timers[timer] || !timers[timer][id] || !timers[timer][id].start) {
        //log.warn('Try to stop profiling without start for timer: ', timer, ', id: ', id, '. Do nothing');
        return;
    }

    var startTime = timers[timer][id].start;
    timers[timer][id].start = null;
    var diff = endTime - startTime;
    timers[timer][id].diff = diff; 
    timers[timer].__avg = timers[timer].__avg ? (timers[timer].__avg + diff) / 2n : diff;
    if(timers[timer].__max === undefined || timers[timer].__max < diff) timers[timer].__max = diff;
    if(timers[timer].__min === undefined || timers[timer].__min > diff) timers[timer].__min = diff;
};

profiling.get = function(timer) {
    return timers[timer] || {};
};

profiling.print = function(timer) {
    if(!timers[timer] || !timers[timer].__avg) return;

    print(timer);
};

function print(timer) {
        log.info('\tTimings max\\avg\\min: ', human(timers[timer].__max), '\\', human(timers[timer].__avg), '\\', human(timers[timer].__min), '.\tcnt: ', Object.keys(timers[timer]).length, ', timer: ', timer);
        timers[timer] = {};
}

function human(bigIntVal) {
    if(bigIntVal === undefined) return '?';
    return calc.convertToHuman(Number(bigIntVal) / 1e9, 'Time');
}