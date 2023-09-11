/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const threads = require('../lib/threads');
const logRotate = require('./logRotate');

const Conf = require('../lib/conf');
const auditServerRunner = require('../serverAudit/auditServerRunner');

const confLog = new Conf('config/log.json');

auditServerRunner.start(function (err, auditServerThreads) {
    if (err) return log.throw(err.message);

    logRotate();

    new IPC.server(confLog.get(), function (err, messageObj, socket, callback) {
        if (err) return log.error(err.message);

        if (socket === -1) {
            new threads.child({
                module: 'log',
                simpleLog: true,
                onStop: function (callback) {
                    auditServerRunner.stop(function() {
                        log.exit('Audit server was stopped');
                        setTimeout(callback, 50);
                        callback = null;
                    });

                    setTimeout(function () {
                        typeof callback === 'function' && callback()
                    }, 1000);
                },
            });

        } else if (messageObj) {

            // get log records or session data from audit
            if (messageObj.auditData !== undefined) {
                return auditServerThreads[0].sendAndReceive(messageObj, callback);
            }

            // add a new session, add session result, add task comment, add action comment
            // or write log message to the audit
            if (messageObj.sessionID || messageObj.taskSessionID) {
                if(!messageObj.messageBody || messageObj.logToAudit) {

                    log.debug('Sending message to the audit servers: ',
                        messageObj.sessionID || messageObj.taskSessionID, ': ',
                        (messageObj.messageBody ||
                        (messageObj.stopTimestamp && ('stopTime: ' + messageObj.stopTimestamp)) || messageObj),
                        ', number of servers: ', auditServerThreads.length);

                    async.each(auditServerThreads, function (auditServerThread, callback) {
                        auditServerThread.sendAndReceive(messageObj, callback);
                    }, function(err) {
                        if(err) {
                            log.error('Error sending message to the audit servers: ', err.message, ': ',
                                messageObj.sessionID || messageObj.taskSessionID, ': ',
                                (messageObj.messageBody || messageObj.username ||
                                    ('stopTime: ' + messageObj.stopTimestamp) || messageObj),
                                ', number of servers: ', auditServerThreads.length);
                        }
                        callback();
                    });

                } else log.debug('Don\'t add message to the audit: ', messageObj);
            }
        }
    });
});