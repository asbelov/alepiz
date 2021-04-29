/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

// Wrapper to sqlite.js for use it with default path to db
var conf = require('../lib/conf');
var path = require('path');
var sqlite = require('../lib/sqlite');

var dbPath = path.join(__dirname, '..', conf.get('sqlite:path'));
sqlite.init(dbPath, function(err, db) {
    if(err) return console.log('Can\'t initialise database ' + dbPath + ': ' + err.message);

    module.exports = db;
});

