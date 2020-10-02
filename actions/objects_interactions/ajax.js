/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
 * Created on Tue Jan 19 2016 15:19:55 GMT+0600 (RTZ 5 (зима))
 */
var log = require('../../lib/log')(module);
var rightsWrapper = require('../../rightsWrappers/objectsDB');

module.exports = function(args, callback) {
    log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (func === 'getInteractions') return rightsWrapper.getInteractions(args.username, args.ids, callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};
