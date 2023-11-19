/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-4-9 21:01:14
*/
var fs = require('fs');
var path = require('path');
var async = require('async');

const _log = require('../../lib/log');
var checkIDs = require('../../lib/utils/checkIDs');
var prepareUser = require('../../lib/utils/prepareUser');
var userRolesRights = require('../../models_db/usersRolesRightsDB');
var transactions = require('../../models_db/modifiers/transaction');
var counterDB = require('../../models_db/countersDB');
var counterSaveDB = require('../../models_db/modifiers/countersDB');
var activeCollector = require('../../server/activeCollector');


var collectorName = 'event-generator';

/**
 * Change event and counter settings
 * @param {Object} args
 * @param {string} args.actionName action name
 * @param {string} args.switchOnHint used the hint editor
 * @param {string} args.switchOnSettings used settings editor
 * @param {string} args.switchOnDisable used the event disable editor
 * @param {string} args.counterGroup counter group ID
 * @param {string} args.counterDescriptionShared counter description
 * @param {string} args.counterDisabledCBShared is counter disabled
 * @param {string} args.debugCBShared is counter in debug mode
 * @param {string} args.taskConditionCBShared is counter used as a task execution condition
 * @param {string} args.counterDisabledCB is counter disabled
 * @param {string} args.debugCB is counter in debug mode
 * @param {string} args.taskConditionCB is counter used as a task execution condition
 * @param {string} args.disableFromDate event disabled from date
 * @param {string} args.disableUntilDate event disabled until date
 * @param {string} args.disableFromTime event disabled from time
 * @param {string} args.disableUntilTime event disabled until time
 * @param {string} args.counterName counter name
 * @param {string} args.collectorName collector name
 * @param {string} args.keepHistory days to keep history for counter
 * @param {string} args.keepTrends days to keep trends for counter
 * @param {string} args.counterID counter ID
 * @param {string} args.timestamp counter change timestamp
 * @param {string} args.counterDescription counter description
 * @param {string} args.username user name
 * @param {Object} args.actionCfg action configuration
 * @param {string} args.o Stringified objects array like [{id:.., name:..}, ...]
 * @param {function()|function(Error)} callback callback(err)
 */
