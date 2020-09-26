/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var os = require('os');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var async = require('async');
var IPC = require('../lib/IPC');
var exitHandler = require('../lib/exitHandler');

var maxMessageID = 0xffffffff; // messageID must be >= 0 and <= 4294967295

var proc = {};
module.exports = proc;

/*
options = {
    childrenNumber: <int> children number. if 0 then number will be equal to CPUs number
    childProcessExecutable: <string> relative or absolute path to JS child file
    args: [array] command line arguments for child process. Substring %:childID:% will be replaced to child ID for each child
    onStart: <function> run after start or !!! restart !!!(on child exit and not null restartAfterErrorTimeout )
    onMessage: <function> function for processing message from parent
    onChildExit: <function> executed when one of children is exit
    restartAfterErrorTimeout: <int> in ms restart child after error or exit or exception. 0 - no restart
    killTimeout: <int> timeout before killing process, when try to stop children by stopAll() function. default 120 0000 ms
    IPCLog: <boolean> if true, use IPC.log instead standard log function
    module: <object> parent module for correct logging
    keepCallbackInterval: max time in ms for waiting answer from sendAndReceive and alloc memory for callback function. default 1800000
    cleanUpCallbacksPeriod: every cleanUpCallbacksPeriod we will clean callbacks. default 300000
    maxCallbacksCnt: the number of callbacks, after which the callback clearing procedure starts. default 10000
}
*/

