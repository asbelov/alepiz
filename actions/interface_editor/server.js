/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 04.09.2022, 22:55:38
*/
var log = require('../../lib/log')(module);
var actionClient = require('../../serverActions/actionClient');

module.exports = function(args, callback) {
    log.info('Starting action server "', args.actionName, '" with parameters', args);
    
    try {
        var config = JSON.parse(args.config);
    } catch (err) {
        return callback(new Error('Error parse interface configuration: ' + err.message + ': ' + args.config));
    }

    // run JSON.stringify(config) again for remove spaces from args.config
    actionClient.actionConfig(args.username, 'setActionConfig', '__AlepizMainMenuCustomization',
        JSON.stringify(config),function (err) {
        if(err) return callback(err);
        
        log.info('Complete saving user ', args.username, ' configuration: ', config);
        callback(null, config);
    });
};