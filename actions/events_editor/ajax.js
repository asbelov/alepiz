/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-4-9 21:01:14
*/

var fs = require('fs');
var path = require('path');
var log = require('../../lib/log')(module);
var sqlite = require('../../lib/sqlite');
var conf = require('../../lib/conf');
var prepareUser = require('../../lib/utils/prepareUser');
var countersGroups = require('../../models_db/countersGroupsDB');
var countersRightsWrapperDB = require('../../rightsWrappers/countersDB');
var countersDB = require('../../models_db/countersDB');
var objectsRightsWrapperDB = require('../../rightsWrappers/objectsDB');

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
        conf.get('collectors:event-generator:dbPath'),
        conf.get('collectors:event-generator:dbFile'));

    sqlite.init(dbPath, function (err, _db) {
        if (err) return callback(new Error('Can\'t initialise event database ' + dbPath + ': ' + err.message));

        _db.exec('PRAGMA journal_mode = WAL', function (err) {
            if (err) return callback(new Error('Can\'t set journal mode to WAL: ' + err.message));

            db = _db;
            log.info('Initializing events system database is completed');
            return ajax(args, callback);
        });
    });
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

    getOCIDs(user, objectsIDs, function (err, OCIDsrows) {
        if(err) return callback(err);

        var countersIDs = [], OCIDs = {};
        if(OCIDsrows) {
            OCIDsrows.forEach(function (row) {
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

                db.all('SELECT * FROM hints', function(err, hintsRows) {
                    if(err) {
                        return callback(new Error('Can\'t get hints: ' + err.messages));
                    }


                    db.all('SELECT disabledEvents.OCID AS OCID, disabledEvents.disableUntil AS disableUntil, ' +
                        'disabledEvents.intervals AS intervals, \n' +
                        'comments.subject AS subject, comments.comment AS comment FROM disabledEvents ' +
                        'JOIN comments ON disabledEvents.commentID=comments.id',
                        function (err, disabledRows) {

                        if(err) {
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
                        if(OCIDsrows) {
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
                                (!OCIDsrows || countersIDs.indexOf(rowCounter.id) !== -1)) {

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

/*
function getComments(objectsIDs, callback) {
    if(!Array.isArray(objectsIDs) || !objectsIDs.length) return callback();

    var rows = [];

    // SELECT max (timestamp) AS timestamp... is used to reverse sort events when using GROUP BY events.counterID ORDER BY events.timestamp DESC
    var stmt = db.prepare('SELECT events.counterID AS counterID, events.objectID AS objectID, ' +
        'comments.user AS user, comments.timestamp AS timestamp, comments.subject AS subject, comments.comment AS comment ' +
        'FROM (SELECT max(timestamp) AS timestamp, counterID, objectID, commentID FROM events GROUP BY events.counterID ORDER BY events.timestamp DESC) AS events ' +
        'JOIN comments ON comments.id=events.commentID ' +
        'WHERE events.objectID = ?', function (err) {
        if(err) {
            return callback(new Error('Can\'t prepare stmt to get comments for ' + objectsIDs.join(',') + ': ' + err.messages));
        }

        async.eachLimit(objectsIDs, 100, function (objectID, callback) {
            stmt.all(Number(objectID), function (err, _rows) {
                if(err) {
                    return callback(new Error('Can\'t get comments for ' + objectID + '/' + objectsIDs.join(',') + ': ' + err.messages));
                }

                //_rows.forEach(row => log.warn('Comment size: ', row.comment.length, '; ', new Date(row.timestamp)));
                rows.push.apply(rows, _rows);
                callback();
            });
        }, function(err) {
            if(err) return callback(err);
            stmt.finalize();

            var comments = {};
            if(commentsRows) {
                commentsRows.forEach(function (comment) {
                    if (!comments[comment.counterID]) comments[comment.counterID] = {};
                    comments[comment.counterID][comment.objectID] = comment;
                });
            }

            callback(err, comments);
        });
    });
}
 */