module.exports = function(args, callback) {
    var log = _log({
        sessionID: args.actionCfg.launcherPrms.sessionID,
        filename: __filename,
    });

    log.info('Starting action server "', args.actionName, '"; save hint: ' + (args.switchOnHint || 'off') +
        ', disabled: ' + (args.switchOnDisable || 'off') +', settings: ' + (args.switchOnSettings || 'off') +
        ';  parameters', args);

    if(!args.switchOnDisable && !args.switchOnSettings && !args.switchOnHint) {
        log.info('All tabs are disabled. Nothing to save. Exiting');
        return callback();
    }

    if(args.switchOnDisable && args.o === '[]') {
        log.info('Objects were not selected for disable counters. Exiting');
        return callback();
    }

    checkParametersAndRights(args, function (err, param) {
        if(err) return callback(err);

        saveChanges(args, param, callback);
    });


    /**
     * Save changes for event
     * @param {Object} args action parameters
     * @param {{
     *     objectsIDs: Array<number>,
     *     countersIDs: Array<number>,
     *     importance: number
     *     disableUntil: number,
     *     countersParameters: Object,
     * }} param preprocessed action parameters
     * @param {function} callback callback(err)
     */
    function saveChanges(args, param, callback) {

        counterDB.getObjectsCountersInfo(param.countersIDs, function(err, rows) {
            if(err) {
                return callback(new Error('Can\'t get object counters information: ' + err.message + ': ' +
                    JSON.stringify(param, null, 4)));
            }

            var events = (param.objectsIDs.length ?
                rows.filter(o => param.objectsIDs.indexOf(o.objectID) !== -1) : rows);

            activeCollector.connect(collectorName, function (err, collector) {
                if (err) return callback(err);

                var collectorParam = {
                    action: 'eventEditor',
                    user: prepareUser(args.username),

                    preventHintChangingOperation: !args.switchOnHint,
                    hintSubject: args['hint-subject'],
                    hintComment: args.hint,
                    addAsHintForObject: args['link-hint-to-objects-cb'],

                    preventDisableOperation: !param.objectsIDs.length || !args.switchOnDisable,
                    disableUntil: param.disableUntil, // if null then enable disabled events
                    disableFrom: args.disableFrom,
                    disableDaysOfWeek: args.disableDaysOfWeek,
                    intervals: args['disable-time-intervals'],
                    subject: args['disable-comment-subject'],
                    comment: args['disable-comment'],
                    importance: param.importance,

                    events: events,
                }

                log.info('Connect to "', collectorName, '", processing: ', collectorParam);

                collector.get(collectorParam, function (err) {
                    if (err) return callback(err);

                    // dont save counter settings and parameters
                    if(!args.switchOnSettings) return callback();

                    transactions.begin(function(err) {
                        if(err) return callback(err);

                        var counters = {}, countersNames = {};
                        events.forEach(function(event) {
                            counters[event.counterID] = event;
                            countersNames[event.counterName] = true;
                        });

                        log.info('Saving counters parameters: ', param.countersParameters, ' for ',
                            Object.keys(countersNames));
                        async.eachSeries(param.countersIDs, function(counterID, callback) {

                            var counter = counters[counterID];
                            if(!counter) return callback(new Error('Can\'t find counter ' + counterID + ' in database'));
                            var counterSettings = {
                                name: args.counterName || counter.counterName,
                                collectorID: collectorName,
                                groupID: args.counterGroup === '' ? counter.counterGroup : Number(args.counterGroup),
                                unitID: null,
                                sourceMultiplier: 1.0,
                                keepHistory: args.keepHistory === '' ? counter.keepHistory : Number(args.keepHistory),
                                keepTrends: counter.keepTrends,
                                counterID: counterID,
                                timestamp: args.timestamp,
                                description: args.counterDescription ? args.counterDescription :
                                    (args.counterDescriptionShared === '0' ? counter.counterDescription : ''),
                                disabled: args.counterDisabledCB ? 1 :
                                    ( args.counterDisabledCBShared === '0' ? counter.disabled : 0),
                                debug: args.debugCB ? 1 :
                                    (args.debugCBShared === '0' ? counter.debug : 0),
                                taskCondition: args.taskConditionCB ? 1 :
                                    (args.taskConditionCBShared === '0' ? counter.taskCondition : 0),
                            };

                            counterSaveDB.updateCounter(counterSettings, function(err) {
                                if (err) {
                                    return callback(new Error('Can\'t update counter for counterID: ' + counterID +
                                        ': ' + err.message + ': ' +
                                        JSON.stringify(counterSettings, null, 4)));
                                }

                                counterSaveDB.updateCounterParameters(counterID, param.countersParameters,
                                    function (err, notUpdatedParameters) {
                                        if (err) {
                                            return callback(new Error('Can\'t update counter parameters for counterID: ' +
                                                counterID + ': ' + err.message + '; params: ' +
                                                JSON.stringify(param.countersParameters, null, 4)));
                                        }
                                        if(!Object.keys(notUpdatedParameters).length) return callback();

                                        counterSaveDB.insertCounterParameters(counterID, notUpdatedParameters,
                                            function(err) {
                                                if (err) {
                                                    return callback(
                                                        new Error('Can\'t insert counter parameters for counterID: ' +
                                                        counterID + ': ' + err.message + '; params: ' +
                                                        JSON.stringify(notUpdatedParameters, null, 4)));
                                                }

                                                callback();
                                            })
                                    })
                            });
                        }, function(err) {
                            if(err) transactions.rollback(err, callback);
                            else transactions.end(callback);
                        });
                    });
                });
            });
        });
    }

    /**
     * Checking for integer and convert to integer
     * @param {string|number} n value for check
     * @return {number|null}
     */
    function isInt(n) {
        return Number(n) === parseInt(String(n), 10) ? Number(n) : null;
    }

    /**
     * Action parameters parser
     * @param {Object} args
     * @param {function(Error)|function(null, {
     *     objectsIDs: Array<number>,
     *     countersIDs: Array<number>,
     *     importance: number
     *     disableUntil: number,
     *     countersParameters: Object,
     * })} callback
     */
    function checkParametersAndRights(args, callback) {
        function er(text) {
            return callback(new Error(text + ': ' + JSON.stringify(args, null, 4)));
        }

        checkIDs(args['counter-id'], function (err, countersIDs) {
            if(err) return er('Error in countersIDs: ' + err.message);

            userRolesRights.checkCountersIDs(countersIDs, {
                user: prepareUser(args.username),
                errorOnNoRights: false,
                checkChange: true,
            }, function (err) {
                if(err) {
                    return er('User ' + args.username + ' has no rights for change counters ' +
                        args['counter-id'] + ': ' + err.message);
                }

                var objects = [];
                try {
                    objects = JSON.parse(args.o); // [{"id": "XX", "name": "name1"}, {..}, ...]
                } catch (err) {
                    return er('Can\'t parse JSON string with a objects parameters "' + args.o + '": ' + err.message);
                }

                if(!objects.length && args['link-hint-to-objects-cb']) {
                    return er('No objects are selected, but checkbox "Link hint to selected objects" is checked');
                }

                getImportance(function (err, initImportance) {
                    if(err) return er(err.message);

                    var countersParameters = {};

                    if(args['event-pronunciation']) countersParameters.pronunciation = args['event-pronunciation']

                    if(countersIDs.length === 1) {
                        if (!args['counterName']) return er('Counter name is not set');
                        if (args['event-description']) countersParameters.eventDescription = args['event-description'];
                    }

                    // don\'t modify importance in collector parameters
                    if(args['event-importance']) countersParameters.importance = args['event-importance'];

                    // if importance is not integer, set to min (highest importance) value of initImportance for
                    // event parameters
                    if(Number(args['event-importance']) === parseInt(args['event-importance'], 10)) {
                        var importance = Number(args['event-importance']);
                    } else {
                        importance = Object.keys(initImportance)
                            .filter(o => Number(o) === parseInt(o, 10))
                            .sort()/*.reverse()*/[0];
                    }

                    if(args.keepHistory && isInt(args.keepHistory) === null) {
                        return er('Incorrect keep history value ' + args.keepHistory);
                    }

                    if (args['event-duration'] && isInt(args['event-duration']) === null &&
                        !args['event-duration'].match(/^%:.*:%$/)) {
                        return er('Incorrect event duration ' + args['event-duration']);
                    }
                    countersParameters.eventDuration = args['event-duration'] ? Number(args['event-duration']) : '';

                    if(args['event-task-on-problem']) {
                        if ((isInt(args['event-task-on-problem']) === null || Number(args['event-task-on-problem']) < 0)) {
                            return er('Incorrect taskID when event occurred ' + args['event-task-on-problem']);
                        }
                        countersParameters.problemTaskID = Number(args['event-task-on-problem'])
                    }

                    if(args['event-task-on-solved']) {
                        if ((isInt(args['event-task-on-solved']) === null || Number(args['event-task-on-solved']) < 0)) {
                            return er('Incorrect taskID when event solved ' + args['event-task-on-solved']);
                        }
                        countersParameters.solvedTaskID = Number(args['event-task-on-solved']);
                    }

                    if(args.counterGroup !== '' && !isInt(args.counterGroup)) {
                        return er('Incorrect counters group ID ' + args.counterGroup);
                    }

                    if(objects.length && args.switchOnDisable) {
                        if (args['disable-time-intervals']) {
                            var intervals = args['disable-time-intervals'].split(';');
                            for (var i = 0; i < intervals.length; i++) {
                                if (!/^\d+-\d+$/.test(intervals[i])) {
                                    return er('Incorrect disable time intervals ' + args['disable-time-intervals']);
                                }
                            }
                        }

                        var disableUntil = null; // enable disabled events;
                        if(args.disableUntil) {
                            disableUntil = isInt(args.disableUntil);
                            if (!disableUntil || disableUntil < Date.now() + 120000) {
                                return er('End time for disable event is incorrect: ' + args.disableUntilDate, '; ',
                                    args.disableUntilTime, '; ', args.disableUntil);
                            }
                        }
                    }

                    callback(null, {
                        objectsIDs: objects.map(o=>o.id),
                        countersIDs: countersIDs,

                        importance: importance, // should be a Number for save to events DB
                        disableUntil: disableUntil,
                        countersParameters: countersParameters,
                    });
                });

            });
        });
    }

    function getImportance(callback) {
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

            callback(null, cfg.importance);
        });
    }
};
