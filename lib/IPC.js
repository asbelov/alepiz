/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var net = require('net');
var path = require('path');
var fs = require('fs');
var zlib = require('zlib');
var async = require('async');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var logFileWithoutSuffix = path.join(String(conf.get('log:path')), String((conf.get('log:lib:IPC:file') ? conf.get('log:lib:IPC:file') : 'IPC.log')));
var streamLog, logFile;

var magic = 'ALPZ', version = 1, magicLength = magic.length;
var headerLength = magicLength + 1 + 8;
var maxMessageID = 0xffffffff; // messageID must be >= 0 and <= 4294967295
var maxMessageLen  = 0xffffffff; // 4294967295;
var keepAlive = 120000; // delay between the last data packet received and the first keepalive probe in milliseconds
var socketTimeout = 0;  // Sets the socket to timeout after timeout milliseconds of inactivity on the socket. 0 - disabled
var reconnectDelay = 5000; // delay between reconnect attempt to server on disconnect in milliseconds
var maxAttemptsCnt = 720; // attempts number for restart IPC server after error occurred. 720 * (reconnectDelay) 5 sec = 3600 (one hour)
var levelOrder = {S:0, D:1, I:2, W:3, E:4, exit:5};
var logLevel = levelOrder[conf.get('log:logLevel') || 'I'];
var logToConsole = false;
var stopInProgress = 0;
var stopMessage = '__stop_your_child__';
var closeConnectionMessage = '__close_connection__';
var storageDirName = path.join(__dirname, '..', conf.get('tempDir') || 'temp');
var storageFileExtension = '.ipc';


var IPC = {};
module.exports = IPC;


/*
cfg = {
        serverAddress: <string> - server IP
        serverPort: <number>: server TCP port
        id: <string> - log file name and storage file name ID
        logToConsole: log to console. not to IPC.log
        keepCallbackInterval: max time in ms for waiting answer from sendAndReceive and alloc memory for callback function. default 1800000
        cleanUpCallbacksPeriod: every cleanUpCallbacksPeriod we will clean callbacks. default 300000
        maxSocketErrorsCnt: maximum socket errors before exit(4), default 50
        maxSocketErrorsTime: maximum socket time, when errors occurred before exit(4), default 60000
        maxSocketErrorsTTL: time to live before reset maxSocketErrorsCnt and maxSocketErrorsTime, default 300000
    }
callback(err, message, socketIndex|-1 when init, function forClientSendAndReceive(err1, message) {})

methods:
    stop(callback)
    destroy()
    send(data, callback(err))
    sendToAll(data, callback(err))
    sendAndReceive(data, callback(err, socketIndex, receivedData))
    sendAndPermanentReceive(data, callback(err, socketIndex, receivedData))

 */

