/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const threads = require('../lib/threads');
const auditDB = require('./auditDB');
const auditCreateDB = require('./auditCreateDB');
const usersDB = require('../models_db/usersDB');
const actionsConf = require('../lib/actionsConf');

const dbPath = threads.workerData && threads.workerData[0];
var sessions = new Map();

// printing cache info and clearing deleted sessions from the cache every 5 minutes
setInterval(function () {
    var now = Date.now();
    var sessionsRemoved = 0;
    var sessionsForRemove = 0;
    sessions.forEach((sessionObj, sessionID) => {
        if(sessionObj.deleted) {
            ++sessionsForRemove;
            if (now - sessionObj.deleted > 3600000) {
                ++sessionsRemoved;
                sessions.delete(sessionID);
            }
        }
    });
    log.info('Sessions in the cache: ', sessions.size, '; ', sessionsRemoved,
        ' deleted sessions has been cleared; ', sessionsForRemove,
        ' sessions have been marked for deletion in the future');
}, 300000);

auditDB.dbOpen(dbPath, false, function (err, db) {
    if(err) return log.throw('Can\'t open audit DB: ' + err.message);

    auditCreateDB(db, function (err) {
        if(err) log.error(err.message);

        new threads.child({
            module: 'auditDB',
            onMessage: onMessage,
            onStop: auditDB.close,
            onDestroy: auditDB.close,
            simpleLog: true,
        });

        log.info('Audit server started: ', dbPath);
    });
});

/**
 * Processing messages from actionClient
 * @param {Object} msgObj
 * @param {function(Error)|function(null, object)} callback callback(err, returnedMessage), where returned message is
 *    message which returned from auditDB
 */
function onMessage (msgObj, callback) {
    if (!msgObj || typeof msgObj !== 'object') return;

    if (msgObj.messageBody) addNewRecord(msgObj);
    else if (msgObj.lastRecordID !== undefined && Array.isArray(msgObj.sessionIDs)) getLogRecords(msgObj, callback);
    else if (msgObj.lastRecordID !== undefined) getSessions(msgObj.lastRecordID, callback);
    else if (msgObj.user !== undefined && !sessions.has(msgObj.sessionID)) sessions.set(msgObj.sessionID, msgObj);
    else if (msgObj.stopTimestamp) addSessionResult(msgObj);
}

/**
 * Add a new audit log record
 * @param {Object} messageObj object with data for create a new audit record
 * @param {number} messageObj.sessionID sessionID
 * @param {number} messageObj.timestamp timestamp
 * @param {number} messageObj.level character code for the level of the message ("D", "I", "W", "E")
 * @param {string} messageObj.label message label
 * @param {string} messageObj.messageBody message
 * @param {Object} [messageObj.options] log options
 */
function addNewRecord(messageObj) {
    var sessionObj = sessions.get(messageObj.sessionID);
    if(!sessionObj) return;

    addNewSession(sessionObj, function (err) {
        if(err) return log.error(err.message);

        try {
            auditDB.insertRecord(messageObj);
            log.debug('Added a new record: ', messageObj);
        } catch (err) {
            log.error('Can\'t insert message: ', err.message, ': ', messageObj);
        }
    })

}


/**
 * Add a new session
 * @param {Object} sessionObj  sessionObj for add a new sessionID
 * @param {number} sessionObj.user username or user ID
 * @param {number} sessionObj.userID user ID
 * @param {number} sessionObj.sessionID sessionID
 * @param {string} sessionObj.actionID action dir
 * @param {number} sessionObj.startTimestamp timestamp when action was started
 * @param {string} [sessionObj.descriptionTemplate] action description template
 * @param {string} [sessionObj.description] action description
 * @param {Object} [sessionObj.objects] objects for action
 * @param {boolean} [sessionObj.saved] true if the session with sessionID was added before
 * @param {function(Error)|function()} callback callback(err)
 */
