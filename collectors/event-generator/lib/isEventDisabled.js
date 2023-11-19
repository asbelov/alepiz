/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../../../lib/log')(module);

/**
 * Check is event with specific parameters is disabled
 * @param {string} eventDescription even description for log
 * @param {number|null} disableFrom disable from timestamp
 * @param {string|null} disableDaysOfWeekStr string like "0,1,2,3,4,5,6" (0 for Sunday, 1 for Monday and so on)
 * @param {string|null} intervalsStr string like <from>-<to>;<from>-<to>;<from>-<to>
 * @param {number} [startTime] event start time timestamp. Date.now() for undefined
 * @param {number} [endTime]  event end time timestamp. Date.now() for undefined
 * @return {boolean} true (event is disabled) or false (event is enabled)
 */
module.exports = function (eventDescription, disableFrom, disableDaysOfWeekStr,
                           intervalsStr, startTime, endTime) {

    if(!startTime) startTime = Date.now();
    if(!endTime) endTime = Date.now();

    if(disableFrom && endTime < disableFrom) {
        log.debug(eventDescription + ':enabled: the event occurred before the disabling time occurred: ',
            new Date(endTime).toLocaleString(), ' < ', new Date(disableFrom).toLocaleString())
        return false;
    }

    // 0 for Sunday, 1 for Monday, 2 for Tuesday, and so on
    if(disableDaysOfWeekStr) {
        var eventDaysOfWeek = [];
        var disableDaysOfWeek = disableDaysOfWeekStr.split(',');

        // the event lasts more than one week
        if(endTime - startTime > 604800000) {
            eventDaysOfWeek = [0,1,2,3,4,5,6]; // add all days of the week
        } else {
            var startTimeMidnight =
                new Date(new Date(startTime).setHours(0, 0, 0, 0)).getTime();
            for (let day = startTimeMidnight; day < endTime; day += 86400000) {
                eventDaysOfWeek.push(new Date(day).getDay());
            }
        }

        /*
        if the days of the week on which the event occurred do not correspond to the days of the week on which the
        event should be disabled, then the event is not disabled
         */
        if(!eventDaysOfWeek.every(eventDayOfWeek => disableDaysOfWeek.indexOf(String(eventDayOfWeek)) !== -1)) {

            log.debug(eventDescription + ':enabled: the event is occurred on the week days (',
                eventDaysOfWeek.join(','), ') but the event was disabled at the week days: ',
                disableDaysOfWeek.join(','));
            return false;
        }
    }

    if(!intervalsStr) {
        log.debug(eventDescription + ':disabled: disable from ',
            new Date(disableFrom).toLocaleString(), '; days: ',  disableDaysOfWeekStr, '; intervals: ',
            timeIntervalsToHuman(intervalsStr));
        return true;
    }
    var eventsTimeFrom = startTime - (new Date(new Date(startTime).setHours(0,0,0,0))).getTime();
    var eventTimeTo = endTime - (new Date(new Date(endTime).setHours(0,0,0,0))).getTime();
    var intervals = intervalsStr.split(';');

    for(var i = 0; i < intervals.length; i++) {
        var fromTo = intervals[i].split('-');
        if(eventsTimeFrom > Number(fromTo[0]) && eventTimeTo < Number(fromTo[1])) {
            log.debug(eventDescription + ':disabled: the event is disabled at the interval ', fromTo.join('-'), ' : disable from ',
                new Date(disableFrom).toLocaleString(), '; days: ',  disableDaysOfWeekStr, '; intervals: ',
                timeIntervalsToHuman(intervalsStr));
            return true;
        }
    }

    log.debug(eventDescription + ':enabled: disable from ',
        new Date(disableFrom).toLocaleString(), '; days: ',  disableDaysOfWeekStr, '; intervals: ',
        timeIntervalsToHuman(intervalsStr));
    return false;
}

/**
 * Return human readable time intervals
 * @param {string} intervalsStr string with time intervals from the database
 * @return {string} human readable intervals string
 */
function timeIntervalsToHuman(intervalsStr) {
    if(!intervalsStr || typeof intervalsStr !== 'string') return 'all time';

    return intervalsStr.split(';').map(function (interval) {
        var fromTo = interval.split('-');
        //dd = h * 3600000 + m * 60000;
        //m = (dd - h*360000) / 60000

        var from = ('0' + Math.floor(fromTo[0] / 3600000) + ':0' +
            Math.floor((fromTo[0] - Math.floor(fromTo[0] / 3600000) * 3600000) / 60000))
            .replace(/\d(\d\d)/g, '$1');

        var to = ('0' + Math.floor(fromTo[1] / 3600000) + ':0' +
            Math.floor((fromTo[1] - Math.floor(fromTo[1] / 3600000) * 3600000) / 60000))
            .replace(/\d(\d\d)/g, '$1');

        return from + '-' + to;
    }).join(';');
}

