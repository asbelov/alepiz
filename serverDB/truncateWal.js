/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const fs = require('fs');
const Database = require('better-sqlite3');

var lastTruncate = Date.now();
var truncateInProgress = false;

module.exports = {
    initTruncateWal: init,
    truncateWal: truncateWal,
}

/**
 * Initializing sqlite DB
 * @param {string} dbPath path to database file
 * @param {Object} conf conf object fom conf.js
 */
function init(dbPath, conf) {
    var db;

    log.info('Open DB file ', dbPath, ' for truncating the WAL journal');
    try {
        db = new Database(dbPath, {
            timeout: 5000,
        });
    } catch (err) {
        return log.warn('Can\'t open DB ', dbPath, ' for truncating the WAL journal: ', err.message);
    }

    try {
        db.pragma('synchronous = "OFF"');
        db.pragma('foreign_keys = "ON"');
        db.pragma('encoding = "UTF-8"');
        db.pragma('journal_mode = "WAL"');
    } catch (err) {
        log.warn('Can\'t set some required pragma modes to ', dbPath, ' for truncating the WAL journal: ', err.message);
    }

    periodicallyTruncateWall(dbPath, db, conf);
}

/**
 * Periodically truncate journal wal file
 * @param {string} dbPath path to database file
 * @param {Object} db db objects
 * @param {Object} conf conf object fom conf.js
 */
function periodicallyTruncateWall(dbPath, db, conf) {
    // 10Mb = 1024  * 1024 * 10
    var maxWalSize = conf && typeof conf.get === 'function' ? conf.get('maxWalSize') || 5242880 : 5242880;
    var truncatePeriod = conf && typeof conf.get === 'function' ? conf.get('truncatePeriod') || 60000 : 60000;

    truncateWal(dbPath, db, maxWalSize);
    var t = setTimeout(periodicallyTruncateWall, truncatePeriod, dbPath, db, conf);
    t.unref();
}

/**
 * Truncate sqlite journal wal file
 * @param {string} dbPath path to database file
 * @param {Object} db db objects
 * @param {number} maxWalSize max wal file size (bytes) after which file will be truncated
 */
function truncateWal(dbPath, db, maxWalSize) {
    if(!db) {
        log.error('DB ', dbPath, ' is not initializing');
        return;
    }

    if(Date.now() - lastTruncate < 30000) return;
    lastTruncate = Date.now();
    truncateInProgress = true;
    try {
        var stat = fs.statSync(dbPath + '-wal');
    } catch (err) {
        if (err.code !== 'ENOENT') return log.error('Can\'t stat ', dbPath + '-wal: ', err.message);
    }

    if (stat.size > maxWalSize) {
        log.info('Size of ', dbPath + '-wal journal file is a ',
            Math.round(stat.size / 1048576), 'Mb. Truncating wal and optimizing DB...');
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (err) {
            log.error('Can\' truncate WAL checkpoint: ', err.message);
        }
        try {
            db.pragma('optimize');
        } catch (err) {
            log.error('Can\' optimize DB: ', err.message);
        }
    }
    truncateInProgress = false;
}