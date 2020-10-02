/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
async = require('async');
var usersDB = require('../../models_db/usersDB');
var communication = require('../../lib/communication');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getInfo'){
        async.parallel({
            users: function (callback) {
                usersDB.getUsersInformation(null, callback);
            },
            user: function(callback) { callback(null, args.username); },
            priorities: usersDB.gerPriorityDescriptions,
            medias: communication.getMedias,

        }, callback); // err, result
        return
    }

    return callback(new Error('Ajax function is not set or unknown function "'+args.func+'"'));
};
