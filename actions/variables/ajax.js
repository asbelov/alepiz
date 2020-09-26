/*
 * Copyright (C) 2019. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var rightsWrappersCountersDB = require('../../rightsWrappers/countersDB');
var groupsDB = require('../../models_db/countersGroupsDB');
var dynamicLog = require('../../lib/dynamicLog');

dynamicLog.connect(function(err) {
    if(err) return log.error(err.message);
    log.info('Connecting to dynamic log');
});

module.exports = function(args, callback) {
    log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if(!func) return callback(new Error('Ajax function is not set'));

    if(func === 'getCountersGroups') return groupsDB.get(callback);

    // rows: [{id:.., name:.., unitID:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
    if(func === 'getCountersForObjects') return rightsWrappersCountersDB.getCountersForObjects(args.username, args.ids, (!args.groupID || args.groupID === '0' ? null : [Number(args.groupID)]), callback);

    if(func === 'getVariablesInfo') return dynamicLog.get('variables', args.OCID, callback);

    callback(new Error('Unknown function ' + func));
};
