/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const util = require('util');
const {threadId} = require('worker_threads');
const PID = process.pid;

module.exports = createMessage;

// TID_PID = ":<TID>:<PID>" or ":<PID>"
const TID_PID = (threadId ? ':' + threadId + ':' : ':') + PID;

var levelsColors = {
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

function setColor(str, level) {
    if(level in levelsColors) return consoleColors[levelsColors[level][0]] + str + consoleColors[levelsColors[level][1]];
    else return str;
}

function createMessageBody(args, level, objectDepth) {
    return args.map(arg => {
        if (typeof arg === 'number'/* || !isNaN(arg)*/) return setColor(String(arg), 'number');
        if (typeof arg === 'string') return setColor(arg.replace(/[\r\n]+$/, ''), level);
        if (typeof arg === 'boolean') return setColor(String(arg), 'boolean');

        try {
            return ('\n' + util.inspect(arg, {
                colors: true,
                showHidden: true,
                depth: objectDepth,
            }));
        } catch(err) {
            return '(ERROR CONVERTING OBJECT TO STRING: ' + err.message+')'
        }
    }).join('');
}

function createMessage(args, level, label, objectDepth) {
    const date = new Date();
    const timeStr = date.toLocaleTimeString() + '.' +
        String('00' + date.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

    return setColor((timeStr), 'timestamp') +
        (label ? '[' + label + TID_PID + ']' : '') +
        level + ': ' + createMessageBody(args, level, objectDepth);
}