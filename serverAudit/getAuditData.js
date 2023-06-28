/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const auditDB = require('./auditDB');
const async = require('async');
const actionsRightsWrapper = require('../rightsWrappers/actions');

var getAuditData = {};
module.exports = getAuditData;

/**
 * Get log records from auditDB for specific user and sessionIDs. Used for show the action execution result
 * @param {Object} req object with request parameters
 * @param {string|number} req.user user ID or username.
 * @param {number} req.lastRecordID last log record ID for continue getting the log records
 *     or 0 for get records from beginning
 * @param {Array} req.sessionIDs array with session IDs. If not set, get the records for all sessions
 * @param {string} req.message FTS5 SQLite filter for message
 * @param {function(Error)|function(null, Array)} callback callback(err, logRecordsRows), where logRecordsRows
 *     is an array with log records objects like [{}]
 */
getAuditData.getLogRecords = function (req, callback) {
    try {
        var logRecordsRows = auditDB.getRecords(req.lastRecordID, req.sessionIDs, req.message);
        // use JSON.stringify for decrease log record size
        log.debug('Got the ', logRecordsRows.length, ' log records for request: ', JSON.stringify(req));
    } catch (err) {
        log.error('Can\'t get log records from auditDB: ', err.message, ' for request ', req)
        return callback(new Error('Can\'t get log records from auditDB: ' + err.message +
            ' for request ' + JSON.stringify(req, null, 4)));
    }

    checkUserRightsForAuditRecords(req.user, logRecordsRows, function (err, filteredRows) {
        callback(null, filteredRows);
    });
}

/**
 * Get sessions from auditDB. Used in the audit action
 * @param {Object} req object with request parameters
 * @param {string|number} req.user user ID or username.
 * @param {number} req.lastRecordID last id from sessions table for continue getting the sessions
 *     or 0 for get records from beginning
 * @param {function(Error)|function(null, Array)} callback callback(err, sessionsRows), where logRecordsRows
 *     is an array with log records objects like [{}]
 */
getAuditData.getSessions = function (req, callback) {
    try {
        var sessionsRows = auditDB.getSessions(req);
        log.debug('Got the ', sessionsRows.length, ' sessions for request: ', req);
    } catch (err) {
        return callback(new Error('Can\'t get sessions from auditDB: ' + err.message +
            ' for request: ' + JSON.stringify(req, null, 4)));
    }

    // filter sessions without audit rights
    var filteredRows = [];
    async.each(sessionsRows, function (row, callback) {
        actionsRightsWrapper.checkActionRights(req.user, row.actionID, 'audit', function(err) {
            if(err) log.debug(err.message);
            else filteredRows.push(row);
            callback();
        });
    }, function () {
        callback(null, filteredRows);
    });
}

/**
 * Filter received audit log records according to the user rights to action audit
 * @param {number} userID user ID
 * @param {Array} rows audit log records
 * @param {function(null, Array)} callback callback(null, filteredRows), where filteredRows is an array of
 *      allowed to view audit log records
 */
function checkUserRightsForAuditRecords(userID, rows, callback) {
    if(!Array.isArray(rows) || !rows.length) return callback(null, rows);

    var filteredRows = [],
        lastID = rows[0].id,
        firstID = rows[0].id;

    async.eachSeries(rows, function (row, callback) {
        if (row.id > lastID) lastID = row.id
        if (row.id < firstID) firstID = row.id
        if(row.userID === userID) filteredRows.push(row);

        actionsRightsWrapper.checkActionRights(userID, row.actionID, 'audit', function(err) {
            if(err) log.debug(err.message);
            else filteredRows.push(row);
            callback();
        });
    }, function () {
        if(filteredRows.length) {
            filteredRows[0].lastID = lastID;
            filteredRows[0].firstID = firstID;
        }
        callback(null, filteredRows);
    });
}

/**
 * Get all user IDs and action IDs for create filter form in audit action
 * @param {function(Error)|function(null, {userIDs: Array, actionIDs: Array})} callback callback(err, data), where
 *  data.userIDs - array with all user IDs, data.actionIDs - array with all action IDs which saved in the auditDB
 */
getAuditData.getUsersAndActions = function (callback) {
    try {
        var data = auditDB.getAllUsersAndActions();
    } catch (err) {
        return callback(new Error('Can\'t get userIDs and action IDs from auditDB: ' + err.message));
    }
    log.debug('Received users and actions: ', data);
    callback(null, data);
}