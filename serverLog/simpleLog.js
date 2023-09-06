/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
 Used in node modules that are used for serverLog/*. This avoids cyclical dependencies.
*/

const createLogObject = require('./createLogObject');
const prepareLogMessage = require('./prepareLogMessage');
const createLabel = require('./createLabel');
const {threadId} = require('worker_threads');
const writeLog = require('./writeLog');

// TID_PID = ":<TID>:<PID>" or ":<PID>"
const TID_PID = (threadId ? ':' + threadId + ':' : ':') + process.pid;

/**
 * Create log.debug(), log.info(), log.warn(), log.error(), log.exit() and log.throw() functions
 * Used in node modules that are used for serverLog/*. This avoids cyclical dependencies.
 *
 * @param {NodeModule} parentModule parent node module for create log label and log file name
 * @returns {{warn: Function, exit: Function, debug: Function, throw: Function, error: Function, info: Function}}
 */
module.exports = function (parentModule) {
    for (var mod = parentModule; mod; mod = mod.parent) {
        if (mod.sessionID) {
            var sessionID = Number(mod.sessionID);
            break;
        }
    }
    var label = createLabel(parentModule);
    var logObj = createLogObject(parentModule, sessionID, label, writeToLog);
    logObj.disconnect = function(callback) { if (typeof callback === 'function') callback() };

    return logObj;

    /**
     * Write data to the log file
     * @param {'D'|'I'|'W'|'E'|'EXIT'|'THROW'} level log level
     * @param {Array} args array of the log message data
     */
    function writeToLog(level, args) {
        var dataToSend = prepareLogMessage(level, args, undefined, label);
        if(dataToSend) {
            dataToSend.TID_PID = TID_PID;
            dataToSend.additionalLabel = '*';
            writeLog(dataToSend);
        }

        if(level === 'THROW') process.exit(2);
    }
}

