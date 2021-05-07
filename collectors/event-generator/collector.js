/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var path = require('path');
var log = require('../../lib/log')(module);
var task = require('../../lib/tasks');
var sqlite = require('../../lib/sqlite');
var dbReplication = require('../../lib/dbReplication');
var conf = require('../../lib/conf');
conf.file('config/conf.json');

var collector = {};
module.exports = collector;

var systemUser = conf.get('systemUser') || 'system';
var saveRepeatEventsCacheInterval = conf.get('collectors:event-generator:saveRepeatEventsCacheInterval') * 1000 || 15000;
var runTaskOnProblem = conf.get('collectors:event-generator:runTaskOnProblem');
var runTaskOnSolve = conf.get('collectors:event-generator:runTaskOnSolve');
var isInitializing = false;
var isEventProcessed = false;
var db, eventsCache = {}, repeatEventsCache = {}, disabledEventsCache = {}, collectorActionsQueue = [];
/*
    get data and return it to server

    prms - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

collector.isEventDisabled = isEventDisabled; // for ajax
collector.get = function(prms, _callback) {

    if(typeof prms !== 'object') return _callback(new Error('Parameters are not set or error'));

    prms.$dataTimestamp = Date.now();

    if(isEventProcessed) {
        collectorActionsQueue.push({
            prms: prms,
            callback: _callback
        });

        if(collectorActionsQueue.length > 100 && Math.round(collectorActionsQueue.length / 10) ===  collectorActionsQueue.length / 10)
            log.warn('Queue length for write events to database too big: ', collectorActionsQueue.length);

        return;
    }
    isEventProcessed = true;

    if(!isInitializing) {
        isInitializing = true;
        initDB( function (err, initDB, _eventsCache, _disabledEventsCache) {
            if(err) {
                isInitializing = isEventProcessed = false;
                return _callback(err);
            }

            dbReplication(initDB, 'events', function (err, replicationDB) {
                if(err) {
                    isInitializing = isEventProcessed = false;
                    return _callback(err);
                }

                db = replicationDB;
                eventsCache = _eventsCache;
                disabledEventsCache = _disabledEventsCache;
                isEventProcessed = false;
                collector.get(prms, _callback);
                setInterval(saveRepeatedEventsToCache, saveRepeatEventsCacheInterval);
                log.info('Initializing events system is completed');
            })
        });
        return;
    }

    function callback(err, result) {
        _callback(err, result);

        isEventProcessed = false;
        if(!collectorActionsQueue.length) return;
        var collectorAction = collectorActionsQueue.shift();
        collector.get(collectorAction.prms, function(err, result) {
            collectorAction.callback(err, result);
        });
    }


    if(prms.action) return runAction(prms, callback);

    var OCID = prms.$id;
    var eventTimestamp = prms.$variables.UPDATE_EVENT_TIMESTAMP ? prms.$variables.UPDATE_EVENT_TIMESTAMP : prms.$dataTimestamp;

    if(Number(OCID) !== parseInt(String(OCID), 10) || !Number(OCID) ||
        Number(prms.$counterID) !== parseInt(String(prms.$counterID), 10) || !Number(prms.$counterID) ||
        typeof prms.$variables !== 'object' || !prms.$variables.OBJECT_NAME || !prms.$variables.COUNTER_NAME) {
        return callback(new Error('Some parameters are not correct: ' + JSON.stringify(prms)));
    }

    // prms.$variables.UPDATE_EVENT_STATE === undefined when we has not an update event expression
    if(prms.$variables.UPDATE_EVENT_STATE === true || prms.$variables.UPDATE_EVENT_STATE === undefined) {
        // !!!don't touch this horror
        if(disabledEventsCache[OCID]) {
            if(disabledEventsCache[OCID].disableUntil < Date.now()) enableEvents({ events: [{OCID: OCID}] });
            else {
                if(isEventDisabled(disabledEventsCache[OCID].intervals)) {
                    if(!eventsCache[OCID]) {
                        log.info('Disabled event occurred: ', prms.$variables.OBJECT_NAME, '(', prms.$variables.COUNTER_NAME, '): importance: ',
                            prms.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', prms.$parentID,
                            ', OCID: ', OCID, ', disabled: ', disabledEventsCache[OCID]);
                    }
                    return callback();
                }
            }
        }

        if(!eventsCache[OCID]) {
            log.info('Event occurred: ', prms.$variables.OBJECT_NAME, '(', prms.$variables.COUNTER_NAME, '): importance: ',
                prms.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', prms.$parentID,
                ', OCID: ', OCID);
        }

        onEvent(OCID, prms.$objectID, prms.$counterID, prms.$variables.OBJECT_NAME, prms.$variables.COUNTER_NAME, prms.$parentID,
            prms.importance, prms.eventDescription, eventTimestamp, prms.$dataTimestamp, prms.pronunciation, function(err, newEventID) {

            if(err) return callback(err);

            if(prms.problemTaskID && runTaskOnProblem) {
                task.runTask({
                    userName: systemUser,
                    taskID: prms.problemTaskID,
                    variables: prms.$variables,
                },function(err) {
                    if(err) log.error(err.message);
                });
            }

            if(Number(prms.eventDuration) === parseInt(String(prms.eventDuration), 10)) {
                prms.eventDuration = Number(prms.eventDuration);
                var solve_problem = function() {
                    solveEvent(function(err) {
                        if(newEventID) callback(err, 1);
                        else callback(err);
                    })
                    prms.$variables.UPDATE_EVENT_STATE = false;
                    collector.get(prms, _callback); // use _callback()!!!
                }

                if(!prms.eventDuration || prms.eventDuration < 1) solve_problem();
                else setTimeout(solve_problem, prms.eventDuration * 1000);
                return;
            }

            // save new event to history database too
            if(newEventID) callback(null, 1);
            else callback();
        });

    } else if(prms.$variables.UPDATE_EVENT_STATE === false) {
        solveEvent(callback);
    } else {
        callback(new Error('Can\'t generate event: incorrect variable value for UPDATE_EVENT_STATE (' +
            prms.$variables.UPDATE_EVENT_STATE + ') for ' +
            prms.$variables.OBJECT_NAME + '->' + prms.$variables.PARENT_OBJECT_NAME + ':' +
            (prms.$variables.PARENT_COLLECTOR_NAME || 'unknown parent collector') + '=' + prms.$variables.PARENT_VALUE));
    }

    function solveEvent(callback) {
        if(eventsCache[OCID]) {
            log.info('Event solved: ', prms.$variables.OBJECT_NAME, '(', prms.$variables.COUNTER_NAME, '): importance: ',
                prms.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', prms.$parentID,
                ', OCID: ', OCID);
        } else var dontRunTask = true;
        onSolvedEvent(OCID, eventTimestamp, function(err) {
            if(err) return callback(err);

            if(disabledEventsCache[OCID]) if(disabledEventsCache[OCID].disableUntil < Date.now()) enableEvents({ events: [{OCID: OCID}] });

            if(runTaskOnSolve &&
                (!disabledEventsCache[OCID] || !isEventDisabled(disabledEventsCache[OCID].intervals)) &&
                prms.solvedTaskID && !dontRunTask) {
                task.runTask({
                    userName: systemUser,
                    taskID: prms.solvedTaskID,
                    variables: prms.$variables,
                },function(err) {
                    if(err) log.error(err.message);
                });
            }

            // save solved event to history database too
            callback(null, 0);
        });
    }
};

collector.removeCounters = function(OCIDs, callback) {
    if(!OCIDs.length) return callback();

    async.eachSeries(OCIDs, function (OCID, callback) {
        if(!eventsCache[OCID]) return callback();

        log.info('Remove OCID: ', OCID, ' from event-generator collector');
        onSolvedEvent(OCID, Date.now(), function(err) {
            if(err) log.error(err.message);
            callback();
        });
    }, callback);
};

collector.destroy = function(callback) {
    log.warn('Destroying collector event-generator');
    isInitializing = false;
    eventsCache = {};
    if(db && typeof db.sendReplicationData === 'function') db.sendReplicationData(callback);
    else callback();
};


/*
check is event disabled or enabled now
   intervals: <from>-<to>;<from>-<to>;<from>-<to>

   return true (event is disabled) or false (event is enabled)
 */
