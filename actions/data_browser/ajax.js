/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 12.02.2017.
 */

var async = require('async');
var log = require('../../lib/log')(module);
var rightsWrappersCountersDB = require('../../rightsWrappers/countersDB');
var units = require('../../models_db/countersUnitsDB');
var history = require('../../models_history/history');

module.exports = function(args, callback) {
    log.debug('Starting ajax with parameters', args);

    var func = args.func;

    if (!func) return callback(new Error('Ajax function is not set'));

    if (func === 'getCountersGroups'){
        if(!args.IDs) return callback(new Error('Can\'t get counters groups for objects: objects IDs not specified'));

        return rightsWrappersCountersDB.getGroupsForObjects(args.username, args.IDs.split(','), callback);
    }

    if (func === 'getCounters') {
        if(!args.IDs) return callback(new Error('Can\'t get counters for objects: objects IDs not specified'));
        if(!args.groupsIDs) args.groupsIDs = '';

        return rightsWrappersCountersDB.getCountersForObjects(args.username, args.IDs.split(','), args.groupsIDs.split(','), callback);
    }

    if (func === 'getUnits') return units.getUnits(callback);

    if (func === 'getObjectsCountersValues') {
        if(!args.IDs) return callback(new Error('Can\'t get last values for objects: objectsCounters IDs not specified'));

        return history.getLastValues(args.IDs.split(','), function(err, records) {
            if(!records && err) return callback(err);
            callback(null, records);
        });
    }

    if (func === 'getObjectsCountersHistoryValues') {
        if(!args.IDs) return callback(new Error('Can\'t get history values for objects: objectsCounters IDs not specified'));

        // 1477236595310 = 01.01.2000
        if(!Number(args.to) || Number(args.to)  < 1477236595310) var toDate = (new Date()).getTime();
        else toDate = Number(args.to);

        // 86400000 = 24 hours or 1 day
        if(!Number(args.from) || Number(args.from)  >= toDate) var fromDate = (new Date(toDate - 86400000)).getTime();
        else fromDate = Number(args.from);

        if(Number(args.maxRecordsCnt) === undefined || (Number(args.maxRecordsCnt) > 1 && Number(args.maxRecordsCnt) < 30)) var maxRecordsCnt = 30;
        else maxRecordsCnt = Number(args.maxRecordsCnt);


        var objectsCountersHistoryValues = {};
        async.each(args.IDs.split(','), function(id, callback){
            history.getByTime(id, fromDate, toDate, maxRecordsCnt, function(err, result){
                if(err){
                    log.warn(err.message);
                    return callback();
                }
                if(!result[0]){
                    log.warn('Returned empty history values for object-counter: ', id);
                    return callback();
                }

                objectsCountersHistoryValues[id] = result;
                callback();
            });
        }, function(){
            callback(null, objectsCountersHistoryValues);
        });
    }

};