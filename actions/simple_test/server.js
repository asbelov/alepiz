/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);

/**
 * Simple test action
 * @param {Object} args action arguments
 * @param {string} args.actionName action name
 * @param {string} args.executionTime action execution time in ms
 * @param {string} args.returnValue action returned value
 * @param {string} args.error action returned error message
 * @param {function(Error)|function(null, string)|function()} callback callback(err, returnedValue)
 */
module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var executionTime = parseInt(args.executionTime, 10);
    if(!executionTime || executionTime < 0) executionTime = 0;

    if(args.error) {
        log.debug('Executing action "', args.actionName, '" complete with errors: ', args.error);
        return setTimeout(callback, executionTime, new Error(args.error));
    }

    log.debug('Executing action "', args.actionName, '" complete without errors and result: "', args.returnValue, '"');

    return args.returnValue ?
        setTimeout(callback, executionTime, null, args.returnValue) :
        setTimeout(callback, executionTime);
};
