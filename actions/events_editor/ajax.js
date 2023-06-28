/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-4-9 21:01:14
*/

const fs = require('fs');
const path = require('path');
const log = require('../../lib/log')(module);
const Conf = require('../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confOptionsEventGenerator = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
const prepareUser = require('../../lib/utils/prepareUser');
const countersGroups = require('../../models_db/countersGroupsDB');
const countersRightsWrapperDB = require('../../rightsWrappers/countersDB');
const countersDB = require('../../models_db/countersDB');
const objectsRightsWrapperDB = require('../../rightsWrappers/objectsDB');
const Database = require("better-sqlite3");

var db;

module.exports = ajax; // initDB need to run ajax again in recursion

function ajax(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    if(!db) return initDB(args, callback);

    if(args.func === 'getData') {
        countersGroups.get(function (err, counterGroupsRows) {
            if(err) return callback(err);

            getImportanceAndMontNames(function (err, importance, monthNames) {
                if(err) return callback(err);

                var objectsIDs = args.objectsIDs ? args.objectsIDs.split(',') : null;
                getEvents(prepareUser(args.username), objectsIDs, function(err, events) {
                    if(err) return callback(err);

                    callback(null, {
                        importance: importance,
                        monthNames: monthNames,
                        countersGroups: counterGroupsRows,
                        events: events,
                    });
                });
            });
        });
        return;
    }

    if(args.func === 'getAllCounters') return countersRightsWrapperDB.getAllCounters(args.username, callback);

    return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
}

function initDB(args, callback) {
    var dbPath = path.join(__dirname, '..', '..',
        confOptionsEventGenerator.get('dbPath'),
        confOptionsEventGenerator.get('dbFile'));

    try {
        db = new Database(dbPath, {readonly: true, fileMustExist: true});
    } catch (err) {
        return callback(new Error('Can\'t initialise event database ' + dbPath + ': ' + err.message));
    }
    log.info('Initializing events system database is completed');
    return ajax(args, callback);
}


function getImportanceAndMontNames(callback) {
    var dashboardConfigFile = path.join(__dirname, '..', 'dashboard', 'config.json');
    fs.readFile(dashboardConfigFile, 'utf8', function (err, cfgStr) {
        if(err) {
            return callback(new Error('Can\'t read dashboard configuration file ' + dashboardConfigFile +
            ' for get events importance information: ' + err.message));
        }

        try {
            var cfg = JSON.parse(cfgStr);
        } catch (e) {
            return callback(new Error('Can\'t parse dashboard configuration file ' + dashboardConfigFile +
                ' for get events importance information: ' + e.message));
        }

        if(typeof cfg.importance !== 'object') {
            return callback(new Error('Can\'t find importance information in dashboard configuration file ' +
                dashboardConfigFile));
        }

        callback(null, cfg.importance, cfg.monthNames);
    });
}

function getEvents(user, objectsIDs, callback) {

    getOCIDs(user, objectsIDs, function (err, OCIDsRows) {
        if(err) return callback(err);

        var countersIDs = [], OCIDs = {};
        if(OCIDsRows) {
            OCIDsRows.forEach(function (row) {
                countersIDs.push(row.counterID);
                OCIDs[row.id] = row;
            });
        }

        countersRightsWrapperDB.getAllCounters(user, function (err, countersRows) {
            if(err) {
                return callback(new Error('Can\'t get counter list for user ' + user + ': ' + err.message));
            }

            countersDB.getAllParameters(function (err, parametersRows) {
                if(err) {
                    return callback(new Error('Can\'t get counter parameters: ' + err.message));
                }
                var params = {};
                parametersRows.forEach(function (param) {
                    if(!params[param.counterID]) params[param.counterID] = {};
                    params[param.counterID][param.name] = param.value;
                });

                try {
                    var hintsRows = db.prepare('SELECT * FROM hints').all();
                } catch (err) {
                    return callback(new Error('Can\'t get hints: ' + err.messages));
                }

                try {
                    var disabledRows = db.prepare('SELECT disabledEvents.OCID AS OCID, disabledEvents.disableUntil AS disableUntil, ' +
                        'disabledEvents.intervals AS intervals, \n' +
                        'comments.subject AS subject, comments.comment AS comment FROM disabledEvents ' +
                        'JOIN comments ON disabledEvents.commentID=comments.id').all();
                } catch (err) {
                    return callback(new Error('Can\'t get disabled events: ' + err.messages));
                }

                var hints = {};
                hintsRows.forEach(function (hint) {
                    var counterID = hint.counterID || (hint.OCID && OCIDs[hint.OCID] ? OCIDs[hint.OCID].counterID : null);
                    if(!counterID) return;
                    var objectID = hint.OCID ? OCIDs[hint.OCID].objectID : 0;

                    if(!hints[counterID]) hints[counterID] = {};
                    hints[counterID][objectID] = hint;
                });

                var disabledEvents = {};
                if(OCIDsRows) {
                    disabledRows.forEach(function (disabled) {
                        var OCID = OCIDs[disabled.OCID];
                        if (OCID) {
                            if(!disabledEvents[OCID.counterID]) disabledEvents[OCID.counterID] = {};
                            disabledEvents[OCID.counterID][OCID.objectID] = disabled;
                        }
                    });
                }

                var filteredCounters = {};
                countersRows.forEach(function (rowCounter) {
                    var param = params[rowCounter.id];
                    if(!param) {
                        log.warn('Undefined collector parameters for ', rowCounter);
                        return;
                    }
                    if(rowCounter.collectorID === 'event-generator' &&
                        (!OCIDsRows || countersIDs.indexOf(rowCounter.id) !== -1)) {

                        filteredCounters[rowCounter.id] = {
                            counterID: rowCounter.id,
                            name: rowCounter.name,
                            groupID: rowCounter.groupID,
                            keepHistory: rowCounter.keepHistory,
                            keepTrends: rowCounter.keepTrends,
                            counterDescription: rowCounter.description,
                            counterDisabled: rowCounter.disabled,
                            debug: rowCounter.debug,
                            taskCondition: rowCounter.taskCondition,
                            importance: param.importance, // can be not an Number
                            description: param.eventDescription,
                            pronunciation: param.pronunciation,
                            duration: param.eventDuration,
                            problemTaskID: param.problemTaskID,
                            solvedTaskID: param.solvedTaskID,
                            hints: hints[rowCounter.id],
                            //comments: comments[rowCounter.id],
                            disabled: disabledEvents[rowCounter.id],
                        };
                    }
                });
                callback(null, filteredCounters);
            });
        });
    });
}

function getOCIDs(user, objectsIDs, callback) {
    if(!objectsIDs) return callback();

    objectsRightsWrapperDB.getObjectsCountersIDs(user, objectsIDs, function (err, rows) {
        if(err) {
            return callback(new Error('Can\'t get OCIDs for user ' + user + ', objectsIDs ' + objectsIDs.join(',') +
                ': ' + err.message));
        }

        return callback(null, rows);
    });
}