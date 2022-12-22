/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const thread = require('../lib/threads');
const DB = require('../serverDB/dbClient');
const db = require('../models_db/db');
const connectToRemoteNodes = require('../lib/connectToRemoteNodes');
const Conf = require('../lib/conf');

const confRepl = new Conf('config/replication.json');
const confMyNode = new Conf('config/node.json');

var myObjectIDs = new Set(), notMyObjectIDs = new Set();

connectToRemoteDBs(replication);

/**
 * Connect to the remote DB described in the from nodes.json
 * @param {function(remoteDB: Object<string: Object>)} callback callback(remoteDB, allClientIPC), where remoteDB is a
 *  object like {<hostPort1>:<db1>, <hostPort2>:<db2>, ...}, where dbN is the dbClient.js object
 */
function connectToRemoteDBs(callback) {
    connectToRemoteNodes('db', 'dbReplRemote', function (err, allClientIPC) {
        if(!allClientIPC) {
            log.warn('No remote nodes specified for dbRepl');
            return;
        }

        var remoteDBs = {};
        allClientIPC.forEach((clientIPC, hostPort) => remoteDBs[hostPort] = new DB({clientIPC: clientIPC}));
        new thread.child({
            module: 'replServer',
        });
        log.info('Replication server initialized');
        callback(remoteDBs);
    });
}

/**
 * Get table names from the database excluding system tables whose names start with 'sqlite_'
 * @param {function(Error)|function(null, tables:Array)} callback callback(err, tables), where tables is an array
 *  with table names like ['tableName1', 'tableName2', ...]
 */
function getTableList(callback) {
    db.all('SELECT name FROM sqlite_master WHERE type="table"', function (err, rows) {
        if(err) return callback(new Error('Can\'t get list of tables: ' + err.message))
        var tables = [];
        // skip sqlite_sequence, sqlite_stat1, sqlite_stat4 tables
        rows.forEach(row => {
            if(row.name.indexOf('sqlite_') === -1 &&
                row.name !== 'actionsConfig' &&
                row.name !== 'objectsAlepizRelation'
            ) {
                tables.push(row.name)
            }
        });

        // make 'objectsAlepizRelation' table first in the array
        tables.unshift('objectsAlepizRelation');
        callback(null, tables);
    })
}


/**
 * Searches for changes in remote tables and adds them to the local database.
 * Restarts itself once every 30 seconds
 *
 * @param {Object} remoteDBs object with remote DB, like {<hostPort1>:<db1>, <hostPort2>:<db2>, ...},
 *  where dbN is the dbClient.js object
 */
