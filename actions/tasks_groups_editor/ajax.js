/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 20.06.2017.
 */
var log = require('../../lib/log')(module);
var tasksDB = require('../../models_db/tasksDB');
var usersDB = require('../../models_db/usersDB');

module.exports = function(args, callback) {
    log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (!func) return callback(new Error('Ajax function is not set'));

    // callback(err, groups); groups = [{id:.., name:..}, {..}]
    if (func === 'getTasksGroups') return tasksDB.getTasksGroupsList(callback);
    if(func === 'getRolesInformation') return usersDB.getRolesInformation(callback);
    if(func === 'getTasksGroupsRoles') return tasksDB.getRoles(callback);

    return callback(new Error('Ajax function is not set or unknown function'));

};