function isEventDisabled(intervalsStr, startTime, endTime) {
    if(!intervalsStr) return true;
    if(!startTime) startTime = Date.now();
    if(!endTime) endTime = Date.now();

    var eventsTimeFrom = startTime - (new Date(new Date(startTime).setHours(0,0,0,0))).getTime();
    var eventTimeTo = endTime - (new Date(new Date(endTime).setHours(0,0,0,0))).getTime();
    var intervals = intervalsStr.split(';');

    for(var i = 0; i < intervals.length; i++) {
        var fromTo = intervals[i].split('-');
        if(eventsTimeFrom > Number(fromTo[0]) && eventTimeTo < Number(fromTo[1])) return true;
    }
    return false;
}

function runAction(prms, callback) {
    //log.info('Run event action: ', prms);

    /* when count of objects are greater then 999 (SQLITE_MAX_VARIABLE_NUMBER), sqlite can\'t create a long query.
        separate objects array to small arrays and check objects rights by parts
       https://www.sqlite.org/limits.html
     */

    if(prms.action === 'eventEditor') return transactionEventEditor(prms, callback);

    var events = [], arrayPartsIdx = [0];

    // Math.ceil(.95)=1; Math.ceil(7.004) = 8
    for(var i = 1; i < Math.ceil(prms.eventsIDs.length / db.maxVariableNumber); i++) {
        arrayPartsIdx.push(i * db.maxVariableNumber);
    }

    async.eachSeries(arrayPartsIdx, function (idx, callback) {
        var eventsIDsPart = prms.eventsIDs.slice(idx, idx + db.maxVariableNumber);

        db.all('SELECT id, OCID, counterID FROM events WHERE id IN (' +
            (new Array(eventsIDsPart.length)).fill('?').join(',') + ')', eventsIDsPart, function(err, eventsPart) {

            if(err) return callback(new Error('Can\'t get event information from events table: ' + err.message + '. Events IDs ' +
                JSON.stringify(eventsIDsPart) + '(all events IDs: ' + JSON.stringify(prms.eventsIDs) + ')' + ': ' + err.message));

            //log.debug('maxVariableNumber: ', db.maxVariableNumber, '; arrayPartsIdx: ', arrayPartsIdx, '; idx: ', idx, '; eventsPart: ', eventsPart, '; prms: ', prms);

            Array.prototype.push.apply(events, eventsPart);
            callback();
        });
    }, function (err) {
        if(err) return callback(err);
        // events: [{id: eventID, OCID: OCID or NULL, counterID: counterID or NULL}, { ..... }]

        prms.events = events;
        if(!Array.isArray(prms.events) || !prms.events.length) return callback(new Error('Events are not select for ' + JSON.stringify(prms)));

        log.info('Executing action ', prms.action, ' for ', prms.events.length, ' events: ', prms.subject);

        if(prms.action === 'enableEvents') return enableEvents(prms, callback);
        if(!prms.comment) return callback(new Error('Comment is not set for ' + JSON.stringify(prms)));
        if(!prms.recipients) prms.recipients = null;
        if(!prms.subject) prms.subject = null;

        if(prms.action === 'addAsHint') return addRemoveHint(prms, callback);
        if(prms.action === 'addAsHintForObject') return addRemoveHint(prms, callback);
        if(prms.action === 'addAsComment') return transactionAddCommentsOrDisableEvents(prms, callback);
        if(prms.action === 'disableEvents') return transactionAddCommentsOrDisableEvents(prms, callback);
        if(prms.action === 'removeTimeIntervals') return removeTimeIntervals(prms, callback);
        if(prms.action === 'solveProblem') {
            var timestamp = Date.now();
            log.info('Mark ', prms.events.length ,' events as solved: ', prms.subject);

            async.eachSeries(prms.events, function(event, callback) {
                if(!eventsCache[event.OCID]) {
                    eventsCache[event.OCID] = event.id;
                    log.error('Event is not present in a events cache. Forced solve event: ', event);
                }
                onSolvedEvent(event.OCID, timestamp, callback);
            }, callback);
            return ;
        }

        // we checked action name in dashboard server.js. This code will never run
        callback(new Error('Unknown action: ' + JSON.stringify(prms)));
    });
}
/*
param = {
    event: [{
        OCID:,
        counterID:,
        objectID:,
        objectName:
        counterName
    }]
    user,

    enableHint
    hintSubject:
    hintComment:
    addAsHintForObject:

    enableDisabled: enable or disable events
    disableUntil: <timestamp>
    intervals:
    subject:
    comment:
    importance:
}
 */