function replication(remoteDBs) {
    var cfg = confRepl.get();
    var indexOfOwnNode = confMyNode.get('indexOfOwnNode');

    if(cfg.debug) log.info('Starting new replication cycle');

    var restartReplicationTime = cfg.restartReplicationTime ===
        parseInt(String(cfg.restartReplicationTime), 10) && cfg.restartReplicationTime > 10000 ?
        cfg.restartReplicationTime : 300000;

    if(cfg.disable) {
        log.info('Replication server was disabled in configuration. Check for enable again after ',
            restartReplicationTime / 1000, 'sec');
        return setTimeout(replication, restartReplicationTime, remoteDBs).unref();
    }


    if(Object.values(remoteDBs).every(remoteDB => !remoteDB.clientIPC.isConnected())) {
        log.info('Not connected to all remote DB ', Object.keys(remoteDBs).join(', '),
            ', restart replication after ', restartReplicationTime, 'sec');
        return setTimeout(replication, restartReplicationTime, remoteDBs).unref();
    }

    var pauseBetweenReplication = cfg.pauseBetweenReplication ===
    parseInt(String(cfg.pauseBetweenReplication), 10) && cfg.pauseBetweenReplication > 1000 ?
        cfg.pauseBetweenReplication : 30000;

    var pauseBetweenTableProcessing = cfg.pauseBetweenTableProcessing ===
    parseInt(String(cfg.pauseBetweenTableProcessing), 10) && cfg.pauseBetweenTableProcessing > 0 ?
        cfg.pauseBetweenTableProcessing : 500;

    var maxTableSizeForReplication = cfg.maxTableSizeForReplication ===
    parseInt(String(cfg.maxTableSizeForReplication), 10) && cfg.maxTableSizeForReplication > 100000 ?
        cfg.maxTableSizeForReplication : 1000000;


    getTableList(function (err, tables) {
        if(err) return log.warn(err.message);

        var tableNum = 1;
        async.eachSeries(tables, function (table, callback) {
            if (cfg.debug) log.info('Processing table ', table, ': ', tableNum++, '/', tables.length);

            db.get('SELECT COUNT(*) AS cnt FROM ' + table, function (err, localTableRows) {
                if (err) {
                    log.warn('Can\'t get count of data from local table ', table, ': ', err.message);
                    return callback();
                }
                if (localTableRows.cnt > maxTableSizeForReplication) {
                    log.warn('Table ', table, ' too big for replication. Rows ',
                        localTableRows.cnt, '/', maxTableSizeForReplication, '. Skip it');
                    return setTimeout(callback, pauseBetweenTableProcessing).unref();
                }

                var id = 'id';
                if (table === 'auditUsers') id = 'sessionID';
                else if (table === 'tasksRunConditionsOCIDs' || table === 'tasksRunConditions') id = 'taskID';
                const query = 'SELECT * FROM ' + table + ' ORDER BY ' + id;

                var differences = [];
                db.all(query, function (err, myRows) {
                    if (err) {
                        log.warn('Can\'t get data from local table ', table, ': ', err.message);
                        return callback();
                    }

                    if(table === 'objectsAlepizRelation') {
                        myRows.forEach(row => {
                            if(row.alepizID === indexOfOwnNode) myObjectIDs.add(row.objectID);
                            else notMyObjectIDs.add(row.objectID);
                        });
                    }

                    async.eachOf(remoteDBs, function (remoteDB, hostPort, callback) {
                        if (!remoteDB.clientIPC.isConnected()) {
                            if (!remoteDB.clientIPC.printNotConnectedBefore || cfg.debug) {
                                log.warn('Not connected to ', hostPort, ' waiting...');
                            }
                            remoteDB.clientIPC.printNotConnectedBefore = true;
                            return callback();
                        }

                        if (remoteDB.clientIPC.printNotConnectedBefore ||
                            remoteDB.clientIPC.printNotConnectedBefore === undefined) {
                            log.info('Connected to ', hostPort, ' and running replication');
                        }
                        remoteDB.clientIPC.printNotConnectedBefore = false;

                        remoteDB.all(query, function (err, remoteRows) {
                            if (err) {
                                log.warn('Can\'t get data from table ', table, ': ', hostPort, ': ', err.message);
                                return callback();
                            }

                            var diff = getDifferenceFromArraysSortedByID(myRows, remoteRows, id, table);
                            if (diff.length) differences.push(diff);

                            if (cfg.debug) {
                                log.info('Table ', table, 'has ', diff.length, ' differences. Rows local: ',
                                    localTableRows.cnt, ', remote: ', remoteRows.length, ':', hostPort);
                            }

                            callback();
                        });
                    }, function () {
                        // no differences found
                        if (differences.length === 0) {
                            if (cfg.debug) log.info('No differences found for table ', table);
                            return setTimeout(callback, pauseBetweenTableProcessing).unref();
                        }

                        if (cfg.debug) {
                            log.info('Found not optimized differences for table ', table, ': ',
                                (differences[0].length > 10 ? differences[0].length : differences));
                        }
                        var diffRows = differences.shift();
                        if (differences.length > 1) {
                            differences.forEach(diffRows1 => {
                                diffRows = getSimilarityFromArraysSortedByID(diffRows, diffRows1, id);
                            })
                        }

                        if (cfg.debug) {
                            log.info('Found optimized differences for table ', table, ': ',
                                (diffRows.length > 10 ? diffRows.length : diffRows));
                        }

                        if (diffRows.length === 0) {
                            log.info('Found ', differences.length + 1,
                                ' differences, but no rows will be updated after optimization')
                            return setTimeout(callback, pauseBetweenTableProcessing).unref();
                        }

                        insertOrUpdateDifferentRows(table, id, diffRows, function () {
                            setTimeout(callback, pauseBetweenTableProcessing).unref();
                        });
                    });
                });
            });
        }, function () {
                setTimeout(replication, pauseBetweenReplication, remoteDBs).unref();
        });
    });
}

