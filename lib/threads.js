/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var os = require('os');
var { Worker, isMainThread, parentPort, MessageChannel, workerData, threadId } =
    require('worker_threads');
var fs = require('fs');
var path = require('path');
var async = require('async');
var IPC = require('../lib/IPC');
var exitHandler = require('../lib/exitHandler');

var workerThreads = {};
module.exports = workerThreads;

workerThreads.isMainThread = isMainThread;

// set sessionID from parent if exist
workerThreads.workerData = workerData;


/**
 * Initialize parent process for the worker thread
 * @param {Object} options options for thread
 * @param {number} options.childrenNumber children number. if 0 then number will be equal to CPUs number.
 *  If childrenNumber is an array, then number will be equal to the array length and
 *  %:childID:% will be set to array item
 * @param {string} options.childProcessExecutable relative or absolute path to JS child file
 * @param {Array<>} options.args command line arguments for worker thread. Substring %:childID:% will be replaced to
 *  thread ID for each thread
 * @param {Function} options.onStart run after start or !!! restart !!!(on thread exit and not null
 *  restartAfterErrorTimeout )
 * @param {Function} options.onMessage function for processing message from parent
 * @param {Function} options.onChildExit executed when one of children is exit
 * @param {number} options.restartAfterErrorTimeout in ms restart thread after error or exit or exception.
 *  0 - no restart
 * @param {number} options.killTimeout timeout before killing process, when try to stop children by stopAll() function.
 *  default 120 000 ms
 * @param {boolean} options.simpleLog if true, use serverLog/simpleLog instead standard log function
 * @param {Object} options.module parent module for correct logging
 * @param {number} options.keepCallbackInterval max time in ms for waiting answer from sendAndReceive and alloc
 *  memory for callback function. default 1800000
 * @param {number} options.cleanUpCallbacksPeriod every cleanUpCallbacksPeriod we will clean callbacks.
 *  default 300000
 * @param {number} options.maxCallbacksCnt the number of callbacks, after which the callback clearing procedure starts.
 *  default 10000
 * @param {boolean} options.ownExitHandler used own exit handler function
 * @param callback
 * @return {undefined|{
 *      stopAll: ((function(*): (*|undefined))|*),
 *      sendAndReceiveToAll: sendAndReceiveToAll,
 *      startAll: ((function(*): (*|undefined))|*),
 *      stop: ((function(*): (*|undefined))|*),
 *      sendToAll: sendToAll,
 *      start: ((function(*): (*|undefined))|*),
 *      killAll: killAll,
 *      sendAndReceive: ((function(*, *): (undefined|*))|*),
 *      kill: killAll,
 *      send: ((function(*, *): (undefined|*))|*)}
 * }
 */