function transactionEventEditor(param, callback) {
    db.exec('BEGIN', function(err) {
        if (err) return callback(new Error('Can\'t start event editor transaction: ' + err.message  + ': ' + JSON.stringify(param)));

        eventEditor(param, function(err) {
            if (err) {
                db.exec('ROLLBACK', function (errRollBack) {
                    var rollBackError = errRollBack ? ' and error while rollback transaction: ' + errRollBack.message : '';
                    return callback(new Error(err.message + rollBackError));
                });
                return;
            }

            db.exec('COMMIT', function (err) {
                if (err) return callback(new Error('Can\'t commit event editor transaction: ' + err.message + ': ' + JSON.stringify(param)));
                callback();
            });
        });
    });
}

function eventEditor(param, callback) {

    async.parallel([
        function(callback) {

            if(param.preventHintChangingOperation) return callback();

            addRemoveHint({
                events: param.events,
                user: param.user,
                subject: param.hintSubject,
                recipients: null,
                comment: param.hintComment,
                action: param.addAsHintForObject ? 'addAsHintForObject' : '',
            }, callback);
        },

        function (callback) {

            // Skip disabling or enabling events
            if(param.preventDisableOperation) return callback();

            // Enable disabled events
            if(param.disableUntil === null) return enableEvents({ events: param.events }, callback);

            var timestamp = Date.now(), events = [];
            async.eachSeries(param.events, function(event, callback) {
                onEvent(event.OCID, event.objectID, event.counterID, event.objectName, event.counterName,
                    null, param.importance, event.counterName, timestamp, 0, null, function (err, eventID) {
                        if(err) return callback(err);
                        if(!eventID) return callback(new Error('Error while add a new event. EventID is not returned for OCID ' + event.OCID));

                        events.push({
                            id: eventID,
                            OCID: event.OCID,
                        });

                        callback();
                    });
            }, function (err) {
                if(err) return callback(err);

                addCommentsOrDisableEvents({
                    action: 'disableEvents',
                    events: events,
                    user: param.user,
                    subject: param.subject,
                    recipients: null,
                    comment: param.comment,
                    disableUntil: param.disableUntil,
                    intervals: param.intervals,
                    replaceIntervals: true,
                }, callback);
            });
        }
    ], callback);
}

