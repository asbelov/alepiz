/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


//const log = require('../lib/log')(module);

module.exports = createDB;

/**
 * Create history database
 * @param {Object} db better-sqlite3 object like db = new Database(dbPath, ...)
 * @param {function(Error)|function(void)} callback callback(err)
 */
function createDB(db, callback) {

    try {
        // taskSession used when run one task with one taskID several times
        db.prepare('\
CREATE TABLE IF NOT EXISTS sessions (\
id INTEGER PRIMARY KEY ASC AUTOINCREMENT,\
sessionID INTEGER NOT NULL UNIQUE,\
userID INTEGER NOT NULL,\
taskID INTEGER,\
taskSession INTEGER,\
actionID TEXT NOT NULL,\
startTimestamp INTEGER NOT NULL,\
stopTimestamp INTEGER)\
').run();
    } catch (err) {
        return callback(new Error('Can\'t create sessions table in audit DB: ' + err.message))
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS sessionID_sessions_index on sessions(sessionID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create sessionID index in sessions table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS userID_sessions_index on sessions(userID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create userID index in sessions table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS actionID_sessions_index on sessions(actionID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create actionID index in sessions table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS startTimestamp_sessions_index on sessions(startTimestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create startTimestamp index in sessions table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS stopTimestamp_sessions_index on sessions(stopTimestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create stopTimestamp index in sessions table in audit DB: ' + err.message));
    }

    // descriptions(rowid) = sessions(id)
    try {
        db.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS descriptions USING FTS5(description, error)').run();
    } catch (err) {
        return callback(new Error('Can\'t create descriptions table in audit DB: ' + err.message));
    }

    try {
        db.prepare('\
CREATE TABLE IF NOT EXISTS actionCommentsReferences (\
actionCommentRowID INTEGER PRIMARY KEY,\
sessionID INTEGER NOT NULL,\
timestamp INTEGER NOT NULL\
)\
').run();
    } catch (err) {
        return callback(new Error('Can\'t create actionCommentsReferences table in audit DB: ' + err.message))
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS sessionID_actionCommentsReferences_index on ' +
            'actionCommentsReferences(sessionID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create sessionID index in actionCommentsReferences table in ' +
            'audit DB: ' + err.message));
    }

    // actionComments(rowid) = actionCommentsReferences(actionCommentRowID) and
    // sessions(id) = actionCommentsReferences(sessionsID)
    try {
        db.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS actionComments USING FTS5(comment)').run();
    } catch (err) {
        return callback(new Error('Can\'t create actionComments table in audit DB: ' + err.message));
    }

    try {
        // taskSession used when run one task with one taskID several times
        db.prepare('\
CREATE TABLE IF NOT EXISTS taskReferences (\
taskSession INTEGER PRIMARY KEY,\
taskNameRowID INTEGER NOT NULL UNIQUE)\
').run();
    } catch (err) {
        return callback(new Error('Can\'t create taskReferences table in audit DB: ' + err.message))
    }

    // taskNames(rowid) = taskReferences(taskNameRowID)
    try {
        db.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS taskNames USING FTS5(name)').run();
    } catch (err) {
        return callback(new Error('Can\'t create taskNames table in audit DB: ' + err.message));
    }

    try {
        db.prepare('\
CREATE TABLE IF NOT EXISTS taskCommentsReferences (\
taskCommentRowID INTEGER PRIMARY KEY,\
taskSession INTEGER NOT NULL,\
timestamp INTEGER NOT NULL\
)\
').run();
    } catch (err) {
        return callback(new Error('Can\'t create taskCommentsReferences table in audit DB: ' + err.message))
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS taskSession_taskCommentsReferences_index on ' +
            'taskCommentsReferences(taskSession)').run();
    } catch (err) {
        return callback(new Error('Can\'t create taskSession index in taskCommentsReferences table in ' +
            'audit DB: ' + err.message));
    }

    // taskComments(rowid) = taskCommentsReferences(taskCommentRowID) and
    // taskNames(rowid) = taskCommentsReferences(taskNameRowID)
    try {
        db.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS taskComments USING FTS5(comment)').run();
    } catch (err) {
        return callback(new Error('Can\'t create taskComments table in audit DB: ' + err.message));
    }

    try {
        db.prepare('\
CREATE TABLE IF NOT EXISTS objects (\
id INTEGER PRIMARY KEY ASC AUTOINCREMENT,\
sessionID INTEGER NOT NULL REFERENCES sessions(sessionID) ON DELETE CASCADE ON UPDATE CASCADE,\
objectID INTEGER NOT NULL,\
objectName TEXT NOT NULL)\
').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects table in audit DB: ' + err.message))
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS sessionID_objects_index on objects(sessionID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create sessionID index in objects table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectName_objects_index on objects(objectName)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objectName index in objects table in audit DB: ' + err.message));
    }

    // level is a ASCII code of the level character
    try {
        db.prepare('\
CREATE TABLE IF NOT EXISTS log (\
id INTEGER PRIMARY KEY ASC AUTOINCREMENT,\
sessionID INTEGER NOT NULL REFERENCES sessions(sessionID) ON DELETE CASCADE ON UPDATE CASCADE,\
timestamp INTEGER NOT NULL,\
level INTEGER NOT NULL)\
        ').run();
    } catch (err) {
        return callback(new Error('Can\'t create log table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS sessionID_log_index on log(sessionID)').run();
    } catch (err) {
        return callback(new Error('Can\'t create sessionID index in log table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS timestamp_log_index on log(timestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create timestamp index in log table in audit DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS level_log_index on log(level)').run();
    } catch (err) {
        return callback(new Error('Can\'t create level index in log table in audit DB: ' + err.message));
    }

    // messages(rowid) = log(id)
    try {
        db.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS messages USING FTS5(label, message)').run();
    } catch (err) {
        return callback(new Error('Can\'t create messages table in audit DB: ' + err.message));
    }

    callback();
}