/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var db = require('../lib/db');

var auditUsers = {};
module.exports = auditUsers;

auditUsers.addNewSessionID = function(userID, sessionID, actionID, actionName, timestamp, callback) {
    db.run('INSERT INTO auditUsers (userID, sessionID, actionID, actionName, timestamp) VALUES (?,?,?,?,?)',
        [userID, sessionID, actionID, actionName, timestamp], function(err){
            if(err) return callback(new Error('Can\'t insert new sessionID for user into the auditUser table: '+ err.message));

            callback();
        }
    );
};
