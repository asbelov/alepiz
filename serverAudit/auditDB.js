/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Conf = require('../lib/conf');

const confLog = new Conf('config/log.json');
const cfg = confLog.get();

var auditDB = {
    //getRecords: function (lastRecordID, userID, sessionsIDs, callback) {callback(null, []); },
};
module.exports = auditDB;

/**
 * Open audit DB
 * @param {string} dbPath path to database file
 * @param {Boolean} isReadOnly if true, then open database in read only mode
 * @param {function(Error)|function(null, db)} callback callback(err, db), where db is a better-sqlite3 db object
 */
auditDB.dbOpen = function (dbPath, isReadOnly, callback) {

    if(isReadOnly && !fs.existsSync(dbPath)) {
        setTimeout(auditDB.dbOpen, 30000, dbPath, isReadOnly, callback);
        return;
    }

    try {
        var db = new Database(dbPath, {
            readonly: isReadOnly,
            timeout: Number(cfg.dbLockTimeout) || 5000,
        });
    } catch (err) {
        return callback(new Error('Can\'t open audit DB ' + dbPath + ': ' + err.message));
    }

    try {
        if(!isReadOnly) {
            db.pragma('synchronous = "OFF"');
            db.pragma('foreign_keys = "ON"');
            db.pragma('encoding = "UTF-8"');
            db.pragma('journal_mode = "WAL"');
        }
    } catch (err) {
        callback(new Error('Can\'t set some required pragma modes to ' + dbPath + ': ' + err.message));
    }

    /**
     * Close audit DB
     * @param {function(Error)|function()} [callback] callback(err)
     */
    auditDB.close = function (callback) {

        try {
            db.close();
        } catch (err) {
            if(typeof callback === 'function') {
                callback(new Error('Can\'t close audit DB: ' + err.message + '; dbPath: ' + dbPath));
            }
            return;
        }

        if(typeof callback === 'function') callback();
    }

    /**
     * Insert a new log record
     *
     * @param {Object} messageObj object with data for create a new audit record
     * @param {number} messageObj.sessionID sessionID
     * @param {number} messageObj.timestamp timestamp
     * @param {number} messageObj.level character code for the level of the message ("D", "I", "W", "E")
     * @param {string} messageObj.label message label
     * @param {string} messageObj.message message
     */
    auditDB.insertRecord = db.transaction((messageObj) => {
        var messagesTable = db.prepare('INSERT INTO messages (label, message) VALUES($label, $message)').run({
            label: messageObj.label,
            message: messageObj.messageBody,
        });
        var id = messagesTable.lastInsertRowid;
        db.prepare('INSERT INTO log (id, sessionID, timestamp, level) VALUES($id, $sessionID, $timestamp, $level)')
            .run({
                id: id,
                sessionID: messageObj.sessionID,
                timestamp: messageObj.timestamp,
                level: messageObj.level.charAt(0), // get char code of message level
            });
    });

    /**
     * Add or update a session parameters
     * @param {Object} sessionObj  object with data for add a new sessionID
     * @param {number} sessionObj.userID] user ID
     * @param {number} sessionObj.sessionID sessionID
     * @param {string} sessionObj.actionID action dir
     * @param {number} sessionObj.startTimestamp timestamp when action was started
     * @param {string} [sessionObj.description] action description
     * @param {Object} [sessionObj.objects] objects for action
     */
    auditDB.addNewSession = db.transaction((sessionObj) => {

        // add null description for generate new rowid for sessions table
        if(!sessionObj.description) sessionObj.description = null
        try {
            var descriptionsTable = db.prepare('INSERT INTO descriptions (description) VALUES($description)')
                .run(sessionObj);
            sessionObj.id = descriptionsTable.lastInsertRowid;
        } catch (err) {
            throw new Error('Can\'t add description ' + sessionObj.description + ' to auditDB: ' + err.message);
        }

        try {
            db.prepare('\
INSERT INTO sessions (id, userID, sessionID, actionID, startTimestamp) \
VALUES ($id, $userID, $sessionID, $actionID, $startTimestamp)').run(sessionObj);
        } catch (err) {
            throw new Error('Can\'t add sessions to auditDB: ' + err.message +
                ': ' + JSON.stringify(sessionObj, null, 4));
        }

        if(Array.isArray(sessionObj.objects) && sessionObj.objects.length) {
            var stmtObjects = db.prepare(
                'INSERT INTO objects (sessionID, objectID, objectName) VALUES ($sessionID, $id, $name)');

            sessionObj.objects.forEach(obj => {
                if(!obj.id || !obj.name) return;
                try {
                    stmtObjects.run({
                        sessionID: sessionObj.sessionID,
                        id: obj.id,
                        name: obj.name,
                    });
                } catch (err) {
                    throw new Error('Can\'t add object to auditDB: ' + err.message +
                        ': sessionID: ' + sessionObj.sessionID +
                        ', object: ' + JSON.stringify(obj, null, 4));
                }
            });
        }
    });

    /**
     * Update a session parameters
     * @param {Object} sessionObj  object with data for add a new sessionID
     * @param {number} sessionObj.sessionID sessionID
     * @param {number} sessionObj.stopTimestamp timestamp when action was stopped
     * @param {string|null} sessionObj.error session error message or null
     */
    auditDB.addSessionResult = db.transaction((sessionObj) => {
        db.prepare('UPDATE sessions SET stopTimestamp=$stopTimestamp WHERE sessionID=$sessionID')
            .run(sessionObj);

        if(sessionObj.error) {
            var id = db.prepare('SELECT id FROM sessions WHERE sessionID = $sessionID').get(sessionObj).id;
            db.prepare('UPDATE descriptions SET error=$error WHERE rowid=$id').run({
                id: id,
                error: sessionObj.error,
            });
        }
    });

    /**
     * Get audit log records
     * @param {number} [lastRecordID=0] last log record ID for continue getting the log records
     * @param {number} userID get log records only for specific user ID
     * @param {Array} sessionIDs array of the session IDs
     * @return {Array} log records is an array with objects like
     *     [{id, sessionID, level, timestamp, label, message, userID, actionID, sessionTimestamp}, ...]
     */
    auditDB.getRecords = function(lastRecordID=0, userID, sessionIDs) {
        var maxRecordsCnt = Number(confLog.get('maxRecordsReturnedFromDatabase'));
        if(maxRecordsCnt !== parseInt(String(maxRecordsCnt), 10) || maxRecordsCnt <= 10 ) maxRecordsCnt = 100;

        var stmt = db.prepare('\
SELECT log.id AS id, log.sessionID AS sessionID, log.timestamp AS timestamp, log.level AS level, \
messages.label AS label, messages.message AS message, \
sessions.userID AS userID, sessions.actionID AS actionID, sessions.startTimestamp AS sessionTimestamp FROM log \
JOIN messages ON log.id=messages.rowid \
JOIN sessions ON log.sessionID = sessions.sessionID \
WHERE log.id > $lastID AND sessions.userID = $userID AND log.sessionID = $sessionID \
ORDER by log.timestamp DESC LIMIT $maxRecordsReturnedFromDatabase');

        if(!sessionIDs) sessionIDs = [0];
        var allRows = [];
        sessionIDs.reverse().some(sessionID => {
            var rows = stmt.all({
                lastID: lastRecordID || 0,
                userID: userID,
                sessionID: sessionID,
                maxRecordsReturnedFromDatabase: maxRecordsCnt - allRows.length,
            });

            Array.prototype.push.apply(allRows, rows);
            return allRows.length >= maxRecordsCnt;
        });

        return allRows;
    }


    /**
     * Get all audit log records, sorted by timestamp desc from lastRecordID
     * @param {number} [lastRecordID=0] last log record ID for continue getting the log records
     * @return logRecordRows is an
     *     array with objects [{sessionID, level, timestamp, label, message, actionID, userID}, ...]
     */
    auditDB.getAllRecords = function(lastRecordID=0) {
        var maxRecordsCnt = Number(confLog.get('maxRecordsReturnedFromDatabase'));
        if(maxRecordsCnt !== parseInt(String(maxRecordsCnt), 10) || maxRecordsCnt <= 10 ) maxRecordsCnt = 100;

        return db.prepare('\
SELECT log.sessionID AS sessionID, log.timestamp AS timestamp, log.level AS level, \
messages.label AS label, messages.message AS message, \
sessions.userID AS userID, sessions.actionID AS actionID FROM log \
JOIN messages ON log.id=messages.rowid \
JOIN sessions ON log.sessionID = sessions.sessionID \
WHERE log.id > $lastID \
ORDER by log.timestamp DESC LIMIT $maxRecordsReturnedFromDatabase\
        ').all({
            lastID: lastRecordID,
            maxRecordsReturnedFromDatabase: maxRecordsCnt,
        });
    }

    /**
     * Get session information from the lastID. The lastID is not a sessionID.
     * This is the "id" field from the session table
     *
     * @param {number} [lastID=0] last ID for ID filed.
     * @return Array sessionRows
     * @example
     * returned sessionRows array:
     *  [{
     *     id: <id = descriptions.rowid>,
     *     sessionID: <sessionID>,
     *     actionID: <actionID (action dir)>,
     *     startTimestamp: <time when action was started>,
     *     stopTimestamp: <time when action was finished>,
     *     description: <an action description created from a action descriptionTemplateHTML or descriptionTemplate>
     *     objects: [{
     *         id: <objectID>,
     *         name: <objectName>
     *     }, ....]
     *  }, ...]
     */
    auditDB.getSessions = function (lastID=0) {
        var maxSessionsCnt = Number(confLog.get('maxSessionsReturnedFromDatabase'));
        if(maxSessionsCnt !== parseInt(String(maxSessionsCnt), 10) || maxSessionsCnt <= 10 ) maxSessionsCnt = 1000;

        var sessionsRows = db.prepare('\
SELECT * FROM sessions JOIN descriptions ON sessions.id=descriptions.rowid \
WHERE sessions.id > $lastID ORDER by sessions.startTimestamp DESC LIMIT $maxSessionsReturnedFromDatabase').all({
            lastID: lastID,
            maxSessionsReturnedFromDatabase: maxSessionsCnt,
        });

        var objectStmt =
            db.prepare('SELECT objectID AS id, objectName AS name FROM objects WHERE sessionID=$sessionID');

        sessionsRows.forEach(row => {
            row.objects = objectStmt.all({sessionID: row.sessionID})
        });

        return sessionsRows;
    };

    callback(null, db);
}

