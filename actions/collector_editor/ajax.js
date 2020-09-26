/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 25.07.2015.
 */
var log = require('../../lib/log')(module);
var collectors = require('../../lib/collectors');
var help = require('../../lib/help');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getCollectors') return collectors.get(null, callback);

    if(args.func === 'getCollectorCode') {
        if(!args.name) return callback(new Error('Collector name is not specified for getting collector.js file'));
        collectors.getCollectorCode(args.name, callback);
    }

    if(args.func === 'getHelpLanguages') {
        if(!args.name) return callback(new Error('Collector name is not specified for getting help data'));
        help.getLanguages(collectors.getCollectorPath(args.name), null, function(err, languages) {
            callback(null, languages);
        });
    }

    if(args.func === 'getHelpContent') {
        if(!args.name) return callback(new Error('Collector name is not specified for getting help data'));
        help.getHelpContent(collectors.getCollectorPath(args.name), null, args.lang, callback);
    }
};