/**
 * Get differences between two arrays of objects sorted by specific id. Used for compare two tables from DB
 *
 * If the table is called 'objects' or there is an ObjectId field in the table and the object is served on this
 * instance of ALEPIZ, then even if the rows are different, they are not synchronized.
 *
 * If an instance of Alepiz serves nobody's objects and the objects do not belong to other instances of Alepiz,
 * then even if the rows are different, they are not synchronized.
 * @param {Array} firstArray first array of objects like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 * @param {Array} secondArray second array of objects like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 * @param {string} id database unique row id
 * @param {string} tableName table name
 * @returns {Array} array with different rows like [{<id>:<val1>, <field1>:<val2>, ....}, ...]
 */
function getDifferenceFromArraysSortedByID(firstArray, secondArray, id, tableName) {
    var shift = 0;
    var serviceNobodyObjects = confMyNode.get('serviceNobodyObjects');

    return secondArray.filter((secondArrayRow, idx) => {
        while (
            idx + shift < firstArray.length - 1 &&
            idx + shift > -1 &&
            firstArray[idx + shift][id] !== secondArrayRow[id]
            ) {
            if(firstArray[idx + shift][id] > secondArrayRow[id]) {
                --shift;
                return true;
            } else ++shift;
        }

        if(idx + shift < 0 || idx + shift >= firstArray.length) return false;

        firstArray[idx + shift].___forUpdate = true;
        secondArrayRow.___forUpdate = true;
        var objectIDKey = tableName === 'objects' ? 'id' : 'objectID';
        return !Object.keys(secondArrayRow).every(key => {
            return firstArray[idx + shift][key] === secondArrayRow[key] ||
                (
                    (tableName !== 'objectsAlepizRelation' && objectIDKey in secondArrayRow) &&
                    (
                        myObjectIDs.has(secondArrayRow[objectIDKey]) ||
                        (serviceNobodyObjects && !notMyObjectIDs.has(secondArrayRow[objectIDKey]))
                    )
                )
        });
    });
}

/**
 * Get similarity between two arrays of objects sorted by specific id. Used for compare two tables from DB
 * @param {Array} firstArray first array of objects like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 * @param {Array} secondArray second array of objects like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 * @param {string} id database unique row id
 * @returns {Array} array with similar rows like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 */
function getSimilarityFromArraysSortedByID(firstArray, secondArray, id) {
    var shift = 0;
    return secondArray.filter((secondArrayRow, idx) => {
        while (
            idx + shift < firstArray.length - 1 &&
            idx + shift > -1 &&
            firstArray[idx + shift][id] !== secondArrayRow[id]
            ) {
            if(firstArray[idx + shift][id] > secondArrayRow[id]) {
                --shift;
                return false;
            } else ++shift;
        }
        if(idx + shift < 0 || idx + shift >= firstArray.length - 1) return false;

        return Object.keys(secondArrayRow).every(key => firstArray[idx + shift][key] === secondArrayRow[key]);
    });
}

/**
 * Insert or update rows in the table
 * @param {string} tableName table name
 * @param {string} id database unique row id
 * @param {Array} rows array with the inserted or updated rows like [{<id>:<val1>, <field2>:<val2>, ....}, ...]
 * @param {function()} callback callback()
 */
function insertOrUpdateDifferentRows(tableName, id, rows, callback) {
    async.eachSeries(rows, function (row, callback) {
        if(!row.___forUpdate) {
            log.info('Inserting into the table ', tableName, ' row ', row);

            const columnNames = Object.keys(row);
            const questionStr = new Array(columnNames.length).fill('?').join(',');
            db.run('INSERT INTO ' + tableName + '(' + columnNames.join(',') + ') VALUES (' + questionStr + ')',
                Object.values(row), function (err) {
                    if(err) {
                        log.warn('Can\'t insert new row into the table ', tableName, '; row: ', row,
                            ': ', err.message);
                    }
                    callback();
                });
        } else {
            log.info('Updating table ', tableName, ' row ', row);

            var updateData = {};
            const columns = [];
            Object.keys(row).forEach(name => {
                if(name !== '___forUpdate') {
                    updateData['$' + name] = row[name];
                    columns.push(name + '=$' + name);
                }
            });
            db.run('UPDATE ' + tableName + ' set ' + columns.join(',') + ' WHERE ' + id + '=$' + id,
                updateData, function (err) {
                if(err) {
                    log.warn('Can\'t update row in the table ', tableName, '; row: ', row, ': ', err.message);
                }
                callback();
            });
        }
    }, callback);
}