IPC.server = function(cfg, callback) {
    var serverAddress = cfg.serverAddress,
        serverPort = cfg.serverPort,
        id = cfg.id,
        cleanUpCallbacksPeriod = cfg.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = cfg.keepCallbackInterval || 1800000,
        isServerRunning = 0,
        attemptsCnt = maxAttemptsCnt,
        server,
        callbackStack = new Map(),
        connectedSockets = new Map(),
        currentSocketIndex = 0,
        messageID,
        stopCallback,
        firstMessageID = 1, // even for client, odd for server
        socketErrorCounter = {
            num: 0,
            maxNum: cfg.maxSocketErrorsCnt || 50,
            time: 0,
            maxTime: cfg.maxSocketErrorsTime || 60000,
            timeToLive: cfg.maxSocketErrorsTTL || 300000,
        };

    if(cfg.logToConsole) logToConsole = true;

    if(id) id = 'server:' + id;
    else if(module.parent) id = 'server:' + path.basename(module.parent.filename, '.js');
    else id = 'server';

    var log = new IPC.log(id || 'Server');

    // cleanup unused callbacks
    setTimeout(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, log);

    this.send = function(data, socketIndex, callback) { send(data, socketIndex, 0, false, callback); };

    //round robin send to children
    this.send = function(data, callback) { send(data, null, 0, false, callback); };

    this.sendToAll = sendToAll;

    this.sendAndReceive = function(data, socketIndex, callback) {
        sendAndReceive(data, socketIndex, false, callback);
    };

    this.sendAndPermanentReceive = function(data, socketIndex, callback) {
        sendAndReceive(data, socketIndex, true, callback);
    };

    this.stop = stop;
    this.destroy = destroy;


    if(isServerRunning) return callback();
    return start();

    function getNextSocketIndex() {
        if(!connectedSockets.size) return;

        if(currentSocketIndex >= connectedSockets.size) currentSocketIndex = 0;
        return Array.from(connectedSockets.keys())[currentSocketIndex++];
    }

    function sendToAll (data, callback) {
        if(typeof callback !== 'function') callback = function(err) { if(err) log.warn(err.message); };

        async.each(Array.from(connectedSockets.keys()), function (socketIndex, callback) {
            send(data, socketIndex, 0, false, callback);
        }, callback);
    }

    function send (data, socketIndex, sentMessageID, permanent, callback) {
        if(typeof callback !== 'function') callback = function(err) { if(err) log.warn(err.message); };

        if(socketIndex === undefined || socketIndex === null) {
            socketIndex = getNextSocketIndex();
        }
        if(socketIndex === undefined) {
            log.warn('Children sockets are not exist. Waiting...');
            return setTimeout(send, 1000, data, socketIndex, sentMessageID, permanent, callback);
        }

        if(sentMessageID) {
            callbackStack.set(connectedSockets.get(socketIndex).remotePort + '_' + sentMessageID, {
                timestamp: Date.now(),
                permanent: permanent,
                func: callback
            });
            callback = null;
            //log.info('Add new callback for messageID ', sentMessageID, ', permanent: ', permanent ,', message: ', data);
        }

        dataSender(log,null, connectedSockets.get(socketIndex), data, sentMessageID, callback);
    }

    function sendAndReceive(data, socketIndex, permanent, callback) {
        if(typeof callback !== 'function') return log.warn('Can\' run sendAndReceive() function: callback is not set');

        messageID = getNewMessageID(messageID, firstMessageID);
        send(data, socketIndex, messageID, permanent, callback);
    }

    function destroy() {
        if(stopInProgress) return;
        stopInProgress = Date.now();
        connectedSockets.clear();
        isServerRunning = 0;
        if(server && typeof server.close === 'function') server.close();
        server = null;
    }

    function stop(callback) {
        if(stopInProgress) return;
        stopInProgress = Date.now();
        if(typeof callback !== 'function') {
            callback = function(err) {
                if(err) {
                    log.error(err.message);
                    log.exit(err.message);
                }
            }
        }

        var stopWatchDog;

        stopCallback = function() {
            clearTimeout(stopWatchDog);
            stopCallback = null;
            server = null;
            connectedSockets.clear();
            isServerRunning = 0;
            stopInProgress = 0;
            callback();
        }

        if(!server || typeof server.close !== 'function') return stopCallback();

        // Stops the server from accepting new connections and keeps existing connections.
        // This function is asynchronous, the server is finally closed when all connections are ended and the
        // server emits a 'close' event. The optional callback will be called once the 'close' event occurs.
        // Unlike that event, it will be called with an Error as its only argument if the server was not open when
        // it was closed.
        server.close(function() {
            if(typeof stopCallback === 'function') stopCallback();
        });
        sendToAll(closeConnectionMessage);

        // waiting 15 seconds for close connections
        stopWatchDog = setTimeout(function () {
            log.warn('Timeout occurred while waiting for server connections to close');
            if(typeof stopCallback === 'function') stopCallback();
        }, 15000);
    }

    function start() {
        //log.debug('Starting IPC server on ', serverAddress, ':', serverPort);

        isServerRunning = Date.now();
        stopInProgress = 0;

        server = net.createServer(function(socket) {

            var socketIndex = Date.now();
            connectedSockets.set(socketIndex, socket);

            log.debug('Client connected: ', socket.remoteAddress, ':', socket.remotePort, '->', serverAddress, ':', serverPort);
            attemptsCnt = maxAttemptsCnt;

            // Setting true for noDelay will immediately fire off data each time socket.write() is called.
            //socket.setNoDelay(true);

            //Enable keep-alive functionality, and set the initial delay before the first keepAlive probe is sent on an idle socket.
            // in milliseconds
            socket.setKeepAlive(true, keepAlive);
            socket.setTimeout(socketTimeout);

            socket.on('timeout', function() {
                connectedSockets.delete(socketIndex);
                socket.end();
                if(stopInProgress) return;

                log.debug('IPC server socket closed due timeout ' +(socketTimeout / 1000) + ' sec : ' + socket.remoteAddress +
                    ':' + socket.remotePort + '->' + serverAddress + ':' + serverPort);
            });

            socket.on('error', function(err) {
                if(stopInProgress) return;
                socketErrorsHandler(new Error('IPC server socket error: ' + err.message + ' for: ' + socket.remoteAddress +
                    ':' + socket.remotePort + '->' + serverAddress + ':' + serverPort), socketErrorCounter, log);
            });

            // this will be called after 'error'
            socket.on('close', function(hadError) {
                connectedSockets.delete(socketIndex);
                if(stopInProgress) return;
                if(typeof stopCallback === 'function') {
                    if(!connectedSockets.size) stopCallback();
                    return;
                }

                if(hadError) {
                    log.warn('IPC server: socket closed due to a transmission error to client for: ' + socket.remoteAddress +
                        ':' + socket.remotePort + '->' + serverAddress + ':' + serverPort);
                    return callback(new Error('IPC server: socket closed due to a transmission error to client for: ' + socket.remoteAddress +
                        ':' + socket.remotePort + '->' + serverAddress + ':' + serverPort));
                }
            });
            
            socket.on('end', function () {
                connectedSockets.delete(socketIndex);
                if(stopInProgress) return;

                log.debug('IPC server socket closed by peer: ' + socket.remoteAddress +
                    ':' + socket.remotePort + '->' + serverAddress + ':' + serverPort);
            });

            dataReceiver(log, socket, function(err, receivedMessageID, result) {
                // same another process is starting and send stop message because it will use this port
                // using exitCode 10 for prevent to restart process by proc.js
                if(result === stopMessage) {
                    log.error('Received message for stopping from another IPC system. Exiting...');
                    log.exit('Received message for stopping from another IPC system. Exiting...');
                    log.disconnect(function () { process.exit(10) });
                    return;
                }

                var callbackID = socket.remotePort + '_' + receivedMessageID;
                var callbackObj = callbackStack.get(callbackID);
                if (callbackObj && typeof callbackObj.func === 'function') {
                    if(callbackObj.removed)
                        //log.warn('Callback for messageID ', receivedMessageID, ', message: ', resultStr , ' was removed at ', new Date(callbackObj.removed).toLocaleString());
                        callbackObj.func(err, result, socketIndex);

                    if (!callbackObj.permanent) {
                        //callbackObj.removed = Date.now();
                        callbackStack.delete(callbackID);
                    }
                    return;
                } else if(receivedMessageID && receivedMessageID % 2 !== 0) // for odd messageIDs
                    log.warn('Can\'t find callback for messageID ', receivedMessageID, '/', messageID, ', message: "', result, '"');

                callback(err, result, socketIndex, function (err1, message) {
                    if(err1) log.warn(err1.message);
                    // dont send back this message (was called .send() function, not sendAndReceive())
                    if(!receivedMessageID && !message) return;
                    var returnedError = err ? (err1 ? new Error(err.stack + ' AND ' + err1.stack) : err) : (err1 ? err1 : null);
                    dataSender(log, returnedError, socket, message, receivedMessageID);
                });
            });
        });

        // !!!! Server error (f.e. address in use), not a socket error (f.e. transmit error)
        server.on('error', function(err) {
            if(stopInProgress) return;

            var message = 'IPC server error: ' + err.message +
                (attemptsCnt ?
                    ('. ' + attemptsCnt + ' attempts left. Try to restart listener after ' + (reconnectDelay / 1000) + ' sec') :
                    '. No attempts left, exiting');

            callback(new Error(message));

            // exit code 4 means nothing and reserved for IPC
            if(!attemptsCnt--) {
                log.error(message);
                log.exit(message);
                return log.disconnect(function () { process.exit(4) });
            } else log.warn(message);

            // sending a stop message to another process that is listening on this port
            connectAndSendMessage(serverAddress, serverPort, null, stopMessage, function(err) {
                if(!err) { // message sent successfully
                    log.warn('Another process is listening on ' + serverAddress + ':' + serverPort +
                        '. Stop message sent successfully, restarting socket listener');
                }

                // waiting while process exiting and restart socket listener
                setTimeout(function() {
                    stop(function(err) {
                        if(err) callback(err);
                        start();
                    });
                }, reconnectDelay);
            });
        });

        server.listen({
            host: serverAddress,
            port: serverPort,
            exclusive: true
        }, function() {
            log.info('Server starting at ', serverAddress,' and bound to TCP port ', serverPort);
            callback(null, null, -1); // send -1 as socketIndex
        });
    }
};

