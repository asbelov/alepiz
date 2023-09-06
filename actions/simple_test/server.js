/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const async = require('async');
const _log = require('../../lib/log');

/**
 * Simple test action
 * @param {Object} args action arguments
 * @param {string} args.actionName action name
 * @param {string} args.executionTime action execution time in ms
 * @param {string} args.printDataToLogInterval frequency of printing data to the log
 * @param {string} args.returnValue action returned value
 * @param {string} args.error action returned error message
 * @param {number} args.actionCfg.launcherPrms.sessionID sessionID
 * @param {function(Error)|function(null, string)|function()} callback callback(err, returnedValue)
 */
module.exports = function(args, callback) {
    var log = _log({
        sessionID: args.actionCfg.launcherPrms.sessionID,
        filename: __filename,
    });

    log.info('Starting action ', args.actionName, ', sessionID: ', args.actionCfg.launcherPrms.sessionID,
        ' with parameters ', args);

    var executionTime = parseInt(args.executionTime, 10);
    if(isNaN(executionTime) || executionTime < 0) executionTime = 0;

    var printDataToLogInterval = parseInt(args.printDataToLogInterval, 10);
    if(isNaN(printDataToLogInterval) || printDataToLogInterval < 0) printDataToLogInterval = 1000;

    executeAndPrintDataToLog(executionTime, printDataToLogInterval, args.error, args.returnValue, log, function(err, result) {
        log.info('Action ', args.actionName, ', sessionID: ', args.actionCfg.launcherPrms.sessionID,
            ' finished with result: ', result, ', error: ', err);
        callback(err, result);
    });
};

function executeAndPrintDataToLog(executionTime, printDataToLogInterval, errMessage, returnValue, log, callback) {
    var timeInterval = Math.floor(executionTime / printDataToLogInterval);
    var remainingTime = executionTime / printDataToLogInterval - timeInterval;
    var i = 0;

    async.whilst(() => i < timeInterval, function (callback) {
        log.info('Iteration ', ++i, ' of ', timeInterval);
        setTimeout(callback, printDataToLogInterval);
    }, function () {
        if(errMessage) {
            log.debug('Execution complete with errors: ', errMessage);
            setTimeout(callback, remainingTime, new Error(errMessage));
        } else {
            log.debug('Execution complete without errors and result: "', returnValue, '"');
            return returnValue ?
                setTimeout(callback, remainingTime, null, returnValue) :
                setTimeout(callback, remainingTime);
        }
    });
}
