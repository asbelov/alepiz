/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Conf = require('../lib/conf');

const confLog = new Conf('config/log.json');

/**
 *
 * @type {{
 *     auditDB: Array<string>|string,
 *     dbLockTimeout: number,
 * }}
 */
const cfg = confLog.get();

const highlightOpen = '{{highlightOpen}}';
const highlightClose = '{{highlightClose}}';

var auditDB = {};
module.exports = auditDB;

/**
 * Open audit DB
 * @param {string} dbPath path to database file
 * @param {Boolean} isReadOnly if true, then open database in read only mode
 * @param {function(Error)|function(null, Object)} callback callback(err, db), where db is a better-sqlite3 db object
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
        /**
         * @type {{lastInsertRowid: number}}
         */
        var messagesTable =
            db.prepare('INSERT INTO messages (label, message) VALUES($label, $message)').run({
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
     * @param {number} [sessionObj.taskID] taskID if action was running from the task
     * @param {number} [sessionObj.taskSession] unique taskSession if action was running from the task
     * @param {number} [sessionObj.taskName] task name if action was running from the task
     * @param {number} sessionObj.startTimestamp timestamp when action was started
     * @param {string} [sessionObj.description] action description
     * @param {Object} [sessionObj.objects] objects for action
     */
    auditDB.addNewSession = db.transaction((sessionObj) => {

        // add null description for generate new rowid for sessions table
        if(!sessionObj.description) sessionObj.description = null
        try {
            /**
             * @type {{lastInsertRowid: number}}
             */
            var descriptionsTable =
                db.prepare('INSERT INTO descriptions (description) VALUES ($description)').run(sessionObj);

            sessionObj.id = descriptionsTable.lastInsertRowid;
        } catch (err) {
            throw new Error('Can\'t add description ' + sessionObj.description + ' to auditDB: ' + err.message);
        }
        if(!sessionObj.taskID) {
            sessionObj.taskID = null;
            sessionObj.taskSession = null;
        } else if (sessionObj.taskName) {

            var addTaskName = db.transaction((sessionObj) => {
                /**
                 * @type {{lastInsertRowid: number}}
                 */
                var taskNamesTable = db.prepare('INSERT INTO taskNames (name) VALUES (?)')
                    .run(sessionObj.taskName);
                var taskNameRowID = taskNamesTable.lastInsertRowid;

                db.prepare('\
INSERT OR IGNORE INTO taskReferences (taskSession, taskNameRowID) VALUES ($taskSession, $taskNameRowID)').run({
                    taskSession: sessionObj.taskSession,
                    taskNameRowID: taskNameRowID,
                });

            });

            try {
                addTaskName(sessionObj);
            } catch (err) {
                throw new Error('Can\'t add task name ' + sessionObj.taskName + ' to auditDB: ' + err.message +
                    ': ' + JSON.stringify(sessionObj, null, 4));
            }
        }

        try {
            db.prepare('\
INSERT INTO sessions (id, userID, sessionID, actionID, taskID, taskSession, startTimestamp) \
VALUES ($id, $userID, $sessionID, $actionID, $taskID, $taskSession, $startTimestamp)').run(sessionObj);
        } catch (err) {
            throw new Error('Can\'t add data to the sessions table in auditDB: ' + err.message +
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
     * Add result to the session
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
     * Get audit log records for specific sessions after lastRecordID
     * @param {number} [lastRecordID=0] last log record ID for continue getting the log records
     * @param {Array} sessionIDs array of the session IDs
     * @param {string} message - FTS5 MATCH filter for messages
     * @return {Array} log records is an array with objects like
     *     [{id, sessionID, level, timestamp, label, message, userID, actionID, sessionTimestamp}, ...]
     */
    auditDB.getRecords = function(lastRecordID=0, sessionIDs, message) {
        var maxRecordsCnt = Number(confLog.get('maxRecordsReturnedFromDatabase'));
        if(maxRecordsCnt !== parseInt(String(maxRecordsCnt), 10) || maxRecordsCnt <= 10 ) maxRecordsCnt = 1000;

        if(!message) message = '';
        var queryFilter = message.replace(/"/g, '') ? ' AND messages.message MATCH $message ' : '';
        var highLightMessage = message.replace(/"/g, '') ?
            'highlight(messages, 1, \'' + highlightOpen + '\', \'' + highlightClose + '\') AS message'  :
            'messages.message AS message';

        var stmtFilter = db.prepare('\
SELECT log.id AS id, log.sessionID AS sessionID, log.timestamp AS timestamp, log.level AS level, \
messages.label AS label, ' + highLightMessage + ', sessions.taskSession AS taskSession, \
sessions.userID AS userID, sessions.actionID AS actionID, sessions.startTimestamp AS sessionTimestamp \
FROM messages \
JOIN log ON log.id=messages.rowid \
JOIN sessions ON log.sessionID = sessions.sessionID \
WHERE log.id > $lastID AND log.sessionID = $sessionID' + queryFilter + ' \
ORDER by log.id ASC LIMIT $maxRecordsReturnedFromDatabase');

        var stmtTask = db.prepare('\
SELECT log.id AS id, log.sessionID AS sessionID, log.timestamp AS timestamp, log.level AS level, \
messages.label AS label, messages.message AS message, \
sessions.userID AS userID, sessions.actionID AS actionID, sessions.startTimestamp AS sessionTimestamp \
FROM log \
JOIN messages ON log.id=messages.rowid \
JOIN sessions ON log.sessionID = sessions.sessionID \
WHERE log.id > $lastID AND log.sessionID = $sessionID AND sessions.taskSession NOTNULL \
ORDER by log.id ASC LIMIT $maxRecordsReturnedFromDatabase');


        if(!sessionIDs) sessionIDs = [0];
        var allRows = [];
        sessionIDs.reverse().some(sessionID => {
            var rowsFilter = stmtFilter.all({
                lastID: lastRecordID || 0,
                sessionID: sessionID,
                maxRecordsReturnedFromDatabase: maxRecordsCnt - allRows.length,
                message: message,
            });
            if(!message.replace(/"/g, '') || (rowsFilter.length && !rowsFilter[0].taskSession)) {
                Array.prototype.push.apply(allRows, rowsFilter);
            } else {
                var rowsTask = stmtTask.all({
                    lastID: lastRecordID || 0,
                    sessionID: sessionID,
                    maxRecordsReturnedFromDatabase: maxRecordsCnt - allRows.length,
                });

                if(!rowsFilter.length) Array.prototype.push.apply(allRows, rowsTask);
                else {
                    for (var i1 = 0, i2 = 0, l1 = rowsFilter.length, l2 = rowsTask.length; ;) {

                        var s1 = rowsFilter[i1];
                        var s2 = rowsTask[i2];

                        if ((s1.id > s2.id || i1 === l1 - 1) && i2 < l2 - 1) {
                            allRows.push(s2);
                            i2++;
                        } else if ((s1.id < s2.id || i2 === l2 - 1) && i1 < l1 - 1) {
                            i1++;
                            allRows.push(s1);
                        } else if (s1.id === s2.id) {
                            if (i1 < l1 - 1) i1++;
                            if (i2 < l2 - 1) i2++;
                            // add highlighted message from filtered query s1
                            allRows.push(s1);
                        }
                        if (i1 === l1 - 1 && i2 === l2 - 1) break;
                    }
                }
            }

            return allRows.length >= maxRecordsCnt;
        });

        return allRows;
    }

    /**
     * Get session information from the lastID. The lastID is not a sessionID.
     * This is the "id" field from the session table
     *
     * @param {Object} req filter parameters
     * @param {number} req.from from date
     * @param {number} req.to to date
     * @param {string} req.userIDs comma separated user IDs
     * @param {string} req.actionIDs comma separated action IDs
     * @param {string} req.description description filter
     * @param {string} req.taskIDs comma separated taskIDs filter
     * @param {string} req.message message filter
     * @param {string} req.objectIDs comma separated objectIDs filter
     * @return {Array<{
     *      id: number,
     *      sessionID: number,
     *      userID: number,
     *      taskID: number,
     *      taskSession: number,
     *      actionID: string,
     *      startTimestamp: number,
     *      stopTimestamp: number,
     *      [message: string],
     *      [description: string],
     *      [actionComment: string],
     *      [actionCommentTimestamp: number],
     *      [actionCommentUsername: string],
     *      [taskComment: string],
     *      [taskCommentTimestamp: number],
     *      [taskCommentUsername: string],
     *      objects: Array<{id: number, name: string}>
     * }>} sessionRows
     * @example
     * returned sessionRows array:
     *  [{
     *      id: <id = descriptions.rowid>,
     *      sessionID: <sessionID>,
     *      actionID: <actionID (action dir)>,
     *      startTimestamp: <time when action was started>,
     *      stopTimestamp: <time when action was finished>,
     *      description: <an action description created from a action descriptionTemplateHTML or descriptionTemplate>
 *          actionComment: comment for the action,
     *      actionCommentTimestamp: action comment timestamp,
     *      actionCommentUsername: action comment username,
     *      taskComment: comment for the task,
     *      taskCommentTimestamp: task comment timestamp,
     *      taskCommentUsername: task comment username,
     *      objects: [{
     *          id: <objectID>,
     *          name: <objectName>
     *      }, ....]
     *  }, ...]
     */
    auditDB.getSessions = function (req={}) {
        var maxSessionsCnt = Number(confLog.get('maxSessionsReturnedFromDatabase'));
        if(maxSessionsCnt !== parseInt(String(maxSessionsCnt), 10) || maxSessionsCnt <= 10 ) maxSessionsCnt = 1000;

        var queryFilterArr = [];
        var actionFilter = new Set();
        var descriptionFilter = new Map();
        var taskNameFilter = new Map();
        var messageFilter = new Set();
        var lastID = null;
        var rowsLimit = '';
        var taskSessionFilter = new Set();


        if (req.from) queryFilterArr.push('sessions.startTimestamp > $from');
        if (req.to) queryFilterArr.push('sessions.stopTimestamp < $to');
        if (req.userIDs) {
            var userIDsArr = [];
            req.userIDs.split(',').forEach(id => {
                id = Number(id);
                if(!isNaN(id) && id === parseInt(String(id), 10) || id >= 0) userIDsArr.push(id);
            });
            if(userIDsArr.length) {
                var userIDs = userIDsArr.join(',');
                queryFilterArr.push('sessions.userID IN ($userIDs)');
            }
        }
        if (req.taskIDs) {
            var taskIDsArr = [];
            req.taskIDs.split(',').forEach(id => {
                id = Number(id);
                if(!isNaN(id) && id === parseInt(String(id), 10) || id >= 0) taskIDsArr.push(id);
            });
            if(taskIDsArr.length) {
                var taskIDs = taskIDsArr.join(',');
                queryFilterArr.push('sessions.taskID IN ($taskIDs)');
            }
        }

        if (req.actionIDs) {
            try {

                var actionStmt = db.prepare('SELECT sessions.id AS id, sessions.taskSession AS taskSession ' +
                    'FROM sessions WHERE sessions.actionID=$actionID ' +
                    'ORDER BY sessions.id DESC LIMIT $maxSessionsReturnedFromDatabase');

                var actionRows = [];
                req.actionIDs.split(',').forEach(actionID => {
                    var rows = actionStmt.all({
                        actionID: actionID,
                        maxSessionsReturnedFromDatabase: maxSessionsCnt - actionRows.length,
                    });
                    if(rows.length) Array.prototype.push.apply(actionRows, rows);
                })
            } catch (err) {
                throw new Error('Actions query: ' + err.message);
            }
            actionRows.forEach(row => {
                actionFilter.add(row.id);
                if (row.taskSession) taskSessionFilter.add(row.taskSession);
            });

            if(actionRows.length) lastID = actionRows[actionRows.length - 1].id;
        }

        if (req.description.replace(/"/g, '')) {
            try {
                var descriptionRows = db.prepare('SELECT sessions.id AS id, sessions.taskSession AS taskSession, ' +
                    'highlight(descriptions, 0, \'' + highlightOpen + '\', \'' + highlightClose + '\') AS description, ' +
                    'highlight(descriptions, 1, \'' + highlightOpen + '\', \'' + highlightClose + '\') AS error ' +
                    'FROM descriptions ' +
                    'JOIN sessions ON sessions.id=descriptions.rowid ' +
                    'WHERE descriptions MATCH $description ' +
                    'ORDER BY sessions.id DESC LIMIT $maxSessionsReturnedFromDatabase')
                    .all({
                        description: req.description,
                        maxSessionsReturnedFromDatabase: maxSessionsCnt,
                });
            } catch (err) {
                throw new Error('Description query: ' + err.message);
            }

            descriptionRows.forEach(row => {
                descriptionFilter.set(row.id, {
                    description: row.description,
                    error: row.error,
                });
                if (row.taskSession) taskSessionFilter.add(row.taskSession);
            });

            if(descriptionRows.length && (lastID === null || descriptionRows[descriptionRows.length - 1].id < lastID)) {
                lastID = descriptionRows[descriptionRows.length - 1].id;
            }

            try {
                var taskNameRows = db.prepare('SELECT sessions.id AS id, sessions.taskSession AS taskSession, ' +
                    'highlight(taskNames, 0, \'' + highlightOpen + '\', \'' + highlightClose + '\') AS taskName ' +
                    'FROM taskNames ' +
                    'JOIN taskReferences ON taskReferences.taskNameRowID=taskNames.rowid ' +
                    'JOIN sessions ON sessions.taskSession=taskReferences.taskSession ' +
                    'WHERE taskNames.name MATCH $description ' +
                    'ORDER BY sessions.id DESC LIMIT $maxSessionsReturnedFromDatabase')
                    .all({
                        description: req.description,
                        maxSessionsReturnedFromDatabase: maxSessionsCnt,
                });
            } catch (err) {
                throw new Error('Task names query: ' + err.message);
            }
            taskNameRows.forEach(row => {
                taskNameFilter.set(row.id, row.taskName);
                if (row.taskSession) taskSessionFilter.add(row.taskSession);
            });
            if(taskNameRows.length && (lastID === null || taskNameRows[taskNameRows.length - 1].id < lastID)) {
                lastID = taskNameRows[taskNameRows.length - 1].id;
            }
        }

        if (req.message.replace(/"/g, '')) {
            try {
            var messageRows =
                db.prepare('SELECT sessions.id AS id, sessions.taskSession AS taskSession ' +
                    'FROM messages ' +
                    'JOIN log ON log.id=messages.rowid ' +
                    'JOIN sessions ON sessions.sessionID=log.sessionID ' +
                    'WHERE messages.message MATCH $message ' +
                    'ORDER BY sessions.id DESC LIMIT $maxSessionsReturnedFromDatabase').all({
                    message: req.message,
                    maxSessionsReturnedFromDatabase: maxSessionsCnt,
                });
            } catch (err) {
                throw new Error('Messages query: ' + err.message);
            }

            messageRows.forEach(row => {
                messageFilter.add(row.sessionID);
                if (row.taskSession) taskSessionFilter.add(row.taskSession);
            });
            if(messageRows.length && (lastID === null || messageRows[messageRows.length - 1].id < lastID)) {
                lastID = messageRows[messageRows.length - 1].id;
            }
        }

        if(lastID !== null) queryFilterArr.push('sessions.id > $lastID');
        else rowsLimit = ' LIMIT $maxSessionsReturnedFromDatabase';

        var queryFilter = queryFilterArr.length ? ' WHERE ' + queryFilterArr.join(' AND ') : '';

        try {
            var sessionRows = db.prepare('\
SELECT sessions.id AS id, sessions.sessionID AS sessionID, sessions.userID AS userID, sessions.taskID AS taskID, \
sessions.taskSession AS taskSession, sessions.actionID AS actionID, \
sessions.startTimestamp AS startTimestamp, sessions.stopTimestamp AS stopTimestamp, \
descriptions.description AS description, descriptions.error AS error, taskNames.name AS taskName, \
actionComments.comment AS actionComment, actionCommentsReferences.timestamp AS actionCommentTimestamp, \
actionCommentsReferences.username AS actionCommentUsername, \
taskComments.comment AS taskComment, taskCommentsReferences.timestamp AS taskCommentTimestamp,\
taskCommentsReferences.username AS taskCommentUsername \
FROM sessions \
JOIN descriptions ON sessions.id=descriptions.rowid \
LEFT JOIN taskCommentsReferences ON taskCommentsReferences.taskSession=sessions.taskSession \
LEFT JOIN taskComments ON taskCommentsReferences.taskCommentRowID=taskComments.rowid \
LEFT JOIN actionCommentsReferences ON actionCommentsReferences.sessionID=sessions.sessionID \
LEFT JOIN actionComments ON actionCommentsReferences.actionCommentRowID=actionComments.rowid \
LEFT JOIN taskReferences ON sessions.taskSession=taskReferences.taskSession \
LEFT JOIN taskNames ON taskReferences.taskNameRowID=taskNames.rowid' + queryFilter + ' \
ORDER BY sessions.id DESC' + rowsLimit).all({
                from: req.from,
                to: req.to + 86400000,
                userIDs: userIDs,
                taskIDs: taskIDs,
                lastID: lastID,
                maxSessionsReturnedFromDatabase: maxSessionsCnt,
            });
        } catch (err) {
            throw new Error('Common query: ' + err.message);
        }
        var filteredResult = new Map();
        var objectStmt =
            db.prepare('SELECT objectID AS id, objectName AS name FROM objects WHERE sessionID=$sessionID');
        var filteredObjectIDs = req.objectIDs ?
            new Set(req.objectIDs.split(',').map(id => Number(id))) : null;
        var objectFilter = new Set();

        sessionRows.forEach(row => {

            if(req.description.replace(/"/g, '') ||
                req.message.replace(/"/g, '') ||
                req.actionIDs) {

                var foundDescription = false;
                if (descriptionFilter.has(row.id)) {
                    row.description = descriptionFilter.get(row.id).description;
                    row.error = descriptionFilter.get(row.id).error;
                    foundDescription = true;
                }

                // if the current row contains an action that is started from the task
                if (row.taskSession) {
                    // if the current row contains a task whose actions do not have
                    // the desired substring in the description of actions and
                    // there is no desired substring in the action messages,
                    // then do not add this row
                    if (!taskSessionFilter.has(row.taskSession) && !taskNameFilter.has(row.id)) return;
                    if (taskNameFilter.has(row.id)) row.taskName = taskNameFilter.get(row.id);
                } else {
                    // if the action in the current row was not started from the task and
                    // the description of the action does not contain the desired substring and
                    // the action messages do not contain the desired substring,
                    // then it does not add this row
                    if (!foundDescription && !messageFilter.has(row.id) && !actionFilter.has(row.id)) return;
                }
            }
            row.objects = objectStmt.all({sessionID: row.sessionID});

            if(filteredObjectIDs) {
                var hasFilteredObject = false;
                row.objects.some(obj => {
                    if(filteredObjectIDs.has(obj.id)) {
                        hasFilteredObject = true;
                        return true;
                    }
                });
                if(!hasFilteredObject && !row.taskSession) return;
                if(hasFilteredObject && row.taskSession) objectFilter.add(row.taskSession);
            }
            filteredResult.set(row.id, row);
        });

        if(filteredObjectIDs) {
            filteredResult.forEach((row, id) => {
                if(row.taskSession && !objectFilter.has(row.taskSession)) filteredResult.delete(id);
            });
        }

        return Array.from(filteredResult.values());
    };

    /**
     * Get all user IDs and action IDs for filter in audit action
     * @return {{userIDs: Array<number>, actionIDs: Array<number>}} userIDs - array with user IDs,
     *  actionIDs - array with action IDs
     */
    auditDB.getAllUsersAndActions = function () {
        var userIDs = db.prepare('SELECT userID FROM sessions GROUP BY userID').all().map(row => row.userID);
        var actionIDs = db.prepare('SELECT actionID FROM sessions GROUP BY actionID').all().map(row => row.actionID);

        return {
            userIDs: userIDs,
            actionIDs: actionIDs,
        };
    }

    /**
     * Add comment to the task
     * @param {number} taskSessionID taskSessionID
     * @param {string} comment new comment for the task
     * @param {string} username username
     */
    auditDB.addTaskComment = db.transaction((taskSessionID, comment, username) => {

        /**
         * @type {{lastInsertRowid: number}}
         */
        var taskCommentsTable =
            db.prepare('INSERT INTO taskComments (comment) VALUES(?)').run(comment);

        var taskCommentRowID = taskCommentsTable.lastInsertRowid;
        db.prepare('\
INSERT INTO taskCommentsReferences (taskCommentRowID, taskSession, timestamp, username) \
VALUES ($taskCommentRowID, $taskSession, $timestamp, $username)').run({
            taskCommentRowID: taskCommentRowID,
            taskSession: taskSessionID,
            timestamp: Date.now(),
            username: username,
        });
    });

    /**
     * Add comment to the action
     * @param {number} sessionID sessionID
     * @param {string} comment new comment for the action
     * @param {string} username username
     */
    auditDB.addActionComment = db.transaction((sessionID, comment, username) => {
        /**
         * @type {{lastInsertRowid: number}}
         */
        var actionCommentsTable =
            db.prepare('INSERT INTO actionComments (comment) VALUES(?)').run(comment);

        var actionCommentRowID = actionCommentsTable.lastInsertRowid;
        db.prepare('\
INSERT INTO actionCommentsReferences (actionCommentRowID, sessionID, timestamp, username) \
VALUES($actionCommentRowID, $sessionID, $timestamp, $username)').run({
            actionCommentRowID: actionCommentRowID,
            sessionID: sessionID,
            timestamp: Date.now(),
            username: username,
        });
    });

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
