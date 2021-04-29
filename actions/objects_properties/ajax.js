/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getSharedObjectsProperties') {
        if (!args.IDs) return callback(new Error('Can\'t get shared objects properties: objects IDs are not specified'));

        // properties [{name:.., value:.., mode:.., description:..}]
        return objectsPropertiesDB.getSharedProperties(args.username, args.IDs.split(','), callback);
    } else if(args.func === 'getObjectsForProperty') {
        if (!args.propertyName) return callback(new Error('Can\'t get objects for property: property not specified'));

        return objectsPropertiesDB.getObjectsForProperty(args.username, args.propertyName, callback);
    }

    return callback(new Error('Ajax function is not set or unknown function "'+args.func+'"'));
};
