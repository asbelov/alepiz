/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../../lib/log')(module);
const Database = require("better-sqlite3");
const Conf = require("../../../lib/conf");
const confSqlite = new Conf('config/sqlite.json');

module.exports = {
    init: init,
};

function init (dbPath) {

    try {
        var db = new Database(dbPath, {});
    } catch (err) {
        throw(new Error('Can\'t initialise event database ' + dbPath + ': ' + err.message));
    }

    db.maxVariableNumber = Number(confSqlite.get('maxVariableNumber')) || 99;

    try {
        db.pragma('foreign_keys = "ON"');
        db.pragma('encoding = "UTF-8"');
        db.pragma('journal_mode = "WAL"');
    } catch (err) {
        throw(new Error('Can\'t set some required pragma modes to DB: ' + err.message));
    }

    createEventsCommentsTable(db);
    createEventsTable(db);
    createHintsTable(db);
    createDisabledEventsTable(db);

    try {
        db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
        log.error('Can\'t truncate WAL journal file: ', err.message);
    }

    // will return { db, eventsCache,disabledEventsCache }
    return loadDataToCache(db);
}


function createEventsCommentsTable(db) {
    try {
        db.prepare('CREATE TABLE IF NOT EXISTS comments (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'timestamp INTEGER NOT NULL,' +
            'user TEXT NOT NULL,' +
            'subject TEXT,' +
            'recipients TEXT,' +
            'comment TEXT)').run();
    } catch (err) {
        throw(new Error('Can\'t create comments table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS timestamp_comments_index on comments(timestamp)').run();
    } catch (err) {
        throw(new Error('Can\'t create timestamp index in comments table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS user_comments_index on comments(user)').run();
    } catch (err) {
        throw(new Error('Can\'t create user index in comments table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS comments_comments_index on comments(comment)').run();
    } catch (err) {
        throw(new Error('Can\'t create comment index in comments table in events database: ' + err.message));
    }
}

function createEventsTable(db) {
    try {
        db.prepare(
            'CREATE TABLE IF NOT EXISTS events (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'OCID INTEGER NOT NULL,' +
            'objectID INTEGER NOT NULL,' +
            'counterID INTEGER NOT NULL,' +
            'objectName TEXT NOT NULL,' +
            'counterName TEXT NOT NULL,' +
            'parentOCID INTEGER,' + // may be NULL
            'importance INTEGER NOT NULL,' +
            'startTime INTEGER NOT NULL,' +
            'endTime INTEGER,' +
            'initData TEXT,' +
            'data TEXT,' +
            'commentID INTEGER REFERENCES comments(id) ON DELETE NO ACTION ON UPDATE CASCADE,' +
            'timestamp INTEGER,' +
            'pronunciation TEXT)').run();
    } catch (err) {
        throw(new Error('Can\'t create events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS startTime_events_index on events(startTime)').run();
    } catch (err) {
        throw(new Error('Can\'t create startTime index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS endTime_events_index on events(endTime)').run();
    } catch (err) {
        throw(new Error('Can\'t create endTime index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS OCID_events_index on events(OCID)').run();
    } catch (err) {
        throw(new Error('Can\'t create OCID index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectName_events_index on events(objectName)').run();
    } catch (err) {
        throw(new Error('Can\'t create objectName index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS counterName_events_index on events(counterName)').run();
    } catch (err) {
        throw(new Error('Can\'t create counterName index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS importance_events_index on events(importance)').run();
    } catch (err) {
        throw(new Error('Can\'t create importance index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS counterID_events_index on events(counterID)').run();
    } catch (err) {
        throw(new Error('Can\'t create counterID index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS objectID_events_index on events(objectID)').run();
    } catch (err) {
        throw(new Error('Can\'t create objectID index in events table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS commentID_events_index on events(commentID)').run();
    } catch (err) {
        throw(new Error('Can\'t create commentID index in events table in events database: ' + err.message));
    }
}

function createHintsTable(db) {
    try {
        db.prepare('CREATE TABLE IF NOT EXISTS hints (' +
            'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
            'OCID INTEGER,' +
            'counterID INTEGER,' +
            'timestamp INTEGER NOT NULL,' +
            'user TEXT NOT NULL,' +
            'subject TEXT, ' +
            'recipients TEXT, ' +
            'comment TEXT NOT NULL)').run();
    } catch (err) {
        throw(new Error('Can\'t create hints table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS OCID_hints_index on hints(OCID)').run();
    } catch (err) {
        throw(new Error('Can\'t create OCID index in hints table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS counterID_hints_index on hints(counterID)').run();
    } catch (err) {
        throw(new Error('Can\'t create counterID index in hints table in events database: ' + err.message));
    }
}

function createDisabledEventsTable(db) {
    try {
        db.prepare('CREATE TABLE IF NOT EXISTS disabledEvents (' +
            'OCID INTEGER PRIMARY KEY,' +
            'eventID INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
            'timestamp INTEGER NOT NULL,' +
            'user TEXT NOT NULL,' +
            'commentID INTEGER NOT NULL REFERENCES comments(id) ON DELETE NO ACTION ON UPDATE CASCADE,' +
            'disableUntil INTEGER NOT NULL,' + // in ms from 1970
            'intervals TEXT)').run();
    } catch (err) { // time intervals is a string <fromInMs>-<toInMs>;<fromInMs>-<toInMs>;<fromInMs>-<toInMs>...
        throw(new Error('Can\'t create disabledEvents table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS disableUntil_disabledEvents_index on disabledEvents(disableUntil)').run();
    } catch (err) {
        throw(new Error('Can\'t create disableUntil index in disabledEvents table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS OCID_disabledEvents_index on disabledEvents(OCID)').run();
    } catch (err) {
        throw(new Error('Can\'t create OCID index in disabledEvents table in events database: ' + err.message));
    }

    try {
        db.prepare('CREATE INDEX IF NOT EXISTS eventID_disabledEvents_index on disabledEvents(eventID)').run();
    } catch (err) {
        throw(new Error('Can\'t create eventID index in disabledEvents table in events database: ' + err.message));
    }
}

/** Removes disabled events for which the disable time has passed.
 * Load events and disabledEvents to the cache from database.
 *
 * @param db {Object} better-sqlite db object
 * @returns {{db: {}, disabledEventsCache: {}, eventsCache: {}}}
 */
function loadDataToCache(db) {
    try {
        var rows = db.prepare('SELECT id, OCID FROM events WHERE endTime IS NULL').all();
    } catch (err) {
        throw(new Error('Can\'t load events data to cache: ' + err.message));
    }

    var eventsCache = {};
    rows.forEach(function (row) {
        eventsCache[row.OCID] = row.id;
    });

    try {
        db.prepare('DELETE FROM disabledEvents WHERE disableUntil < ?').run(Date.now());
    } catch(err) {
        throw('Can\'t clean disabledEvents table for old disabled events: ' + err.message);
    }

    try {
        rows = db.prepare('SELECT * FROM disabledEvents').all();
    } catch (err) {
        throw(new Error('Can\'t load disabled events data to cache: ' + err.message));
    }

    var disabledEventsCache = {};
    rows.forEach(function (row) {
        disabledEventsCache[row.OCID] = row;
    });

    return({
        db: db,
        eventsCache: eventsCache,
        disabledEventsCache: disabledEventsCache,
    });
}