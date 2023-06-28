/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const IPC = require('../lib/IPC');
const threads = require('../lib/threads');
const logRotate = require('./logRotate');

const Conf = require('../lib/conf');
const thread = require('../lib/threads');
const path = require('path');
const auditServerRunner = require('../serverAudit/auditServerRunner');

const confLog = new Conf('config/log.json');

auditServerRunner.start(function (err, auditServerThreads) {
    if (err) return log.throw(err.message);

    logRotate();

    const childrenNumber = parseInt(confLog.childrenNumber, 10) || 10;
    new thread.parent({
        childrenNumber: childrenNumber,
        childProcessExecutable: path.join(__dirname, 'logServer.js'),
        restartAfterErrorTimeout: 0,
        killTimeout: 300,
        module: 'log',
    }, function (err, logServerProcess) {
        if (err) return log.throw('Can\'t initializing logServer: ' + err.message);

        logServerProcess.startAll(function (err) {
            if (err) return log.throw(new Error('Can\'t run logServer: ' + err.message));

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

                    log.info('logServer started: ', childrenNumber, ' thread');

                } else if (messageObj) {
                    // write message to log
                    if (messageObj.messageBody) logServerProcess.send(messageObj);
                    // get log records or session data from audit
                    else if (messageObj.auditData !== undefined) {
                        return auditServerThreads[0].sendAndReceive(messageObj, callback);
                    }

                    // add a new session, add session result or write log message to the audit
                    if (messageObj.sessionID) {
                        if(!messageObj.messageBody || messageObj.logToAudit) {

                            log.debug('Send message to the audit: ', messageObj.sessionID, ': ',
                                (messageObj.messageBody || messageObj.username || messageObj.stopTimestamp));

                            auditServerThreads.forEach(auditServerThread => auditServerThread.send(messageObj));
                        } else log.debug('Don\'t add message to the audit: ', messageObj);
                    }
                }
            });
        });
    });
});