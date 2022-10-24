/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const {Worker, MessageChannel} = require('worker_threads');
const exitHandler = require('../lib/exitHandler');

var callbackStack = new Map();
const maxMessageID = 0xffffffff; // messageID must be >= 0 and <= 4294967295
var messageID = 1;
var maxCallbackStackSize = 100000;
var keepCallbackTime = 2678400000; // 31 days
var removeOldCallbackCnt = maxCallbackStackSize / 10; // 10%
var cleanUpCallbacksStartTime = 0;
var threadLabel = '';

setTimeout(cleanUpCallbackStack, 3600000).unref();

/** Attach the nodejs javascript module as a thread, just like using require(). A Javascript module must contain
 * "module.export" and export an object with functions, or a single function.
 *
 * @param {string} requiredFile - nodejs javascript module
 * @param {object|null} options - options {module_name: <module_name>, {<function>: permanentCallback: <true|false>}},
 * where <moduleName> is the label used in the log file. <function>—the name of the exported function to apply the
 * settings, or “function” if only one function is exported. "permanentCallback" (true|false). if the function callback
 * should only be called once, set the value to false. In this case, the callback will be removed after the call.
 * If the function callback should be called many times, set to true. In this case, the callback was never removed
 * @param {function(Error)|function(null, object)} callback - callback(err, obj) - return error or obj like
 * {func: {<function1>, <function2>, ...}} exported functions or {func: <function>} for one exported function.
 */
module.exports = function (requiredFile, options, callback) {
    const worker = new Worker(path.join(__dirname, 'runInThreadChild.js'), {
        workerData: requiredFile,
    });

    var moduleName = options && options.moduleName ? ':' + options.moduleName : '';
    const threadLabel = '[' + path.basename(path.dirname(requiredFile)) + ':' + path.basename(requiredFile) + moduleName + '] ';

    exitHandler.init(null, threadLabel, worker);

    worker.on('message', msg => {

        if (msg.id) {
            if (!callbackStack.has(msg.id)) return log.error(threadLabel + ' Can\'t find callback for message ', msg);
            //else log.error(threadLabel + ' Find callback for message ', msg, '; ', Object.fromEntries(callbackStack));
            var callbackObj = callbackStack.get(msg.id);
            callbackObj.func.apply(this, msg.args);
            if(!callbackObj.permanent) callbackStack.delete(msg.id);
            else callbackObj.timestamp = Date.now();
            return;
        }

        // message from child to parent
        if (msg.data) return callback(null, null, msg.data);

        if (msg.init) return init(msg.init);

        if (msg.err) return callback(new Error(msg.err));
    });

    worker.on('exit', exitCode => {
        log.exit(threadLabel + 'Worker thread exiting with exitCode ', exitCode);
        // process exit only for exit code != 0
        if(exitCode) exitHandler.exit(3, 1000); // process.exit(3)
    });

    worker.on('error', err => {
        log.exit(threadLabel + 'Worker thread throws an uncaught exception: ', err.message);
        exitHandler.exit(3, 1000); // process.exit(3)
    });

    worker.on('messageerror', err => {
        log.error(threadLabel + 'Worker deserializing a message failed: ', err.message);
    });

    function init(exportedObj) {
        var returnedObj = {
            getMessageChannel: new MessageChannel(), // {port1, port2}
            sendMessagePort: function (type, port) {
                worker.postMessage({
                    portType: type,
                    port: port,
                }, [port]);
            },
            func: {},
            exit: function (exitCode) {
                exitCode = exitCode === undefined ? 0 : exitCode
                worker.postMessage({
                    exit: exitCode
                });
            },
        };
        if(exportedObj === 'function') {
            returnedObj.func = function () {
                var postData = {
                    // id: messageID,
                    // args: args,
                };
                var args = Array.prototype.slice.call(arguments);
                // if last argument is a callback() then save this in the callbackStack
                if (typeof args[args.length - 1] === 'function') {
                    var messageID = getMessageID();
                    postData.id = messageID;
                    callbackStack.set(messageID, {
                        func: args.pop(),
                        timestamp: Date.now(),
                        permanent: options && options.function && options.function.permanentCallback,
                    });

                    cleanUpCallbackStack(true);
                }
                postData.args = args;
                worker.postMessage(postData);
            }
        } else {
            for (var name in exportedObj) {
                // closure for save exported object name
                (function (_name) {
                    returnedObj.func[_name] = function () {
                        var postData = {
                            name: _name,
                            // id: messageID,
                            // args: args,
                        };
                        var args = Array.prototype.slice.call(arguments);
                        // if last argument is a callback() then save this in the callbackStack
                        if (typeof args[args.length - 1] === 'function') {
                            var messageID = getMessageID();
                            postData.id = messageID;
                            callbackStack.set(messageID, {
                                func: args.pop(),
                                timestamp: Date.now(),
                                permanent: options && options[_name] && options[_name].permanentCallback,
                            });

                            cleanUpCallbackStack(true);
                        }
                        postData.args = args;
                        worker.postMessage(postData);
                    }
                }(name));
            }
        }

        callback(null, returnedObj);
    }
}

/** Get new message ID
 * @returns {number} messageID - new message ID
 */
function getMessageID() {
    if (++messageID > maxMessageID) messageID = 1;
    return messageID;
}

/** Cleanup unused callbacks
 *
 * @param {boolean=} force - (true|false) force cleanup old callbacks
 */
function cleanUpCallbackStack(force) {

    if (cleanUpCallbacksStartTime || callbackStack.size < maxCallbackStackSize) return;

    cleanUpCallbacksStartTime = Date.now();
    var callbacksForRemoveCnt = 0;
    var olderCallback = [];

    for (var [id, callbackObj] in callbackStack.entries()) {
        if (callbackObj.timestamp + keepCallbackTime < cleanUpCallbacksStartTime) {
            ++callbacksForRemoveCnt;
            callbackStack.delete(id);
        }

        var olderCallbackLen = olderCallback.length;
        if (olderCallback[olderCallbackLen - 1].timestamp > callbackObj.timestamp) {
            olderCallback.push({
                timestamp: callbackObj.timestamp,
                id: id,
            });
        }
    }

    if (force && !callbacksForRemoveCnt) {
        olderCallbackLen = olderCallback.length;
        for (var i = 1; i < removeOldCallbackCnt && olderCallback[olderCallbackLen - i]; i++) {
            ++callbacksForRemoveCnt;
            callbackStack.delete(olderCallback[olderCallbackLen - i].id);
        }
    }

    if (callbacksForRemoveCnt) log.warn(threadLabel + 'Cleaned ', callbacksForRemoveCnt, ' older callbacks from stack');
    cleanUpCallbacksStartTime = 0;
}