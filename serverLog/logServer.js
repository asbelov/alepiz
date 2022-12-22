/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const IPC = require('../lib/IPC');
const threads = require('../lib/threads');
const writeLog = require('./writeLog');
const logRotate = require('./logRotate');
const createMessage = require('./createMessage');
const Conf = require('../lib/conf');

const confLog = new Conf('config/log.json');
const cfg = confLog.get();


logRotate();

new IPC.server(cfg, function(err, message, socket, callback) {
    if(err) return writeLog(err.message);

    if(socket === -1) {
        new threads.child({
            module: 'log',
            IPCLog: true,
            onStop: function(callback) {
                writeLog(createMessage(['Log server stopped'], 'EXIT', 'log'));
                setTimeout(callback, 50);
            },
            onDisconnect: function() {  // exit on disconnect from parent
                writeLog(createMessage(['Log server was disconnected from parent unexpectedly. Exiting'],
                    'EXIT', 'log'));
                process.exit(2);
            },
        });
    } else if(message) {
        writeLog(message);
        // send back that the log server received the message (but may not have written it to the log file)
        if(typeof callback === 'function') callback();
    }
});
