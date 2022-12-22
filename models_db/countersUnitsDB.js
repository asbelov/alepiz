/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
const path = require('path');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');
const Database = require('better-sqlite3');
var dbPath = path.join(__dirname, '..', confSqlite.get('path'));

var unitsDB = {};
module.exports = unitsDB;

unitsDB.getUnits = function(callback) {
    try {
        var bestDB = new Database(dbPath, {});
        var units = bestDB.prepare('SELECT * FROM countersUnits').all();
        bestDB.close();
    } catch (err) {
        if(typeof callback === 'function') return callback(err);
    }

    if(typeof callback === 'function') return callback(null, units);
    else return units;
};