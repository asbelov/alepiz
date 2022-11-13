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
 * @param {string} user username
 * @param {string} actionID - action directory
 * @param {string} config - stringified action configuration (usually JSON.stringify())
 * @param {number} sessionID - sessionID for create unique ID for inserted row
 * @param {function(Error)} callback - callback(err)
 */
actionsDB.setActionConfig = function (user, actionID, config, sessionID, callback) {
    const id = unique.createHash(user + actionID + config + sessionID);

    db.run('INSERT INTO actionsConfig (id, userID, actionName, config) ' +
        'VALUES ($id, (SELECT id FROM users WHERE isDeleted=0 AND name = $userName), $actionName, $config)', {
        $id: id,
        $userName: user,
        $actionName: actionID,
        $config: config,
    }, callback);
}