/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    if(args.error){
        log.debug('Executing action "', args.actionName, '" complete with errors: ', args.error);
        return callback(new Error(args.error));
    }

    log.debug('Executing action "', args.actionName, '" complete without errors and result: "', args.returnValue, '"');
    return args.returnValue ? callback(null, args.returnValue) : callback();
};