workerThreads.parent = function (options, callback) {
    if(!options) options = {};
    var errModuleInfo = options.module ? '[parent:' + options.module + '] ' :
        (module.parent ? '[parent:' + path.basename(module.parent.filename, '.js') + '] ' : '');

    if(options.simpleLog) var log = require('../serverLog/simpleLog')(module);
    else log = require('../lib/log')(module);

    if(!options.ownExitHandler) {
        exitHandler.init(stopAll, errModuleInfo || module.parent.parent || module.parent);
    }

    if(!fs.existsSync(options.childProcessExecutable)) {
        var err = errModuleInfo + 'Can\'t find worker thread executable file "' + options.childProcessExecutable +
            '". Current working directory ' + process.cwd();
        if(typeof callback === 'function') callback(new Error(err));
        else log.error(err);
        return;
    }

    var threads = new Map(),
        treadsSpecialArgs,
        messageID,
        firstMessageID = 1, // even for thread, odd for parent
        callbackStack = new Map(),
        cleanUpCallbacksPeriod = options.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = options.keepCallbackInterval || 1800000,
        maxCallbacksCnt = options.maxCallbacksCnt || 10000,
        allChildrenAreStoppedCallback = null,
        stopInProgress = 0,
        killInProgress = 0,
        currentChild = 0,
        childFindingIteration = 0,
        threadNotFoundTime = 0,
        threadNotFoundMaxTime = 180000, //ms
        errRestartAfterTimeout = '';

    // cleanup unused callbacks
    setInterval(IPC.cleanUpCallbackStack, cleanUpCallbacksPeriod,
        callbackStack, keepCallbackInterval, maxCallbacksCnt, log);

    if(Number(options.restartAfterErrorTimeout) !== parseInt(String(options.restartAfterErrorTimeout), 10)) {
        options.restartAfterErrorTimeout = 0;
    }

    if(options.restartAfterErrorTimeout) {
        errRestartAfterTimeout = ', try to run thread again after ' +
            options.restartAfterErrorTimeout / 1000 + ' sec';
    }

    var returnedFunctions = {
        start: startAll,
        startAll: startAll,
        stopAll: stopAll,
        stop: stopAll,
        kill: killAll,
        killAll: killAll,
        send: send,
        sendAndReceive: sendAndReceive,
        sendAndReceiveToAll: sendAndReceiveToAll,
        sendToAll: sendToAll,
    };

    if (typeof callback === 'function') callback(null, returnedFunctions);
    return returnedFunctions;

    function emptyCallback(err) {
        if(err) log.error(errModuleInfo + err.message);
    }

    function startAll(callback) {
        if(typeof callback !== 'function') callback = emptyCallback;

        killInProgress = stopInProgress = 0;

        if(Array.isArray(options.childrenNumber) && options.childrenNumber.length) {
            treadsSpecialArgs = options.childrenNumber.map(function (arg) {
                return {
                    threadId: null,
                    id: null,
                    arg: arg,
                }
            });
            options.childrenNumber = treadsSpecialArgs.length;
        }

        if(!options.childrenNumber ||
            Number(options.childrenNumber) !== parseInt(String(options.childrenNumber), 10)) {
            options.childrenNumber = os.cpus().length;
        }

        if(threads.size >= options.childrenNumber) {
            return callback(new Error(errModuleInfo + 'all threads already started'));
        }

        log.debug(errModuleInfo + 'Starting ', options.childrenNumber - threads.size, ' threads.',
            (threads.size ? ' Already running ' + threads.size : ''));
        async.parallel(new Array(options.childrenNumber - threads.size).fill(runChild),
            function (err) {
            if(err) killAll();
            callback(err, threads.size);
        });
    }

    function stopAll(callback) {
        if(stopInProgress) {
            return log.warn(errModuleInfo + 'Method "stop" already called before. Skip stopping threads');
        }
        stopInProgress = Date.now();

        if(!options.killTimeout) options.killTimeout = 120000; // 2min

        if(typeof callback === 'function') {
            //log.exit('Set allChildrenAreStoppedCallback in stopAll');
            allChildrenAreStoppedCallback = callback;
        }
        var aliveChildren = 0, TIDs = [];
        threads.forEach(function (child) {
            try {
                TIDs.push(child.threadId);
                child.messagePort.postMessage({ message: 'stop' });
                ++aliveChildren;
            } catch(e) {}
        });

        if(!aliveChildren) {
            threads.clear();
            if(typeof allChildrenAreStoppedCallback === 'function') {
                //log.exit('Run allChildrenAreStoppedCallback no alive')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
            return
        }

        var checkForChildrenCntTimer = setTimeout(checkForChildrenCnt, 5000);
        checkForChildrenCntTimer.unref();

        var killTimer = setTimeout(function () {
            // process may be restarted and we can to kill a new restarted thread.
            // Trying to kill only threads, which we tried to stop
            var killedPIDs = killForTIDs(TIDs);
            if(killedPIDs && killedPIDs.length) {
                log.error(errModuleInfo + 'Threads with TIDs ', killedPIDs.join(', '),
                    ' were not stopped during killTimeout ',
                    options.killTimeout / 1000, 's and now killed');
                log.exit(errModuleInfo + 'Threads with TIDs ', killedPIDs.join(', '),
                    ' were not stopped during killTimeout ',
                    options.killTimeout / 1000, 's and now killed');
            }
            if(typeof allChildrenAreStoppedCallback === 'function') {
                //log.exit('Run allChildrenAreStoppedCallback timeout')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
        }, options.killTimeout);
        killTimer.unref();
    }

    function killAll(callback) {
        killForTIDs(null, callback);
    }

    function killForTIDs(TIDs, callback) {
        if(killInProgress) return;
        killInProgress = Date.now();
        if(typeof callback === 'function') {
            //log.exit('KillAll set allChildrenAreStoppedCallback')
            allChildrenAreStoppedCallback = callback;
        }
        var killingPIDs = [];
        threads.forEach(function (child) {
            try {
                var threadId = child.threadId;
                if(!Array.isArray(TIDs) || TIDs.indexOf(threadId) !== -1) {
                    child.terminate().then(() => {
                        log.exit('Child terminated successfully')
                    }, (err) => {
                        log.exit('Error while child terminate: ', err.message);
                    });
                    child.connected = false;
                    killingPIDs.push(threadId);
                }
            } catch(e) {}
        });
        threads.clear();
        return killingPIDs;
    }

    function send(message, callback) {
        if(typeof callback !== 'function') callback = emptyCallback;

        var child = getNextChild();
        if(!child) {
            var err = new Error(errModuleInfo + 'Can\'t find working thread (threads: ' + threads.size +
                ') for send message. Exiting. ' + JSON.stringify(message));
            callback(err);
            if(!threadNotFoundTime) threadNotFoundTime = Date.now();
            else if(Date.now() - threadNotFoundTime > threadNotFoundMaxTime) {
                exitHandler.exit(3, 2000, err); // process.exit(3)
            }
            return;
        }
        threadNotFoundTime = 0;

        try {
            child.messagePort.postMessage({ userMessage: message });
        } catch (e) {
            return callback(new Error(errModuleInfo + 'Can\'t send a message to thread: ' + e.message + ': ' +
                JSON.stringify(message)));
        }

        callback();
    }

    function sendAndReceive(message, callback) {
        var myMessageID = IPC.getNewMessageID(messageID, firstMessageID);
        messageID = myMessageID;
        var child = getNextChild();
        if(!child) {
            var err = new Error(errModuleInfo + 'Can\'t find working thread (threads: ' + threads.size +
                ') for sendAndReceive message. Exiting. ' + JSON.stringify(message));
            callback(err);
            if(!threadNotFoundTime) threadNotFoundTime = Date.now();
            else if(Date.now() - threadNotFoundTime > threadNotFoundMaxTime) {
                exitHandler.exit(3, 2000, err); // process.exit(3)
            }
            return;
        }
        threadNotFoundTime = 0;

        try {
            child.messagePort.postMessage({
                userMessage: message,
                id: myMessageID,
            });

            /*
            Moved to "try - catch" because some time Map() generating the error:
            "RangeError: Value undefined out of range for undefined options property undefined",
            */
            callbackStack.set(child.threadId + '_' + myMessageID, {
                func: callback,
                timestamp: Date.now(),
            });
        } catch (e) {
            return callback(new Error(errModuleInfo + 'Can\'t sendAndReceive message: ' + e.message + ': ' +
                JSON.stringify(message)));
        }
    }

    function sendAndReceiveToAll(message, callback) {
        var results = [], errors = [];
        var myMessageID = IPC.getNewMessageID(messageID, firstMessageID);
        messageID = myMessageID;

        // don't return err in a callback, use errors.push({id:.., err:..})
        // for example the restart function waits for a restart message to be sent to everyone and if you call the
        // callback some threads may not get the restart message.
        async.each(Array.from(threads), function (entry, callback) {
            var id = entry[0], child = entry[1];

            try {
                child.messagePort.postMessage({
                    userMessage: message,
                    id: myMessageID,
                });
            } catch (err) {
                errors.push({
                    id: id,
                    err: err.message
                });
                //console.log(errModuleInfo + 'childID: ', id,', can\'t sendAndReceiveToAll , message: ' + err.message + ': ' + JSON.stringify(message));
                return callback();
            }

            // closure for save a callback and ID
            (function (_id, _callback) {
                callbackStack.set(child.threadId + '_' + myMessageID, {
                    timestamp: Date.now(),
                    func: function (err, result) {
                        results.push({
                            id: _id,
                            timestamp: Date.now(),
                            result: result,
                        });
                        if(err) {
                            //log.error(errModuleInfo + 'childID: ', _id,', can\'t sendAndReceiveToAll , message: ' +  err.message + ': ' + JSON.stringify(message))
                            errors.push({
                                id: id,
                                err: err.message
                            });
                        }
                        _callback();
                    },
                });
            })(id, callback);
        }, function() {
            if(errors.length) var err = new Error(errModuleInfo + 'sendAndReceiveToAll: ' + JSON.stringify(errors));
            callback(err, results);
        });
    }

    function sendToAll(message, callback) {
        threads.forEach(function (child) {
            try {
                child.messagePort.postMessage({ userMessage: message });
            } catch (e) {
                log.error(errModuleInfo + 'Can\'t send a message to all threads: ', e.message, ': ', message);
            }
        });
        if(typeof callback === 'function') callback();
    }

    function checkForChildrenCnt(errExitCode) {
        var runningChildrenCnt = threads.size;
        threads.forEach(function (child) {
            if(!child || !child.connected) --runningChildrenCnt;
        });

        if(runningChildrenCnt === 0) {
            if(typeof allChildrenAreStoppedCallback === 'function') {
                if(!errExitCode) log.exit(errModuleInfo + 'thread exited by an unknown method');
                //log.exit('Run allChildrenAreStoppedCallback on thread exit')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
            threads.clear();
        } else {
            if(errExitCode) { // running from child.on('exit')
                log.warn(errModuleInfo + 'worker thread was stopped' + errExitCode + '; ' +
                    runningChildrenCnt + ' threads left');
            } else {
                var stopTime = stopInProgress || killInProgress;
                if(stopTime && Date.now() - options.killTimeout > stopTime) {
                    log.error(runningChildrenCnt, ' threads are not stopped in killTimeout ',
                        options.killTimeout / 1000, 'sec, try kill all...');
                    killAll();
                } else log.warn(runningChildrenCnt, ' threads are not stopped. Continue to wait...');
                var checkForChildrenCntTimer = setTimeout(checkForChildrenCnt, 30000);
                checkForChildrenCntTimer.unref();
            }
        }
    }

    function runChild(callback) {

        if(treadsSpecialArgs && Array.isArray(treadsSpecialArgs)) {
            for(var idx = 0, childIDVar; idx < treadsSpecialArgs.length; idx++) {
                if(treadsSpecialArgs[idx].threadId === null) {
                    childIDVar = treadsSpecialArgs[idx].arg;
                    break;
                }

                for(let child of threads.values()) {
                    if(treadsSpecialArgs[idx].threadId === child.threadId) {
                        var hasLinkedChild = true;
                        break;
                    }
                }
                if(!hasLinkedChild) {
                    childIDVar = treadsSpecialArgs[idx].arg;
                    break;
                }
            }
            if(childIDVar === undefined) {
                if(typeof callback === 'function') {
                    return callback(new Error('Can\'t find unlinked thread arg: ' +
                        JSON.stringify(treadsSpecialArgs)));
                } else {
                    return log.error(errModuleInfo + 'Can\'t find unlinked thread arg: ' +
                        JSON.stringify(treadsSpecialArgs));
                }
            }
        } else childIDVar = String(threads.size);


        var childID = Date.now(), args = [];
        if(Array.isArray(options.args)) {
            for(var i = 0; i< options.args.length; i++) {
                if(!options.args[i] && options.args[i] !== 0) continue;

                if(typeof options.args[i] === 'string') {
                    args.push(options.args[i].replace(/%:childID:%/gi, childIDVar));
                } else {
                    if(typeof options.args[i] === 'number') args.push(String(options.args[i]));
                    else args.push(JSON.stringify(options.args[i]))
                }
            }
        } else args = undefined;

        var childToParentChannel = new MessageChannel();
        var parentToChildChannel = new MessageChannel();
        var child = new Worker(options.childProcessExecutable, { workerData: args });
        child.postMessage({ portForSend: childToParentChannel.port1 }, [childToParentChannel.port1]);
        child.postMessage({ portForReceive: parentToChildChannel.port1 }, [parentToChildChannel.port1]);
        if(!options.ownExitHandler) {
            exitHandler.init(stopAll, errModuleInfo || module.parent.parent || module.parent, child);
        }

        child.messagePort = parentToChildChannel.port2;
        child.id = childID;
        child.connected = true;

        childToParentChannel.port2.on('message', processMessage);
        child.on('message', processMessage);


        if(treadsSpecialArgs && treadsSpecialArgs[idx]) treadsSpecialArgs[idx].threadId = child.threadId;
        threads.set(childID, child);

        /*
        The 'error' event is emitted whenever:
        - The process could not be spawned, or
        - The process could not be killed, or
        - Sending a message to the worker thread failed.
         */
        child.on('error', function (err) {
            if(!stopInProgress && !killInProgress) {
                log.exit(errModuleInfo + 'worker thread return error', errRestartAfterTimeout, ': ', err.stack);
            }
            child.terminate().then(() => {
                log.exit('Child terminated successfully after error: ', err.message)
            }, (err1) => {
                log.exit('Error while child terminate after error: ', err.message ,': ', err1.message);
            }) ;
            child.connected = false;
            cleanCallBackStackForPid(child.threadId);
            threads.delete(child.id);
            if(typeof options.onChildExit === 'function') options.onChildExit(err);
            if (options.restartAfterErrorTimeout && !stopInProgress && !killInProgress) {
                var runChildTimer = setTimeout(runChild, options.restartAfterErrorTimeout);
                runChildTimer.unref();
            } else {
                if(!stopInProgress && !killInProgress) {
                    // process.exit(3)
                    exitHandler.exit(3, 1000);
                }
            }
        });

        child.on('exit', function(exitCode) {
            var errExitCode = '';
            if(exitCode) errExitCode = ' with exitCode ' + exitCode;

            // clearing PIDs in treadsSpecialArgs for restart
            if(treadsSpecialArgs && Array.isArray(treadsSpecialArgs)) {
                for (var idx = 0; idx < treadsSpecialArgs.length; idx++) {
                    if (treadsSpecialArgs[idx].threadId === child.threadId) {
                        treadsSpecialArgs[idx].threadId = null;
                        break;
                    }
                }
            }
            threads.delete(child.id);

            if(stopInProgress || killInProgress) checkForChildrenCnt(errExitCode);
            else {
                // exitCode 10 will reserve for prevent to restart worker thread
                if(exitCode === 12) { // exitCode 12 was reserved for scheduled restart. Don't log to exit.log
                    log.warn(errModuleInfo + 'thread ', child.threadId, ' process was stopped',
                        errExitCode, errRestartAfterTimeout);
                } else {
                    log.exit(errModuleInfo + 'thread ', child.threadId ,' process was stopped',
                        errExitCode, exitCode !== 10 ? errRestartAfterTimeout : '');
                }
                cleanCallBackStackForPid(child.threadId);
                if(typeof options.onChildExit === 'function') options.onChildExit(exitCode);
                if (options.restartAfterErrorTimeout && exitCode !== 10) {
                    var runChildTimer = setTimeout(runChild, options.restartAfterErrorTimeout);
                    runChildTimer.unref();

                } else {
                    if(!stopInProgress && !killInProgress) {
                        // process.exit(3)
                        exitHandler.exit(3, 1000);
                    }
                }
            }
        });

        child.on('messageerror', err => {
            log.error('Worker deserializing a message failed: ', err.message);
        });

        function processMessage(data) {
            if(data.message === 'initComplete') {
                if(data.err) {
                    log.error(errModuleInfo + 'worker thread return error while initialising',
                        errRestartAfterTimeout, ': ', data.err.stack);
                    if(options.restartAfterErrorTimeout) {
                        var runChildTimer = setTimeout(runChild, options.restartAfterErrorTimeout);
                        runChildTimer.unref();
                    }
                }
                // running when server started first time
                if(typeof callback === 'function') {
                    callback(data.err);
                    callback = null; // don't call callback again when thread restarting
                }

                // running on server started and restarted
                if(typeof options.onStart === 'function') options.onStart(data.err);

            } else if(data && data.id && data.id % 2 !== 0) {
                // returned sendAndReceive message from parent with odd messageIDs

                //log.info(errModuleInfo + 'Message: ', data, '; callbacks: ', callbackStack.keys());
                //if(data.err) log.warn('!!!Err in ret msg: ', data.err, '; data: ', data);

                var key = child.threadId + '_' + data.id, callbackObj = callbackStack.get(key);
                if (callbackObj && typeof callbackObj.func === 'function') {
                    callbackObj.func(data.err, data.userMessage);
                    //log.warn('Run callback: ', data, '; threadId ', child.threadId ,'; callback IDs:', callbackStack.keys(), '; current messageID: ', messageID)
                    callbackStack.delete(key);
                } else {
                    log.error(errModuleInfo + 'Can\'t find callback for received message: ', data,
                        '; callback IDs:', callbackStack.keys(), '; current messageID: ', messageID);
                }
            } else if(typeof options.onMessage === 'function') {
                // receive sendAndReceive message from thread
                options.onMessage(data.userMessage, function(err, message) {
                    //if(err) log.warn('!!!Err in msg: ', err, '; msg: ', message);
                    var returnedMessage = {
                        id: data.id,
                        userMessage: message,
                        err: !err ? undefined : {
                            stack: err.stack,
                            message: err.message
                        },
                    };
                    try {
                        child.messagePort.postMessage(returnedMessage);
                    } catch(e) {
                        log.error(errModuleInfo + 'Can\'t send message to parent: ', e.message, '; ',
                            returnedMessage)
                    }
                });
            } else log.error(errModuleInfo + 'Received incorrect message from thread: ', data);
        }
    }

    function getNextChild() {
        var childrenIDsArr = Array.from(threads.keys());
        if(currentChild >= childrenIDsArr.length) currentChild = 0;

        var childID = childrenIDsArr[currentChild], child = threads.get(childID);
        // connected indicates whether it is still possible to send and receive messages from a worker thread
        if(child && child.connected) {
            childFindingIteration = 0;
            currentChild++;
            return child;
        } else {
            if(child) {
                log.warn(errModuleInfo + 'thread with threadId ', child.threadId ,
                    ' is not ready for receiving data. We will no longer use this thread');
            }
            threads.delete(childID);
        }

        if(++childFindingIteration > childrenIDsArr.length) {
            childFindingIteration = 0;
            return;
        }
        return getNextChild();
    }

    function cleanCallBackStackForPid(threadId) {
        var clearingCallbacks = 0;
        for(var [id, callbackObj] in callbackStack.entries()) {
            if(Number(id.split('_')[0]) === threadId) {
                if (callbackObj && typeof callbackObj.func === 'function') {
                    callbackObj.func(new Error('worker thread ' + threadId + ' was died and can\'t return requires data'));
                }
                callbackStack.delete(id);
                ++clearingCallbacks;
            }
        }
        if(clearingCallbacks) log.warn('Clearing ', clearingCallbacks, ' callbacks for died worker thread ' + threadId);
    }
};

/**
 * Initialize the worker thread
 * @param {Object} options options for the child thread
 * @param {Function} [options.onStop] onStop(callback) for planed childProcess stop
 * @param {Function} [options.onDestroy] onDestroy() for fast destroy childProcess when unplanned exit occurred.
 * @param {Function} [options.onMessage] onMessage(message, callback) for send message to parent
 * @param {boolean} [options.simpleLog] if true, use serverLog/simpleLog instead standard log function
 * @param {Object} options.module parent module for correct logging
 * @param {boolean} [options.ownExitHandler] if set to true, then used own exit handler except build in
 * @param {number} [options.keepCallbackInterval] max time in ms for waiting answer from sendAndReceive and alloc memory
 *  for callback function. default 1800000
 * @param {number} [options.cleanUpCallbacksPeriod] every cleanUpCallbacksPeriod we will clean callbacks. default 300000
 * @param {number} [options.maxCallbacksCnt] the number of callbacks, after which the callback clearing procedure starts.
 *  default 10000
 */
workerThreads.child = function(options) {

    if(!options) options = {};
    if(options.simpleLog) var log = require('../serverLog/simpleLog')(module);
    else log = require('../lib/log')(module);

    if(typeof options.onDestroy === 'function') var destroy = options.onDestroy;
    else destroy = function() {};

    if(typeof IPC.destroy === 'function') var stopIPC = IPC.destroy;
    else stopIPC = function() {};

    var messageID,
        parentMessagePort = parentPort,
        firstMessageID = 2, // even for thread, odd for parent
        callbackStack = new Map(),
        cleanUpCallbacksPeriod = options.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = options.keepCallbackInterval || 1800000,
        maxCallbacksCnt = options.maxCallbacksCnt || 10000,
        errModuleInfo = options.module ? '[thread:' + options.module + '] ' :
            (module.parent ? '[thread:' + path.basename(module.parent.filename, '.js') + '] ' : '');

    // cleanup unused callbacks
    setInterval(IPC.cleanUpCallbackStack, cleanUpCallbacksPeriod,
        callbackStack, keepCallbackInterval, maxCallbacksCnt, log);

    this.threadId = threadId;

    this.send = function (message, callback) {
        parentMessagePort.postMessage({userMessage: message});
        if(typeof callback === 'function') callback();
    };

    this.sendAndReceive = function(message, callback) {
        var myMessageID = IPC.getNewMessageID(messageID, firstMessageID);
        messageID = myMessageID;
        callbackStack.set(messageID, {
            func: callback,
            timestamp: Date.now(),
        });
        parentMessagePort.postMessage({
            id: myMessageID,
            userMessage: message
        });
    };

    this.stop = exit;
    this.exit = exit;

    if(!options.ownExitHandler) {
        exitHandler.init(function () {
            destroy();
            stopIPC();
        }, errModuleInfo || module.parent.parent || module.parent);
    }

    parentMessagePort.postMessage({ message: 'initComplete' });

    parentPort.on('message', processMessage);

    function processMessage(data) {
        //log.info(errModuleInfo + 'Message: ', data);

        if(data.portForReceive) data.portForReceive.on('message', processMessage);
        else if(data.portForSend) parentMessagePort = data.portForSend;
        else if(data.message === 'stop') exit();
        else if(data && data.id && data.id % 2 === 0) { // returned sendAndReceive message from thread with even messageIDs
            //if(data.err) log.warn('!!!Err in thread ret msg: ', data.err, '; data: ', data);
            var key = data.id, callbackObj = callbackStack.get(key);
            if(callbackObj && typeof callbackObj.func === 'function') {
                callbackObj.func(data.err, data.userMessage);
                callbackStack.delete(key);
            } else {
                log.error(errModuleInfo + 'Can\'t find callback for received message: ', data,
                    '; callback IDs:', callbackStack.keys(), '; current messageID: ', messageID);
            }
        } else if(typeof options.onMessage === 'function') {
            options.onMessage(data.userMessage, function(err, message) { // receive sendAndReceive message from parent
                //log.info(errModuleInfo + 'Message: ', message, '; data', data);
                //if(err) log.warn('!!!Err in thread msg: ', err, '; msg: ', message);
                var returnedMessage = {
                    id: data.id,
                    userMessage: message,
                    err: !err ? undefined : {
                        stack: err.stack,
                        message: err.message
                    },
                };
                parentMessagePort.postMessage(returnedMessage);
            });
        } else log.error(errModuleInfo + 'Received incorrect message from parent: ', data);
    }

    function exit(exitCode) {
        if(!exitCode) exitCode = 3; // for simple searching this exit code: process.exit(3)

        if(typeof options.onStop !== 'function') {
            // print something to log before exit, because there is nobody else to print
            log.exit(errModuleInfo + 'Receiving stop message, exiting...');
            if(typeof IPC.stop === "function") {
                IPC.stop(function () {
                    exitHandler.exit(exitCode);
                });
            } else {
                return exitHandler.exit(exitCode, 100); // process.exit()
            }
        }

        options.onStop(function (err) {
            if(err) log.error(errModuleInfo + err.message);

            if(typeof IPC.stop === "function") {
                IPC.stop(function () {
                    exitHandler.exit(exitCode);
                });
            } else {
                exitHandler.exit(exitCode, 1000); // process.exit()
            }
        });
    }
};