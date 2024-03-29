/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');

var browserLog = {};
module.exports = browserLog;

// number of log messages, generated by client javascript in browser for each sessionID: {<sessionID>: <logRecordsCount>}
// If count of log records for session more than 'maxRecordsReturnedFromBrowserForOneSession' log.json parameter,
// then skip to record it
var countOfLogMessagesFromBrowser = new Map();

/**
 * Receive log message from browser and log it, using standard log module
 * @param {'D'|'I'|'W'|'E'} level log level
 * @param {string} argsStr stringified array of log arguments
 * @param {number} sessionID session ID
 * @param {function(Error)|function()} callback callback(err)
 */
browserLog.log = function (level, argsStr, sessionID, callback){
    log.debug('Receiving log record from browser:\nlevel: ', level, '\nargs: ', argsStr, '\nsessionID: ', sessionID);

    if(!argsStr || !level || (level !== 'D' && level !== 'I' && level !== 'W' && level !== 'E')) {
        return callback(new Error('Browser request error: log arguments (' + argsStr +
            ') not specified or invalid log level: ' + level));
    }

    if(!countOfLogMessagesFromBrowser.has(sessionID)) countOfLogMessagesFromBrowser.set(sessionID, 1);
    else {
        var n = countOfLogMessagesFromBrowser.get(sessionID);
        countOfLogMessagesFromBrowser.set(sessionID, ++n);
    }

    if(countOfLogMessagesFromBrowser.get(sessionID) >
        (Number(confLog.get('maxRecordsReturnedFromBrowserForOneSession') || 50))) {
        return callback(new Error('Too many log messages (' + countOfLogMessagesFromBrowser.get(sessionID) +
            ') received from the browser'));
    }

    try {
        var args = JSON.parse(argsStr);
    } catch(err){
        return callback(new Error('Can\'t parse log arguments (' + argsStr + ') received from browser: ' + err.message));
    }

    log.raw(level, args);
    callback();
};

/**
 * Cleanup data for log session
 * @param {number} sessionID session ID
 */
browserLog.deleteSession = function(sessionID){
    countOfLogMessagesFromBrowser.delete(sessionID);
};