/*
hint: {
    events: [{
            id: eventID,
            OCID: OCID or NULL
            counterID: counterID or NULL
        }, {
        .....
        }],
    user: userName,
    subject: subject,
    recipients: recipients,
    comment: text
    action: 'addAsHintForObject' || ?
}

callback(err)
 */
function addRemoveHint(hint, callback) {

    if(!hint.subject && !hint.comment) log.info('Delete hints: ', hint);
    else log.info('Add hint: ', hint);

    var timestamp = Date.now();
    var forObject = hint.action === 'addAsHintForObject';

    async.eachSeries(hint.events, function(event, callback) {
        if((forObject && !event.OCID) || (!forObject && !event.counterID))
            return callback(new Error('Can\'t add hint: OCID or counterID not defined' + JSON.stringify(hint)));

        db.run('DELETE FROM hints WHERE ' + (forObject ? 'OCID=?' : 'counterID=?'), (forObject ? event.OCID : event.counterID), function(err) {
            if(err) return callback(new Error('Can\'t delete previous hint: ' + err.message + ':' + JSON.stringify(hint)));

            // only delete hint
            if(!hint.subject && !hint.comment) return callback();

            db.run('INSERT INTO hints (OCID, counterID, timestamp, user, subject, recipients, comment) ' +
                'VALUES ($OCID, $counterID, $timestamp, $user, $subject, $recipients, $comment)', {
                $OCID: forObject ? event.OCID : null,
                $counterID: forObject ? null : event.counterID,
                $timestamp: timestamp,
                $user: hint.user,
                $subject: hint.subject,
                $recipients: hint.recipients,
                $comment: hint.comment
            }, function (err) {
                if (err) return callback(new Error('Can\'t add hint: ' + err.message + ':' + JSON.stringify(hint)));
                callback();
            });
        });
    }, callback);
}
/*
events: [{
            id: eventID,
            OCID: OCID
        }, {
        .....
        }],
        timeIntervalsForRemove: '<from>-<to>,<from>-<to>,...'

 */
function removeTimeIntervals(timeIntervals, callback) {
    log.info('Removing time intervals: ', timeIntervals);
    if(!timeIntervals.timeIntervalsForRemove) return callback(new Error('Time intervals for removing is not set'));
    var timeIntervalsForRemove = timeIntervals.timeIntervalsForRemove.split(',');

    async.eachSeries(timeIntervals.events, function(event, callback) {
        db.all('SELECT * FROM disabledEvents WHERE OCID=?', event.OCID, function(err, rows) {
            if(err || rows.length !== 1) {
                return callback(new Error('Can\'t get disabled event data for OCID ' + event.OCID +
                    ' for removing time intervals ' + timeIntervals.timeIntervalsForRemove + ': ' +
                    (err ? err.message : 'can\'t find or find not unique event in disabled events table: ' + JSON.stringify(rows))));
            }
            var newTimeIntervals = rows[0].intervals.split(';').filter(function (interval) {
                return timeIntervalsForRemove.indexOf(interval) === -1;
            }).join(';') || null;

            db.run('UPDATE disabledEvents SET intervals=$intervals WHERE OCID=$OCID', {
                $OCID: event.OCID,
                $intervals: newTimeIntervals
            }, function(err) {
                if(err) return callback(new Error('Can\'t update time interval to ' + newTimeIntervals +
                    ' for event ' + JSON.stringify(rows[0]) + ' while removing time intervals ' +
                    timeIntervals.timeIntervalsForRemove +': ' + err.message));

                rows[0].intervals = newTimeIntervals;
                disabledEventsCache[event.OCID] = rows[0];
                log.info('New disabled event: ', rows[0]);

                callback();
            });
        });
    }, callback);
}

/*
    enable: {
        events: [{
                OCID: OCID
            }, {
            .....
            }]
    }
    callback(err) or nothing
 */
