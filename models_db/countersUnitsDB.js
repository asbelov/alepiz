/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
var log = require('../lib/log')(module);
var db = require('./db');

var unitsDB = {};
module.exports = unitsDB;

unitsDB.getUnits = function(callback) {
    db.all('SELECT * FROM countersUnits', [],  function(err, units) {
        if(err) {
            log.error('Error when getting units from countersUnits table: ' +err.message);
            return callback(err);
        }
        callback(null, units);
    });
};