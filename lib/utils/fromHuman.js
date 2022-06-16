/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

module.exports = fromHuman;

/** Convert numeric (maybe a float) with abbreviation suffixes "Kb", "Mb", "Gb", "Tb" to bytes or
 * "s", "m", "h", "d" (day), "w" (week) to milliseconds. F.e. 2Mb => 2097152; 1.5h => 2400000
 * Abbreviation suffix is case-insensitive. Returns an argument without conversion if it is a number or not a string
 * If conversion failed, return undefined
 *
 * @param {number|string|*} val - value for convert
 * @returns {number|undefined|*} - numeric converted value or unmodified value if value for convert is not a string
 * or undefined when error occurred
 */
function fromHuman(val) {
    if(!isNaN(parseFloat(val)) && isFinite(val)) return Number(val); // pure numeric
    if(typeof val !== 'string') return val;

    var n1 = val.trim();
    // check for abbreviation after numeric
    var res = n1.match(/^([+\-]?\d*\.?\d+(?:e[+\-]?\d+)?)(([KMGT]b)|([smhdw]))$/i);
    //log.debug(res)
    if(!res) return val; // no abbreviation after numeric

    var digit = Number(res[1]);
    var abr = res[2] ? res[2].toLowerCase() : '';

    if(abr === 'kb') return digit * 1024; // convert from Kilobytes to bytes
    if(abr === 'mb') return digit * 1048576; // convert from Megabytes to bytes
    if(abr === 'gb') return digit * 1073741824; // convert from Gigabytes to bytes
    if(abr === 'tb') return digit * 1099511627776; // convert from Terabytes to bytes
    if(abr === 's') return digit * 1000; // convert from minutes to milliseconds
    if(abr === 'm') return digit * 60000; // convert from seconds to milliseconds
    if(abr === 'h') return digit * 3600000; // convert from hours to milliseconds
    if(abr === 'd') return digit * 86400000; // convert from days to milliseconds
    if(abr === 'w') return digit * 604800000; // convert from weeks to milliseconds
}
