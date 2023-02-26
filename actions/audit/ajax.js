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
    log.info('Starting ajax ', __filename, ' with parameters', args);

    if(args.func === 'getSessions') {
        log.getAuditData(args.firstID, null, null, function (err, data) {
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

                    getUserName(row.userID, function (err, username) {
                        if (err) return callback(err);

                        getActionCfg(row.actionID, function (err, actionCfg) {
                            if (err) return callback(err);

                            var session = sessions[row.sessionID]
                            if(!session) {
                                sessions[row.sessionID] = {
                                    startTimestamp: row.startTimestamp,
                                    stopTimestamp: row.stopTimestamp,
                                    userID: row.userID,
                                    userName: username,
                                    actionID: row.actionID,
                                    actionName: actionCfg.name,
                                    description: row.description,
                                    error: row.error,
                                    objects: row.objects,
                                    sessionID: row.sessionID,
                                    taskID: null,
                                    taskSubject: null,
                                };
                            } else {
                                if(session.startTimestamp > row.startTimestamp) {
                                    session.startTimestamp = row.startTimestamp
                                }
                                if(session.stopTimestamp < row.stopTimestamp) {
                                    session.stopTimestamp = row.stopTimestamp
                                }
                                session.description += '\n' + row.description;
                                Array.prototype.push.apply(session.objects, row.objects);
                            }

                            callback();
                        });
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

        return;
    }

    return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
};

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
