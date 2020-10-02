/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../../lib/db');


module.exports = function(callback){
    log.debug('Creating auditUsers table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS auditUsers (' +
        'sessionID INTEGER PRIMARY KEY ASC,' +
        'userID INTEGER NOT NULL REFERENCES users(id) ON DELETE NO ACTION ON UPDATE CASCADE,' +
        'actionID TEXT NOT NULL,' +
        'actionName TEXT NOT NULL,' +
        'timestamp DATETIME NOT NULL)',
        function (err) {
            if (err) return callback(new Error('Can\'t create auditUsers table in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS userID_auditUsers_index on auditUsers(userID)', function (err) {
                if (err) return callback(new Error('Can\'t create userID auditUsers index in database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS sessionID_auditUsers_index on auditUsers(sessionID)', function (err) {
                    if (err) return callback(new Error('Can\'t create sessionID auditUsers index in database: ' + err.message));

                    callback();
                });
            });
        }
    );
};
