/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var conf = require('../lib/conf');
var sqlite3 = require('sqlite3');
//var log = require('../lib/log')(module);

var sqlite = {};
module.exports = sqlite;

sqlite.init = function(dbPath, callback) {
    if (conf.get('sqlite:verbose')) {
        sqlite3 = sqlite3.verbose();
    }

    try {
        // .cache avoid opening the same database multiple times
        var db = new sqlite3.cached.Database(dbPath);
    } catch(err){
        return callback(err);
    }

    db.maxVariableNumber = conf.get('sqlite:maxVariableNumber') || 99;

    var pragma = conf.get('sqlite:pragma');
    db.serialize(function() {
        for (var key in pragma) {
            if (!pragma.hasOwnProperty(key)) continue;
            //log.info('Executing PRAGMA ', key, pragma[key] ? ' = ' + pragma[key] : '', ' for ' + dbPath);
            db.run('PRAGMA ' + key + (pragma[key] ? ' = "' + pragma[key] + '"' : ''), function(err){
                if(err) return callback(err);

            });
        }
    });
    callback(null, db);
    return db;
};

