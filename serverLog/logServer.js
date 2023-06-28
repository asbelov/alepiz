/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('./simpleLog')(module);
const threads = require('../lib/threads');
const writeLog = require('./writeLog');

// write message to log
new threads.child({
    module: 'log',
    simpleLog: true,
    onMessage: writeLog,
    onStop: function(callback) {
        log.exit('Log server stopped');
        setTimeout(function() { typeof callback === 'function' && callback() }, 1000);
    },
});