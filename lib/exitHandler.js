/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const async = require('async');
const Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');
const conf = new Conf('config/common.json');

const { isMainThread } = require('worker_threads');

var logPath = confLog.get('dir') || 'logs';
var exitLogFileName = String(confLog.get('exitLogFileName')) || 'exit.log';
var pid = process.pid;
var logFile = path.join(logPath,  exitLogFileName);
var exitHandler = {};
module.exports = exitHandler;

var isExitHandlerInitialized = false;
var isCleanup = false;
var callbacksOnExit = [];
var streamLog = fs.createWriteStream(logFile, {flags: 'a'});
var heapSnapshotWriteTime = 0;

var logExtension = path.extname(exitLogFileName) || '.log';
var exceptionFileName = path.join(logPath, path.basename(exitLogFileName, logExtension) + '-' + pid + '.');

exitHandler.exit = function(exitCode, waitBeforeStop, err) {
    isCleanup = true;

    // check because it might be null
    if (callbacksOnExit) {
        async.parallel(callbacksOnExit, function () {
            exitCode ? process.exit(exitCode) : process.exit(8);
        });
    }

    if(err) createStackFile(err, '');
    setTimeout(function () {
        exitCode ? process.exit(exitCode) : process.exit(8);
    }, waitBeforeStop || 0).unref();
};
/**
 * Exit handler used for handle process or thread exit and creating exit log on exit
 * @param {function=} callback - this function will be called on exit
 * @param {(string|Object)=} parentModule - suffix for exit file. suffix = parentModule['filename'] or parentModule
 * @param {object=} worker - worker of workerThreads for handle thread exit or thread error events
 */
exitHandler.init = function(callback, parentModule, worker) {
    if(callback && typeof callback === 'object' && callback.stack) {
        return exitHandler('EXIT', callback);
    }

    if(parentModule && parentModule.filename) var fileName = parentModule.filename;
    else if(typeof parentModule === 'string') fileName = parentModule;
    else if(module.parent && module.parent.filename) fileName = module.parent.filename;
    else fileName = '';
    // when initializing more than one time, try to init worker every time
    var exceptionString = 'PID: ' + pid +  (worker ? ' TID:' + worker.threadId : '') + ' ' + fileName + '\nStack: ';
    if(worker && typeof worker.on === 'function') {
        worker.on('error', err => createStackFile(err, exceptionString));
        worker.on('exit', exitCode =>
            fastLog('Worker tread exit with exitCode: ' + exitCode) );
    }

    /*
    setTimeout(function () {
        var heapFileName = v8.writeHeapSnapshot();
        fastLog('Heap snapshot written to file: ' + heapFileName);
    }, 60000).unref()
     */

    if(isExitHandlerInitialized) {
        if(typeof callbacksOnExit !== 'function' && typeof callback === 'function') callbacksOnExit.push(callback);
        return;
    }

    isExitHandlerInitialized = true;
    if( typeof callback === 'function') callbacksOnExit.push(callback);


    //do something when app is closing
    process.on('exit', exitHandler.bind(null, 'EXIT'));

//catches ctrl+c event. Save to storage will be started after process.exit() call
    //process.on('SIGINT', exitHandler.bind(null, {exit:true}));
    process.on('SIGINT', exitHandler.bind(null, 'SIGINT'));
    process.on('SIGTERM', exitHandler.bind(null, 'SIGTERM'));

    // this make throw on linux
    //process.on('SIGKILL', exitHandler.bind(null, 'SIGKILL'));

    //process.on('beforeExit', exitHandler.bind(null,'Before exit'));

    /*
    catches uncaught exceptions. Save to storage will be started after process.exit() call
    process.on('uncaughtException', exitHandler.bind(null, 'Uncaught Exception'));
     */
    process.on('uncaughtException', (err/*, origin*/) => {
        createStackFile(err, exceptionString);

        //so the program will not close instantly
        setTimeout(function() {
            process.stdin.resume();
            process.exit(9);
        }, 55000).unref();
    });

    // Node.js can emit warnings whenever it detects bad coding practices that could lead to suboptimal application
    // performance, bugs, or security vulnerabilities.
    process.on('warning', (err) =>
        fastLog('WARNING: ' + (err && err.stack ? err.stack : err + '\nStack: ' + new Error()))
    );

    setInterval(function () {
        var memUsage = process.memoryUsage().rss / 1048576; // mem usage in Mb
        var garbageCollectionError = null;
        var cfg = conf.get()
        var maxMemSize = cfg.maxMemSize || 4096;
        var criticalMemSize = cfg.criticalMemSize || 0;
        var isWriteHeapSnapshot = cfg.writeHeapSnapshot;

        if (memUsage > maxMemSize) {
            if(criticalMemSize && memUsage > criticalMemSize) {
                fastLog('Critical memory usage: ' + Math.round(memUsage) + 'Mb / ' + maxMemSize +
                    'Mb. Exiting...');

                //so the program will not close instantly
                process.stdin.resume();
                process.exit(9);
            }

            try {
                global.gc();
            } catch (e) {
                garbageCollectionError = e;
            }
            // waiting for run global.gc() in the threads
            if(isMainThread) {
                setTimeout(function () {
                    fastLog('Memory usage: ' + Math.round(memUsage) + 'Mb / ' + maxMemSize + 'Mb. ' +
                        (garbageCollectionError ? 'Error run garbage collection: ' + garbageCollectionError.message :
                            'After garbage collection: ' + Math.round(process.memoryUsage().rss / 1048576) + 'Mb'));


                }, 10000).unref();
            }

            if(isWriteHeapSnapshot && Date.now() - heapSnapshotWriteTime > 1800000) {
                var heapFileName = v8.writeHeapSnapshot();
                fastLog('Heap snapshot written to file: ' + heapFileName);
                heapSnapshotWriteTime = Date.now();
            }
        }
    }, 300000).unref();

    /*
    process.stdin.on('data', function() {
        process.stdin.read();
        process.stdin.pause();
    });
    */
    // don't try to save unsaved data. process will terminate very faster and while you saving data to the first file
    // you can corrupt storage files. Even we can't do in time closing storage files
    function exitHandler(handler, err) {
        if (!isCleanup) {
            isCleanup = true;
            fastLog('Caught ' + handler +
                (err && err !== handler ?
                    ': ' + (err.stack ? err.stack : err + ': ' + (new Error('generated for get stack')).stack) :
                    ' without errors.'));

            if (callbacksOnExit) callbacksOnExit.forEach(callbackOnExit => callbackOnExit());
            callbacksOnExit = null;
            streamLog.end();
        }

        var waitForExit = handler === 'SIGINT' || handler === 'SIGTERM' ? 1000 : 55000;

        //so the program will not close instantly
        setTimeout(function() {
            process.stdin.resume();
            process.exit(9);
        }, waitForExit).unref();
    }

    function fastLog(message) {
        if(!streamLog.writable) return;
        var dateTime = new Date();

        streamLog.write(dateTime.toLocaleString() +
            '[' + fileName + pid +
            (worker && worker.threadId && worker.threadId > 0 ? ':' + worker.threadId : '') + ']: ' +
            message + '\n');
    }
};

function createStackFile(err, exceptionString) {
    var d = new Date();
    var myExceptionFileName = exceptionFileName +
        d.toLocaleTimeString().split(':').join('-') + '.' + d.getMilliseconds() + logExtension;
    fs.writeFileSync(myExceptionFileName, exceptionString +  err.stack);

    if (callbacksOnExit) callbacksOnExit.forEach(callbackOnExit => callbackOnExit());
    callbacksOnExit = null;
}