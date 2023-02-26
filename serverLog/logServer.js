/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const IPC = require('../lib/IPC');
const threads = require('../lib/threads');
const writeLog = require('./writeLog');
const logRotate = require('./logRotate');
const auditServerRunner = require('../serverAudit/auditServerRunner');

const Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');
const conf = new Conf('config/common.json');
var systemUser = conf.get('systemUser') || 'system';

logRotate();

auditServerRunner.start(function (err, auditServerThreads) {
    if(err) return log.error(err.message);

    new IPC.server(confLog.get(), function(err, messageObj, socket, callback) {
        if(err) return log.error(err.message);

        if(socket === -1) {
            new threads.child({
                module: 'log',
                simpleLog: true,
                onStop: function(callback) {
                    log.exit('Log server stopped');
                    auditServerRunner.stop(function() {
                        log.exit('Audit server was stopped');
                        setTimeout(callback, 50);
                        callback = null;
                    });
                    setTimeout(function() { typeof callback === 'function' && callback() }, 1000);
                },
            });
        } else if(messageObj) {
            if (messageObj.messageBody) writeLog(messageObj);

            // getLogRecords for audit
            if (messageObj.lastRecordID !== undefined) {
                return auditServerThreads[0].sendAndReceive(messageObj, callback);
            }

            // add a new session or write log message to the audit
            if (messageObj.sessionID && (!messageObj.cfg ||
                    (messageObj.cfg.logToAudit &&
                        (messageObj.cfg.auditSystemTasks || (messageObj.user !== 0 && messageObj.user !== systemUser))
                    )
                )
            ) {
                auditServerThreads.forEach(auditServerThread => auditServerThread.send(messageObj));
            }
        }
    });
});