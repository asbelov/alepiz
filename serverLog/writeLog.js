/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
*/

const fs = require("fs");
const path = require("path");
const createMessage = require('./createMessage');

var logFD = new Map();

module.exports = writeLog;

 // close unused or old log files
closeUnusedLogFiles();

var dateSuffix = setDateSuffix();

/**
 * Write log message to the log file
 * @param {Object|string} messageObj object with data for create log message and log file name
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} messageObj.level log level
 * @param {string} messageObj.messageBody pure the log message
 * @param {Object} messageObj.cfg configuration from config/log.json for current log label
 * @param {string} [messageObj.label] log message label
 * @param {number} [messageObj.timestamp] log message timestamp
 * @param {number} [messageObj.sessionID] sessionID for action
 * @param {Object} [messageObj.options] log options
 */
function writeLog(messageObj) {
    if(!messageObj) return;

    if (!messageObj.messageBody) return;

    // get default configuration
    var cfg = messageObj.cfg;
    const logDir = String(cfg.dir) || 'logs';

    var date = messageObj.timestamp ? new Date(messageObj.timestamp) : new Date();
    var message = cfg.logLevel === 'D' ? messageObj.messageBody.replace(/[\r\n]/g, '\n\t') : messageObj.messageBody.replace(/[\r\n]/g, '');
    message = createMessage.createHeader(messageObj.level, messageObj.label, messageObj.sessionID, date) +
        (messageObj.additionalLabel ? messageObj.additionalLabel : '') +
        messageObj.messageBody;
    if(cfg.logToConsole) console.log(message);

    message = message
        .replace(/[\r\n]/g, (cfg.wrapLines ? '' : '\n\t'))
        .replace(/\x1B\[\d+m/g, '') + '\n';

    var mainLogFile =
        path.join(logDir, String(messageObj.level === 'EXIT' ?
            (cfg.exitLogFileName || 'exit.log') : (cfg.file || 'log.log') + dateSuffix));

    var logFiles = (messageObj.options && Array.isArray(messageObj.options.filenames) ?
        messageObj.options.filenames.map(filePath => path.join(logDir, filePath + '.log' + dateSuffix)) :
        [mainLogFile]);

    if(messageObj.level === 'W' || messageObj.level === 'E') {
        logFiles.push(path.join(String(logDir), (cfg.errorLogFileName || 'error.log') + dateSuffix))
    }

    logFiles.forEach(logFilePath => {
        var stream = openLog(logFilePath);
        stream.fd.write(message);
        stream.timestamp = Date.now();
    });
}

/**
 * Open stream for log file
 * @param {string} logFilePath path to the log file
 * @returns {stream} stream log file stream
 */
function openLog(logFilePath) {
    if(!logFD.has(logFilePath)) {
        try {
            fs.mkdirSync(path.dirname(logFilePath), {recursive: true});
        } catch (e) {}

        logFD.set(logFilePath, {
            fd: fs.createWriteStream(logFilePath, {flags: 'a'}),
            created: new Date(),
        });
    }
    var stream = logFD.get(logFilePath);
    stream.timestamp = Date.now();
    return stream;
}

/**
 * dateSuffix - if a log file extension, like .<YYMMDD>. dateSuffix updated every day at 00:00 o'clock.
 * @returns {string} dateSuffix like .<YYMMDD>
 */
function setDateSuffix() {
    var nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    var time =  nextDay - Date.now();
    var timer = setTimeout(setDateSuffix, time);
    timer.unref();

    var now = new Date();
    var month = now.getMonth() + 1;
    var date = now.getDate();
    dateSuffix = '.' + String((now.getYear() - 100)) + String(month < 10 ? '0' + month : month) +
        String(date < 10 ? '0' + date: date)

    return dateSuffix;
}

/**
 * Close unused opened log files at 00:03:00
 */
function closeUnusedLogFiles() {
    if(logFD.size) {
        const now = new Date(), dayOfMonth = now.getDate();
        logFD.forEach((stream, logFilePath) => {
            if (now.getTime() - stream.timestamp > 3600000 || stream.created.getDate() !== dayOfMonth) {
                if (stream.fd && typeof stream.fd.end === 'function') stream.fd.end();
                logFD.delete(logFilePath);
            }
        });
    }

    var nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 3, 0, 0);

    var time =  nextDay - Date.now();

    var timer = setTimeout(closeUnusedLogFiles, time);
    timer.unref();
}