function enableEvents(enable, callback) {
    log.info('Enable events: ', enable);

    if(typeof callback !== 'function') {
        callback = function(err) {
            if(err) log.error(err.message);
        };
    }

    async.each(enable.events, function(event, callback) {
        var OCID = event.OCID;
        // make it at first for immediately enable events when function called without callback
        if (disabledEventsCache[OCID]) delete disabledEventsCache[OCID];
        else log.error('Can\'t enable event for OCID: ' + OCID + ': event not exist in the list of disabled events');

        db.run('DELETE FROM disabledEvents WHERE OCID=?', OCID, function (err) {
            if (err) return callback(new Error('Can\'t enable event for OCID ' + OCID + ': ' +
                JSON.stringify(disabledEventsCache[OCID]) + ': ' + err.message));

            callback();
        });
    }, callback);
}

/*
comment: {
    events: [{
            id: eventID,
            OCID:
        }, {
        .....
        }],
    action: 'disableEvents' || null
    user: userName,
    subject: subject,
    recipients: recipients,
    comment: comment
    disableUntil: timestamp
    intervals: <timeFrom>-<timeTo>; <timeFrom>-<timeTo>;
}

callback(err)
 */
function transactionAddCommentsOrDisableEvents(param, callback) {
    db.exec('BEGIN', function(err) {
        if (err) return callback(new Error('Can\'t start transaction while add comment: ' + JSON.stringify(param) + ': ' + err.message));

        addCommentsOrDisableEvents(param, function(err) {
            if (err) {
                db.exec('ROLLBACK', function (errRollBack) {
                    var rollBackError = errRollBack ? ' and error while rollback transaction: ' + errRollBack.message : '';
                    return callback(new Error(err.message + rollBackError));
                });
                return;
            }

            db.exec('COMMIT', function (err) {
                if (err) return callback(new Error('Can\'t commit transaction while add comment: ' + err.message + ': ' + JSON.stringify(param)));

                callback();
            });
        });
    });
}

function addCommentsOrDisableEvents(param, callback) {
    var timestamp = Date.now();

    if(param.action === 'disableEvents') {
        log.info('Disable ', param.events.length, ' events: ', (param.events.length < 5 ? param : param.subject) );

        if(!param.disableUntil || Number(param.disableUntil) !== parseInt(String(param.disableUntil), 10) ||
            param.disableUntil < Date.now() + 120000)
            return callback(new Error('Disable time limit is not set or incorrect for ' + JSON.stringify(param)));

        if (param.intervals) {
            var intervals = param.intervals.split(';');
            for (var i = 0; i < intervals.length; i++) {
                var fromTo = intervals[i].split('-');
                if (fromTo.length !== 2 ||
                    Number(fromTo[0]) !== parseInt(fromTo[0], 10) || Number(fromTo[0]) < 0 || Number(fromTo[0] > 86400000) ||
                    Number(fromTo[1]) !== parseInt(fromTo[1], 10) || Number(fromTo[1]) < 0 || Number(fromTo[1] > 86400000)) {
                    return callback(new Error('Invalid time interval "' + intervals[i] + '" for disable events: ' + JSON.stringify(param)));
                }
            }
        } else param.intervals = null;
    } else log.info('Add comment for ', param.events.length, ' events: ', param.subject);

    db.run('INSERT INTO comments (timestamp, user, subject, recipients, comment) ' +
        'VALUES ($timestamp, $user, $subject, $recipients, $comment)', {
        $timestamp: timestamp,
        $user: param.user,
        $subject: param.subject,
        $recipients: param.recipients,
        $comment: param.comment
    }, function (err) {
        if (err) return callback(new Error('Can\'t add comment: ' + err.message + ': ' + JSON.stringify(param)));

        param.commentID = this.lastID;
        var sameEventOCIDs = {};
        async.eachSeries(param.events, function (event, callback) {
            if(param.action !== 'disableEvents')
                return deletePreviousCommentAndUpdateEventCommentID(event.id, param.commentID, callback);

            // do not disable event disabled in previous iteration
            if(sameEventOCIDs[event.OCID]) return deletePreviousCommentAndUpdateEventCommentID(event.id, param.commentID, callback);

            sameEventOCIDs[event.OCID] = true;
            var query;
            if (disabledEventsCache[event.OCID]) {
                if(disabledEventsCache[event.OCID].intervals && !param.replaceIntervals) {
                    param.intervals = param.intervals ?
                        disabledEventsCache[event.OCID].intervals + ';' + param.intervals :
                        disabledEventsCache[event.OCID].intervals;
                }

                query = 'UPDATE disabledEvents SET eventID=$eventID, timestamp=$timestamp, user=$user, commentID=$commentID, ' +
                    'disableUntil=$disableUntil, intervals=$intervals WHERE OCID=$OCID';
            } else {
                query = 'INSERT INTO disabledEvents (eventID, OCID, timestamp, user, disableUntil, intervals, commentID) ' +
                    'VALUES ($eventID, $OCID, $timestamp, $user, $disableUntil, $intervals, $commentID)';
            }
            db.run(query, {
                $eventID: event.id,
                $OCID: event.OCID,
                $timestamp: timestamp,
                $user: param.user,
                $disableUntil: Number(param.disableUntil),
                $intervals: clearIntervals(param.intervals),
                $commentID: param.commentID
            }, function (err) {
                if (err) return callback(new Error('Can\'t disable event: ' + err.message + ': ' + JSON.stringify(param)));
                disabledEventsCache[event.OCID] = param;

                deletePreviousCommentAndUpdateEventCommentID(event.id, param.commentID, callback);
            });
        }, callback);
    });
}

