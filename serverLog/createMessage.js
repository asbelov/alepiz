/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const util = require('util');

var createMessage = {};
module.exports = createMessage;

// colors for different log level and object types
var colorsLabels = {
    S:          ['fgGrey','fgDefault'],
    D:          ['fgGreen','fgDefault'],
    I:          ['fgDefault','fgDefault'],
    W:          ['fgBlue','fgDefault'],
    E:          ['fgRed','fgDefault'],
    EXIT:       ['fgMagenta','fgDefault'],
    timestamp:  ['fgDefault','fgDefault'],
    number:     ['attrUnderlined','attrReset'],
    boolean:    ['attrDim','attrReset'],
};

// console colors specifications
// http://wiki.bash-hackers.org/scripting/terminalcodes
//    \0x1b = 27 = ←: Esc character
var consoleColors = {
    // foreground colors
    fgBlack:        '\u001b[30m',
    fgRed:          '\u001b[31m',
    fgGreen:        '\u001b[32m',
    fgYellow:       '\u001b[33m',
    fgBlue:         '\u001b[34m',
    fgMagenta:      '\u001b[35m',
    fgCyan:         '\u001b[36m',
    fgWhite:        '\u001b[37m',
    fgDefault:      '\u001b[39m',

    // background colors
    bgBlack:        '\u001b[40m',
    bgRed:          '\u001b[41m',
    bgGreen:        '\u001b[42m',
    bgYellow:       '\u001b[43m',
    bgBlue:         '\u001b[44m',
    bgMagenta:      '\u001b[45m',
    bgCyan:         '\u001b[46m',
    bgWhite:        '\u001b[47m',
    bgDefault:      '\u001b[49m',

    // attributes
    attrReset:      '\u001b[0m',
    attrBright:     '\u001b[1m',
    attrDim:        '\u001b[2m',
    attrUnderlined: '\u001b[4m', //set smul unset rmul :?:	Set "underscore" (underlined text) attribute
    attrBlink:      '\u001b[5m',
    attrReverse:    '\u001b[7m',
    attrHidden:     '\u001b[8m'
};

/** Set color for a string
 * @param {string} str part of the log message for se color
 * @param {string} colorLabel message color label
 * @returns {string} part of the log message with color
 */
function setColor(str, colorLabel) {
    if(colorLabel in colorsLabels) {
        return consoleColors[colorsLabels[colorLabel][0]] + str + consoleColors[colorsLabels[colorLabel][1]];
    }
    else return str;
}

/**
 * Create log message header with time, label, level, PID, TID
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level message debug level
 * @param {string} label label for log message. Usually it is a path to the .js file, separated by ":"
 * @param {number|null} sessionID sessionID or null
 * @param {Date} [date] log message timestamp
 * @param {string} TID_PID string [<threadID>:]<process ID>
 * @returns {string} log message header
 */
createMessage.createHeader = function (level, label, sessionID, date, TID_PID) {
    if(!date) date = new Date();

    // add date for log level EXIT or THROW
    const timeStr = (level.length > 1 ? date.toLocaleString() : date.toLocaleTimeString()) + '.' +
        String('00' + date.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

    return setColor((timeStr), 'timestamp') +
        setColor((label ? ' [' + label + TID_PID + ']' : ' ') +
            (sessionID ? '[' + sessionID + '] ' : ' ') + level + ': ', level);
}

/**
 * Convert args to string and create message body
 * @param {Array} args array of the message parts. Parts can be any types
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level message debug level
 * @param {{
 *     printObjectWithDepth: number,
 *     printMaxArrayLength: number,
 *     printMaxStringLength: number,
 *     printCompactLevel: number,
 *     printBreakLength: number,
 * }} cfg log object size
 * @returns {string} message body
 */
createMessage.createBody = function (args, level, cfg) {

    var objectDepth = Number(cfg.printObjectWithDepth) || 10;
    var maxArrayLength = Number(cfg.printMaxArrayLength) || 100;
    var maxStringLength = Number(cfg.printMaxStringLength) || 2000;
    var compactLevel = cfg.printCompactLevel === false ? false : Number(cfg.printCompactLevel) || 10;
    var breakLength= Number(cfg.printBreakLength) || 80;

    return args.map(arg => {
        if (typeof arg === 'number') return setColor(String(arg), 'number');
        if (typeof arg === 'boolean') return setColor(String(arg), 'boolean');
        if (typeof arg === 'string') {
            if(arg.length > maxStringLength) arg = arg.substring(0, maxStringLength) + '...';
            return setColor(arg.replace(/[\r\n]+$/, ''), level);
        }

        try {
            return (util.inspect(arg, {
                colors: true,
                showHidden: true,
                depth: objectDepth,
                maxArrayLength: maxArrayLength,
                maxStringLength: maxStringLength, // strings in the objects
                compact: compactLevel,
                breakLength: breakLength,
            }));

            // use util.inspect formatting
            //if (typeof arg === 'string') return str.replace(/[\r\n]+$/, '');
            //return str.split('\n').length > 1 ? '\n' + str : str.replace('\n', '');
        } catch(err) {
            return '(ERROR CONVERTING OBJECT TO STRING: ' + err.message+')'
        }
    }).join('');
}