function addNewSession(sessionObj, callback) {
    if(sessionObj.saved) return callback();

    usersDB.getID(sessionObj.user, function (err, userID) {
        if (err) return callback(new Error('Can\'t get userID for user ' + sessionObj.user + ': ' + err.message));
        if(userID === undefined) {
            log.warn('Can\'t find user ', sessionObj.user, ' for add a new session. UserID will be set to 0 for ',
                sessionObj);
            userID = 0;
        }

        sessionObj.userID = userID;

        createActionDescription(sessionObj.args, sessionObj.descriptionTemplate, function(err, description) {
            if (err) log.warn('Can\'t create description for action: ', err.message, '; ', sessionObj);

            if (description) sessionObj.description = description;

            try {
                auditDB.addNewSession(sessionObj);
                sessions.get(sessionObj.sessionID).saved = true;
                log.debug('Added a new session: ', sessionObj);
            } catch (err) {
                return callback(new Error('Can\'t add new session to the sessions table: ' + err.message +
                    ': ' + JSON.stringify(sessionObj, null, 4)));
            }
            return callback()
        });
    });
}

/**
 * Update the saved session to add a session stop timestamp
 * @param {Object} sessionObj object with parameters
 * @param {number} sessionObj.sessionID session ID
 * @param {number} sessionObj.stopTimestamp session stop timestamp
 * @param {string|null} sessionObj.error session error message or null
 */
function addSessionResult(sessionObj) {
    var savedSession = sessions.get(sessionObj.sessionID);
    if(!savedSession || !savedSession.saved) return;

    try {
        auditDB.addSessionResult(sessionObj);
        savedSession.deleted = Date.now(); // savedSession ia a pointer to the sessions.get(sessionObj.sessionID)
        log.debug('Add session stop timestamp: ', sessionObj);
    } catch (err) {
        log.error('Can\'t update session for add stop timestamp to the sessions table: ', err.message,
            ': ', sessionObj);
    }
}

/**
 * Get log records from auditDB for specific user and sessionIDs. Used for show the action execution result
 * @param {Object} req object with request parameters
 * @param {number} req.lastRecordID last log record ID for continue getting the log records
 *     or 0 for get records from beginning
 * @param {Array} req.sessionIDs array with session IDs. If not set, get the records for all sessions
 * @param {string|number} req.user user ID or username. If not set get the records for all users
 * @param {function(Error)|function(null, Array)} callback callback(err, logRecordsRows), where logRecordsRows
 *     is an array with log records objects like [{}]
 */
function getLogRecords (req, callback) {
    usersDB.getID(req.user, function (err, userID) {
        if (err) return log.error('Can\'t get userID for user ', req.user, ': ', err.message);
        if (userID === undefined) return log.error('Can\'t find user ', req.user);

        try {
            var logRecordsRows = auditDB.getRecords(req.lastRecordID, userID, req.sessionIDs);
            log.debug('Getting ', logRecordsRows.length, ' log records for request: ', req);
        } catch (err) {
            log.error('Can\'t get log records from auditDB: ', err.message, ' for request ', req)
            return callback(new Error('Can\'t get log records from auditDB: ' + err.message +
                ' for request ' + JSON.stringify(req, null, 4)));
        }
        callback(null, logRecordsRows);
    });
}

/**
 * Get sessions from auditDB. Used in the audit action
 * @param {number} lastID last id from sessions table for continue getting the sessions
 *     or 0 for get records from beginning
 * @param {function(Error)|function(null, Array)} callback callback(err, sessionsRows), where logRecordsRows
 *     is an array with log records objects like [{}]
 */
function getSessions (lastID, callback) {
    try {
        var sessionsRows = auditDB.getSessions(lastID);
        log.debug('Getting ', sessionsRows.length, ' sessions.');
    } catch (err) {
        return callback(new Error('Can\'t get sessions from auditDB: ' + err.message +
            ' for lastID: ' + lastID));
    }
    callback(null, sessionsRows);
}


function createActionDescription(args, descriptionTemplate, callback) {
    if(!descriptionTemplate) return callback();

    var variables = [];
    if(args && typeof args === 'object') {
        for (var name in args) {
            variables.push({
                name: name,
                value: args[name],
            });
        }
    }
    actionsConf.makeActionDescription(descriptionTemplate, variables, callback);
}
