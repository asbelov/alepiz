/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var db = require('../db');
var async = require('async');

module.exports = function(callback){
    log.debug('Creating objects and interactions tables in database: ');

    createObjectsTable(function(err){
        if(err) return callback(err);

        createInteractionsTable(function(err){
            if(err) return callback(err);

            createPropertiesTable(callback);
        });
    });
};


function createObjectsTable(callback){
    // name can be unique, because many SQL 'select' operations use this field as a key field for
    // getting query results for specific object
    // also it's useful for forms, contained list of the objects: if it will contain a equal
    // object name, you can't differ it
    db.run(
        'CREATE TABLE IF NOT EXISTS objects (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'name TEXT UNIQUE,' +
        'description TEXT,' +
        'sortPosition INTEGER DEFAULT 80,' +
        'color TEXT,' +
        'disabled BOOLEAN,' +
        'created INTEGER)',
        function (err) {
            if (err) return callback(new Error('Can\'t create objects table in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS sortPosition_objects_index on objects(sortPosition)', function (err) {
                if (err) return callback(new Error('Can\'t create sortPosition objects index in database: ' + err.message));

                db.run('CREATE INDEX IF NOT EXISTS name_objects_index on objects(name)', function (err) {
                    if (err) return callback(new Error('Can\'t create name objects index in database: ' + err.message));

                    db.run('CREATE INDEX IF NOT EXISTS disabled_objects_index on objects(disabled)', function (err) {
                        if (err) return callback(new Error('Can\'t create disabled objects index in database: ' + err.message));

                        callback();
                    });
                });
            });
        }
    );
}

function createInteractionsTable(callback){
    db.run(
        'CREATE TABLE IF NOT EXISTS interactions (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'objectID1 INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'objectID2 INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
//          'objectID1 INTEGER NOT NULL REFERENCES objects(id) DEFERRABLE INITIALLY DEFERRED ON DELETE CASCADE ON UPDATE CASCADE,' +
//          'objectID2 INTEGER NOT NULL REFERENCES objects(id) DEFERRABLE INITIALLY DEFERRED ON DELETE CASCADE ON UPDATE CASCADE,' +
        'type INTEGER DEFAULT 0)',
        function (err) {
            if (err) return callback(new Error('Can\'t create interactions table in database: ' + err.message));

            async.parallel([
                function(callback){
                    db.run('CREATE INDEX IF NOT EXISTS objectIDs_interactions_index on interactions(objectID1, objectID2)',
                        function (err) {
                            if (err) return callback(new Error('Can\'t create interactions index in database: ' + err.message));
                            callback();

                        }
                    )
                },

                function(callback) {
                    db.run('CREATE INDEX IF NOT EXISTS types_interactions_index on interactions(type)',
                        function (err) {
                            if (err) return callback( new Error('Can\'t create interactions index in database: ' + err.message));
                            callback();
                        }
                    )
                }
            ], callback);
        }
    );
}


function createPropertiesTable(callback) {
    db.run(
        'CREATE TABLE IF NOT EXISTS objectsProperties (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'objectID INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'name TEXT NOT NULL,' +
        'value TEXT NOT NULL,' +
        'description TEXT,' +
        'mode INTEGER DEFAULT 0)',
        function (err) {
            if (err) return callback(new Error('Can\'t create objectsProperties table in database: ' + err.message));

            db.run('CREATE INDEX IF NOT EXISTS objectID_objectsProperties_index on objectsProperties(objectID)',
                function (err) {
                    if (err) return callback(new Error('Can\'t create objectID objectsProperties index in database: ' + err.message));
                    callback();
                });
        }
    );
}


