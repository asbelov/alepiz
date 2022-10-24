/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var db = require('./db');

var actionsDB = {};
module.exports = actionsDB;

actionsDB.getActionConfig = function (user, actionID, callback) {
    db.get('SELECT actionsConfig.config AS config FROM actionsConfig JOIN users ON users.id=actionsConfig.userID ' +
        'WHERE actionsConfig.actionName = $actionName AND users.name = $userName', {
        $actionName: actionID,
        $userName: user,
    }, callback);
};