/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var logPath = conf.get('log:path');
var exitLogFileName = String(conf.get('log:exitLogFileName')) || 'exit.log';
var pid = process.pid;
var logFile = path.join(logPath,  exitLogFileName);
var maxMemSize = conf.get('maxMemSize') || 4096;
var exitHandler = {};
module.exports = exitHandler;

var isExitHandlerInitialized = false;
var isCleanup = false;
var callbackOnExit;
var streamLog = fs.createWriteStream(logFile, {flags: 'a'});
var timeZoneOffset = (new Date()).getTimezoneOffset() * 60000;

exitHandler.exit = function(exitCode) {
    isCleanup = true;
    exitCode ? process.exit(exitCode) : process.exit(8); // for simple searching exit code 8
};

exitHandler.init = function(callback, parentModule) {

    if(isExitHandlerInitialized) {
        if(typeof callbackOnExit !== 'function' && typeof callback === 'function') callbackOnExit = callback;
        return;
    }

    isExitHandlerInitialized = true;
    if( typeof callback === 'function') callbackOnExit = callback;
    else callbackOnExit = function(){};

    if(parentModule && parentModule.filename) var fileName = parentModule.filename;
    else if(typeof parentModule === 'string') fileName = parentModule;
    else if(module.parent && module.parent.filename) fileName = module.parent.filename;
    else fileName = 'unknown file';
    var logExtension = path.extname(exitLogFileName) || '.log';
    var exceptionFileName = path.join(logPath, path.basename(exitLogFileName, logExtension) + '-' + pid + '.');
    var exceptionString = `PID: ${pid}, ${fileName}:\nStack: `;

//do something when app is closing
    process.on('exit', exitHandler.bind(null, 'EXIT'));

//catches ctrl+c event. Save to storage will started after process.exit() call
    //process.on('SIGINT', exitHandler.bind(null, {exit:true}));
    process.on('SIGINT', exitHandler.bind(null, 'SIGINT'));
    process.on('SIGTERM', exitHandler.bind(null, 'SIGTERM'));

    // this make throw on linux
    //process.on('SIGKILL', exitHandler.bind(null, 'SIGKILL'));

    //process.on('beforeExit', exitHandler.bind(null,'Before exit'));

    /*
    catches uncaught exceptions. Save to storage will started after process.exit() call
    process.on('uncaughtException', exitHandler.bind(null, 'Uncaught Exception'));
     */
    process.on('uncaughtException', (err/*, origin*/) => {
        var d = new Date();
        var myExceptionFileName = exceptionFileName +
            d.toLocaleTimeString().split(':').join('-') + '.' + d.getMilliseconds() + logExtension;
        fs.writeFileSync(myExceptionFileName, exceptionString +  err.stack);

        if(callbackOnExit) callbackOnExit();
        callbackOnExit = null;
        //so the program will not close instantly
        setTimeout(function() {
            process.stdin.resume();
            process.exit(9);
        }, 55000);
    });

    // Node.js can emit warnings whenever it detects bad coding practices that could lead to sub-optimal application performance, bugs, or security vulnerabilities.
    process.on('warning', function(err) {
        fastLog('WARNING: ' + (err && err.stack ? err.stack : err + '\nStack: ' + new Error()));
    });

    if(maxMemSize) {
        setInterval(function () {
            var memUsage = process.memoryUsage().rss / 1048576; // mem usage in Mb
            if (memUsage * 1.1 > maxMemSize) {
                fastLog('Memory usage: ' + Math.round(memUsage) + 'Mb / ' + maxMemSize + 'Mb (' + fileName + ') . Starting garbage collection');
                try { global.gc(); } catch (e) {}
            }
        }, 120000);
    }

    /*
    process.stdin.on('data', function() {
        process.stdin.read();
        process.stdin.pause();
    });
    */
    // don't try to save unsaved data. process will terminated very faster and while you saving data to the first file
    // you can corrupt storage files. Even we can't do in time closing storage files
    function exitHandler(handler, err) {
        if (!isCleanup) {
            isCleanup = true;
            fastLog('Caught ' + handler + ' in ' + fileName +
                (err && err !== handler ? ': ' + (err.stack ? err.stack : err + ': ' + (new Error('generated for get stack')).stack) : ' without errors.'));
            streamLog.end();

            if (callbackOnExit) callbackOnExit();
            callbackOnExit = null;
        }

        //so the program will not close instantly
        setTimeout(function() {
            process.stdin.resume();
            process.exit(9);
        }, 55000);
    }

    function fastLog(message) {
        var dateTime = (new Date(Date.now() - timeZoneOffset)).toISOString().slice(0, -1).replace('T', ' ');
        streamLog.write(dateTime + '[' + pid + ']: ' + message + '\n');

        //console.error('\u001b[35m' + dateTime + '[' + pid + ']: ' + message + '\u001b[39m');
    }
};

