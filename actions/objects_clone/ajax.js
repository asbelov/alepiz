/*
 * Copyright © 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
* Created on Mon Apr 09 2018 17:26:59 GMT+0700
*/
var log = require('../../lib/log')(module);
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../rightsWrappers/countersDB');
var objectsProperties = require('../../rightsWrappers/objectsPropertiesDB');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    var func = args.func;

    if (func === 'getInteractions') return objectsDB.getInteractions(args.username, args.ids, callback);

    if (func === 'getCounters') return countersDB.getCountersForObjects(args.username, args.ids, null, callback);

    if (func === 'getProperties') return objectsProperties.getProperties(args.username, args.ids, callback);

    if (func === 'getTemplatesParameters') return objectsDB.getObjectsByIDs(args.username, args.ids.split(','), callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};