/*
intervalStr: '1117-1135;1418-1430;1420-1428;1700-1800;0930-0935;0935-0943;1015-1030;1020-1045;1040-1045;1043-1050;1100-1110;1115-1120';
return '930-943;1015-1050;1100-1110;1115-1135;1418-1430;1700-1800';
 */
function clearIntervals(intervalsStr) {
    if(!intervalsStr) return intervalsStr;

    var intervals = intervalsStr.split(';').map(function (interval) {
        var fromTo = interval.split('-');
        return {
            from: Number(fromTo[0]),
            to: Number(fromTo[1])
        };
    }).sort(function (a,b) {
        return a.from - b.from;
    });

    if(intervals.length < 2) return intervalsStr;

    var newIntervals = [], newInterval = intervals[0];
    //console.log('sorted intervals:\n', intervals);

    for(var i = 0; i < intervals.length; i++) {
        var nextInterval = intervals[i+1]/*, interval = newInterval*/;
        //console.log('comp:', newInterval, nextInterval);
        if(nextInterval && newInterval.to >= nextInterval.from) {
            newInterval = {
                from: newInterval.from,
                to: newInterval.to < nextInterval.to ? nextInterval.to : newInterval.to
            };
            //console.log(newInterval, '=', interval, nextInterval, intervals[i], '=>', intervals[i+2]);
        } else {
            newIntervals.push(newInterval);
            //console.log('add:', newInterval, intervals[i], '=>', intervals[i+1]);
            newInterval = nextInterval;
        }
    }

    return newIntervals.map(function (interval) {
        return interval.from + '-' + interval.to;
    }).join(';');
}

function deletePreviousCommentAndUpdateEventCommentID(eventID, newCommentID, callback) {
    db.get('SELECT * FROM events WHERE id=?', eventID, function (err, row) {
        if (err) return callback(new Error('Can\'t get previous commentID while add new comment: ' + err.message));

        db.run('UPDATE events set commentID=$commentID WHERE id=$eventID', {
            $eventID: eventID,
            $commentID: newCommentID
        }, function (err) {
            if (err) return callback(new Error('Can\'t update events table for add comment: '  + err.message));

            if (!row || !row.commentID) return callback();
            var prevCommentID = row.commentID;

            db.all('SELECT * FROM events WHERE commentID=?', prevCommentID, function (err, rows) {
                if (err) return callback(new Error('Can\'t get previous commentID while add new comment: ' + err.message));
                if (rows.length) return callback();

                db.run('DELETE FROM comments WHERE id=?', prevCommentID, function (err) {
                    // some time we can get SQLITE_CONSTRAINT: FOREIGN KEY constraint failed.
                    if (err) log.warn('Can\'t delete previous comment: ', err.message, ': ', row);
                    callback();
                });
            });
        });
    });
}


function onEvent(OCID, objectID, counterID, objectName, counterName, parentOCID, importance, eventDescription, eventTimestamp, dataTimestamp, pronunciation, callback) {
    var eventID = eventsCache[OCID];
    if(eventID && dataTimestamp) { // dataTimestamp - check for run not from eventEditor
        repeatEventsCache[eventID] = {
            $eventID: eventID,
            $data: eventDescription || null,
            $timestamp: eventTimestamp,
            $pronunciation: pronunciation
        };
        // call callback here for clear events queue
        return callback();
    }

    var queryParameters = {
        $OCID: OCID,
        $objectID: objectID,
        $counterID: counterID,
        $objectName: objectName,
        $counterName: counterName,
        $parentOCID: parentOCID || null,
        $importance: importance || 0,
        $startTime: dataTimestamp,
        $endTime: dataTimestamp ? null : 0, // for eventEditor
        $data: eventDescription,
        $timestamp: eventTimestamp,
        $pronunciation: pronunciation
    };
    db.run('INSERT INTO events (OCID, objectID, counterID, objectName, counterName, parentOCID, importance, startTime, endTime, initData, data, timestamp, pronunciation) ' +
        'VALUES ($OCID, $objectID, $counterID, $objectName, $counterName, $parentOCID, $importance, $startTime, $endTime, $data, $data, $timestamp, $pronunciation)',
        queryParameters, function(err) {
            if(err) return callback(new Error('Can\'t add event with OCID: ' + OCID + ' into events table event database: ' +
                err.message + ' data: ' + JSON.stringify(queryParameters)));

            // dont save eventID to the eventsCache when event generated by eventsEditor (dataTimestamp = 0)
            if(dataTimestamp) eventsCache[OCID] = this.lastID;

            callback(null, this.lastID); // return new event ID
        });
}