/**
 * Get path to all auditDB from log.conf file
 * You can set array of the audit DB path or string
 * @example
 * log.conf:
 * "auditDB": [
 *         {
 *             "path": "DB",
 *             "file": "audit.db",
 *             "relative": true
 *         },
 *         {
 *             "path": "DBClone",
 *             "file": "audit.db",
 *             "relative": true
 *         }
 *     ],
 * or
 * "auditDB": "DB\\audit.db",
 * @param {function(Error)|function(null, Array)} callback callback(err, dbPaths), where dbPath is an array of the
 *  path to audit databases
 */
auditDB.getAuditDbPaths = function (callback) {

    var dbPaths;
    if(Array.isArray(cfg.auditDB) && cfg.auditDB.length) {
        dbPaths = cfg.auditDB.map(function (obj) {
            if (obj && typeof obj.path === 'string' && typeof obj.file === 'string') {
                if(obj.relative) return path.join(__dirname, '..', obj.path, obj.file);
                else return path.join(obj.path, obj.file);
            } else {
                return callback(new Error('Can\'t create DB path from ' + JSON.stringify(cfg.auditDB) +
                    ': ' + JSON.stringify(obj)));
            }
        });
    } else if (typeof cfg.auditDB === 'string') {
        dbPaths = [cfg.auditDB];
    } else return callback(new Error('Error in log.conf:auditDB parameter: ' + JSON.stringify(cfg.auditDB)));

    callback(null, dbPaths);
}
