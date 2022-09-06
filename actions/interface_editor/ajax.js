/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 04.09.2022, 22:55:38
*/
var log = require('../../lib/log')(module);
var actionClient = require('../../serverActions/actionClient');
var Conf = require('../../lib/conf');

const confActions = new Conf('config/actions.json');
const confNavBarLinks = new Conf('config/navBarLinks.json');
const confObjectGroups = new Conf('config/objectGroups.json');
const confObjectFilters = new Conf('config/objectFilters.json');


module.exports = function(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    if(args.func === 'getConfig') {
        actionClient.actionConfig(args.username, 'getActionConfig', '__AlepizMainMenuCustomization',
            null, function (err, config) {

            if(err) return callback(err);
            callback(null, {
                config: config,
                actionsLayout: confActions.get('layout'),
                navBarLinks: confNavBarLinks.get(),
                objectGroups: confObjectGroups.get(),
            });
            log.info('Getting user configuration: ', config);
        });
        return;
    }

    return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
};