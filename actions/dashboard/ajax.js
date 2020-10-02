/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var path = require('path');
var eventDisabled = require('../../collectors/event-generator/collector').isEventDisabled; // only for isEventsDisabled()
var sqlite = require('../../lib/sqlite');
var conf = require('../../lib/conf');
conf.file('config/conf.json');
var checkIDs = require('../../lib/utils/checkIDs');

var db;
module.exports = ajax; // initDB need to run ajax again in recursion

function ajax(args, callback) {

    log.debug('Starting ajax ', __filename, ' with parameters ', args);

    if(!db) return initDB(args, callback);

    if(args.func === 'getEventsData') getEvents(args, callback); // callback(err, {history: [..], current: [...], disabled: [...], comment: []});
    else if(args.func === 'getComment') getCommentForEvent(args.ID, callback);
    else if(args.func === 'getHint') getHintForEvent(args.ID, callback);
    else if(args.func === 'getComments') getDashboardDataForHistoryCommentedEvents (args, callback);
    else if(args.func === 'getCommentedEventsList') getDashboardDataForCommentedEventsList(args.objectsIDs, args.commentID, callback);
    else if(args.func === 'getHistoryData') getHistoryForOCID(args, callback);
    else return callback(new Error('Ajax function is not set or unknown function: "' + args.func +'"'));
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

function getEvents (args, callback) {
    checkIDs(args.objectsIDs, function (err, objectsIDs) {
        if (!args.objectsIDs || !objectsIDs || !objectsIDs.length) objectsIDs = [];
        else if (err) return callback(err);

        var condition = ['disabledEvents.eventID NOTNULL'];
        if(args.getDataForCurrentEvents) condition.push('events.endTime ISNULL');
        if(args.getDataForHistoryEvents) condition.push('events.commentID ISNULL');

        db.all('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, \
events.timestamp AS timestamp, events.importance AS importance, events.commentID AS commentID, \
events.startTime AS startTime, events.endTime AS endTime, events.pronunciation AS pronunciation, \
disabledEvents.disableUntil AS disableUntil, disabledEvents.intervals AS disableIntervals, disabledEvents.user AS disableUser \
FROM events \
LEFT JOIN disabledEvents ON disabledEvents.eventID=events.id \
WHERE (' + condition.join(' OR ') + ') ' +
    (objectsIDs.length ? 'AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ')' : '') + ' \
ORDER BY disabledEvents.eventID DESC, events.startTime DESC', objectsIDs, function (err, events) {
            if (err) return callback(new Error('Can\'t get data from events: ' + err.message));

            db.all('SELECT id, OCID, counterID FROM hints', function (err, rows) {
                if (err) return callback(new Error('Can\'t get hints: ' + err.message));

                var hintsOCID = {}, hintsCounterID = {};
                rows.forEach(function (row) {
                    if (row.OCID) hintsOCID[row.OCID] = row;
                    if (row.counterID) hintsCounterID[row.counterID] = row;
                });

                var disabledOCID = {}, history = [], current = [], now = Date.now();

                //log.info('Events list:');
                events.forEach(function (event) {
                    // add hintID to events
                    if (hintsOCID[event.OCID]) event.hintID = hintsOCID[event.OCID].id;
                    else if (hintsCounterID[event.counterID]) event.hintID = hintsOCID[event.counterID].id;

                    // make list of disabled events
                    // events are sorted by disabledEvents.eventID and at first of the events list we have a disabled events
                    if (event.disableUntil) disabledOCID[event.OCID] = event;

                    // add disabled event information
                    if (disabledOCID[event.OCID]) {
                        event.disableUntil = disabledOCID[event.OCID].disableUntil;
                        event.disableIntervals = disabledOCID[event.OCID].disableIntervals;
                        event.disableUser = disabledOCID[event.OCID].disableUser;
                    }

                    //log.info('event all: ', event.objectName, ':', event.counterName, ':', event);
                    // sort events
                    if (!event.disableUntil ||
                        event.disableUntil < now ||
                        !eventDisabled(event.disableIntervals, event.startTime, event.endTime)) {

                        //log.info('event prn: ', event.objectName, ':', event.counterName, ':', event);
                        if (args.getDataForCurrentEvents && !event.endTime ) current.push(event);
                        if (args.getDataForHistoryEvents && !event.commentID) history.push(event);
                    }
                });

                callback(null, {
                    disabled: args.getDataForDisabledEvents ? Object.values(disabledOCID).reverse() : [],
                    current: current,
                    history: history
                });
            });
        });
    });
}

