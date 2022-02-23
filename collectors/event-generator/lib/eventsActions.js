/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../../lib/log')(module);

var eventsCache = {}, repeatEventsCache = {}, disabledEventsCache = {};
var enableEvents, onSolvedEvent, onEvent;

var eventActions = {};
module.exports = eventActions;

eventActions.init = init;
eventActions.dashboard = dashboard;
eventActions.eventEditor = eventEditor;

function init(cache, _enableEvents, _onSolvedEvent, _onEvent) {
    eventsCache = cache.eventsCache;
    repeatEventsCache = cache.repeatEventsCache;
    disabledEventsCache = cache.disabledEventsCache;
    enableEvents = _enableEvents;
    onSolvedEvent = _onSolvedEvent;
    onEvent = _onEvent;
}

function dashboard(db, param) {
    //log.info('Run event action: ', param);

    var events = [];
    try {
        var stmt = db.prepare('SELECT id, OCID, counterID FROM events WHERE id=?');
    } catch (err) {
        throw(new Error('Can\'t prepare query to get event information from events table: ' + err.message + '. Events IDs ' +
            JSON.stringify(param.eventsIDs)));
    }

    param.eventsIDs.forEach(eventID => {
        try {
            var row = stmt.get(eventID);
        } catch (err) {
            throw(new Error('Can\'t get event information from events table: ' + err.message + '. Events IDs ' +
               JSON.stringify(param.eventsIDs)));
        }
        if(row) events.push(row);
    });

    // events: [{id: eventID, OCID: OCID or NULL, counterID: counterID or NULL}, { ..... }]
    param.events = events;
    if(!Array.isArray(param.events) || !param.events.length) {
        log.warn('Events were not found in database for ', param);
        //throw(new Error('Events were not found in database for ' + JSON.stringify(param)));
        return;
    }

    log.info('Executing action ', param.action, ' for ', param.events.length, ' events: ', param.subject);

    if(param.action === 'enableEvents') return enableEvents(db, param);
    if(!param.comment) throw(new Error('Comment is not set for ' + JSON.stringify(param)));
    if(!param.recipients) param.recipients = null;
    if(!param.subject) param.subject = null;

    if(param.action === 'addAsHint') return addRemoveHint(db, param);
    if(param.action === 'addAsHintForObject') return addRemoveHint(db, param);
    if(param.action === 'addAsComment') return transactionAddCommentsOrDisableEvents(db, param);
    if(param.action === 'disableEvents') return transactionAddCommentsOrDisableEvents(db, param);
    if(param.action === 'removeTimeIntervals') return removeTimeIntervals(db, param);
    if(param.action === 'solveProblem') {
        var timestamp = Date.now();
        log.info('Mark ', param.events.length ,' events as solved: ', param.subject);

        param.events.forEach(event => {
            if(!eventsCache[event.OCID]) {
                eventsCache[event.OCID] = event.id;
                log.error('Event is not present in a events cache. Forced solve event: ', event);
            }
            onSolvedEvent(db, event.OCID, timestamp);
        });
        return;
    }

    // we checked action name in dashboard server.js. This code will never run
    throw(new Error('Unknown action: ' + JSON.stringify(param)));
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

function eventEditor(db, param) {

    var transaction = db.transaction(() => {

        if(!param.preventHintChangingOperation) {
            addRemoveHint(db, {
                events: param.events,
                user: param.user,
                subject: param.hintSubject,
                recipients: null,
                comment: param.hintComment,
                action: param.addAsHintForObject ? 'addAsHintForObject' : '',
            });
        }


        // Skip disabling or enabling events
        if(param.preventDisableOperation) return;

        // Enable disabled events
        if(param.disableUntil === null) return enableEvents(db, { events: param.events });

        var timestamp = Date.now(), events = [];
        param.events.forEach(event => {
            var eventID = onEvent(db, event.OCID, event.objectID, event.counterID, event.objectName, event.counterName,
                null, param.importance, event.counterName, timestamp, 0, null);

            if(!eventID) {
                throw(new Error('Error while add a new event. EventID is not returned for OCID ' + event.OCID));
            }

            events.push({
                id: eventID,
                OCID: event.OCID,
            });
        });

        addCommentsOrDisableEvents(db, {
            action: 'disableEvents',
            events: events,
            user: param.user,
            subject: param.subject,
            recipients: null,
            comment: param.comment,
            disableUntil: param.disableUntil,
            intervals: param.intervals,
            replaceIntervals: true,
        });
    });

    transaction();
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
    function addRemoveHint(db, hint) {

    if(!hint.subject && !hint.comment) log.info('Delete hints: ', hint);
    else log.info('Add hint: ', hint);

    var timestamp = Date.now();
    var forObject = hint.action === 'addAsHintForObject';

    hint.events.forEach(function (event) {
        if ((forObject && !event.OCID) || (!forObject && !event.counterID)) {
            throw(new Error('Can\'t add hint: OCID or counterID not defined' + JSON.stringify(hint)));
        }

        try {
            db.prepare('DELETE FROM hints WHERE ' + (forObject ? 'OCID=?' : 'counterID=?'))
                .run(forObject ? event.OCID : event.counterID);
        } catch (err) {
            throw(new Error('Can\'t delete previous hint: ' + err.message + ':' + JSON.stringify(hint)));
        }

        // only delete hint
        if (!hint.subject && !hint.comment) return;

        try {
            db.prepare('INSERT INTO hints (OCID, counterID, timestamp, user, subject, recipients, comment) ' +
                'VALUES ($OCID, $counterID, $timestamp, $user, $subject, $recipients, $comment)').run({
                OCID: forObject ? event.OCID : null,
                counterID: forObject ? null : event.counterID,
                timestamp: timestamp,
                user: hint.user,
                subject: hint.subject,
                recipients: hint.recipients,
                comment: hint.comment
            });
        } catch (err) {
            throw(new Error('Can\'t add hint: ' + err.message + ':' + JSON.stringify(hint)));
        }
    });
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
function removeTimeIntervals(db, timeIntervals) {
    log.info('Removing time intervals: ', timeIntervals);
    if(!timeIntervals.timeIntervalsForRemove) throw(new Error('Time intervals for removing is not set'));
    var timeIntervalsForRemove = timeIntervals.timeIntervalsForRemove.split(',');

    timeIntervals.events.forEach(function (event) {
        try {
            var rows = db.prepare('SELECT * FROM disabledEvents WHERE OCID=?').all(event.OCID);
        } catch (err) {
            if (err || rows.length !== 1) {
                throw(new Error('Can\'t get disabled event data for OCID ' + event.OCID +
                    ' for removing time intervals ' + timeIntervals.timeIntervalsForRemove + ': ' +
                    (err ? err.message : 'can\'t find or find not unique event in disabled events table: ' + JSON.stringify(rows))));
            }
        }
        var newTimeIntervals = rows[0].intervals.split(';').filter(function (interval) {
            return timeIntervalsForRemove.indexOf(interval) === -1;
        }).join(';') || null;

        try {
            db.run('UPDATE disabledEvents SET intervals=$intervals WHERE OCID=$OCID', {
                OCID: event.OCID,
                intervals: newTimeIntervals
            });
        } catch (err) {
            throw(new Error('Can\'t update time interval to ' + newTimeIntervals +
                ' for event ' + JSON.stringify(rows[0]) + ' while removing time intervals ' +
                timeIntervals.timeIntervalsForRemove + ': ' + err.message));
        }
        rows[0].intervals = newTimeIntervals;
        disabledEventsCache[event.OCID] = rows[0];
        log.info('New disabled event: ', rows[0]);
    });
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
function transactionAddCommentsOrDisableEvents(db, param) {
    var transaction = db.transaction(() => {
        try {
            addCommentsOrDisableEvents(db, param);
        } catch (err) {
            //if (!db.inTransaction) throw err; // (transaction was forcefully rolled back)
            throw err;
        }
    });

    transaction();
}


function addCommentsOrDisableEvents(db, param) {
    var timestamp = Date.now();

    if(param.action === 'disableEvents') {
        log.info('Disable ', param.events.length, ' events: ', (param.events.length < 5 ? param : param.subject) );

        if(!param.disableUntil || Number(param.disableUntil) !== parseInt(String(param.disableUntil), 10) ||
            param.disableUntil < Date.now() + 120000)
            throw(new Error('Disable time limit is not set or incorrect for ' + JSON.stringify(param)));

        if (param.intervals) {
            var intervals = param.intervals.split(';');
            for (var i = 0; i < intervals.length; i++) {
                var fromTo = intervals[i].split('-');
                if (fromTo.length !== 2 ||
                    Number(fromTo[0]) !== parseInt(fromTo[0], 10) || Number(fromTo[0]) < 0 || Number(fromTo[0] > 86400000) ||
                    Number(fromTo[1]) !== parseInt(fromTo[1], 10) || Number(fromTo[1]) < 0 || Number(fromTo[1] > 86400000)) {
                    throw(new Error('Invalid time interval "' + intervals[i] + '" for disable events: ' + JSON.stringify(param)));
                }
            }
        } else param.intervals = null;
    } else log.info('Add comment for ', param.events.length, ' events: ', param.subject);

    try {
        var info = db.prepare('INSERT INTO comments (timestamp, user, subject, recipients, comment) ' +
            'VALUES ($timestamp, $user, $subject, $recipients, $comment)').run({
            timestamp: timestamp,
            user: param.user,
            subject: param.subject,
            recipients: param.recipients,
            comment: param.comment
        });
    } catch (err) {
        throw(new Error('Can\'t add comment: ' + err.message + ': ' + JSON.stringify(param)));
    }

    param.commentID = info.lastInsertRowid;

    var sameEventOCIDs = {};
    for(i = 0; i < param.events.length; i++) {
        var event = param.events[i];

        // !sameEventOCIDs[event.OCID]: do not disable event disabled in previous iteration
        if(param.action === 'disableEvents' && !sameEventOCIDs[event.OCID]) {
            sameEventOCIDs[event.OCID] = true;
            var query;
            if (disabledEventsCache[event.OCID]) {
                if (disabledEventsCache[event.OCID].intervals && !param.replaceIntervals) {
                    /*
                    param.intervals = param.intervals ?
                        disabledEventsCache[event.OCID].intervals + ';' + param.intervals :
                        disabledEventsCache[event.OCID].intervals;
                     */
                    param.intervals = param.intervals ?
                        disabledEventsCache[event.OCID].intervals + ';' + param.intervals :
                        null;
                }

                query = 'UPDATE disabledEvents SET eventID=$eventID, timestamp=$timestamp, user=$user, commentID=$commentID, ' +
                    'disableUntil=$disableUntil, intervals=$intervals WHERE OCID=$OCID';
            } else {
                query = 'INSERT INTO disabledEvents (eventID, OCID, timestamp, user, disableUntil, intervals, commentID) ' +
                    'VALUES ($eventID, $OCID, $timestamp, $user, $disableUntil, $intervals, $commentID)';
            }
            try {
                db.prepare(query).run({
                    eventID: event.id,
                    OCID: event.OCID,
                    timestamp: timestamp,
                    user: param.user,
                    disableUntil: Number(param.disableUntil),
                    intervals: clearIntervals(param.intervals),
                    commentID: param.commentID
                });
            } catch (err) {
                throw(new Error('Can\'t disable event: ' + err.message + ': ' + JSON.stringify(param)));
            }

            disabledEventsCache[event.OCID] = param;
        }

        deletePreviousCommentAndUpdateEventCommentID(db, event.id, param.commentID);
    }
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

function deletePreviousCommentAndUpdateEventCommentID(db, eventID, newCommentID) {
    try {
        var row = db.prepare('SELECT * FROM events WHERE id=?').get(eventID);
    } catch (err) {
        throw(new Error('Can\'t get previous commentID while add new comment: ' + err.message));
    }

    try {
        db.prepare('UPDATE events set commentID=$commentID WHERE id=$eventID').run({
            eventID: eventID,
            commentID: newCommentID,
        });
    } catch (err) {
        throw(new Error('Can\'t update events table for add comment: ' + err.message));
    }
    if (!row || !row.commentID) return;
    var prevCommentID = row.commentID;

    try {
        var rows = db.prepare('SELECT * FROM events WHERE commentID=?').all(prevCommentID);
    } catch (err) {
        throw(new Error('Can\'t get previous commentID while add new comment: ' + err.message));
    }
    if (rows.length) return;

    try {
        db.prepare('DELETE FROM comments WHERE id=?').run(prevCommentID);
    } catch (err) {
        // some time we can get SQLITE_CONSTRAINT: FOREIGN KEY constraint failed.
        log.warn('Can\'t delete previous comment: ', err.message, ': ', row);
    }
}