function saveRepeatedEventsToCache() {
    if(!Object.keys(repeatEventsCache).length) return;

    var savedEventsCnt = 0;
    async.eachOfSeries(repeatEventsCache, function (item, eventID, callback) {

        db.run('UPDATE events set data=$data, timestamp=$timestamp, pronunciation=$pronunciation WHERE id=$eventID', item, function(err) {
            delete(repeatEventsCache[eventID]);
            if(err) log.error('Can\'t update cached event data with eventID ' + item.$eventID +
                ' data: ' + item.$data + ', timestamp: ' + (new Date(item.$timestamp)).toLocaleString() +
                ' into events table event database: ' +  err.message);
            else ++savedEventsCnt;
            callback();
        });
    }, function() {
        if(savedEventsCnt > 2) log.info('Adding ', savedEventsCnt, ' cached repeated events to events table');
    });
}

function onSolvedEvent(OCID, timestamp, callback) {
    var eventID = eventsCache[OCID];
    if(!eventID) {
        //log.debug('Can\'t add event end time for OCID: ' + OCID + ' into events table: Opened event with current OCID does not exist');
        // it's not an error. it can be when previous state of trigger is unknown, and new state is false
        // do nothing
        return callback(null, false);
    }

    delete eventsCache[OCID];
    db.run('UPDATE events set endTime=$endTime WHERE id=$eventID', {
        $endTime: timestamp,
        $eventID: eventID
    }, function(err) {
        if(err) return callback(new Error('Can\'t add event end time (' + timestamp+ ') with eventID ' + eventID +
            ', OCID: ' + OCID + ' into events table event database: ' + err.message));

        callback(null, true);
    });
}

function initDB(callback) {
    var dbPath = path.join(__dirname, '..', '..',
        conf.get('collectors:event-generator:dbPath'),
        conf.get('collectors:event-generator:dbFile'));

    sqlite.init(dbPath, function (err, db) {
        if (err) return callback(new Error('Can\'t initialise event database ' + dbPath + ': ' + err.message));

        db.exec('PRAGMA journal_mode = WAL', function(err) {
            if(err) return callback(new Error('Can\'t set journal mode to WAL: ' + err.message));

            createEventsCommentsTable(db, function(err) {
                if(err) return callback(err);

                createEventsTable(db, function(err) {
                if(err) return callback(err);

                    createHintsTable(db,function (err) {
                        if(err) return callback(err);

                        createDisabledEventsTable(db,function(err) {
                            if(err) return callback(err);

                            db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
                                if (err) log.error('Can\'t truncate WAL journal file: ', err.message);

                                loadDataToCache(db, callback);
                            });
                        });
                    });
                });
            });
        });
    });
}


