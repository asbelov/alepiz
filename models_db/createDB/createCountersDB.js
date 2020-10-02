/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../../lib/db');
var async = require('async');

module.exports = function(callback){
    log.debug('Creating counters, counterParameters, countersGroups, countersUnits, objectsCounters, variables tables in database');

    async.parallel([
        createCountersGroupsTable,
        createCountersUnitsTable
    ], function(err){
        if(err) return callback(err);

        createCountersTable(function(err){
            if(err) return callback(err);

            async.parallel([
                createCountersUpdateEventTable,
                createCounterParametersTable,
                createObjectsCountersTable,
                createVariablesTable,
                createVariablesExpressionTable
            ], callback);
        })
    });
};

function createCountersTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS counters (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT,' +
        'collectorID TEXT,' +
        'groupID INTEGER NOT NULL REFERENCES countersGroups(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'unitID INTEGER REFERENCES countersUnits(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'sourceMultiplier REAL,' +
        'keepHistory INTEGER DEFAULT 90,' +
        'keepTrends INTEGER DEFAULT 365,' +
        'modifyTime DATETIME NOT NULL,' +
        'description TEXT,' +
        'disabled BOOLEAN,' +
        'debug BOOLEAN,' +
        'taskCondition BOOLEAN)',
        function(err) {
            if (err) return callback(new Error('Can\'t create counters table in database: ' + err.message));
            callback();
        }
    );
    
}

function createCountersUpdateEventTable(callback) {
    db.run(
        'CREATE TABLE IF NOT EXISTS countersUpdateEvents (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'counterID INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'parentCounterID INTEGER DEFAULT 0 REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'parentObjectID INTEGER DEFAULT 0 REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'expression TEXT,' +
        'mode INTEGER NOT NULL, ' +
        'objectFilter TEXT)',
        function(err) {
            if (err) return callback(new Error('Can\'t create countersUpdateEvents table in database: ' + err.message));
            callback();
        }
    );
}

function createCounterParametersTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS counterParameters (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT,' +
        'value TEXT,' +
        'counterID INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE)',
        function(err) {
            if (err) return callback(new Error('Can\'t create counterParameters table in database: ' + err.message));
            callback();
        }
    );
}

function createCountersGroupsTable(callback){
    db.run('CREATE TABLE IF NOT EXISTS countersGroups (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT UNIQUE,' +
        'isDefault B00LEAN DEFAULT 0)',  function(err) {
        if (err) return callback(new Error('Can\'t create countersGroups table in database: ' + err.message));

        db.get('SELECT COUNT(*) as count FROM countersGroups', [], function (err, row) {
            if (err || row.count) return callback();

            log.debug('Table countersGroups is empty, inserting initial values into countersGroups table');
            db.run(
                'INSERT OR IGNORE INTO countersGroups (id, name, isDefault) VALUES ' +
                '(1, "General", 1),' +
                '(2, "Availability", 0),' +
                '(3, "Performance", 0),' +
                '(4, "Audit", 0),' +
                '(5, "Other", 0),' +
                '(6, "Update events", 2)', function (err) {
                if (err) {
                    return callback(new Error('Can\'t insert initial values into countersGroups table in database: ' +
                        err.message));
                }

                callback();
            });
        });
    });
}

function createCountersUnitsTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS countersUnits (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT UNIQUE,' +
        'abbreviation TEXT,' +
        'multiplies TEXT,' +
        'prefixes TEXT,' +
        'onlyPrefixes BOOLEAN DEFAULT 0)',
        function(err) {
            if (err) return callback(new Error('Can\'t create countersUnits table in database: ' + err.message));
            callback();
        }
    );
}

function createObjectsCountersTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS objectsCounters (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'counterID INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE)',
        function(err) {
            if (err) return callback(new Error('Can\'t create objectsCounters table in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS counterID_objectsCounters_index on objectsCounters(counterID)', function (err) {
                if (err) return callback(new Error('Can\'t create counterID objectsCounters index in database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS objectID_objectsCounters_index on objectsCounters(objectID)', function (err) {
                    if (err) return callback(new Error('Can\'t create objectID objectsCounters index in database: ' + err.message));

                    db.get('SELECT COUNT(*) as count FROM countersUnits', [], function(err, row) {
                        if(err || row.count) return callback();

                        log.debug('Table countersUnits is empty, inserting initial values into this table');
                        db.run(
                            'INSERT OR IGNORE INTO countersUnits (id, name, abbreviation, multiplies, prefixes, onlyPrefixes) VALUES ' +
                            '(1, "Bytes", "B", "1024,1048576,1073741824,1099511627776", "K,M,G,T", 0),' +
                            '(2, "Bits", "b", "1024,1048576,1073741824,1099511627776", "K,M,G,T", 0),' +
                            '(3, "Time", "sec", "0.000000001,0.000001,0.001,60,3600,86400,604800,2592000,31536000", "ns,μs,ms,min,hours,days,weeks,months,years", 1),' +
                            '(4, "Percents", "%","","",0)',
                            function (err) {
                                if (err) return callback(new Error('Can\'t insert initial values into countersUnits table in database: ' + err.message));
                                callback();
                            }
                        );
                    });
                });
            });
        }
    );
}
/*
name - variable name, not null
counterID - counterID, for variable, where variable is using (is not counterID, which return value of this variable)
objectID - if NULL, then current object, linked with counter. Else object for this variable
parentCounterName - upper case name of the counter, which return value of this variable.
(I forget, why I use counter name instead counterID here, but I'm sure, that it is need for something)
 */

function createVariablesTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS variables (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT NOT NULL,' +
        'counterID INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'objectID INTEGER REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'parentCounterName TEXT NOT NULL,' +
        'function TEXT,' +
        'functionParameters TEXT,' +
        'objectName TEXT)',
        function(err) {
            if (err) return callback(new Error('Can\'t create variables table in database: ' + err.message));
            callback()
        }
    );
}


/*
name - variable name, not null
counterID - counterID, for variable, where variable is using (is not counterID, which return value of this variable)
expression - variable expression for calculation.
 */
function createVariablesExpressionTable(callback) {
    db.run(
        'CREATE TABLE IF NOT EXISTS variablesExpressions (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT NOT NULL,' +
        'counterID INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'expression TEXT NOT NULL)',
        function(err) {
            if (err) return callback(new Error('Can\'t create variablesExpressions table in database: ' + err.message));
            callback()
        }
    );
}