proc.parent = function (options, callback) {
    if(!options) options = {};
    var errModuleInfo = options.module ? '[parent:' + options.module + '] ' :
        (module.parent ? '[parent:' + path.basename(module.parent.filename, '.js') + '] ' : '');

    if(options.IPCLog) var log = new (IPC.log)('proc');
    else log = require('../lib/log')(module);

    if(!options.ownExitHandler) {
        exitHandler.init(function () {
            killAll();
        }, errModuleInfo || module.parent.parent || module.parent);
    }

    if(!fs.existsSync(options.childProcessExecutable)) {
        var err = errModuleInfo + 'Can\'t find child process executable file "' + options.childProcessExecutable +
            '". Current working directory ' + process.cwd();
        if(typeof callback === 'function') callback(new Error(err));
        else log.error(err);
        return;
    }

    var children = [],
        messageID,
        firstMessageID = 1, // even for child, odd for parent
        callbackStack = {},
        cleanUpCallbacksPeriod = options.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = options.keepCallbackInterval || 1800000,
        maxCallbacksCnt = options.maxCallbacksCnt || 10000,
        allChildrenAreStoppedCallback = null,
        stopInProgress = false,
        killInProgress = false,
        currentChild = 0,
        childFindingIteration = 0,
        errRestartAfterTimeout = '';

    // cleanup unused callbacks
    setInterval(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, maxCallbacksCnt, log);

    if(Number(options.restartAfterErrorTimeout) !== parseInt(String(options.restartAfterErrorTimeout), 10)) {
        options.restartAfterErrorTimeout = 5000;
    }

    if(options.restartAfterErrorTimeout) {
        errRestartAfterTimeout = ', try to run child again after ' + options.restartAfterErrorTimeout / 1000 + ' sec';
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
        sendToAll: sendToAll,
    };

    if (typeof callback === 'function') callback(null, returnedFunctions);
    return returnedFunctions;

    function emptyCallback(err) {
        if(err) log.error(errModuleInfo + err.message);
    }

    function startAll(callback) {
        if(typeof callback !== 'function') callback = emptyCallback;

        killInProgress = stopInProgress = false;

        if(!options.childrenNumber || Number(options.childrenNumber) !== parseInt(String(options.childrenNumber), 10)) {
            options.childrenNumber = os.cpus().length;
        }

        if(children.length >= options.childrenNumber) return callback(new Error(errModuleInfo + 'Children already started'));

        log.debug(errModuleInfo + 'Starting ', options.childrenNumber - children.length, ' children.',
            (children.length ? ' Now already running ' + children.length : ''));
        async.parallel(new Array(options.childrenNumber - children.length).fill(runChild), function (err) {
            if(err) killAll();
            callback(err, children.length);
        });
    }

    function stopAll(callback) {
        if(stopInProgress) return log.warn(errModuleInfo + 'Method "stop" already called before. Skip stopping children');
        stopInProgress = true;

        if(!options.killTimeout) options.killTimeout = 120000; // 2min

        if(typeof callback === 'function') {
            //log.exit('Set allChildrenAreStoppedCallback in stopAll');
            allChildrenAreStoppedCallback = callback;
        }
        var aliveChildren = 0, PIDs = [];
        children.forEach(function (child) {
            try {
                PIDs.push(child.pid);
                child.send({ message: 'stop' });
                ++aliveChildren;
            } catch(e) {}
        });

        if(!aliveChildren) {
            children = [];
            if(typeof allChildrenAreStoppedCallback === 'function') {
                //log.exit('Run allChildrenAreStoppedCallback no alive')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
            return
        }

        setTimeout(checkForChildrenCnt, 5000);

        setTimeout(function () {
            // process may be restarted and we can to kill a new restarted child.
            // Trying to kill only children, which we tried to stop
            var killedPIDs = killForPIDs(PIDs);
            if(killedPIDs && killedPIDs.length) {
                log.error(errModuleInfo + 'Children with PIDs ', killedPIDs.join(', '), ' were not stopped during killTimeout ',
                    options.killTimeout / 1000, 's and now killed');
                log.exit(errModuleInfo + 'Children with PIDs ', killedPIDs.join(', '), ' were not stopped during killTimeout ',
                    options.killTimeout / 1000, 's and now killed');
            }
            if(typeof allChildrenAreStoppedCallback === 'function') {
                //log.exit('Run allChildrenAreStoppedCallback timeout')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
        }, options.killTimeout);
    }

    function killAll(callback) {
        killForPIDs(null, callback);
    }

    function killForPIDs(PIDs, callback) {
        if(killInProgress) return;
        killInProgress = true;
        if(typeof callback === 'function') {
            //log.exit('KillAll set allChildrenAreStoppedCallback')
            allChildrenAreStoppedCallback = callback;
        }
        var killingPIDs = [];
        children.forEach(function (child) {
            try {
                var pid = child.pid;
                if(!Array.isArray(PIDs) || PIDs.indexOf(pid) !== -1) {
                    child.kill();
                    killingPIDs.push(pid);
                }
            } catch(e) {}
        });
        children = [];
        return killingPIDs;
    }

    function send(message, callback) {
        if(typeof callback !== 'function') callback = emptyCallback;

        var child = getNextChild();
        if(!child) return callback(new Error(errModuleInfo + 'Can\'t find working child for send message'));

        try {
            child.send({ userMessage: message });
        } catch (e) {
            return callback(new Error(errModuleInfo + 'Can\'t send message to child: ' + e.message + ': ' + JSON.stringify(message)));
        }

        callback();
    }

    function sendAndReceive(message, callback) {
        messageID = getNewMessageID(messageID, firstMessageID);
        var child = getNextChild();
        if(!child) return callback(new Error(errModuleInfo + 'Can\'t find working child for send message'));

        try {
            child.send({
                userMessage: message,
                id: messageID,
            });
        } catch (e) {
            return callback(new Error(errModuleInfo + 'Can\'t sendAndReceive message: ' + e.message + ': ' + JSON.stringify(message)));
        }
        callbackStack[child.pid + '_' + messageID] = {
            func: callback,
            timestamp: Date.now(),
        };
    }

    function sendToAll(message, callback) {
        children.forEach(function (child) {
            try {
                child.send({ userMessage: message });
            } catch (e) {
                log.error(errModuleInfo + 'Can\'t send message to all children: ', e.message, ': ', message);
            }
        });
        if(typeof callback === 'function') callback();
    }

    function checkForChildrenCnt(errExitCode) {
        var runningChildrenCnt = children.length;
        children.forEach(function (child) {
            if(!child || !child.connected) --runningChildrenCnt;
        });

        if(runningChildrenCnt === 0) {
            if(typeof allChildrenAreStoppedCallback === 'function') {
                if(!errExitCode) log.exit(errModuleInfo + 'Child exited by an unknown method');
                //log.exit('Run allChildrenAreStoppedCallback on child exit')
                allChildrenAreStoppedCallback();
            }
            allChildrenAreStoppedCallback = null;
            children = [];
        } else if(errExitCode) {
            log.warn(errModuleInfo + 'Child process was stopped' + errExitCode + '; ' +
                runningChildrenCnt + ' children left');
        }
    }

    function runChild(callback) {

        var childID = children.length, args = [];
        if(Array.isArray(options.args)) {
            for(var i = 0; i< options.args.length; i++) {
                if(!options.args[i] && options.args[i] !== 0) continue;

                if(typeof options.args[i] === 'string') args.push(options.args[i].replace(/%:childID:%/gi, String(childID)));
                else if(typeof options.args[i] === 'number') args.push(String(options.args[i]));
                else args.push(JSON.stringify(options.args[i]))
            }
        } else args = undefined;

        var child = cp.fork(options.childProcessExecutable, args);
        child.id = childID;
        children.push(child);

        /*
        The 'error' event is emitted whenever:
        - The process could not be spawned, or
        - The process could not be killed, or
        - Sending a message to the child process failed.
         */
        child.on('error', function (err) {
            if(!stopInProgress && !killInProgress) log.exit(errModuleInfo + 'Child process return error', errRestartAfterTimeout, ': ', err.message);
            try {
                child.kill("SIGINT");
            } catch(e) {
                if (options.restartAfterErrorTimeout && !stopInProgress && !killInProgress) {
                    setTimeout(runChild, options.restartAfterErrorTimeout);
                }
                children.splice(child.id, 1);
                if(typeof options.onChildExit === 'function') options.onChildExit(err);
            }
        });

        child.on('exit', function(exitCode, signal) {
            var errExitCode = '';
            if(exitCode) errExitCode = ' with exitCode ' + exitCode;
            if(signal) errExitCode += ' by signal ' + signal;
            if(stopInProgress || killInProgress) checkForChildrenCnt(errExitCode);
            else {
                // exitCode 10 will reserved for prevent to restart child process
                if(exitCode === 12) { // exitCode 12 was reserved for scheduled restart. Don't log to exit.log
                    log.warn(errModuleInfo + 'Child process was stopped', errExitCode, exitCode !== 10 ? errRestartAfterTimeout : '');
                } else {
                    log.exit(errModuleInfo + 'Child process was stopped', errExitCode, exitCode !== 10 ? errRestartAfterTimeout : '');
                }
                if (options.restartAfterErrorTimeout && exitCode !== 10) {
                    setTimeout(runChild, options.restartAfterErrorTimeout);
                }
                children.splice(child.id, 1);
                if(typeof options.onChildExit === 'function') options.onChildExit(exitCode, signal);
            }
        });

        child.on('message', function(data) {
            if(data.message === 'initComplete') {
                if(data.err) {
                    log.error(errModuleInfo + 'Child process return error while initialising', errRestartAfterTimeout, ': ', data.err.stack);
                    if(options.restartAfterErrorTimeout) setTimeout(runChild, options.restartAfterErrorTimeout);
                }
                // running when server started first time
                if(typeof callback === 'function') {
                    callback(data.err);
                    callback = null; // don't call callback again when child restarting
                }

                // running on server started and restarted
                if(typeof options.onStart === 'function') options.onStart(data.err);

            } else if(data && data.id && data.id % 2 !== 0) { // returned sendAndReceive message from parent with odd messageIDs
                //log.info(errModuleInfo + 'Message: ', data, '; callbacks: ', Object.keys(callbackStack));
                //if(data.err) log.warn('!!!Err in ret msg: ', data.err, '; data: ', data);

                if (callbackStack[child.pid + '_' + data.id] && typeof callbackStack[child.pid + '_' + data.id].func === 'function') {
                    callbackStack[child.pid + '_' + data.id].func(data.err, data.userMessage);
                    //log.warn('Run callback: ', data, '; callback IDs:', Object.keys(callbackStack), '; current messageID: ', messageID)
                    delete callbackStack[child.pid + '_' + data.id];
                } else {
                    log.error(errModuleInfo + 'Can\'t find callback for received message: ', data,
                        '; callback IDs:', Object.keys(callbackStack), '; current messageID: ', messageID);
                }
            } else if(typeof options.onMessage === 'function') {
                options.onMessage(data.userMessage, function(err, message) { // receive sendAndReceive message from child
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
                        child.send(returnedMessage);
                    } catch(e) {
                        log.error(errModuleInfo + 'Can\'t send message to parent: ', e.message, '; ', returnedMessage)
                    }
                });
            } else log.error(errModuleInfo + 'Received incorrect message from child: ', data);
        });
    }

    function getNextChild() {
        if(currentChild >= children.length) currentChild = 0;
        // connected indicates whether it is still possible to send and receive messages from a child process
        if(children[currentChild] && children[currentChild].connected) {
            childFindingIteration = 0;
            return children[currentChild++];
        } else {
            if(children[currentChild]) {
                log.warn(errModuleInfo + 'Child with pid ', children[currentChild].pid , ' is not ready for receiving data. We will no longer use this child');
            }
            children.splice(currentChild, 1);
        }

        if(++childFindingIteration > children.length) {
            childFindingIteration = 0;
            return;
        }
        return getNextChild();
    }
};

/*
options.onStop(callback) - for planed childProcess stop
options.onDestroy() - for fast destroy childProcess when unplanned exit occurred.
options.onMessage(message, callback) - for send message to parent
options.onDisconnect() - the 'disconnect' event will be emitted when the IPC channel is closed.
options.IPCLog: <boolean> if true, use IPC.log instead standard log function
options.module: <object> parent module for correct logging
options.ownExitHandler: <boolean> if set to true, then used own exit handler except build in
options.keepCallbackInterval: max time in ms for waiting answer from sendAndReceive and alloc memory for callback function. default 1800000
options.cleanUpCallbacksPeriod: every cleanUpCallbacksPeriod we will clean callbacks. default 300000
options.maxCallbacksCnt: the number of callbacks, after which the callback clearing procedure starts
*/
proc.child = function(options) {

    if(!options) options = {};
    if(options.IPCLog) var log = new (IPC.log)('proc');
    else log = require('../lib/log')(module);

    if(typeof options.onDestroy === 'function') var destroy = options.onDestroy;
    else destroy = function(){};

    if(typeof IPC.destroy === 'function') var stopIPC = IPC.destroy;
    else stopIPC = function(){};

    var messageID,
        firstMessageID = 2, // even for child, odd for parent
        callbackStack = {},
        cleanUpCallbacksPeriod = options.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = options.keepCallbackInterval || 1800000,
        maxCallbacksCnt = options.maxCallbacksCnt || 10000,
        errModuleInfo = options.module ? '[child:' + options.module + '] ' :
            (module.parent ? '[child:' + path.basename(module.parent.filename, '.js') + '] ' : '');

    // cleanup unused callbacks
    setInterval(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, maxCallbacksCnt, log);

    this.send = function (message, callback) {
        try {
            process.send({userMessage: message});
        } catch (e) {
            log.error('Can\'t send to child: ', e.message);
        }
        if(typeof callback === 'function') callback();
    };

    this.sendAndReceive = function(message, callback) {
        messageID = getNewMessageID(messageID, firstMessageID);
        callbackStack[messageID] = {
            func: callback,
            timestamp: Date.now(),
        };
        try {
            process.send({
                id: messageID,
                userMessage: message
            });
        } catch (e) {
            log.error('Can\'t send using sendAndReceive to child: ', e.message);
            delete callbackStack[messageID];
        }
    };

    this.stop = exit;
    this.exit = exit;

    if(!options.ownExitHandler) {
        exitHandler.init(function () {
            destroy();
            stopIPC();
        }, errModuleInfo || module.parent.parent || module.parent);
    }

    try {
        process.send({ message: 'initComplete' });
    } catch (e) {
        log.error('Can\'t send "initComplete" message to child: ', e.message);
    }

    process.on('message', function(data) {
        //log.info(errModuleInfo + 'Message: ', data);

        if(data.message === 'stop') {
            exit();
        } else if(data && data.id && data.id % 2 === 0) { // returned sendAndReceive message from child with even messageIDs
            //if(data.err) log.warn('!!!Err in child ret msg: ', data.err, '; data: ', data);
            if(callbackStack[data.id] && typeof callbackStack[data.id].func === 'function') {
                callbackStack[data.id].func(data.err, data.userMessage);
                delete callbackStack[data.id];
            } else {
                log.error(errModuleInfo + 'Can\'t find callback for received message: ', data,
                    '; callback IDs:', Object.keys(callbackStack), '; current messageID: ', messageID);
            }
        } else if(typeof options.onMessage === 'function') {
            options.onMessage(data.userMessage, function(err, message) { // receive sendAndReceive message from parent
                //log.info(errModuleInfo + 'Message: ', message, '; data', data);
                //if(err) log.warn('!!!Err in child msg: ', err, '; msg: ', message);
                var returnedMessage = {
                    id: data.id,
                    userMessage: message,
                    err: !err ? undefined : {
                        stack: err.stack,
                        message: err.message
                    },
                };
                process.send(returnedMessage);
            });
        } else log.error(errModuleInfo + 'Received incorrect message from parent: ', data);
    });

    // the 'disconnect' event will be emitted when the IPC channel is closed.
    process.on('disconnect', function() {
        if(typeof options.onDisconnect === 'function') options.onDisconnect();
    });

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
                return setTimeout(function() {
                    exitHandler.exit(exitCode);
                }, 100);
            }
        }

        options.onStop(function (err) {
            if(err) log.error(errModuleInfo + err.message);

            if(typeof IPC.stop === "function") {
                IPC.stop(function () {
                    exitHandler.exit(exitCode);
                });
            } else {
                setTimeout(function () {
                    exitHandler.exit(exitCode);
                }, 1000);
            }
        });
    }
};

// create new messageID form process pid * 0x10000 plus previous message ID + 2
function getNewMessageID(messageID, firstMessageID) {
    return (messageID && messageID < maxMessageID-1 ? messageID + 2 : firstMessageID);
}


// cleanup unused callbacks
function cleanUpCallbackStack(callbackStack, keepCallbackInterval, maxCallbacksCnt, log) {
    var now = Date.now();
    var callbackIDsForRemove = [];

    if(Object.keys(callbackStack).length < maxCallbacksCnt) return;

    for(var id in callbackStack) {
        if(callbackStack[id].timestamp + keepCallbackInterval < now) {
            callbackIDsForRemove.push(id);
            delete callbackStack[id];
        }
    }

    if(callbackIDsForRemove.length) log.warn('Cleaned ', callbackIDsForRemove.length, ' older callbacks from stack');
    //return callbackIDsForRemove;
}
