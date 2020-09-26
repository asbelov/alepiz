/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../../lib/db');

module.exports = function (callback) {
    log.info('Truncate WAL journal file');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
        if (err) return callback(new Error('Can\'t truncate WAL journal file: ' + err.message));

        db.exec('PRAGMA optimize', function (err) {
            if (err) return callback(new Error('Can\'t optimize database: ' + err.message));
        });

        callback();
    });
};