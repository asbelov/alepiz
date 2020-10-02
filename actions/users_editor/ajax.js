/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var usersDB = require('../../models_db/usersDB');
var communication = require('../../lib/communication');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getUsersInformation') return usersDB.getUsersInformation(null, callback);
    if(args.func === 'getRolesInformation') return usersDB.getRolesInformation(callback);
    if(args.func === 'getPriorityDescriptions') return usersDB.gerPriorityDescriptions(callback);
    // callback(err, medias), medias = {<mediaID>: {description: <description>}, ...}; mediaID is a media dir
    if(args.func === 'getMedias') return communication.getMedias(callback);

    return callback(new Error('Ajax function is not set or unknown function "'+args.func+'"'));
};
