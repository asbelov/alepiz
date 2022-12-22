/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const Database = require("better-sqlite3");

module.exports = createDB;

/**
 * Create history database
 * @param {string} dbPath path to historical database file
 * @param {Array} trendsTimeIntervals array with a trends time intervals, like [10, 30, 60];
 * @param {function(Error)|function(void)} callback callback(err
 */
function createDB(dbPath, trendsTimeIntervals, callback) {
    //log.info('Open storage file ', dbPath, '...');

    try {
        var db = new Database(dbPath);
    } catch (err) {
        return log.throw('Can\'t open DB ', dbPath, ': ', err.message);
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS objects (' +
            'id INTEGER PRIMARY KEY ASC,' +
            'type INTEGER,' + // 0 - number, 1 - string
            'cachedRecords INTEGER,' +
            'trends TEXT)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects table in storage DB: ' + err.message))
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS numbers (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
            'timestamp INTEGER NOT NULL,' +
            'data REAL NOT NULL)').run();
    } catch (err) {
        return callback(new Error('Can\'t create numbers table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_numbers_index on numbers(objectID, timestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects-timestamp index in numbers table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS strings (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
            'timestamp INTEGER NOT NULL,' +
            'data TEXT NOT NULL)').run();
    } catch (err) {
        return callback(new Error('Can\'t create strings table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_strings_index on strings(objectID, timestamp)').run();
    } catch (err) {
        return callback(new Error('Can\'t create objects-timestamp index in strings table in storage DB: ' + err.message));
    }

    try {
        db.prepare('CREATE TABLE IF NOT EXISTS config (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'name TEXT NOT NULL UNIQUE,' +
            'value TEXT)').run();
    } catch (err) {
        return callback(new Error('Can\'t create config table in storage DB: ' + err.message));
    }

    for (var i = 0; i < trendsTimeIntervals.length; i++) {
        var timeInterval = trendsTimeIntervals[i];
        try {
            db.prepare('CREATE TABLE IF NOT EXISTS trends' + timeInterval + 'min (' +
                'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
                'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
                'timestamp INTEGER NOT NULL,' +
                'data REAL NOT NULL)').run();
        } catch (err) {
            return callback(new Error('Can\'t create trends' + timeInterval + 'min table in storage DB: ' + err.message));
        }

        try {
            db.prepare('CREATE INDEX IF NOT EXISTS objectID_timestamp_trends' + timeInterval +
                'min_index on trends' + timeInterval + 'min(objectID, timestamp)').run();
        } catch (err) {
            return callback(new Error('Can\'t create objects-timestamp index in trends' + timeInterval +
                'min table in storage DB: ' + err.message));
        }
    }

    try {
        db.close();
        log.info('Close storage DB file in main history process');
    } catch (err) {
        callback(new Error('Can\'t close storage DB: ' + err.message));
    }

    callback();
}