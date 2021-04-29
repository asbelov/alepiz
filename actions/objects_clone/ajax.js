/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
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

    if (func === 'getAllForCounter') return  countersDB.getAllForCounter(args.username, args.ids.split(','), callback);

    return callback(new Error('Ajax function is not set or unknown function'));
};

/*
objects.
objectsParameters
interactions.objectID1
interactions.objectID2

objectsCounters.counterID
objectsCounters.objectID

counters.groupID
counters.unitID
counters.taskCondition

countersGroups
countersUnits

countersUpdateEvents.parentCounterID
counterUpdateEvents.parentObjectID (may be NULL)
counterUpdateEvents.objectFilter // regExp for filtering depended objects by object name

variables.objectID (may be NULL)
variables.parentCounterName // for get data using a historical function from a specified counter
variables.objectName // for get data using a historical function from a specified object when an objectID is not set. May be a variable

countersParameters (runTask.taskID)

tasks
tasksGroups
tasksActions
auditUsers
taskParameters

 */