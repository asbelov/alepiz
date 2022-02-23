/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var server = require('../../server/counterProcessor');


module.exports = function(args, callback) {
    log.debug('Starting action server \"'+args.actionName+'\" with parameters', args);

    log.info('OK, I warned you. Sending message to restart server...');
    server.sendMsg({restart: 1});
    callback();
};
