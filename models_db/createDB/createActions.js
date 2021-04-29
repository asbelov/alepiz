/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../../lib/log')(module);
var db = require('../../lib/db');

module.exports = function(callback){
    log.debug('Creating actionsConfig table in database');
    db.run(
        'CREATE TABLE IF NOT EXISTS actionsConfig (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'userID INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'actionName TEXT NOT NULL,' +
        'config TEXT,' +
        'UNIQUE(userID, actionName) ON CONFLICT REPLACE)',
        function (err) {
            if (err) return callback(new Error('Can\'t create actionsConfig table in database: ' + err.message));
            callback();
        }
    );
};