function getHistoryForOCID (args, callback) {
    checkIDs(args.OCID, function (err, OCID) {
        if (!args.OCID || !OCID || !OCID.length) OCID = [];
        else if (err) return callback(err);

        db.all('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, \
events.timestamp AS timestamp, events.importance AS importance, events.commentID AS commentID, \
events.startTime AS startTime, events.endTime AS endTime, events.pronunciation AS pronunciation, \
disabledEvents.disableUntil AS disableUntil, disabledEvents.intervals AS disableIntervals, disabledEvents.user AS disableUser \
FROM events \
LEFT JOIN disabledEvents ON disabledEvents.eventID=events.id \
WHERE events.OCID = ? \
ORDER BY disabledEvents.eventID DESC, events.startTime DESC LIMIT 100', OCID, function (err, events) {
            if (err) return callback(new Error('Can\'t get history data for OCID ' + OCID + ' from events: ' + err.message));
            callback(null, events);
        });
    });
}

function getDashboardDataForHistoryCommentedEvents (args, callback) {

    var from = Number(args.from);
    var to = new Date(new Date(Number(args.to)).setHours(23,59,59,999)).getTime();

    if(!to || !from || from >= to || to < 1477236595310) { // 1477236595310 = 01.01.2000
        log.warn('Error in dates interval for show comments: ', args);
        return callback(null, []);
    }

    checkIDs(args.ObjectsIDs, function (err, objectsIDs) {
        if (!args.ObjectsIDs || !objectsIDs || !objectsIDs.length) objectsIDs = [];
        else if (err) return callback(err);

        var queryParameters = [from, to];
        if (objectsIDs && objectsIDs.length) Array.prototype.push.apply(queryParameters, objectsIDs);
        else objectsIDs = null;

        db.all('\
SELECT comments.id AS id, comments.timestamp AS timestamp, comments.user AS user, comments.recipients AS recipients, \
comments.subject AS subject, comments.comment AS comment, count(events.id) AS eventsCount, min(events.importance) AS importance \
FROM comments \
JOIN events ON comments.id=events.commentID \
WHERE comments.timestamp BETWEEN ? AND ? '
    + (objectsIDs ? ' AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ') ' : '') +
'GROUP by events.commentID ORDER BY comments.timestamp DESC', queryParameters, function (err, rows) {
            if (err) return callback(new Error('Can\'t get data for dashboard commented history events: ' + err.message));

            callback(null, rows);
        });
    });
}

function getDashboardDataForCommentedEventsList (initObjectsIDs, commentID, callback) {
    checkIDs(initObjectsIDs, function (err, objectsIDs) {
        if(!initObjectsIDs) objectsIDs = ''; // sorry for this
        else if(err) return callback(err);

        checkIDs(commentID, function (err, commentIDs) {
            if (err) return callback(err);

            var queryParameters = commentIDs;
            if(objectsIDs && objectsIDs.length) Array.prototype.push.apply(queryParameters, objectsIDs);
            else objectsIDs = null;

            db.all('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, events.timestamp AS timestamp, \
events.importance AS importance, events.startTime AS startTime, events.endTime AS endTime, \
hints.id AS hintID \
FROM events \
LEFT JOIN hints ON hints.id = (SELECT id FROM hints \
    WHERE (OCID IS NOT NULL AND events.OCID=OCID) OR \
    ((SELECT id FROM hints WHERE OCID IS NOT NULL AND events.OCID=OCID) IS NULL AND \
    counterID IS NOT NULL AND events.counterID=counterID) ORDER BY timestamp DESC LIMIT 1) \
WHERE events.commentID = ? ' +
/*'AND events.startTime > ?' + */
(objectsIDs ? 'AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ') ' : '') +
'ORDER BY events.startTime DESC LIMIT 1000', queryParameters, function(err, rows) {

                if(err) return callback(new Error('Can\'t get data for commented events list: ' + err.message));
                callback(null, rows);
            });
        });
    });
}

function getCommentForEvent(IDs, callback) {
    checkIDs(IDs, function (err, IDs) {
        if (err) return callback(err);

        var commentID = IDs[0];
        var OCID = IDs[1];
        if(!commentID) return callback();

        db.get('SELECT * FROM comments WHERE id=?', commentID, function(err, comment) {
            if(err) return callback(new Error('Can\'t get comment with ID ' + commentID + ': ' + err.message));

            if(!OCID) return callback(null, comment);

            db.get('SELECT * FROM disabledEvents WHERE OCID=?', OCID, function(err, disabled) {
                if(err) return callback(new Error('Can\'t get disabled event with OCID ' + OCID + ': ' + err.message));

                for(var key in disabled) {
                    if(comment[key] && comment[key] !== disabled[key] && key !== 'timestamp') {
                        comment[key] = 'comment: ' + comment[key] + ', disabled: ' + disabled[key];
                    } else comment[key] = disabled[key];
                }
                callback(null, comment);
            });
        });
    });
}

function getHintForEvent(ID, callback) {
    checkIDs(ID, function (err, IDs) {
        if (err) return callback(err);

        var hintID = IDs[0];
        if(!hintID) return callback();

        // get last hint
        db.get('SELECT * FROM hints WHERE id=? ORDER BY timestamp DESC LIMIT 1', hintID, function(err, row) {
            if(err) return callback(new Error('Can\'t get hint with ID ' + hintID + ': ' + err.message));
            callback(null, row)
        });
    });
}
