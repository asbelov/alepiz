/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var log = require('../lib/log')(module);
var prepareUser = require('../lib/utils/prepareUser');
var usersRolesRightsDB = require('../models_db/usersRolesRightsDB');
var auditDB = require('../lib/auditDB');

var logRecords = {};
module.exports = logRecords;


/*
 Get log records. if no new records, then continue querying records from DB every 1 sec,
 but doesn't sending empty result to client. If no new records during 1 min, then sending
 empty result to client for check is client alive.
 If getting a new record, then send it to client

 send to client is mean that calling callback function

 user - checked user name
 recordID - last record ID or 0
 callback(err, records), where records is a array of records objects

 */

var cntOfGetLogRecordsFunction = 0;
logRecords.getRecords = function (user, recordID, sessionsIDsStr, callback){

    ++cntOfGetLogRecordsFunction;
    log.debug('Getting ',cntOfGetLogRecordsFunction,' request for a logs record, last record: ', recordID,
        ', sessions: ', sessionsIDsStr);

    var continueQueryingForNewRecords = true;
    var allowedRowsForReturn = {};
    var timesCntForWaitingNewRecords = 0;
    recordID = Number(recordID);
    var sessionsIDs = !sessionsIDsStr ? [] : sessionsIDsStr.split(',').map(function (sessionID) {
        return Number(sessionID);
    });

    async.whilst(
        function(){ return continueQueryingForNewRecords; },
        function(callback){
            getLogRecords(user, recordID, sessionsIDs, function(err, allowedRows){
                if(err) return callback(err);

                if(recordID === 0 && (allowedRows === undefined || allowedRows.length === 0)) {
                    log.debug('Records not found in a log database');
                    continueQueryingForNewRecords = false;
                    return callback(null, true);
                }

                if(allowedRows && allowedRows.length){

                    log.debug('Found new records in a log database after record ', recordID, ', new records count: ',
                        allowedRows.length);
                    continueQueryingForNewRecords = false;
                    allowedRowsForReturn = JSON.parse(JSON.stringify(allowedRows));
                    return callback(null, true);

                    // Check for browser alive. If it's alive and want to continue retrieving log, then browser send
                    // a new request for log record. If browser closed, then stop to retrieving log records
                }

                if(timesCntForWaitingNewRecords > 60){
                    log.debug('Maximum count of times (',timesCntForWaitingNewRecords,
                        ' sec) for waiting new log records occurred. Stopping requiring log, because browser may be closed.');
                    allowedRowsForReturn = {};
                    continueQueryingForNewRecords = false;
                    return callback(null, true);
                    // If count of browsers, which retrieving logs, more then 60, then stop retrieving log for prevent
                    // attack to database
                }

                if(cntOfGetLogRecordsFunction > 60){
                    allowedRowsForReturn = {};
                    continueQueryingForNewRecords = false;
                    // If count of browsers less, then 65, send and log error, else if more, then don't send error for
                    // prevent DOS attack to database
                    if(cntOfGetLogRecordsFunction < 65)
                        callback(new Error('Maximum count of log retrievers (browsers) occurred: ' + cntOfGetLogRecordsFunction));
                    else callback(null, true);
                    return;
                }

                //log.debug('Waiting for a new records in log database after record ', recordID);
                ++timesCntForWaitingNewRecords;
                setTimeout(callback, 1000);
            });
        },
        function(err){
            --cntOfGetLogRecordsFunction;
            return callback(err, allowedRowsForReturn);
        }
    );
};
/*
 Getting last log records

 user - checked user name
 recordID - last record ID or 0
 callback(err, records), where records is a array of records objects

 */
function getLogRecords(user, recordID, sessionsIDs, callback){

    if(Number(recordID) !== parseInt(recordID, 10)) recordID = 0;

    auditDB.getRecords(Number(recordID), sessionsIDs, function(err, rows){
        if(err) return callback(err);
        if(!rows || !rows.length) return callback();

        user = prepareUser(user);

        var lastID = Number(rows[0].id);
        var allowedRows = [{lastID: lastID}];

        // cache for allowed sessions IDs
        var allowedSessions = {};

        async.each(rows, function(row, callback){
            var sessionID = row.sessionID;

            if(Number(row.id) > lastID) lastID = Number(row.id);

            // try to find session ID in cache
            if(sessionID in allowedSessions) {
                if (allowedSessions[sessionID]) {
                    row.actionName = allowedSessions[sessionID];
                    allowedRows.push(row);
                    return callback();
                } else if (allowedSessions[sessionID] === false) return callback();
            }

            // try to check user rights for this session ID
            usersRolesRightsDB.checkAuditsRights(user, sessionID, function(err, checkResult){
                if(err) return callback(new Error('Error while check users "'+user+'" rights for session "'+sessionID+'": '+err.message));
                if(checkResult){
                    allowedSessions[sessionID] = row.actionName = checkResult.actionName;
                    allowedRows.push(row);
                } else allowedSessions[sessionID] = false;
                return callback();
            });
        }, function(err){
            if(err) return callback(err);
            allowedRows[0] = {lastID: lastID};
            callback(null, allowedRows);
        });
    });
}
