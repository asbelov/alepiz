/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var db = require('../db');

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
 * @param {string} user username
 * @param {string} actionID - action directory
 * @param {string} config - stringified action configuration (usually JSON.stringify())
 * @param {function(Error)} callback - callback(err)
 */
actionsDB.setActionConfig = function (user, actionID, config, callback) {
    db.run('INSERT INTO actionsConfig (userID, actionName, config) ' +
        'VALUES ((SELECT id FROM users WHERE isDeleted=0 AND name = $userName), $actionName, $config)', {
        $userName: user,
        $actionName: actionID,
        $config: config,
    }, callback);
}