/*
 don't use log or add var log = new IPC.log(logLabel || 'connectAndSendMessage');

 return err:
 if error occurred when connecting
 if connection timeout occurred after 3 sec
 if send message error
 */
connectAndSendMessage = function(serverAddress, serverPort, localAddress, message, callback) {

    var socket = net.connect({
        host: serverAddress,
        port: serverPort,
        localAddress: localAddress || undefined
    });

    socket.setTimeout(3000);

    var log = new IPC.log('connectAndSendMessage ', serverAddress, ':', serverPort);
    socket.on('connect', function() {
        dataSender(log, null, socket, message, null, function(err) {
            socket.end();
            callback(err);
        });
    });

    socket.on('error', function(err) {
        callback(err);
    });

    socket.on('timeout', function() {
        if(socket) socket.end();
        callback(new Error('Connection timeout'));
    });
};

/*
cfg = {
        serverAddress: <string> - server IP
        serverPort: <number>: server TCP port
        localAddress: local IP for send packet. May be null
        id: <string> - log file name and storage file name ID
        suffix: <string> - suffix for automatic generated id
        separateStorageByProcess: (if not set then true) add process pid to name of storage file. prevent sending unsent messages form storage file after exception and restart
        logToConsole: log to console. not to IPC.log
        maxUnsentMessagesCnt: maximum count of unsent messages which stored in memory before start saving to store. default 5000
        keepCallbackInterval: max time in ms for waiting answer from sendAndReceive and alloc memory for callback function. default 1800000
        cleanUpCallbacksPeriod: every cleanUpCallbacksPeriod we will clean callbacks. default 300000
        maxSocketErrorsCnt: maximum socket errors before exit(4), default 50
        maxSocketErrorsTime: maximum socket time, when errors occurred before exit(4), default 60000
        maxSocketErrorsTTL: time to live before reset maxSocketErrorsCnt and maxSocketErrorsTime, default 300000
        onStop: function for run before calling methods stop() = destroy() = disconnect()
    }
callback(err, message, isConnected: true|not true, function forServerSendAndReceive(err, message) {})

methods:
    stop() = destroy() = disconnect()
    send(data, callback(err))
    sendAndReceive(data, callback(err, receivedData))
    sendAndPermanentReceive(data, callback(err, receivedData))

*/
IPC.client = function(cfg, callback) {
    var serverAddress = cfg.serverAddress,
        serverPort = cfg.serverPort,
        localAddress = cfg.localAddress,
        id = cfg.id,
        storageFileSuffix = cfg.separateStorageByProcess || cfg.separateStorageByProcess === undefined ? '_' + process.pid : '',
        cleanUpCallbacksPeriod = cfg.cleanUpCallbacksPeriod || 300000,
        keepCallbackInterval = cfg.keepCallbackInterval || 1800000,
        maxUnsentMessagesCnt = cfg.maxUnsentMessagesCnt || 5000,
        writableStorageStream,
        storageFD,
        socket,
        isConnected = false,
        dateWasSavedBeforeConnection = false, // used only for log
        isDisconnected = false,
        unsentMessagesCnt = 0,
        savedMessagesCnt = 0,
        processedUnsentData = false,
        unsentData = [],
        callbackStack = new Map(),
        reconnectAttempts = 0,
        messageID,
        firstMessageID = 2, // even for client, odd for server
        socketErrorCounter = {
            num: 0,
            maxNum: cfg.maxSocketErrorsCnt || 50,
            time: 0,
            maxTime: cfg.maxSocketErrorsTime || 60000,
            timeToLive: cfg.maxSocketErrorsTTL || 300000,
        };

    if(cfg.logToConsole) logToConsole = true;

    if(id) id = 'client:' + id;
    else if(module.parent) {
        if(module.parent.parent) {
            id = 'client:' + path.basename(module.parent.parent.filename, '.js');
        } else id = 'client:' + path.basename(module.parent.filename, '.js');
    } else id = 'client';

    if(cfg.suffix) id += cfg.suffix;

    var log = new IPC.log(id || 'Client');
    var storageFileName = path.join(storageDirName,
        id.replace(/:/g, '_') + storageFileSuffix + storageFileExtension);

    // cleanup unused callbacks
    setTimeout(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, log);

    this.send = function(data, callback) { send(data, 0, false, callback) };

    this.sendAndReceive = function(data, callback) {
        if(typeof callback !== 'function') return log.warn('Can\' run sendAndReceive() function: callback is not set');

        messageID = getNewMessageID(messageID, firstMessageID);
        send(data, messageID, false, callback);
    };

    this.sendAndPermanentReceive = function(data, callback) {
        if(typeof callback !== 'function') return log.warn('Can\' run sendAndPermanentReceive() function: callback is not set');

        messageID = getNewMessageID(messageID, firstMessageID);
        send(data, messageID, true, callback);
    };

    this.stop = stop;
    this.destroy = disconnect;
    this.disconnect = disconnect;

    function disconnect (callback) {
        socket.end(function () {
            if(typeof socket.destroy === 'function') socket.destroy();
            if(typeof callback === 'function') callback();
        });
        isConnected = false;
        isDisconnected = true;
    }

    function stop (callback) {
        if(!socket || stopInProgress) return;
        stopInProgress = Date.now();

        if(typeof cfg.onStop !== "function") return disconnect(callback);

        cfg.onStop(function (err) {
            if(err) log.error(err);
            disconnect(callback);
        });
    }

    function send (data, sentMessageID, permanent, callback) {

        if(sentMessageID && typeof callback === 'function') {
            callbackStack.set(sentMessageID, {
                timestamp: Date.now(),
                permanent: permanent,
                func: callback
            });
            callback = null;
            //log.info('Add new callback for messageID ', sentMessageID, ', permanent: ', permanent ,', message: ', data);
        }

        if(!isConnected) {
            if(!dateWasSavedBeforeConnection) {
                log.warn('Receiving request to send data but not connected to server' +
                    (localAddress ? ' from ' + localAddress : '') + ' to ' + serverAddress + ':' + serverPort +
                    '. Store data for send after connect.');
                dateWasSavedBeforeConnection = true;
            }
            return saveUnsentData({ data: data, messageID: sentMessageID, permanent: permanent }, function(err) {
                if(err) log.warn(err.message);
            });
        }

        dataSender(log,null, socket, data, sentMessageID, callback);
    }

    if(isConnected || isDisconnected) return callback();
    return connect();

    function connect() {
        socket = net.connect({
            host: serverAddress,
            port: serverPort,
            localAddress: localAddress
        });

        stopInProgress = 0;

        if(reconnectAttempts) {
            log.info('IPC client try to connect to ' + serverAddress + ':' + serverPort +
                ', attempt: ' , String(++reconnectAttempts));
        }

        if(conf.get('IPCClientMaxReconnectAttempts') && reconnectAttempts > conf.get('IPCClientMaxReconnectAttempts')) {
            log.error('Maximum attempts (' +reconnectAttempts+ ') to reconnect to IPC server occurred. Exiting');
            log.exit('Maximum attempts (' +reconnectAttempts+ ') to reconnect to IPC server occurred. Exiting');
            // exit code 4 means nothing and reserved for IPC
            return log.disconnect(function () { process.exit(4) });
        }

        // Setting true for noDelay will immediately fire off data each time socket.write() is called.
        //socket.setNoDelay(true);

        //Enable keep-alive functionality, and set the initial delay before the first keepAlive probe is sent on an idle socket.
        // in milliseconds
        socket.setKeepAlive(true, keepAlive);
        socket.setTimeout(socketTimeout);

        socket.on('timeout', function () {
            socket.end();
            isConnected = false;
            if(stopInProgress) return;

            log.debug('IPC client socket closed due timeout ' + (socketTimeout / 1000) + ' sec: ' +
                socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort,
                '; reconnecting after ', (reconnectDelay / 1000), ' sec');

            setTimeout(function () {
                connect();
            }, reconnectDelay);
        });

        socket.on('connect', function() {
            isConnected = true;
            dateWasSavedBeforeConnection = false;
            reconnectAttempts = 0;

            log.info('IPC client connecting ' + socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort +
                (unsentMessagesCnt ? '. Send ' + unsentMessagesCnt + ' unsent messages': '')
            );

            sendUnsentData(function (err) {
                if (err) log.warn(err.message);
            });

            dataReceiver(log, socket, function(err, receivedMessageID, result) {
                if(result === closeConnectionMessage) {
                    //stopInProgress = Date.now();
                    socket.end(function () {
                        socket.destroy();
                    });
                    return;
                }

                var callbackObj = callbackStack.get(receivedMessageID);
                if (callbackObj && typeof callbackObj.func === 'function') {
                    //if(callbackObj.removed) log.warn('Callback for messageID ', messageID, ', message: ', result, ' was removed at ', new Date(callbackObj.removed).toLocaleString());
                    callbackObj.func(err, result);
                    if (!callbackObj.permanent) {
                        //callbackObj.removed = Date.now();
                        callbackStack.delete(receivedMessageID);
                    }
                    return;
                } else if(receivedMessageID && receivedMessageID % 2 === 0) // for even messageIDs
                    log.warn('Can\'t find callback for messageID ', receivedMessageID, '/', messageID, ', message: "', result, '"');

                callback(err, result, null, function (err1, message) {
                    if(err1) log.warn(err1.message);
                    var returnedError = err ? (err1 ? new Error(err.stack + ' AND ' + err1.stack) : err) : (err1 ? err1 : null);
                    dataSender(log, returnedError, socket, message, receivedMessageID);
                });
            });

            // run callback on connected
            callback(null, null, true);
        });

        socket.on('error', function (err) {
            if(!isConnected || stopInProgress) return; // don't print error when server is not initialized
            socketErrorsHandler(new Error('IPC client socket error: ' + err.message + ' for: ' +
                socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort), socketErrorCounter, log)
        });

        // it will be called after 'error'
        socket.on('close', function (hadError) {
            isConnected = false;
            if(stopInProgress) return;

            if (hadError && isConnected) {
                log.warn('IPC client socket closed due to a transmission error to server for: ' +
                    socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort +
                    '; reconnecting  after ' + (reconnectDelay / 1000) + ' sec');
                callback(new Error('IPC client socket closed due to a transmission error to server for: ' +
                    socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort +
                    '; reconnecting  after ' + (reconnectDelay / 1000) + ' sec'));
            }

            setTimeout(function () {
                connect();
            }, reconnectDelay);
        });

        socket.on('end', function () {
            isConnected = false;
            if(stopInProgress) return;

            log.debug('IPC client socket closed by peer: ' +
                socket.localAddress + ':' + socket.localPort + '->' + serverAddress + ':' + serverPort,
                '; reconnecting after ', (reconnectDelay / 1000), ' sec');

            setTimeout(function () {
                connect();
            }, reconnectDelay);
        });
    }

    function saveUnsentData(data, callback) {
        ++unsentMessagesCnt;
        unsentData.push(data);
        if(unsentData.length < maxUnsentMessagesCnt) return callback();

        try {
            var stringifiedData = Buffer.from(JSON.stringify(unsentData));
            var messageCnt = unsentData.length;
            unsentData = [];
        } catch(err) {
            return callback(new Error('Can\'t stringify data for save unsent message: ' + err.message));
        }

        if(!stringifiedData || !stringifiedData.length || stringifiedData.length > maxMessageLen) {
            log.warn('Can\'t send data. Unsent message wrong or too long: ' + stringifiedData.length + '/ ' + maxMessageLen+ ': ' + stringifiedData.toString('utf8', 0, 512) + '...');
        }

        zlib.brotliCompress(stringifiedData, function(err, compressedData) {
            if(err) return callback(new Error('Can\'t compress data: ' + err.message));

            var message = Buffer.alloc(4);
            message.writeUInt32LE(compressedData.length, 0);
            message = Buffer.concat([message, compressedData]);

            if(!writableStorageStream) {
                if(fs.existsSync(storageFileName)) {
                    log.warn('File ' + storageFileName +
                        ' is exist before create a new writable stream to this file. Try to truncate file');
                }
                //{flags: 'w', autoClose: true}. 'w': Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
                writableStorageStream = fs.createWriteStream(storageFileName);

                writableStorageStream.on('error', (err) => {
                    writableStorageStream = null;
                    log.warn('Error with save unsent IPC data to ', storageFileName, ': ', err.message);
                });

                writableStorageStream.on('close', () => {
                    writableStorageStream = null;
                });

                writableStorageStream.on('finish', () => {
                    writableStorageStream = null;
                });
            }

            writableStorageStream.write(message);

            savedMessagesCnt += messageCnt;
            log.info('Saving ', savedMessagesCnt, ' messages to ', storageFileName);
            if(isConnected && savedMessagesCnt + unsentData.length === unsentMessagesCnt) sendUnsentData(function(err) {
                if(err) log.warn(err.message);
            });

            callback();
        });
    }

    function sendUnsentData(callback) {
        if(processedUnsentData) return callback();
        processedUnsentData = true;

        if (writableStorageStream) {
            writableStorageStream.end();
            writableStorageStream = null;
        }

        if (!storageFD && fs.existsSync(storageFileName)) {
            log.info('Sending unsent '+ savedMessagesCnt + ' messages from ' + storageFileName + ', size: ' + fs.statSync(storageFileName).size + 'B');
            try {
                storageFD = fs.openSync(storageFileName, 'r');
            } catch (e) {
                return callback(new Error('Can\'t open storage for reading: ' + e.message));
            }
            var continueReading = true;
        } else continueReading = false;

        var filePos = 0, sentMessagesCnt = 0;
        async.whilst(function() {
            return continueReading;
        }, function (callback) {
            var sizeBuf = Buffer.alloc(4);
            fs.read(storageFD, sizeBuf, 0, 4, filePos, function (err, bytesRead, sizeBuf) {
                if(err) return callback(new Error('Can\'t read data size from ' + storageFileName + ': ' + err.message));

                if(!bytesRead || bytesRead !== 4) {
                    continueReading = false;
                    return callback();
                }

                var dataSize = sizeBuf.readUInt32LE(0);

                try {
                    var compressedData = Buffer.alloc(dataSize);
                } catch (e) {
                    return callback(new Error('Possible error occurred while reading data size from ' + storageFileName +
                        ': can\'t allocate buffer for compressed data with size: ' + dataSize + ': ' + e.message));
                }
                fs.read(storageFD, compressedData, 0, dataSize, filePos + 4, function (err, bytesRead, compressedData) {
                    if(err) return callback(new Error('Can\'t read data ' + dataSize + 'B from ' + storageFileName + ': ' + err.message));

                    if(!bytesRead || bytesRead !== dataSize) {
                        return callback(new Error('Can\'t read unsent data (' + dataSize + 'B) from ' + storageFileName +
                            ': available only ' + bytesRead + '/' + dataSize + ' for reading.'));
                    }

                    filePos += dataSize + 4;

                    //log.debug('Read data size: ', dataSize,'B: ', compressedData);
                    zlib.brotliDecompress(compressedData, function (err, stringifiedData) {
                        if(err) return callback(new Error('Can\'t decompress unsent data from ' + storageFileName + ': ' + err.message));

                        try {
                            var unsentDataFromStorage = JSON.parse(stringifiedData);
                        } catch (e) {
                            return callback(new Error('Can\'t parse unsent stringified data: ' + e.message + '; Data: ' + stringifiedData));
                        }

                        if(!isConnected) return callback();

                        sentMessagesCnt += unsentDataFromStorage.length;
                        async.eachSeries(unsentDataFromStorage, function (dataObj, callback) {
                            send(dataObj.data, dataObj.messageID, dataObj.permanent, callback);
                        }, function(err) {
                            log.info('Reading ', (err ? 'but not sending ': 'and sending '), unsentDataFromStorage.length,
                                ' (total: ', sentMessagesCnt, ') messages (compressed/decompressed size:',
                                dataSize, 'B/', stringifiedData.length, 'B) from ', storageFileName);
                            if(err) log.warn('Error while sending messages: ', err.message);
                            callback();
                        });
                    });
                });
            });
        }, function (err) {

            if(storageFD) {
                log.info('Sent ', sentMessagesCnt, ' messages form ', storageFileName);
                fs.close(storageFD, function (err) {
                    if(err) log.warn('Can\'t close ', storageFileName, ': ', err.message);

                    storageFD = null;

                    fs.unlink(storageFileName, function (err) {
                        if (err || fs.existsSync(storageFileName)) {
                            log.warn('Can\'t delete file ' + storageFileName + ' with unsent data: ' +
                                (err ? err.message : 'There was no error deleting the file, but the file still exists'));
                        } else log.info('Successfully deleting file with unsent data ' + storageFileName);
                    });
                });
            }

            if(unsentData.length) {
                //log.info('Sending unsent ', unsentData.length, ' messages from memory');
                unsentData.forEach(function (dataObj) {
                    send(dataObj.data, dataObj.messageID, dataObj.permanent);
                });
                unsentData = [];
            }
            unsentMessagesCnt = savedMessagesCnt = 0;
            processedUnsentData = false;
            return callback(err);
        });
    }
};

