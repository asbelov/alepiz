/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const unitsDB = require("../../models_db/countersUnitsDB");

var units = {};
module.exports = toHuman;

toHuman.getUnits = function(callback) {
    var rows = unitsDB.getUnits();

    if(rows && rows.length) {
        rows.forEach(function(unit) {
            if(unit.multiplies) {

                var multiplies = unit.multiplies.split(',');
                var prefixes = unit.prefixes.split(',');
                unit.multiplies = [];
                unit.prefixes = [];

                for (var i = 0; i < multiplies.length; i++) {
                    if ((i === 0 || multiplies[i - 1] < 1) && multiplies[i] > 1) {
                        unit.multiplies.push(1);
                        unit.prefixes.push(unit.abbreviation);
                    }
                    unit.multiplies.push(Number(multiplies[i]));
                    unit.prefixes.push(prefixes[i])
                }

                if (Number(multiplies[multiplies.length - 1]) < 1) {
                    unit.multiplies.push(1);
                    unit.prefixes.push(unit.abbreviation);
                }
            }

            units[unit.name] = unit;
        });
    }
    if(typeof callback === 'function') callback(null, units);
    else return units;
}

/** Convert val to human-readable value with abbreviation suffixes based on specified units of measurement
 *
 * @param {*} val - Convert if val is a number or a string number, or add an abbreviation suffix to val for the
 *      specified unit otherwise
 * @param {string} unitName - one of unit from countersUnits table from DB or
 *      "TimeInterval" for convert to time interval (f.e 3900000 => 1hour 5min)
 *      By default, the countersUnits table contains units of measurement "Bytes", "Bits", "Time", "TimeInterval"
 *      "Percents", "Bytes/sec".
 * @returns {string|number|null} - converted value
 * @example
 * Description for unitName set to 'Time' or 'TimeInterval':
 *
 * if unitName set to 'Time' and val > 1477236595310000 = 01/01/2000 then return date using new Date(val).toLocaleString().
 * Else if val > 1477236595310000 return string 'always'.
 * Else if val < 86400000 (one day) and unitName set to 'Time' then return time in format HH:MM:SS.
 * Else return time intervals like:
 * 0  =  '0sec'
 * 10.1232342  =  '10.12sec'
 * 0.87  =  '0.87sec'
 * 0.32  =  '0.32sec'
 * 345213123654123  =  '10946636years 124days'
 * 12314234.232  =  '142days 12hours'
 * 36582.98  =  '10hours 9min'
 * 934  =  '15min 34sec'
 * 3678.335  =  '1hour 1min'
 * 86589  =  '1day 3min'
 */
function toHuman(val, unitName) {

    if(val === null) return val;

    var isNumber = false;
    if(!isNaN(parseFloat(val)) && isFinite(val)) {
        val = Number(val);
        isNumber = true;
    }

    if((unitName === 'Time' || unitName === 'TimeInterval') && isNumber  && val > 1) {
        return secondsToHuman(val / 1000, unitName);
    }

    var unit = units[unitName];

    if(!unit || !unit.name) {
        if(!isNumber) {
            if(val === undefined) return '';
            else if(typeof val !== 'string') val = String(val);
            return val.length > 1024 ? val.slice(0, 128) + '...' : val;
        }
        if(val === 0) return 0;
        return Math.round(val * 100) / 100;
    }

    if(!isNumber) return val + unit.abbreviation;

    if(!unit.multiplies[0]) return String(Math.round(val * 100) / 100) + unit.abbreviation;

    // searching true multiplier index 'i'
    for (var i = 0; i < unit.multiplies.length && val / unit.multiplies[i] > 1; i++){} --i;

    if(i < 0) return String(val) + unit.abbreviation;

    var newVal = Math.round(val / unit.multiplies[i] * 100) / 100;

    if(unit.onlyPrefixes || unit.prefixes[i] === unit.abbreviation) var suffix = unit.prefixes[i];
    else suffix = unit.prefixes[i] + unit.abbreviation;

    return newVal + suffix;
}

/**
 * Convert time in seconds to human-readable form. If seconds > 1477236595310 = 01/01/2000, then return standard date
 *      using new Date(seconds).toLocaleString(). Else return time lake '10hours 9min' or '1day 3min' etc
 * @param {number} seconds - number of seconds
 * @param {string} unitName - if not 'TimeInterval' and seconds > 1477236595310 then return date
 * using new Date(seconds).toLocaleString(). Else if seconds > 1477236595310 return 'always'.
 * Else if seconds < 86400 (one day) && unitName === 'Time' return time in format HH:MM:SS.
 * Else return time intervals like '10hours 9min' or '1day 3min' etc
 * @returns {string} - Human readable time string
 * @example
 * returned values for unitName 'Time' can be
 * 0  =  '0sec'
 * 10.1232342  =  '10.12sec'
 * 0.87  =  '0.87sec'
 * 0.32  =  '0.32sec'
 * 345213123654123  =  '10946636years 124days'
 * 12314234.232  =  '142days 12hours'
 * 36582.98  =  '10hours 9min'
 * 934  =  '15min 34sec'
 * 3678.335  =  '1hour 1min'
 * 86589  =  '1day 3min'
 */
function secondsToHuman ( seconds, unitName ) {
    // 1477236595310 = 01/01/2000)
    if(seconds > 1477236595310 && unitName !== 'TimeInterval') {
        return new Date(seconds).toLocaleString().replace(/\.\d\d(\d\d),/, '.$1');
    }

    // 1477236595310 = 01/01/2000
    if(seconds > 1477236595310) return 'always';

    if(seconds < 86400 && unitName === 'Time') {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds - h * 3600) / 60);
        var s = Math.floor(seconds % 60 );
        return String('0' + h + ':0' + m + ':0' + s).replace(/0(\d\d)/g, '$1');
    }

    return [   [Math.floor(seconds / 31536000), function(y) { return y === 1 ? y + 'year ' : y + 'years ' }],
        [Math.floor((seconds % 31536000) / 86400), function(y) { return y === 1 ? y + 'day ' : y + 'days ' }],
        [Math.floor(((seconds % 31536000) % 86400) / 3600), function(y) { return y + (y === 1 ? 'hour ' : 'hours ' )}],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), function(y) {return y + 'min '}],
        [Math.floor((((seconds % 31536000) % 86400) % 3600) % 60), function(y) {return y + 'sec'}]
    ].map(function(level) {
        return level[0] ? level[1](level[0]) : '';
    }).join('').replace(/^([^ ]+ [^ ]+) ?.*$/, '$1').replace(/(\.\d\d)\d*/, '$1 ').trim() || '0 sec';
}