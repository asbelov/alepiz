/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var db = require('../lib/db');

var actionsDB = {};
module.exports = actionsDB;

actionsDB.getActionConfig = function (user, actionID, callback) {
    db.get('SELECT actionsConfig.config AS config FROM actionsConfig JOIN users ON users.id=actionsConfig.userID ' +
        'WHERE actionsConfig.actionName = $actionName AND users.name = $userName', {
        $actionName: actionID,
        $userName: user,
    }, callback);
};

/*
It will insert new or update action configuration for existent userID-actionName unique pairs because
CREATE TABLE IF NOT EXISTS actionsConfig (' +
        'id INTEGER PRIMARY KEY ASC AUTOINCREMENT,' +
        'userID INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,' +
        'actionName TEXT NOT NULL,' +
        'config TEXT,' +
        'UNIQUE(userID, actionName) ON CONFLICT REPLACE)
 */
actionsDB.setActionConfig = function (user, actionID, config, callback) {
    db.run('INSERT INTO actionsConfig (userID, actionName, config) ' +
        'VALUES ((SELECT id FROM users WHERE isDeleted=0 AND name = $userName), $actionName, $config)', {
        $userName: user,
        $actionName: actionID,
        $config: config,
    }, callback);
}
