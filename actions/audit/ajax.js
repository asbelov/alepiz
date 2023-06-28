/*
* Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 22.02.2023, 23:52:38
*/
const log = require('../../lib/log')(module);
const async = require('async');
const userDB = require('../../models_db/usersDB');
const actionsConf = require('../../lib/actionsConf');

var users = {}, actionsCfg = {};

module.exports = function(args, callback) {
    log.debug('Starting ajax ', __filename, ' with parameters', args);

    if(args.func === 'getSessions') return getSessions(args, callback);
    if(args.func === 'getUsersAndActions') return getUsersAndAction(callback);

    return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
}

function getSessions(args, callback) {
    log.getAuditData({
        auditData: 'sessions',
        lastRecordID: args.firstID,
        user: args.username,
        from: Number(args.from) || 0,
        to: Number(args.to) || 0,
        userIDs: args.userIDs,
        actionIDs: args.actionIDs,
        description: args.description,
        taskIDs: args.taskIDs,
        message: args.message,
        objectIDs: args.objectIDs,
    }, function (err, data) {
        if(err) return callback(err);

        if(!data || typeof data !== 'object' || !Object.keys(data).length) {
            return callback(new Error('No data returned for audit'))
        }

        var sessions = {};
        async.eachOfSeries(data, function (rows, hostPort, callback) {
            if (!Array.isArray(rows) || !rows.length) {
                log.debug('No audit records for ', hostPort)
                return callback();
            }

            log.debug('Processing ', rows.length ,' records from ', hostPort);
            async.eachSeries(rows, function (row, callback) {

                getActionCfg(row.actionID, function (err, actionCfg) {
                    if (err) return callback(err);

                    var session = sessions[row.sessionID]
                    if(!session) {

                        var userID = row.userID
                        getUserName(userID, function (err, username) {
                            if (err) return callback(err);

                            sessions[row.sessionID] = {
                                startTimestamp: row.startTimestamp,
                                stopTimestamp: row.stopTimestamp,
                                userID: userID,
                                userName: username,
                                actionID: row.actionID,
                                actionName: actionCfg.name,
                                description: row.description || '',
                                error: row.error || '',
                                objects: row.objects,
                                sessionID: row.sessionID,
                                taskID: row.taskID || null,
                                taskSession: row.taskSession || null,
                                taskName: row.taskName || null,
                            };
                            callback();
                        });
                    } else {
                        if(session.startTimestamp > row.startTimestamp) {
                            session.startTimestamp = row.startTimestamp
                        }
                        if(session.stopTimestamp < row.stopTimestamp) {
                            session.stopTimestamp = row.stopTimestamp
                        }
                        if(row.description) session.description += '\n' + row.description;
                        Array.prototype.push.apply(session.objects, row.objects);
                        callback();
                    }

                });
            }, function (err) {
                if (err) log.error(err.message);
                callback();
            });
        }, function (err) {
            callback(err, Object.values(sessions));
            log.debug('Return sessions: ', Object.keys(sessions).length);
        });
    });
}

function getUsersAndAction(callback) {
    // callback(err, {userIDs: Array, actionIDs: Array})
    log.getAuditData({
        auditData: 'usersAndActions',
    }, function (err, data) {
        if(err) return callback(err);

        if(typeof data !== 'object' || !Object.keys(data).length) {
            return callback(new Error('Error while getting user IDs and action IDs from auditDB. ' +
                'Returned unreachable value: ' + JSON.stringify(data, null, 4)));
        }

        var userIDs = new Set(), actionIDs = new Set();
        for(var hostPort in data) {
            if(!data[hostPort]) continue;

            if(Array.isArray(data[hostPort].userIDs)) {
                data[hostPort].userIDs.forEach(userID => userIDs.add(userID));
            }
            if(Array.isArray(data[hostPort].actionIDs)) {
                data[hostPort].actionIDs.forEach(actionID => actionIDs.add(actionID));
            }
        }

        log.debug('Received users and actions: ', data, '\n userIDs: ', userIDs, '\n actionIDs: ', actionIDs);

        var users = [], actions = [];
        async.eachSeries(Array.from(userIDs), function (userID, callback) {
            getUserName(userID, function (err, user) {
                if(user) {
                    users.push({
                        id: userID,
                        user: user,
                    });
                }
                callback(err);
            });
        }, function (err) {
            if(err) return callback(err);

            async.eachSeries(Array.from(actionIDs), function (actionID, callback) {
                getActionCfg(actionID, function (err, actionCfg) {
                    if(typeof actionCfg === 'object' && actionCfg.name) {
                        actions.push({
                            id: actionID,
                            name: actionCfg.name,
                        });

                    }
                    callback(err);
                });
            }, function (err) {
                if(err) return callback(err);

                log.debug('Return users and actions: ', users, '; ', actions);
                callback(null, {
                    users: users,
                    actions: actions,
                });
            });
        });
    });
}

function getUserName (userID, callback) {
    if(users[userID]) return callback(null, users[userID]);

    userDB.getAllUserInfo(function (err, userArray) {
        if(err) return callback(err);
        userArray.forEach(userObj => {
            users[userObj.id] = userObj.fullName + ' (' + userObj.name + ')';
        });

        log.debug('Get information for userID: ', userID, ': ', users[userID], '; users: ', users);
        return callback(null, users[userID]);
    });
}

function getActionCfg(actionID, callback) {
    if(actionsCfg[actionID]) return callback(null, actionsCfg[actionID]);

    actionsConf.getConfiguration(actionID, function (err, actionCfg) {
        if(err) return callback(err);

        actionsCfg[actionID] = actionCfg;

        log.debug('Get information for action ', actionID, ', action name: ', actionsCfg[actionID].name);
        return callback(null, actionsCfg[actionID]);
    });
}
