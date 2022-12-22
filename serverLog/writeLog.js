/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
*/

const fs = require("fs");
const path = require("path");
const createConfig = require('./createConfig');
const auditDB = require('../lib/auditDB');

var logFD = new Map();

module.exports = writeLog;

 // close unused or old log files
closeUnusedLogFiles();

var dateSuffix = setDateSuffix();

function writeLog(data) {
    // get default configuration
    var cfg = createConfig(data.label);
    const logDir = cfg.dir || 'logs';


    if(cfg.logToConsole) console.log(data.message);
    var message = data.message.replace(/([\r\n])|(\x1B\[\d+m)/g, '') + '\n';


    var mainLogFile =
        path.join(String(logDir), String(data.level === 'EXIT' ?
            (cfg.exitLogFileName || 'exit.log') : (cfg.file || 'log.log') + dateSuffix));

    var logFiles = (data.options && Array.isArray(data.options.filenames) ? data.options.filenames : [mainLogFile]);

    if(data.level === 'W' || data.level === 'E') {
        logFiles.push(path.join(String(logDir), (cfg.errorLogFileName || 'error.log') + dateSuffix))
    }

    logFiles.forEach(logFilePath => {
        var stream = openLog(logFilePath);
        stream.fd.write(message);
        stream.timestamp = Date.now();
    });

    auditDB.insertRecords(data, function(err){
        if(err) return writeLog({
            message: 'Error while add log records to audit: ' + err.message,
            level: 'E',
            label: 'log',
        });
    });
}

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
    var month = now.getMonth()+1;
    var date = now.getDate();
    dateSuffix = '.' + String((now.getYear() - 100)) + String(month < 10 ? '0' + month : month) +
        String(date < 10 ? '0' + date: date)

    return dateSuffix;
}

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