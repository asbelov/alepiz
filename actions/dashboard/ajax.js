/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var path = require('path');
var async = require('async');
var objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');
var countersDB = require('../../models_db/countersDB');
var prepareUser = require('../../lib/utils/prepareUser');
var usersDB = require('../../models_db/usersDB');
var actionsRights = require('../../rightsWrappers/actions');
var Database = require('better-sqlite3');
const Conf = require('../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confActions = new Conf('config/actions.json');
const confOptionsEventGenerator = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
var isEventDisabled = require('../../' + confCollectors.get('dir') + '/event-generator/lib/isEventDisabled');
var checkIDs = require('../../lib/utils/checkIDs');

var db;
var hostPort = confActions.get('serverAddress') + ':' + confActions.get('serverPort');
module.exports = ajax; // initDB need to run ajax again in recursion

function ajax(args, callback) {

    log.debug('Starting ajax ', __filename, ' with parameters ', args);

    if(args.hostPort) hostPort = args.hostPort;

    /**
     *
     * @type {{
     *     restrictions: {
     *         Default: Object,
     *     },
     *     actions: Array<{id: number, name: string}>
     * }}
     */
    var cfg = args.actionCfg;
    if(!cfg || !cfg.restrictions) return callback(new Error('Can\'t find "restrictions" in action configuration'));

    if(!db) return initDB(args, callback);

    var user = prepareUser(args.username);

    usersDB.getUsersInformation(user, function(err, rows) {
        if(err) {
            return callback(new Error('Can\'t get user information for ' + args.username + '(' + user +'): ' +
                err.message));
        }
        if(rows.length < 1) {
            return callback(new Error('Error while getting user information for ' + args.username + '(' + user +
                '): received data for ' + rows.length + ' users'));
        }

        var role = rows[0].roleName;
        if(!role) return callback(new Error('Can\'t find any role for user ' + args.username + '(' + user +')'));

        /**
         *
         * @type {{
         *     Importance: number,
         *     Sound: Boolean,
         *     Hints: Boolean,
         *     Info: Boolean,
         *     History: Boolean,
         *     Links: Boolean,
         *     Message: Boolean,
         *     Historical: Boolean,
         *     Current: Boolean,
         *     Disabled: Boolean,
         *     Comments: Boolean
         * }}
         */
        var restrictions = cfg.restrictions[role] || cfg.restrictions.Default;
        if(!restrictions) {
            return callback(new Error('Can\'t find restrictions for role ' + role + ' user ' + args.username +
                '(' + user +') and "Default" restriction is not set'));
        }

        if(args.func === 'getRestrictions') {
            if(!restrictions.Links) {
                return callback(null, {
                    restrictions: restrictions,
                    actions: [],
                });
            }

            // filter actions, which can displayed as action links according user actions rights
            checkActionsRights(args.username, cfg.actions, function(err, checkedActions) {
                if(err) log.error(err.message);
                return callback(null, {
                    restrictions: restrictions,
                    actions: checkedActions,
                });
            })
        } else if(args.func === 'getEventsData') {
            if(!restrictions.Current && args.getDataForCurrentEvents) {
                return callback(new Error('Access denied for ' + user +
                    ' and function: "getEventsData:getDataForCurrentEvents": ' + JSON.stringify(args)));
            }
            if(!restrictions.Historical && args.getDataForHistoryEvents) {
                return callback(new Error('Access denied for ' + user +
                    ' and function: "getEventsData:getDataForHistoryEvents": ' + JSON.stringify(args)));
            }
            if(!restrictions.Disabled && args.getDataForDisabledEvents) {
                return callback(new Error('Access denied for ' + user +
                    ' and function: "getEventsData:getDataForDisabledEvents": ' + JSON.stringify(args)));
            }

            if(!args.getDataForCurrentEvents && !args.getDataForHistoryEvents && !args.getDataForDisabledEvents) {
                return callback(new Error('Nothing to do for function: "' + args.func + '": ' + JSON.stringify(args)));
            }

            // callback(err, {history: [..], current: [...], disabled: [...], comment: []});
            getEvents(args, restrictions.Importance, callback);
        } else if(restrictions.Info && args.func === 'getComment') {
            getCommentForEvent(args.ID, callback);
        } else if(restrictions.Hints && args.func === 'getHint') {
            getHintForEvent(args.ID, callback);
        } else if(restrictions.Comments && args.func === 'getComments') {
            getDashboardDataForHistoryCommentedEvents (args, restrictions.Importance, callback);
        } else if(restrictions.Comments && args.func === 'getCommentedEventsList') {
            getDashboardDataForCommentedEventsList(args.objectsIDs, args.commentID, restrictions.Importance, callback);
        } else if(restrictions.History && args.func === 'getHistoryData') {
            getHistoryForOCID(args.OCID, Number(restrictions.Importance), callback);
        } else if(restrictions.Message && args.func === 'getObjectsProperties') {
            objectsPropertiesDB.getPropertiesByOCIDs(args.username, args.IDs, 0, callback);
        } else if(restrictions.Links && args.func === 'getCounterVariables') {
            countersDB.getOCIDsForVariables(args.objectName, args.counterID, callback);
        } else {
            return callback(new Error('Access denied for ' + user +
                ' or ajax function is not set or unknown function: "' + args.func + '"'));
        }
    });
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

function checkActionsRights(user, actions, callback) {

    var checkedActions = [];
    async.eachSeries(actions, function (action, callback) {
        if(!action.ID || !action.name) return callback();

        actionsRights.checkActionRights(user, action.ID, 'ajax', function(err) {
            if(!err) checkedActions.push(action);
            callback();
        });
    }, function(/* err */) {
        callback(null, checkedActions);
    });
}

function getEvents (args, maxImportance, callback) {
    checkIDs(args.objectsIDs, function (err, objectsIDs) {
        if (!args.objectsIDs || !objectsIDs || !objectsIDs.length) objectsIDs = [];
        else if (err) return callback(err);

        var condition = ['disabledEvents.eventID NOTNULL'];
        if(args.getDataForCurrentEvents) condition.push('events.endTime ISNULL');
        if(args.getDataForHistoryEvents) condition.push('events.commentID ISNULL');
        var queryParameters = [maxImportance];
        Array.prototype.push.apply(queryParameters, objectsIDs);

        try {
            var events = db.prepare('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, \
events.timestamp AS timestamp, events.importance AS importance, events.commentID AS commentID, \
events.startTime AS startTime, events.endTime AS endTime, events.pronunciation AS pronunciation, \
disabledEvents.disableUntil AS disableUntil, disabledEvents.intervals AS disableIntervals, \
disabledEvents.user AS disableUser, disabledEvents.disableFrom AS disableFrom, \
disabledEvents.disableDaysOfWeek AS disableDaysOfWeek \
FROM events \
LEFT JOIN disabledEvents ON disabledEvents.eventID=events.id \
WHERE (' + condition.join(' OR ') + ') AND events.importance <= ? ' +
(objectsIDs.length ? 'AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ')' : '') + ' \
ORDER BY disabledEvents.eventID DESC, events.startTime DESC').all(queryParameters);
        } catch (err) {
            return callback(new Error('Can\'t get data from events: ' + err.message));
        }

        try {
            var rows = db.prepare('SELECT id, OCID, counterID FROM hints').all();
        } catch (err) {
            return callback(new Error('Can\'t get hints: ' + err.message));
        }

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
            else if (hintsCounterID[event.counterID]) event.hintID = hintsCounterID[event.counterID].id;

            // make list of disabled events
            //  are sorted by disabledEvents.eventID and at first of the events list we have a disabled events
            if (event.disableUntil) disabledOCID[event.OCID] = event;

            // add disabled event information
            if (disabledOCID[event.OCID]) {
                event.disableUntil = disabledOCID[event.OCID].disableUntil;
                event.disableIntervals = disabledOCID[event.OCID].disableIntervals;
                event.disableUser = disabledOCID[event.OCID].disableUser;
                event.disableFrom = disabledOCID[event.OCID].disableFrom;
                event.disableDaysOfWeek = disabledOCID[event.OCID].disableDaysOfWeek
            }

            //log.info('event all: ', event.objectName, ':', event.counterName, ':', event);
            // sort events
            if (!event.disableUntil ||
                event.disableUntil < now ||
                    !isEventDisabled( event.objectName + '(' + event.counterName + ') from ajax',
                        event.disableFrom, event.disableDaysOfWeek, event.disableIntervals,
                    event.startTime, event.endTime)) {

                //log.info('event prn: ', event.objectName, ':', event.counterName, ':', event);
                if (args.getDataForCurrentEvents && event.endTime === null ) current.push(event);
                if (args.getDataForHistoryEvents && !event.commentID) history.push(event);
            }
        });

        callback(null, {
            disabled: args.getDataForDisabledEvents ? Object.values(disabledOCID).reverse() : [],
            current: current,
            history: history
        });
    });
}

function getHistoryForOCID (initOCID, maxImportance, callback) {
    checkIDs(initOCID, function (err, OCIDs) {
        if (!initOCID || !OCIDs || !OCIDs.length) return callback(new Error('OCID is not set for getting history'));
        else if (err) return callback(err);

        try {
            var events = db.prepare('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, \
events.timestamp AS timestamp, events.importance AS importance, events.commentID AS commentID, \
events.startTime AS startTime, events.endTime AS endTime, events.pronunciation AS pronunciation, \
disabledEvents.disableUntil AS disableUntil, disabledEvents.intervals AS disableIntervals, \
disabledEvents.user AS disableUser, disabledEvents.disableFrom AS disableFrom, \
disabledEvents.disableDaysOfWeek AS disableDaysOfWeek \
FROM events \
LEFT JOIN disabledEvents ON disabledEvents.eventID=events.id \
WHERE events.OCID = ? AND events.importance <= ? \
ORDER BY disabledEvents.eventID DESC, events.startTime DESC LIMIT 100').all([OCIDs[0], maxImportance]);
        } catch (err) {
            return callback(new Error('Can\'t get history data for OCID ' + OCIDs[0] + ' and importance ' +
                maxImportance + ' from events: ' + err.message));
        }
        callback(null, events);
    });
}

/**
 *
 * @param {Object} args ajax args
 * @param {number} args.from get events from date
 * @param {number} args.to get events to date
 * @param {Array<Number>} args.ObjectsIDs an array with object IDs
 * @param maxImportance max event importance
 * @param {function(Error)|function(null, Array<{
 *     id: number,
 *     timestamp: number,
 *     user: string,
 *     recipients: string,
 *     subject: string,
 *     comment: string,
 *     eventsCount: number,
 *     importance: number,
 *
 * }>)} callback callback(err, result)
 */
function getDashboardDataForHistoryCommentedEvents (args, maxImportance, callback) {

    // convert time from UTC for support different TZ in browser and server
    // for UTC+10 return -600 (minutes); convert from minutes to milliseconds
    var tzOffset = new Date().getTimezoneOffset() * 60000;
    var from = Number(args.from) - tzOffset;
    var to = new Date(new Date(Number(args.to) - tzOffset).setHours(23,59,59,999)).getTime();

    if(!to || !from || from >= to || to < 1477236595310) { // 1477236595310 = 01.01.2000
        log.warn('Error in dates interval for show comments: ', args);
        return callback(null, []);
    }

    checkIDs(args.ObjectsIDs, function (err, objectsIDs) {
        if (!args.ObjectsIDs || !objectsIDs || !objectsIDs.length) objectsIDs = [];
        else if (err) return callback(err);

        var queryParameters = [from, to, maxImportance];
        if (objectsIDs && objectsIDs.length) Array.prototype.push.apply(queryParameters, objectsIDs);
        else objectsIDs = null;

        try {
            var rows = db.prepare('\
SELECT comments.id AS id, comments.timestamp AS timestamp, comments.user AS user, comments.recipients AS recipients, \
comments.subject AS subject, comments.comment AS comment, count(events.id) AS eventsCount, min(events.importance) AS importance \
FROM comments \
JOIN events ON comments.id=events.commentID \
WHERE comments.timestamp BETWEEN ? AND ? AND events.importance <= ? '
+ (objectsIDs ? ' AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ') ' : '') +
'GROUP by events.commentID ORDER BY comments.timestamp DESC').all(queryParameters);
        } catch (err) {
            return callback(new Error('Can\'t get data for dashboard commented history events: ' + err.message));
        }
        callback(null, rows);
    });
}

function getDashboardDataForCommentedEventsList (initObjectIDs, hostPortCommentID, maxImportance, callback) {
    var initCommentID = hostPortCommentID.indexOf(hostPort) === 0 ?
        parseInt(hostPortCommentID.replace(/^.+:(\d+)$/, '$1'), 10) : 0;

    if(!initCommentID) return callback();

    checkIDs(initObjectIDs, function (err, objectsIDs) {
        if(!initObjectIDs) objectsIDs = '';
        else if(err) return callback(err);

        checkIDs(initCommentID, function (err, commentIDs) {
            if (err) return callback(err);

            // commentIDs[0] because checkIDs return array
            var queryParameters = [commentIDs[0], maxImportance];
            if(objectsIDs && objectsIDs.length) Array.prototype.push.apply(queryParameters, objectsIDs);
            else objectsIDs = null;

            try {
                var rows = db.prepare('\
SELECT events.id AS id, events.OCID AS OCID, events.parentOCID AS parentOCID, events.objectName AS objectName, \
events.counterID AS counterID, events.counterName AS counterName, events.data AS eventDescription, events.timestamp AS timestamp, \
events.importance AS importance, events.startTime AS startTime, events.endTime AS endTime, \
hints.id AS hintID \
FROM events \
LEFT JOIN hints ON hints.id = (SELECT id FROM hints \
    WHERE (OCID IS NOT NULL AND events.OCID=OCID) OR \
    ((SELECT id FROM hints WHERE OCID IS NOT NULL AND events.OCID=OCID) IS NULL AND \
    counterID IS NOT NULL AND events.counterID=counterID) ORDER BY timestamp DESC LIMIT 1) \
WHERE events.commentID = ? AND events.importance <= ? ' +
/*'AND events.startTime > ?' + */
(objectsIDs ? 'AND events.objectID IN (' + (new Array(objectsIDs.length)).fill('?').join(',') + ') ' : '') +
'ORDER BY events.startTime DESC LIMIT 1000').all(queryParameters);
            } catch(err) {
                return callback(new Error('Can\'t get data for commented events list: ' + err.message));
            }
            callback(null, rows);
        });
    });
}

function getCommentForEvent(hostPortID_OCID, callback) {
    if(!hostPortID_OCID.length) return callback();

    // ID_OCID = "ID,OCID" or "ID"
    var ID_OCID = parseInt(hostPortID_OCID.replace(/^.+:([^:]+)$/, '$1'), 10);

    checkIDs(ID_OCID, function (err, IDs) {
        if (err) return callback(err);

        var commentID = IDs[0];
        var OCID = IDs[1];
        if(!commentID) return callback();

        try {
            var comment = db.prepare('SELECT * FROM comments WHERE id=?').get(commentID);
        } catch(err) {
            return callback(new Error('Can\'t get comment with ID ' + commentID + ': ' + err.message));
        }
        if(!OCID || !comment) return callback(null, comment);

        try {
            var disabled = db.prepare('SELECT * FROM disabledEvents WHERE OCID=?').get(OCID);
        } catch(err) {
            return callback(new Error('Can\'t get disabled event with OCID ' + OCID + ': ' + err.message));
        }
        if(!disabled) return callback(null, comment);

        for(var key in disabled) {
            if(comment[key] && comment[key] !== disabled[key] && key !== 'timestamp') {
                comment[key] = 'comment: ' + comment[key] + ', disabled: ' + disabled[key];
            } else comment[key] = disabled[key];
        }
        callback(null, comment);
    });
}

function getHintForEvent(ID, callback) {
    checkIDs(ID, function (err, IDs) {
        if (err) return callback(err);

        var hintID = IDs[0];
        if(!hintID) return callback();

        // get last hint
        try {
            var row = db.prepare('SELECT * FROM hints WHERE id=? ORDER BY timestamp DESC LIMIT 1').get(hintID);
        } catch(err) {
            return callback(new Error('Can\'t get hint with ID ' + hintID + ': ' + err.message));
        }
        callback(null, row);
    });
}