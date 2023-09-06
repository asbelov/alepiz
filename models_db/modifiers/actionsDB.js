/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const db = require('../db');
const unique = require('../../lib/utils/unique');

var actionsDB = {};
module.exports = actionsDB;

/**
 * Inserts a new or updates the action configuration for existing unique userID-actionName pairs because
 * @example
 * CREATE TABLE IF NOT EXISTS actionsConfig (
 *         id INTEGER PRIMARY KEY ASC AUTOINCREMENT,
 *         userID INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
 *         actionName TEXT NOT NULL,
 *         config TEXT,
 *         UNIQUE(userID, actionName) ON CONFLICT REPLACE)
 * @param {string} username username
 * @param {string} actionID - action directory
 * @param {string} config - stringified action configuration (usually JSON.stringify())
 * @param {function(Error)|function()} callback - callback(err)
 */
actionsDB.setActionConfig = function (username, actionID, config, callback) {
    // ID unique only for specific user and action
    const id = unique.createHash(username + actionID);

    db.run('INSERT INTO actionsConfig (id, userID, actionName, config) ' +
        'VALUES ($id, (SELECT id FROM users WHERE isDeleted=0 AND name=$userName), $actionName, $config)', {
        $id: id,
        $userName: username,
        $actionName: actionID,
        $config: config,
    }, function(errInsert) {
        if(!errInsert) return callback();

        db.run('UPDATE actionsConfig SET config=$config ' +
            'WHERE userID=(SELECT id FROM users WHERE isDeleted=0 AND name=$userName) AND actionName=$actionName',{
            $userName: username,
            $actionName: actionID,
            $config: config,
        }, function(errUpdate) {
            if(!errUpdate) return callback();

            callback(new Error('INSERT: ' + errInsert.message + '; UPDATE: ' + errUpdate.message));
        });
    });
}