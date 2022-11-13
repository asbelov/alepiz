/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const db = require('../db');

var session = {};
module.exports = session;

// primary key for auditUsers is a sessionID
session.addNewSessionID = function(userID, sessionID, actionID, actionName, timestamp, callback) {
    db.run('INSERT INTO auditUsers (userID, sessionID, actionID, actionName, timestamp) VALUES (?,?,?,?,?)',
        [userID, sessionID, actionID, actionName, timestamp], function(err){
            if(err) return callback(new Error('Can\'t insert new sessionID for user into the auditUser table: '+ err.message));

            callback();
        }
    );
};