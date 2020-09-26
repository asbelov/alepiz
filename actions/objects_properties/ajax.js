/*
 * Copyright © 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var objectsDB = require('../../rightsWrappers/objectsPropertiesDB');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getSharedObjectsProperties') {
        if (!args.IDs) return callback(new Error('Can\'t get shared objects properties: objects IDs are not specified'));

        // properties [{name:.., value:.., mode:.., description:..}]
        return objectsDB.getSharedProperties(args.username, args.IDs.split(','), callback);
    }

    return callback(new Error('Ajax function is not set or unknown function "'+args.func+'"'));
};