// create new messageID form process pid * 0x10000 plus previous message ID + 2
// even for client, odd for server
// must be >= 0 and <= 0xffff
function getNewMessageID(messageID, firstMessageID) {
    //var id = messageID ? messageID % 0x10000 : firstMessageID - 2;
    //id = id < maxMessageID-1 ? id + 2 : firstMessageID;
    //return process.pid * 0x10000 + id;
    return (messageID && messageID < maxMessageID-1 ? messageID + 2 : firstMessageID);
}

function dataSender(log, err, socket, data, sentMessageID, callback) {

    try {
        var stringifiedData = JSON.stringify({
            data: data,
            err: err && err.stack ? err.stack : err
        });

        if(!stringifiedData || !stringifiedData.length || stringifiedData.length > maxMessageLen) {
            err1 = new Error('Can\'t send data. Message too long: ' + stringifiedData.length + '/ ' + maxMessageLen+ ': ' + stringifiedData.toString('utf8', 0, 512) + '...');
            log.warn(err1.message);
            var preparedData = Buffer.from(JSON.stringify({
                data: null,
                err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
            }));
        } else preparedData = Buffer.from(stringifiedData);
    } catch(err) {
        var err1 = new Error('Can\'t stringify sending data: ' + err.message);
        log.warn(err1.message);
        preparedData = Buffer.from(JSON.stringify({
            data: null,
            err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
        }));
    }

    if(preparedData.length > maxMessageLen) {
        err1 = new Error('Can\'t send data. Message too long: ' + preparedData.length + '/ ' + maxMessageLen+ ': ' + preparedData.toString('utf8', 0, 512) + '...');
        log.warn(err1.message);
        preparedData = Buffer.from(JSON.stringify({
            data: null,
            err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
        }));
    }

    var message = Buffer.from(magic+'VLLLLLLLL');
    message.writeInt8(version, 4);
    message.writeUInt32LE(preparedData ? preparedData.length : 0, 5);
    message.writeUInt32LE(sentMessageID === undefined || sentMessageID === null ? 0 : sentMessageID, 9);
    message = Buffer.concat([message, preparedData]);

    //log.debug('send ', serverAddress, ':', serverPort,': length: ', message.length, '(length in header: ', (preparedData.length + headerLength), '), data: ', message.toString());
    socket.write(message, callback);

    /*
    deep debug server messages
    if(data && data.property && data.property.OCID == 155096) console.log('before 155096: ', socket.remoteAddress +
        ':' + socket.remotePort, data);
    socket.write(message, function(err) {
        if(err) log.warn(err.message);
        if(data && data.property && data.property.OCID == 155096) console.log('after 155096: ', data);
        if(callback) callback();
    });
     */
}

