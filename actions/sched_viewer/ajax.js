/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-8-9 23:19:40
*/
var async = require('async');
var path = require('path');
var log = require('../../lib/log')(module);
var history = require('../../models_history/history');
var usersRolesRightsDB = require('../../models_db/usersRolesRightsDB');
var countersDB = require('../../models_db/countersDB');
var actionsConf = require('../../lib/actionsConf');
var prepareUser = require('../../lib/utils/prepareUser');
var checkIDs = require('../../lib/utils/checkIDs');

var historyDataCnt = 5;
var startTimeCounterName = 'I: Service start time';
var stopTimeCounterName = 'I: Service stop time';
var serviceStateName = 'I: Service state';
var startTimeCounterID, stopTimeCounterID, serviceStateID;

module.exports = function(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    if(args.func !== 'getData' || !args.objects) {
        return callback(new Error('Ajax function is not set or unknown function "' + args.func + '" or objects not selected'));
    }

    try {
        var objects = JSON.parse(args.objects);
    } catch (e) {
        return callback(new Error('Can\'t parse objects: ' + e.message + ' from string: ' + args.objects));
    }

    if(!Array.isArray(objects) || !objects.length) return callback();

    if(Number(args.dataNum) && Number(args.dataNum) === parseInt(String(args.dataNum), 10) &&
        Number(args.dataNum) < 100)  historyDataCnt = Number(args.dataNum);

    var objectsIDs = objects.map(obj => { return obj.id });

    checkIDs(objectsIDs, function(err, checkedIDs) {
        if (err && !checkedIDs) return callback(err);
        var user = prepareUser(args.username);

        usersRolesRightsDB.checkObjectsIDs({
            user: user,
            IDs: checkedIDs,
            errorOnNoRights: true
        }, function (err /*, objectsIDs*/) {
            if (err) return callback(err);

            getCountersIDs(function (err, startTimeCounterID, stopTimeCounterID, serviceStateCounterID) {
                if (err) return callback(err);

                var historyData = {};
                async.eachSeries(objects, function(object, callback) {
                    var objectID = object.id;
                    countersDB.getObjectCounterID(objectID, startTimeCounterID, function (err, startTimeRow) {
                        if(err) {
                            log.warn('Can\'t get startTime OCID for objectID: ' + objectID +
                                ' and startCounterID ' + startTimeCounterID + ': ' + err.message);
                            return callback();
                        }

                        if(!startTimeRow || !startTimeRow.id) {
                            log.warn('Can\'t find startTime OCID for objectID ' + objectID +
                                ', counterID: ' + startTimeCounterID + ': ' + JSON.stringify(startTimeRow));
                            return callback();
                        }

                        countersDB.getObjectCounterID(objectID, stopTimeCounterID, function (err, stopTimeRow) {
                            if(err) {
                                log.warn('Can\'t get stopTime OCID for objectID: ' + objectID +
                                    ' and stopCounterID ' + stopTimeCounterID + ': ' + err.message);
                                return callback();
                            }

                            if(!stopTimeRow || !stopTimeRow.id) {
                                log.warn('Can\'t find stopTime OCID for objectID ' + objectID +
                                    ', counterID: ' + stopTimeCounterID +': ' + JSON.stringify(stopTimeRow));
                                return callback();
                            }

                            countersDB.getObjectCounterID(objectID, serviceStateCounterID, function (err, serviceStateRow) {
                                if (err) {
                                    log.warn('Can\'t get serviceState OCID for objectID: ' + objectID +
                                        ' and serviceStateCounterID ' + serviceStateCounterID + ': ' + err.message);
                                    return callback();
                                }

                                if (!serviceStateRow || !serviceStateRow.id) {
                                    log.warn('Can\'t find serviceState OCID for objectID ' + objectID +
                                        ', counterID: ' + serviceStateCounterID + ': ' + JSON.stringify(serviceStateRow));
                                    return callback();
                                }

                                var startTimeOCID = startTimeRow.id;
                                var stopTimeOCID = stopTimeRow.id;
                                var serviceStateOCID = serviceStateRow.id;

                                history.getByIdx(startTimeOCID, 0, historyDataCnt, 0, function (err, startData) {
                                    if (err) {
                                        log.warn('Can\'t get history data for start times for objectID ' + objectID + ': ' + err.message);
                                        return callback();
                                    }
                                    if(!startData || !startData.length) {
                                        log.warn('History data for counter ' + startTimeCounterName + ' not found');
                                    }

                                    history.getByIdx(stopTimeOCID, 0, historyDataCnt, 0, function (err, stopData) {
                                        if (err) {
                                            log.warn('Can\'t get history data for stop times for objectID ' + objectID + ': ' + err.message);
                                            return callback();
                                        }
                                        if(!stopData || !stopData.length) {
                                            log.warn('History data for counter ' + stopTimeCounterName + ' not found');
                                        }

                                        history.getByIdx(serviceStateOCID, 0, 1, 0, function (err, serviceStateData) {
                                            if (err) {
                                                log.warn('Can\'t get history data for service state for objectID ' + objectID + ': ' + err.message);
                                                return callback();
                                            }
                                            if(!serviceStateData || !serviceStateData.length) {
                                                log.warn('History data for counter ' + serviceStateName + ' not found');
                                            }

                                            historyData[objectID] = {
                                                name: object.name,
                                                start: startData,
                                                stop: stopData,
                                                state: serviceStateData[0].data,
                                            };
                                            callback();
                                        });
                                    });
                                });
                            });
                        });
                    });
                }, function(err) {
                    callback(err, historyData);
                });
            });
        });
    });
};

function getCountersIDs(callback) {
    if(startTimeCounterID && stopTimeCounterID && serviceStateID) {
        return callback(null, startTimeCounterID, stopTimeCounterID, serviceStateID);
    }

    actionsConf.getConfiguration(path.basename(__dirname), function(err, actionCfg) {
        if (err) return callback(err);

        if(typeof actionCfg.startTimeCounterID === 'string') startTimeCounterID = actionCfg.startTimeCounterID;
        if(typeof actionCfg.stopTimeCounterID === 'string') stopTimeCounterID = actionCfg.stopTimeCounterID;
        if(typeof actionCfg.serviceState === 'string') serviceStateName = actionCfg.serviceState;

        countersDB.getCountersIDsByNames([startTimeCounterName, stopTimeCounterName, serviceStateName], function (err, rows) {
            if(err) {
                return callback(new Error('Can\'t get counter IDs by names: ' + startTimeCounterName + ', ' +
                    stopTimeCounterName + ': ' + err.message));
            }

            if(rows.length < 3) {
                return callback(new Error('Can\'t get counter IDs by names: ' + startTimeCounterName + ', ' +
                    stopTimeCounterName + ': counters not found, query result: ' + JSON.stringify(rows)));
            }

            var startTimeCounterID = 0, stopTimeCounterID = 0, serviceStateID = 0;
            rows.forEach(function (row) {
                if(row.name === startTimeCounterName) startTimeCounterID = row.id;
                else if(row.name === stopTimeCounterName) stopTimeCounterID = row.id;
                else if(row.name === serviceStateName) serviceStateID = row.id;
            });
            
            callback(null, startTimeCounterID, stopTimeCounterID, serviceStateID);
        });
    });
}