function createEventsCommentsTable(db, callback) {
    db.run('CREATE TABLE IF NOT EXISTS comments (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'timestamp INTEGER NOT NULL,' +
        'user TEXT NOT NULL,' +
        'subject TEXT,' +
        'recipients TEXT,' +
        'comment TEXT)', function (err) {
        if (err) return callback(new Error('Can\'t create comments table in events database: ' + err.message));

        db.run('CREATE INDEX IF NOT EXISTS timestamp_comments_index on comments(timestamp)', function (err) {
            if (err) return callback(new Error('Can\'t create timestamp index in comments table in events database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS user_comments_index on comments(user)', function (err) {
                if (err) return callback(new Error('Can\'t create user index in comments table in events database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS comments_comments_index on comments(comment)', function (err) {
                    if (err) return callback(new Error('Can\'t create comment index in comments table in events database: ' + err.message));

                    callback();
                });
            });
        });
    });
}

function createEventsTable(db, callback) {
    db.run(
        'CREATE TABLE IF NOT EXISTS events (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'OCID INTEGER NOT NULL,' +
        'objectID INTEGER NOT NULL,' +
        'counterID INTEGER NOT NULL,' +
        'objectName TEXT NOT NULL,' +
        'counterName TEXT NOT NULL,' +
        'parentOCID INTEGER,' + // can be null
        'importance INTEGER NOT NULL,' +
        'startTime INTEGER NOT NULL,' +
        'endTime INTEGER,' +
        'initData TEXT,' +
        'data TEXT,' +
        'commentID INTEGER REFERENCES comments(id) ON DELETE NO ACTION ON UPDATE CASCADE,' +
        'timestamp INTEGER,' +
        'pronunciation TEXT)', function (err) {

        if (err) return callback(new Error('Can\'t create events table in events database: ' + err.message));

        db.run('CREATE INDEX IF NOT EXISTS startTime_events_index on events(startTime)', function (err) {
            if (err) return callback(new Error('Can\'t create startTime index in events table in events database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS endTime_events_index on events(endTime)', function (err) {
                if (err) return callback(new Error('Can\'t create endTime index in events table in events database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS OCID_events_index on events(OCID)', function (err) {
                    if (err) return callback(new Error('Can\'t create OCID index in events table in events database: ' + err.message));

                    db.run('CREATE INDEX IF NOT EXISTS objectName_events_index on events(objectName)', function (err) {
                        if (err) return callback(new Error('Can\'t create objectName index in events table in events database: ' + err.message));

                        db.run('CREATE INDEX IF NOT EXISTS counterName_events_index on events(counterName)', function (err) {
                            if (err) return callback(new Error('Can\'t create counterName index in events table in events database: ' + err.message));

                            db.run('CREATE INDEX IF NOT EXISTS importance_events_index on events(importance)', function (err) {
                                if (err) return callback(new Error('Can\'t create importance index in events table in events database: ' + err.message));

                                db.run('CREATE INDEX IF NOT EXISTS counterID_events_index on events(counterID)', function (err) {
                                    if (err) return callback(new Error('Can\'t create counterID index in events table in events database: ' + err.message));

                                    db.run('CREATE INDEX IF NOT EXISTS objectID_events_index on events(objectID)', function (err) {
                                        if (err) return callback(new Error('Can\'t create objectID index in events table in events database: ' + err.message));

                                        db.run('CREATE INDEX IF NOT EXISTS commentID_events_index on events(commentID)', function (err) {
                                            if (err) return callback(new Error('Can\'t create commentID index in events table in events database: ' + err.message));

                                            callback();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function createHintsTable(db, callback) {
    db.run('CREATE TABLE IF NOT EXISTS hints (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'OCID INTEGER,' +
        'counterID INTEGER,' +
        'timestamp INTEGER NOT NULL,' +
        'user TEXT NOT NULL,' +
        'subject TEXT, ' +
        'recipients TEXT, ' +
        'comment TEXT NOT NULL)', function (err) {
        if (err) return callback(new Error('Can\'t create hints table in events database: ' + err.message));

        db.run('CREATE INDEX IF NOT EXISTS OCID_hints_index on hints(OCID)', function (err) {
            if (err) return callback(new Error('Can\'t create OCID index in hints table in events database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS counterID_hints_index on hints(counterID)', function (err) {
                if (err) return callback(new Error('Can\'t create counterID index in hints table in events database: ' + err.message));

                callback();
            });
        });
    });
}

function createDisabledEventsTable(db, callback) {
    db.run('CREATE TABLE IF NOT EXISTS disabledEvents (' +
        'OCID INTEGER PRIMARY KEY,' +
        'eventID INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'timestamp INTEGER NOT NULL,' +
        'user TEXT NOT NULL,' +
        'commentID INTEGER NOT NULL REFERENCES comments(id) ON DELETE NO ACTION ON UPDATE CASCADE,' +
        'disableUntil INTEGER NOT NULL,' + // in ms from 1970
        'intervals TEXT)', function (err) { // time intervals is a string <fromInMs>-<toInMs>;<fromInMs>-<toInMs>;<fromInMs>-<toInMs>...
        if (err) return callback(new Error('Can\'t create disabledEvents table in events database: ' + err.message));

        db.run('CREATE INDEX IF NOT EXISTS disableUntil_disabledEvents_index on disabledEvents(disableUntil)', function (err) {
            if (err) return callback(new Error('Can\'t create disableUntil index in disabledEvents table in events database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS OCID_disabledEvents_index on disabledEvents(OCID)', function (err) {
                if (err) return callback(new Error('Can\'t create OCID index in disabledEvents table in events database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS eventID_disabledEvents_index on disabledEvents(eventID)', function (err) {
                    if (err) return callback(new Error('Can\'t create eventID index in disabledEvents table in events database: ' + err.message));

                    callback();
                });
            });
        });
    });
}

function loadDataToCache(db, callback) {
    var eventsCache = {};
    db.all('SELECT id, OCID FROM events WHERE endTime IS NULL', function (err, rows) {
        if (err) return callback(new Error('Can\'t load events data to cache: ' + err.message));

        rows.forEach(function (row) {
            eventsCache[row.OCID] = row.id;
        });

        db.run('DELETE FROM disabledEvents WHERE disableUntil < ?', Date.now(), function(err) {
            if(err) return callback('Can\'t clean disabledEvents table for old disabled events: ' + err.message);

            var disabledEventsCache = {};
            db.all('SELECT * FROM disabledEvents', function (err, rows) {
                if (err) return callback(new Error('Can\'t load disabled events data to cache: ' + err.message));

                rows.forEach(function (row) {
                    disabledEventsCache[row.OCID] = row;
                });

                callback(null, db, eventsCache, disabledEventsCache);
            });
        });
    });
}