function dataReceiver(log, socket, callback) {
    var newData = Buffer.alloc(0),
        isParserRunning = false;

    return socket.on('data', function(dataPart) {
        newData = Buffer.concat([newData, dataPart]);
        if(!isParserRunning && newData) dataParser(newData);
    });

    function dataParser(data) {
        isParserRunning = true;

        while (data.length >= headerLength) {
            var dataLength = data.readUInt32LE(5);
            if(data.length < dataLength + headerLength) break;

            var receivedMagic = data.toString('utf8', 0, magicLength);
            var receivedVersion = data.readInt8(4);
            if (receivedMagic !== magic || receivedVersion !== version) {
                log.warn('Incorrect header, skip part of received data: "' + receivedMagic + '":' + receivedVersion + ': '+ data.toString('utf8'), data);
                newData = Buffer.alloc(0);
                break;
            }

            var receivedMessageID = data.readUInt32LE(9);

            //log.debug('header + data length: ', (dataLength + headerLength), ', real data length: ', data.length, ', data: ', data);

            if(dataLength) {
                var resultStr = data.toString('utf8', headerLength, dataLength + headerLength);
                try {
                    var result = JSON.parse(resultStr);
                } catch (err) {
                    //log.warn('Can\'t parse JSON in received data (len: ' + data.length + '; len value from header: ' + dataLength + ') data: "' + resultStr + '" (', data,'): ' + err.message);
                    return callback(new Error('Can\'t parse JSON in received data (len: ' + data.length +
                        '; len value from header: ' + dataLength + ') data: "' + resultStr + ': ' +
                        err.message), receivedMessageID);
                }

                if(typeof result !== 'object') return callback(new Error('Received data has unknown format (len: ' + data.length +
                    '; len value from header: ' + dataLength + ') data: "' + resultStr), receivedMessageID);
            } else return callback(new Error('Received message without data (len: ' + data.length +
                '; len value from header: ' + dataLength + ')'), receivedMessageID);

            //if(result.err) log.warn(result.err);
            callback(result.err ? new Error(result.err) : null, receivedMessageID, result.data);
            //if(!receivedMessageID && receivedMessageID !== 0) log.warn('Unknown message ID for ' + resultStr + '(', data, ')');

            data = newData = newData.slice(dataLength + headerLength);
            //log.debug('Receive ',socket.remoteAddress, ':', socket.remotePort,': length: ', dataSavedForDebug.length, '(waiting: ', (dataLength + headerLength), (resultStr ? ', processed data' : ', wait to next data part' ), '), data: ', dataSavedForDebug.toString());
        }
        isParserRunning = false;
    }
}

IPC.log = function(label) {

    if(!label) label = 'IPC';

    return {

        silly: function () {
            writeLog('S', Array.prototype.slice.call(arguments), label)
        },
        debug: function () {
            writeLog('D', Array.prototype.slice.call(arguments), label)
        },
        info: function () {
            writeLog('I', Array.prototype.slice.call(arguments), label)
        },
        warn: function () {
            writeLog('W', Array.prototype.slice.call(arguments), label)
        },
        error: function () {
            writeLog('E', Array.prototype.slice.call(arguments), label)
        },
        exit: function () {
            writeLog('exit', Array.prototype.slice.call(arguments), label)
        },
        // for compatibility with log.js and 1 sec is a time to write data to the log file
        disconnect: function (callback) { setTimeout(callback, 1000); },
    };
};

function writeLog(level, args, label) {
    if(!args.length || levelOrder[level] < logLevel) return;

    // if Error, add stack to error message
    if(level === 'E') args.push('; '+(new Error('occurred')).stack);

    var logStr = args.map(function(arg) {
        if( typeof arg === 'string' || typeof arg === 'number') return String(arg);
        try {
            return JSON.stringify(arg);
        } catch(err) {
            return '???' + err.message.toUpperCase() + '???';
        }
    }).join('').replace(/[\r\n]/g, '');

    var timestamp = new Date();
    var dateStr = String((timestamp.getMonth()+1) + '.0' + timestamp.getDate()).replace(/0(\d\d)/g, '$1') + ' ';
    var timeStamp = String('0'+ timestamp.getHours() + ':0'+ timestamp.getMinutes() + ':0' + timestamp.getSeconds()).replace(/0(\d\d)/g, '$1') +
        '.' + String('00'+timestamp.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

    var message = dateStr + timeStamp + '[' + label + ':' + process.pid + '] ' + level + ': ' + logStr;

    if(logToConsole) return console.log(message);
    message += '\n';

    var now = new Date();
    var month = now.getMonth()+1;
    var date = now.getDate();
    var dateSuffix = String((now.getYear()-100)) + String(month<10 ? '0' + month : month) + String(date<10 ? '0' + date: date);
    var newLogFile = logFileWithoutSuffix + '.' + dateSuffix;

    // log rotation
    if(streamLog && logFile !== newLogFile) {
        streamLog.end();
        streamLog = undefined;
    }
    logFile = newLogFile;
    if(!streamLog) streamLog = fs.createWriteStream(logFile, {flags: 'a'});
    streamLog.write(message);

    if(level === 'exit') {
        streamLog.end();
        streamLog = null;
    }
}

// cleanup unused callbacks
function cleanUpCallbackStack(callbackStack, keepCallbackInterval, log) {
    var now = Date.now();
    var err = new Error('Timeout ' + keepCallbackInterval / 1000 + 'sec occurred while waiting for IPC callback calling');
    var cleanUpCallbacksNum = 0;
    //var callbackIDsForRemove = [];

    for(var [id, callbackObj] of callbackStack.entries()) {
        if(callbackObj && !callbackObj.permanent && callbackObj.timestamp  + keepCallbackInterval < now) {
            if (typeof callbackObj.func === 'function') callbackObj.func(err);
            callbackStack.delete(id);
            ++cleanUpCallbacksNum;
        }
    }

    if(cleanUpCallbacksNum && log && typeof log.warn === 'function') {
        log.warn('Cleaning ' + cleanUpCallbacksNum + ' callbacks older then ' + keepCallbackInterval / 1000 +
            'sec from stack');
    }
    //return callbackIDsForRemove;
}

function socketErrorsHandler(err, socketErrorCounter, log) {
    if(!socketErrorCounter.time) socketErrorCounter.time = Date.now();
    else if(Date.now() - socketErrorCounter.time > socketErrorCounter.timeToLive) {
        socketErrorCounter.num = 0;
        socketErrorCounter.time = Date.now();
    }
    ++socketErrorCounter.num;
    if(socketErrorCounter.num === 1 ||
        socketErrorCounter.num / 100 === Math.round(socketErrorCounter.num / 100) ||
        socketErrorCounter.num === socketErrorCounter.maxNum) {
        if(socketErrorCounter.num === 1) log.warn(err.message);
        else {
            log.warn('Error #', socketErrorCounter.num, ', occurred from: ',
                new Date(socketErrorCounter.time).toLocaleTimeString(), ': ', err.message);
        }
    }

    if(socketErrorCounter.num > socketErrorCounter.maxNum &&
        Date.now() - socketErrorCounter.time > socketErrorCounter.maxTime) {
        var message = 'Maximum error #' + socketErrorCounter.num + ' occurred, from: ' +
            new Date(socketErrorCounter.time).toLocaleTimeString() + '. Restarting: ' + err.message
        log.error(message);
        log.exit(message);
        log.disconnect(function () { process.exit(4) });
    }
}

IPC.service = function () {
    var log = new IPC.log('Service');

    log.info('Starting scheduled IPC service');
    removeUnusedIPCStorageFiles();
    setInterval(removeUnusedIPCStorageFiles, 300000);

    function removeUnusedIPCStorageFiles() {
        log.info('Starting scheduled searching unused files in ', storageDirName,
            ' with "', storageFileExtension, '" extension for deleting...');

        fs.readdir(storageDirName, 'utf8', function (err, files) {
            if(err) {
                log.error('Can\'t read ' + storageDirName + ': ' + err.messsage)
                return;
            }

            async.each(files, function (file, callback) {
                // checking for contain extension '.ipc'
                if(file.length < storageFileExtension.length ||
                    file.toLowerCase().indexOf(storageFileExtension.toLowerCase()) !==
                    file.length - storageFileExtension.length
                ) {
                    return callback();
                }

                var filePath = path.join(storageDirName, file);
                fs.stat(filePath, function (err, stats) {
                    if(err) {
                        log.warn('Can\'t stat ' + filePath + ': ' + err.messsage);
                        return callback();
                    }
                    if(!stats.isFile() || stats.birthtimeMs > Date.now() - 3600000) return callback();

                    fs.access(filePath, fs.constants.W_OK, function (err) {
                        if(err) {
                            log.warn('Can\'t get access to ', filePath, ' for delete: ', err.message);
                            return callback();
                        }

                        fs.unlink(filePath, function (err) {
                            if(err) log.warn('Can\'t delete ', filePath, ': ', err.message);
                            else log.warn('Deleting unused file ', filePath);
                            callback();
                        });
                    });
                });
            }, function(err) {
                if(err) log.error(err.message);
                log.info('Complete search unused files in ', storageDirName,
                    ' with "', storageFileExtension, '" extension for deleting');
            });
        });
    }
}