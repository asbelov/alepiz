/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const net = require('net');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const async = require('async');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');

const magic = 'AlPz', version = 1, magicLength = magic.length;
const headerLength = magicLength + 1 + 8;
const maxMessageID = 0xffffffff; // messageID must be >= 0 and <= 4294967295
const maxMessageLen  = 0xffffffff; // 4294967295;
var defaultSocketTimeout = 0;  // Sets the socket to timeout after timeout milliseconds of inactivity on the socket. 0 - disabled
var stopInProgress = 0;
const stopMessage = '__stop_your_child__';
const storageDirName = path.join(__dirname, '..', conf.get('tempDir') || 'temp');
const storageFileExtension = '.ipc';
var IPCClients = new Map();

var IPC = {
    getNewMessageID: getNewMessageID,
    cleanUpCallbackStack: cleanUpCallbackStack,
};

module.exports = IPC;

/**
 * @typedef {object} serverIPC - object returned by IPC.server
 * @property {function(*, [number], [function(Error)|function()])} send send(data, [socketIndex], callback)
 *      send data to the specific in the socketIndex IPC.client. If socketIndex not specific, send data to IPC.clients
 *      in order using round robin algorithm
 * @property {function(*, [function(Error)|function()])} sendToAll sendToAll(data, callback) send data to all connected
 *      IPC.client
 @property {function(*, number, [function(Error)|function(null, *)])} sendAndReceive
 *      sendAndReceive(data, socketIndex, callback) send data and receive answer from specific in the socketIndex
 *      IPC.client
 * @property {function([function()])} stop run stop() the server and disconnect clients
 * @property {function([function()])} destroy fast destroy the server
 */
/**
 * Server part for interprocess communication based on network communications
 *
 * @param {Object} cfg client IPC settings
 * @param {string} cfg.localAddress - IP address for binding server
 * @param {string} cfg.serverPort server TCP port
 * @param {string} cfg.id log file name and storage file name ID
 * @param {number} cfg.keepCallbackInterval max time in ms for waiting answer from sendAndReceive and alloc memory
 *      for callback function. default 1800000
 * @param {number} [cfg.cleanUpCallbacksPeriod] every cleanUpCallbacksPeriod we will clean callbacks. default 36000000
 * @param {number} [cfg.maxSocketErrorsCnt] maximum socket errors before exit(4), default 50
 * @param {number} [cfg.maxSocketErrorsTime] maximum socket time, when errors occurred before exit(4), default 60000
 * @param {number} [cfg.maxSocketErrorsTTL] time to live before reset maxSocketErrorsCnt and maxSocketErrorsTime,
 *      default 60000
 * @param {number} [cfg.restartListenerOnErrorTime] delay between attempts to restart the listener on error, default 5000
 * @param {number} [cfg.socketTimeout] Sets the socket to timeout after timeout milliseconds of inactivity on the
 *      socket. default 0 - disabled
 * @param {number} [cfg.keepAlive] delay between the last data packet received and the first keepalive probe
 *      in milliseconds. Default 5000
 * @param {Boolean} [cfg.exitOnNoClients] exit when no clients are connected. Default false
 * @param {function()|function(Error)|function(null, *, number, function(Error, *))} callback
 *  callback(err, message, socketIndex|-1 when init, function for ClientSendAndReceive(err1, message) {})
 * message - the message returned by the sendAndReceive function running on the IPC.client side
 * socketIndex - connected client ID or -1 when server initialized
 * sendAndReceiveCallback - function to return data for the sendAndReceive function running on the IPC.client side
 * @returns {serverIPC} object with the IPC.client methods
 *
 * @example
 *
 * stop(callback)
 * destroy()
 * send(data, callback(err))
 * send(data, socketIndex, callback(err))
 * sendToAll(data, callback(err))
 * sendAndReceive(data, socketIndex, callback(err, socketIndex, receivedData))
 */

IPC.server = function(cfg, callback) {
    var serverAddress = cfg.serverAddress,
        serverPort = cfg.serverPort,
        localAddress = cfg.localAddress,
        id = cfg.id,
        cleanUpCallbacksPeriod = Number(cfg.cleanUpCallbacksPeriod) === parseInt(cfg.cleanUpCallbacksPeriod, 10) &&
            Number(cfg.cleanUpCallbacksPeriod) ? Number(cfg.cleanUpCallbacksPeriod) : 3600000,
        keepCallbackInterval = Number(cfg.keepCallbackInterval) === parseInt(cfg.keepCallbackInterval, 10) &&
            Number(cfg.keepCallbackInterval) ? Number(cfg.keepCallbackInterval) : 1209600000, // 14 days
        // delay between attempts to restart the listener on error
        restartListenerOnErrorTime = Number(cfg.restartListenerOnErrorTime) ===
            parseInt(cfg.restartListenerOnErrorTime, 10) && Number(cfg.restartListenerOnErrorTime) ?
            Number(cfg.restartListenerOnErrorTime) : 5000,
        // inactivity on the socket
        socketTimeout = Number(cfg.socketTimeout) === parseInt(cfg.socketTimeout, 10) ?
            Number(cfg.socketTimeout) : defaultSocketTimeout,
        maxCallbacksCnt = Number(cfg.maxCallbacksCnt) === parseInt(cfg.maxCallbacksCnt, 10) ?
            Number(cfg.maxCallbacksCnt) : 10000,
        // delay between the last data packet received and the first keepalive probe in milliseconds
        keepAlive = Number(cfg.keepAlive) === parseInt(cfg.keepAlive, 10) && Number(cfg.keepAlive) > 1000 ?
            Number(cfg.keepAlive) : 5000,
        isServerRunning = 0,
        maxAttemptsCnt = 720,  // attempts number for restart IPC server after error occurred. 720 * (restartListenerOnErrorTime) 5 sec = 3600 (one hour)
        attemptsCnt = maxAttemptsCnt,
        server,
        clientsNum = 0,
        prevCallbackStackSize = 0,
        callbackStack = new Map(),
        connectedSockets = new Map(),
        currentSocketIndex = 0,
        messageID,
        stopCallback,
        firstMessageID = 1, // even for client, odd for server
        socketErrorCounter = {};

    socketErrorCounter = setSocketErrorCounter(cfg);

    if(id) id = 'IPC:server:' + id;
    // if(module.parent) {} === if(require.main !== module) {}
    else if(require.main !== module) id = 'IPC:server:' + path.basename(require.main.filename, '.js');
    else id = 'IPC:server';

    const log = require('../serverLog/simpleLog')(id || 'IPC:server');

    // cleanup unused callbacks
    setInterval(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, maxCallbacksCnt, log);
    setInterval(function () {
        const callbackStackSize = callbackStack.size, increase = callbackStackSize - prevCallbackStackSize;
        if(prevCallbackStackSize && callbackStackSize && increase > 0) {
            log.info('Server callback stack size: ', callbackStackSize, ' increase: ', increase);
        }
        prevCallbackStackSize = callbackStackSize
    }, 60000);

    if(cfg.exitOnNoClients === parseInt(cfg.exitOnNoClients, 10) && cfg.exitOnNoClients > 1000) {
        var t1 = setTimeout(function () {
            if(clientsNum) return log.info('Connected ', clientsNum, ' clients. Continue working...');
            log.error('No clients are connected to IPC worker. Exiting after 3 sec...');
            var t2 = setTimeout(process.exit, 3000); // process.exit();
            t2.unref();
        }, cfg.exitOnNoClients);
        t1.unref();
    }

    this.send = function(data, socketIndex, callback) { send(data, socketIndex, 0, false, callback); };

    //round-robin send to children
    this.send = function(data, callback) { send(data, null, 0, false, callback); };

    this.sendToAll = sendToAll;

    this.sendAndReceive = function(data, socketIndex, callback) {
        sendAndReceive(data, socketIndex, false, callback);
    };

    /*
    this.sendAndPermanentReceive = function(data, socketIndex, callback) {
        sendAndReceive(data, socketIndex, true, callback);
    };
     */

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
            var t = setTimeout(send, 1000, data, socketIndex, sentMessageID, permanent, callback);
            t.unref();
            return;
        }

        var socket = connectedSockets.get(socketIndex);
        //if(!socket) return callback();

        if(sentMessageID) {
            callbackStack.set(socket.remotePort + '_' + sentMessageID, {
                timestamp: Date.now(),
                permanent: permanent,
                func: callback
            });
            callback = null;
            //log.info('Add new callback for messageID ', sentMessageID, ', permanent: ', permanent ,', message: ', data);
        }

        dataSender(log,null, socket, data, sentMessageID, callback);
    }

    function sendAndReceive(data, socketIndex, permanent, callback) {
        if(typeof callback !== 'function') return log.error('Can\' run sendAndReceive() function: callback is not set');

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
        // close connections
        setTimeout(function () {
            connectedSockets.forEach(socket => {
                if (socket && !socket.destroyed && typeof socket.destroy === 'function') {
                    log.debug('IPC server stopped and socket destroyed');
                    socket.destroy();
                }
            });
        }, 100);

        // waiting 15 seconds for close connections
        stopWatchDog = setTimeout(function () {
            log.error('Timeout occurred while waiting for server connections to close');
            if(typeof stopCallback === 'function') stopCallback();
        }, 15000);
        stopWatchDog.unref();
    }

    function start() {
        //log.debug('Starting IPC server on ', localAddress, ':', serverPort);

        isServerRunning = Date.now();
        stopInProgress = 0;
        var _socket;

        server = net.createServer(function(socket) {

            _socket = socket;
            var socketIndex = Date.now();
            connectedSockets.set(socketIndex, socket);

            ++clientsNum;
            log.info('Client connected: ', socket.remoteAddress, ':', socket.remotePort, '->',
                (localAddress || '*'), ':', serverPort);
            attemptsCnt = maxAttemptsCnt;

            // Setting true for noDelay will immediately fire off data each time socket.write() is called.
            //socket.setNoDelay(true);

            //Enable keep-alive functionality, and set the initial delay before the first keepAlive probe is sent
            // on an idle socket in milliseconds
            socket.setKeepAlive(true, keepAlive);

            /*
            Sets the socket to timeout after timeout milliseconds of inactivity on the socket.
            By default net.Socket do not have a timeout.
            When an idle timeout is triggered the socket will receive a 'timeout' event but the connection
            will not be severed. The user must manually call socket.end() or socket.destroy() to end the connection.
            If timeout is 0, then the existing idle timeout is disabled.
             */
            socket.setTimeout(socketTimeout);

            socket.on('timeout', function() {
                connectedSockets.delete(socketIndex);
                log.debug('IPC server socket closed due timeout ' + (socketTimeout / 1000) + ' sec' +
                    printConnectionInfo(socket, cfg, true));
                socket.end();
            });

            socket.on('error', function(err) {
                if(stopInProgress) return;
                socketErrorsHandler(new Error('IPC server socket error: ' + err.message +
                        printConnectionInfo(socket, cfg, true)), socketErrorCounter, log);
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
                    log.warn('IPC server: socket closed due to a transmission error to client' +
                        printConnectionInfo(socket, cfg, true));
                }
            });

            socket.on('end', function () {
                connectedSockets.delete(socketIndex);
                if(stopInProgress) return;

                log.debug('IPC server socket closed by peer' + printConnectionInfo(socket, cfg, true));
            });

            dataReceiver(log, socket, function(err, receivedMessageID, result) {
                // same another process is starting and send stop message because it will use this port
                // using exitCode 10 for prevent to restart process by proc.js
                if(result === stopMessage) {
                    log.error('Received message for stopping from another IPC system for ',
                        printConnectionInfo(socket, cfg, true),'. Exiting...');
                    log.exit('Received message for stopping from another IPC system for ',
                        printConnectionInfo(socket, cfg, true), '. Exiting...');
                    process.exit(10);
                }

                var callbackID = socket.remotePort + '_' + receivedMessageID;
                var callbackObj = callbackStack.get(callbackID);
                if (callbackObj && typeof callbackObj.func === 'function') {
                    callbackObj.timestamp = Date.now();
                    //if(callbackObj.removed) log.warn('Callback for messageID ', receivedMessageID, ', message: ', resultStr , ' was removed at ', new Date(callbackObj.removed).toLocaleString());
                    callbackObj.func(err, result, socketIndex);

                    if (!callbackObj.permanent) {
                        //callbackObj.removed = Date.now();
                        callbackStack.delete(callbackID);
                    }
                    return;
                } else {
                    if(receivedMessageID && receivedMessageID % 2 !== 0) // for odd messageIDs
                        log.error('IPCServer: can\'t find callback for messageID ', receivedMessageID, '/', messageID,
                            ', message: "', result, '". callbackObj: ', callbackObj, ': ',
                            printConnectionInfo(socket, cfg, true));
                }

                callback(err, result, socketIndex, function (err1, message) {
                    //log.warn('!!!', receivedMessageID, ' SendBack:', message)
                    if(err1) log.warn(err1.message);
                    // don't send back this message (was called .send() function, not sendAndReceive())
                    if(!receivedMessageID && !message) return;
                    var returnedError = err ?
                        (err1 ? new Error(err.stack + ' AND ' + err1.stack) : err) : (err1 ? err1 : null);
                    dataSender(log, returnedError, socket, message, receivedMessageID);
                });
            });
        });

        // !!!! Server error (f.e. address in use), not a socket error (f.e. transmit error)
        server.on('error', function(err) {
            if(stopInProgress) return;

            var message = 'IPC server error: ' + err.message +
                (attemptsCnt ?
                    ('. ' + attemptsCnt + ' attempts left. Try to restart listener after ' +
                        (restartListenerOnErrorTime / 1000) + ' sec') :
                    '. No attempts left, exiting. ' + printConnectionInfo(_socket, cfg, true));

            callback(new Error(message));

            // exit code 4 means nothing and reserved for IPC
            if(!attemptsCnt--) {
                log.error(message);
                log.exit(message);
                process.exit(4);
            } else log.warn(message);

            // sending a stop message to another process that is listening on this port
            connectAndSendMessage(serverAddress, serverPort, localAddress, stopMessage, function(err) {
                if(!err) { // message sent successfully
                    log.warn('Another process is listening on ' + localAddress + ':' + serverPort +
                        '. Stop message sent successfully, restarting socket listener');
                }

                // waiting while process exiting and restart socket listener
                var t = setTimeout(function() {
                    stop(function(err) {
                        if(err) log.error(err.message);
                        start();
                    })
                }, restartListenerOnErrorTime);
                t.unref();
            });
        });

        server.listen({
            host: localAddress,
            port: serverPort,
            exclusive: true,
        }, function() {
            log.info('Server started at ', (localAddress || '*') , ' and bound to TCP port ', serverPort);
            callback(null, null, -1); // send -1 as socketIndex
        });
    }
};

/*
 return err:
 if error occurred when connecting
 if connection timeout occurred after 3 sec
 if send message error
 */
function connectAndSendMessage (serverAddress, serverPort, localAddress, message, callback) {

    var socket = net.connect({
        host: serverAddress,
        port: serverPort,
        localAddress: localAddress || undefined
    });

    socket.setTimeout(3000);

    const log = require('../serverLog/simpleLog')('connectAndSendMessage ' + serverAddress + ':' + serverPort);
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
}

/**
 * @typedef {object} sendExtOptions - options for the sendExt IPC.client function
 * @property {boolean} sendAndReceive send data to the IPC.server and wait for receive answer using callback(err, receivedData)
 * @property {boolean} permanent send data once and permanent receive answers from the server using callback(err, receivedData)
 * @property {boolean} dontSaveUnsentMessage if not connected or disconnected from the IPC.server. don't save unsent data for
 *  send it after connection
 */


/**
 * @typedef {object} clientIPC - object returned by IPC.client
 * @property {function(): boolean} isConnected return connection status to server (true|false)
 * @property {function(): {destroyed: boolean, pending: boolean, connecting: boolean}|undefined} getSocketStatus
 *  return object with socket status like
 *  {pending: socket.pending, destroyed: socket.destroyed, connecting: socket.connecting} or undefined if socket
 *  was not initialised.
 * @property {function([function()])} stop run onStop() function if exist, than run disconnect() method
 * @property {function([function()])} disconnect disconnect from the IPC.server
 * @property {function([function()])} destroy alias to the disconnect method
 * @property {function(*, [function(Error)|function()])} send send data to the IPC.server
 * @property {function(*, function(Error)|function(null, *))} sendAndReceive send data to the IPC.server and receive answer using
 *  callback(err, receivedData) function
 * @property {function(*, [sendExtOptions], [function(Error)|function(null, *)])} sendExt send or sendAndReceive data to
 *  the IPC.server. If options sendAndReceive is set, then wait and receive answer from IPC.server using
 *  callback(err, receivedData). options is a {sendAndReceive: true|false, permanent: {true|false},
 *  dontSaveUnsentMessage: {true|false}}
 */
/**
 * Client part for interprocess communication based on network communications
 *
 * @param {Object} cfg client IPC settings
 * @param {string} cfg.serverAddress server IP or hostname to connect to
 * @param {number} cfg.serverPort server port to connect to
 * @param {string} cfg.localAddress the local IP address to bind to when initializing communication with the server.
 *  Can be null for automatic selection
 * @param {string} [cfg.id] the ID in the log file and the file name of the unsent package storage
 * @param {string} [cfg.suffix] suffix for automatic generated ID
 * @param {boolean} [cfg.separateStorageByProcess=true] adds the pid of the process to the name
 *  of the storage file with unsent packets. This is necessary to prevent unsent messages from being sent from
 *  the storage file after an exception and restart. Default true.
 * @param {number} [cfg.maxUnsentMessagesCnt=5000] the maximum number of unsent messages that are stored in memory
 *  before saving to storage. Default 5000
 * @param {number} [cfg.keepCallbackInterval=1800000] the maximum time in ms to wait for a response from sendAndReceive()
 *  and store callback functions in memory. After the timeout expires, the callback will be deleted from memory.
 *  By default 1800000
 * @param {number} [cfg.maxSocketErrorsCnt=50] the maximum number of socket errors that should occur during the
 *      maxSocketErrorsTime after which the process will be completed with error code 4. Default 50
 * @param {number} [cfg.maxSocketErrorsTime=60000] if the maxSocketErrorsCnt number of socket errors occurs during the
 *      specified time, the process will terminate with error code 4, by default 60000
 * @param {number} [cfg.maxSocketErrorsTTL=300000] if there were no socket errors during this time, the socket error counter
 *  will be reset. By default 300000
 * @param {number} [cfg.maxReconnectAttempts] the maximum number of reconnections before exiting with the error code 4.
 *  If not specified, the maxReconnectAttempts parameter from common.json is used. 0 - infinite
 * @param {function(callback)} [cfg.onStop] function to run before calling the methods stop(), destroy() and disconnect()
 * @param {number} [cfg.reconnectDelay=5000] the delay between the attempt to reconnect to the server during disconnection
 *      in milliseconds, by default 5000, 0 - not reconnecting
 * @param {boolean} [cfg.connectOnDemand=false] if true, the connection to the server will be established when data needs
 *  to be sent. Otherwise, the connection to the server is established during initialization. Default false
 * @param {number} [cfg.socketTimeout=0] Sets socket timeout after milliseconds of socket inactivity by timeout.
 *  Default 0 - disabled
 * @param {number} [cfg.keepAlive=5000] delay between the last data packet received and the first keepalive probe in ms
 * @param {number} [cfg.connectionTimeout=5000] Sets the socket connection timeout in ms. If a reconnection timeout
 *  is set, a reconnection attempt will be made after the connection timeout expires. Default 5000. 0 - disabled
 * @param {number} [cfg.maxCallbacksCnt=10000] maximum number of callback, after that old callbacks will be cleaned
 * @param {number} [cfg.cleanUpCallbacksPeriod=3600000] how many time IPC will keep not used callback. Default 3600000
 * @param {function()|function(Error)|function(null, null, clientIPC: Object)|
 *  function(Error, message: Object, null, sendAndReceiveCallback: function(Error, message: object))} callback
 * full list of parameters is a function(err, message, clientIPC, sendAndReceiveCallback), where
 * message - the message returned by the sendAndReceive function running on the IPC.client side
 * clientIPC - object with the IPC.client methods
 * sendAndReceiveCallback - function to return data for the sendAndReceive function running on the IPC.server side
 * @returns {clientIPC} object with the IPC.client methods
 *
 * @example
 *
 * isConnected(): return connection status to server (true|false)
 * stop() = destroy() = disconnect()
 * send(data, callback(err))
 * sendAndReceive(data, callback(err, receivedData))
 * sendExt(data, options, callback(err, receivedData))
 * options = {sendAndReceive: (true|false, permanent: {true|false}, dontSaveUnsentMessage: {true|false})}
 */
IPC.client = function(cfg, callback) {
    var serverAddress = cfg.serverAddress,
        serverPort = cfg.serverPort,
        hostPort = serverAddress + ':' + serverPort;

    // prevents repeated connections to the server
    if(IPCClients.has(hostPort)) {
        var prevReturnedObject = IPCClients.get(hostPort);
        callback(null, null, prevReturnedObject);
        return prevReturnedObject;
    }

    var localAddress = cfg.localAddress,
        id = cfg.id,
        storageFileSuffix = cfg.separateStorageByProcess || cfg.separateStorageByProcess === undefined ?
            '_' + process.pid : '',
        cleanUpCallbacksPeriod = Number(cfg.cleanUpCallbacksPeriod) ===
            parseInt(String(cfg.cleanUpCallbacksPeriod), 10) &&
            Number(cfg.cleanUpCallbacksPeriod) ? Number(cfg.cleanUpCallbacksPeriod) : 3600000,
        keepCallbackInterval = Number(cfg.keepCallbackInterval) ===
            parseInt(String(cfg.keepCallbackInterval), 10) && Number(cfg.keepCallbackInterval) ?
            Number(cfg.keepCallbackInterval) : 1209600000, // 14 days
        maxUnsentMessagesCnt = Number(cfg.maxUnsentMessagesCnt) ===
            parseInt(String(cfg.maxUnsentMessagesCnt), 10) && Number(cfg.maxUnsentMessagesCnt) ?
            Number(cfg.maxUnsentMessagesCnt) : 5000,
        delayBeforeReconnect = Number(cfg.reconnectDelay) === parseInt(String(cfg.reconnectDelay), 10) ?
            Number(cfg.reconnectDelay) : 5000,
        connectOnDemand = cfg.connectOnDemand,
        // inactivity on the socket
        socketTimeout = Number(cfg.socketTimeout) === parseInt(String(cfg.socketTimeout), 10) ?
            Number(cfg.socketTimeout) : defaultSocketTimeout,
        connectionTimeout = Number(cfg.connectionTimeout) === parseInt(String(cfg.connectionTimeout), 10) ?
            Number(cfg.connectionTimeout) : 5000,
        maxCallbacksCnt = Number(cfg.maxCallbacksCnt) === parseInt(String(cfg.maxCallbacksCnt), 10) ?
            Number(cfg.maxCallbacksCnt) : 10000,
        keepAlive = Number(cfg.keepAlive) === parseInt(String(cfg.keepAlive), 10) &&
        Number(cfg.keepAlive) > 1000 ? Number(cfg.keepAlive) : 5000,

        writableStorageStream,
        storageFD,
        socket,
        disconnectionInProgress = false,
        isIPCObjectReturned = false,
        unsentMessagesCnt = 0,
        savedMessagesCnt = 0,
        prevSendErrorMessage = '',
        processedUnsentData = false,
        unsentData = new Set(),
        prevCallbackStackSize = 0,
        callbackStack = new Map(),
        connectCallbackStack = new Set(),
        reconnectAttempts = 0,
        messageID,
        firstMessageID = 2, // even for client, odd for server
        connectTimeoutTimer = null,
        reconnectTimer,
        initTime = Date.now(),
        socketErrorCounter = {};

    socketErrorCounter = setSocketErrorCounter(cfg);

    if(id) id = 'IPC:client:' + id;
    else if(require.main !== module) { // if(module.parent) {} === if(require.main !== module) {}
        if(module.parent.parent) {
            id = 'IPC:client:' + path.basename(module.parent.parent.filename, '.js');
        } else id = 'IPC:client:' + path.basename(require.main.filename, '.js');
    } else id = 'IPC:client';

    if(cfg.suffix) id += cfg.suffix;

    const log = require('../serverLog/simpleLog')(id || 'IPC:client');
    var storageFileName = path.join(storageDirName,
        id.replace(/:/g, '_') + storageFileSuffix + storageFileExtension);

    // cleanup unused callbacks
    setInterval(cleanUpCallbackStack, cleanUpCallbacksPeriod, callbackStack, keepCallbackInterval, maxCallbacksCnt, log);
    setInterval(function () {
        const callbackStackSize = callbackStack.size, increase = callbackStackSize - prevCallbackStackSize;
        if(prevCallbackStackSize && callbackStackSize && increase > 0) {
            log.info('Client callback stack size: ', callbackStackSize, ' increase: ', increase);
        }
        prevCallbackStackSize = callbackStackSize
    }, 60000);

    //!!! dont replace 'returnedObject' to 'this'. 'returnedObject' masts return by callback
    var returnedObject = {
        send: function(data, callback) { send(data, 0, {}, callback) },

        sendAndReceive: function(data, callback) {
            if(typeof callback !== 'function') {
                return log.error('Can\' run sendAndReceive() function: callback is not set');
            }

            messageID = getNewMessageID(messageID, firstMessageID);
            send(data, messageID, {sendAndReceive: true}, callback);
        },

        sendExt: function(data, sendExtOptions, callback) {
            var myMessageID = 0;
            if(sendExtOptions && sendExtOptions.sendAndReceive) {
                messageID = getNewMessageID(messageID, firstMessageID);
                myMessageID = messageID;
            }

            send(data, myMessageID, sendExtOptions, callback);
        },

        stop: stop,
        destroy: disconnect,
        disconnect: disconnect,

        isConnected: function () {
            return socket && !socket.pending && !socket.destroyed && !socket.connecting
        },

        getSocketStatus: function () {
            if(!socket) return;
            return {
                pending: socket.pending,
                destroyed: socket.destroyed,
                connecting: socket.connecting,
            }
        },
    }

    IPCClients.set(hostPort, returnedObject);

    if(socket && !socket.pending && !socket.destroyed) return callback();

    if(connectOnDemand) {
        if(!isIPCObjectReturned) {
            isIPCObjectReturned = true;
            callback(null, null, returnedObject);
        }
    } else connect();

    return returnedObject;

    function disconnect (callback) {
        disconnectionInProgress = true;

        if(connectTimeoutTimer !== null) {
            clearTimeout(connectTimeoutTimer);
            connectTimeoutTimer = null;
        }
        if(!socket || socket.destroyed) {
            if(typeof callback === 'function') callback();
            return;
        }

        var info = ': received "disconnect" or "destroy"';
        if(stopInProgress) info = ': received "stop"';

        // save server info for print to log after disconnect
        info = printConnectionInfo(socket, cfg) + info;
        socket.end(function () {
            log.info('Disconnected', info);
            if(typeof socket.destroy === 'function' && !socket.destroyed) socket.destroy();
            if(typeof callback === 'function') callback();
        })
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

    function send (data, sentMessageID, sendExtOptions, callback) {

        //log.warn('!!!', sentMessageID, ' Send:', sendExtOptions, ';', data);

        // here try to connect. f.e. when connectOnDemand = true.
        connect(function() {

            // save callback before it stay null
            var savedCallback = callback;
            if(sendExtOptions.sendAndReceive && typeof callback === 'function') {
                callbackStack.set(sentMessageID, {
                    timestamp: Date.now(),
                    options: sendExtOptions,
                    func: callback
                });
                callback = null;
                //log.info('Add new callback for messageID ', sentMessageID, ', sendExtOptions: ', sendExtOptions ,', message: ', data);
            }

            if(socket && !socket.pending && !socket.connecting && !socket.destroyed) {
                dataSender(log,null, socket, data, sentMessageID, function(err) {
                    if(!err || sendExtOptions.dontSaveUnsentMessage) {
                        // run callback when no response is expected to be sent
                        // it is equal to if(!sendExtOptions.sendAndReceive || typeof savedCallback !== 'function') savedCallback();
                        if(typeof callback === 'function') callback(err);
                        else if(err) log.warn(err.message);
                        return;
                    }

                    saveUnsentData({data: data, messageID: sentMessageID, options: sendExtOptions}, err,
                        function (err1) {
                            var commonErr = err1 ?
                                (new Error(err.message + ' and ' + err1.message)) :
                                (new Error(err.message + '. Save ' + (savedMessagesCnt + 1) + ' message to send later'));

                            // run callback when no response is expected to be sent
                            // it is equal to if(!sendExtOptions.sendAndReceive || typeof savedCallback !== 'function') savedCallback();
                            if(typeof callback === 'function') callback(commonErr);
                        });
                });
                return;
            }

            // !socket: before the first connection attempt even if the dontSaveUnsentMessage is true,
            // save unsent messages and try to send them after connection
            if(!sendExtOptions.dontSaveUnsentMessage || !socket) {

                saveUnsentData({data: data, messageID: sentMessageID, options: sendExtOptions}, null,
                    function (err) {
                        if (err) log.warn(err.message);

                        // run callback when no response is expected to be sent
                        // it is equal to if(!sendExtOptions.sendAndReceive || typeof savedCallback !== 'function') savedCallback();
                        if(typeof callback === 'function') callback();
                    });
            } else {
                // the callback could have been set to null or it could have been undefined
                if(typeof savedCallback === 'function') {
                    if(sendExtOptions.sendAndReceive) callbackStack.delete(sentMessageID);
                    savedCallback();
                }
                log.warn('Can\'t send message to ', printConnectionInfo(socket, cfg),
                    ': not connecting. ',
                    (socket ?
                        'Socket pending: ' + socket.pending + '; connecting: ' + socket.connecting +
                        '; destroyed: ' + socket.destroyed : 'Connection was not started'));
            }
        });
    }

    function connect(connectCallback) {

        // already connected
        if(socket && !socket.pending && !socket.connecting && !socket.destroyed) {
            if(typeof connectCallback === 'function') connectCallback();
            return;
        }

        // socket.connecting true if socket.connect() was called and has not yet finished.
        // It will stay true until the socket becomes connected.
        if(typeof connectCallback === 'function') {
            connectCallbackStack.add({
                timestamp: Date.now(),
                callback: connectCallback,
            });
        }

        if(connectionTimeout && connectTimeoutTimer === null) {
            connectTimeoutTimer = setTimeout(function () {
                // returns the IPC object when the connection timeout expires to prevent blocking of
                // the calling function
                if(!isIPCObjectReturned) {
                    isIPCObjectReturned = true;
                    callback(null, null, returnedObject);
                }

                connectCallbackStack.forEach(callbackObj => {
                    if(typeof callbackObj.callback === 'function') callbackObj.callback()
                    connectCallbackStack.delete(callbackObj);
                });
                connectCallbackStack.clear();

                if(connectTimeoutTimer !== null) {
                    clearTimeout(connectTimeoutTimer);
                    connectTimeoutTimer = null;
                }

                if(stopInProgress || disconnectionInProgress || !socket) return;

                var maxEventListenersCnt = socket.getMaxListeners();
/*
In the timer collector, a warning similar to that for "finish" or "error" events appeared here.
Increasing the number of possible event listeners up to 1000 to prevent this warnings in exit.log

19.06.2023, 10:27:43[D:\ALEPIZ\server\child\getCountersValue.js17476]: WARNING: MaxListenersExceededWarning:
      Possible EventEmitter memory leak detected. 11 error listeners added to [Socket]. Use emitter.setMaxListeners()
      to increase limit
    at _addListener (events.js:450:17)
    at Socket.prependListener (events.js:473:14)
    at onFinished (internal/streams/writable.js:692:10)
    at Socket.Writable.end (internal/streams/writable.js:594:7)
    at Socket.end (net.js:592:31)
    at Timeout.<anonymous> (D:\ALEPIZ\lib\IPC.js:846:28) => socket.end(() => {......
    at listOnTimeout (internal/timers.js:557:17)
    at processTimers (internal/timers.js:500:7)
 */
                if(maxEventListenersCnt < 1000) {
                    socket.eventNames().forEach(eventName => {
                        var eventsListenersCnt = socket.listenerCount(eventName);

                        if (eventsListenersCnt >= maxEventListenersCnt) {
                            log.error('MaxListenersExceededWarning: Possible EventEmitter memory leak detected.',
                                eventsListenersCnt, ' "', eventName,
                                '" listeners added to [Socket]. Increasing limit to ', eventsListenersCnt + 5);
                            socket.setMaxListeners(eventsListenersCnt + 5);
                            maxEventListenersCnt = socket.getMaxListeners();
                        }
                    });
                }
                /* else will be printed warning to the exit.log, like
                WARNING: MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 1001 error
                listeners added to [Socket]. Use emitter.setMaxListeners() to increase limit
                */

                socket.end(() => {
                    log.debug('IPC connect: timeout ', (connectionTimeout / 1000), 'sec occurred.')
                    if (!socket || socket.destroyed) return;
                    socket.destroy(new Error('IPC connect: timeout ' + (connectionTimeout / 1000) +
                        'sec occurred.'))
                    // error will be printed when 'error' event occurs at socket.on('error', function(err) {..}).
                    // reconnection to the server will be started when the 'close' event occurs,
                    // because socket.destroy() was called
                });

            }, connectionTimeout);
            connectTimeoutTimer.unref();
        }

        // connection in progress
        if(socket && socket.connecting) return;

        disconnectionInProgress = false;

        if(socket && !socket.destroyed) {
            log.debug('Destroy socket before connect: pending: ', socket.pending, '; connecting: ', socket.connecting,
                '; destroyed: ', socket.destroyed);
            socket.destroy();
        }

        socket = net.connect({
            host: serverAddress,
            port: serverPort,
            localAddress: localAddress
        });

        stopInProgress = 0;

        var maxReconnectAttempts =
            cfg.maxReconnectAttempts === undefined ?
                parseInt(conf.get('IPCClientMaxReconnectAttempts'), 10) :
                parseInt(String(cfg.maxReconnectAttempts), 10);
        if(reconnectAttempts) {
            log.info('Reconnect to ' + hostPort +
                ', attempts ' , String(reconnectAttempts++),
                (maxReconnectAttempts ? '/' + maxReconnectAttempts : ''),
                ', interval ', delayBeforeReconnect / 1000, 'sec');
        }

        if(maxReconnectAttempts && reconnectAttempts >= maxReconnectAttempts) {
            log.error('Maximum attempts (', reconnectAttempts + 1, ') to reconnect to IPC server ',
                printConnectionInfo(socket, cfg) ,' occurred. Exiting');
            log.exit('Maximum attempts (' + reconnectAttempts + 1 + ') to reconnect to IPC server ',
                printConnectionInfo(socket, cfg), 'occurred. Exiting');
            // exit code 4 means nothing and reserved for IPC
            process.exit(4);
        }

        clearTimeout(reconnectTimer);
        reconnectTimer = null;

        // Setting true for noDelay will immediately fire off data each time socket.write() is called.
        //socket.setNoDelay(true);

        //Enable keep-alive functionality, and set the initial delay before the first keepAlive probe is sent on an
        // idle socket in milliseconds
        socket.setKeepAlive(true, keepAlive);

        /*
        Sets the socket to timeout after timeout milliseconds of inactivity on the socket.
        By default net.Socket do not have a timeout.
        When an idle timeout is triggered the socket will receive a 'timeout' event but the connection
        will not be severed. The user must manually call socket.end() or socket.destroy() to end the connection.
        If timeout is 0, then the existing idle timeout is disabled.
        */
        socket.setTimeout(socketTimeout);

        socket.on('connect', function () {
            if (connectTimeoutTimer !== null) {
                clearTimeout(connectTimeoutTimer);
                connectTimeoutTimer = null;
            }

            //IPC server print this information before IPC client
            if (reconnectAttempts > 1 || unsentMessagesCnt || connectOnDemand) {
                log.info('Client connected', printConnectionInfo(socket, cfg),
                    (reconnectAttempts ? ' with ' + (reconnectAttempts + 1) + ' attempts' : ''),
                    (connectOnDemand ? ' on demand' : ''),
                    (unsentMessagesCnt ? '. Send ' + unsentMessagesCnt + ' unsent messages' : '')
                    , '; pending: ', socket.pending, '; connecting: ', socket.connecting, '; destroyed: ', socket.destroyed
                    , '. Connected to:\n', Array.from(IPCClients.keys()).join('\n')
                );
            }

            reconnectAttempts = 0;

            sendUnsentData(function (err) {
                if (err) log.warn(err.message);
            });

            connectCallbackStack.forEach(callbackObj => {
                if (typeof callbackObj.callback === 'function') callbackObj.callback();
                connectCallbackStack.delete(callbackObj);
            });
            connectCallbackStack.clear();

            // return IPC object only one time
            if (!isIPCObjectReturned) {
                isIPCObjectReturned = true;
                callback(null, null, returnedObject);
            }
        });

        socket.on('error', function (err) {
            if (stopInProgress || disconnectionInProgress) return;

            if (Date.now() > initTime) {
                socketErrorsHandler(new Error('IPC client socket error: ' + err.message + '.' +
                    printConnectionInfo(socket, cfg, false, delayBeforeReconnect)), socketErrorCounter, log);
            }

            // don't try to reconnect because the 'close' event with reconnect
            // will be called directly following this event.
        });

        // Emitted if the socket times out from inactivity.
        // This is only to notify that the socket has been idle. The user must manually close the connection.
        socket.on('timeout', function () {
            if (stopInProgress || disconnectionInProgress) return;

            socket.end(() => {
                log.debug('IPC socket timeout ',  (socketTimeout / 1000), 'sec occurred.');
                if(!socket.destroyed) {
                    socket.destroy(new Error('IPC socket timeout ' + (socketTimeout / 1000) + 'sec occurred.'))
                }
            });
            // error will be printed when socket 'error' event occurs
            // reconnection to the server will be started when the 'close' event occurs,
            // because socket.destroy() was called
        });

        // 'close' event also will be called after 'error' event with hadError = true
        socket.on('close', function (hadError) {
            if (stopInProgress || disconnectionInProgress) return;

            if (Date.now() > initTime && !hadError) {
                log.warn('IPC client socket closed ' +
                    printConnectionInfo(socket, cfg, false, delayBeforeReconnect));
            }

            if (delayBeforeReconnect && !reconnectTimer) {
                reconnectTimer = setTimeout(function () {
                    // start to calculate reconnect attempts
                    if (!reconnectAttempts) reconnectAttempts = 1;
                    if(!socket.destroyed) {
                        log.debug('Destroy socket before reconnect: pending: ', socket.pending,
                            '; connecting: ', socket.connecting, '; destroyed: ', socket.destroyed);
                        socket.destroy();
                    }
                    connect();
                }, delayBeforeReconnect);
                reconnectTimer.unref();
            }
        });

        socket.on('end', function () {
            log.debug('IPC client socket closed')
            if (stopInProgress || disconnectionInProgress) return;
            if(!socket.destroyed) {
                socket.destroy(new Error('IPC client socket closed'));
            }
            // error will be printed when socket 'error' event occurs
            // reconnection to the server will be started when the 'close' event occurs,
            // because socket.destroy() was called
        });

        dataReceiver(log, socket, function (err, receivedMessageID, result) {

            var callbackObj = callbackStack.get(receivedMessageID);
            if (callbackObj && typeof callbackObj.func === 'function') {
                //if(callbackObj.removed) log.warn('Callback for messageID ', messageID, ', message: ', result, ' was removed at ', new Date(callbackObj.removed).toLocaleString());
                callbackObj.timestamp = Date.now();
                callbackObj.func(err, result);
                if (!callbackObj.options.permanent) {
                    //callbackObj.removed = Date.now();
                    callbackStack.delete(receivedMessageID);
                }
                return;
            } else {
                if (receivedMessageID && receivedMessageID % 2 === 0) // for even messageIDs
                    log.error('IPCClient: can\'t find callback for messageID ', receivedMessageID, '/', messageID,
                        ', message: "', result, '". callbackObj: ', callbackObj,
                        ': ', printConnectionInfo(socket, cfg, false));
            }

            // return received message
            callback(err, result, null, function (err1, message) {
                if (err1) log.warn(err1.message);
                var returnedError = err ?
                    (err1 ? new Error(err.stack + ' AND ' + err1.stack) : err) : (err1 ? err1 : null);
                dataSender(log, returnedError, socket, message, receivedMessageID);
            });
        });
    }

    function saveUnsentData(data, err, callback) {
        ++unsentMessagesCnt;
        unsentData.add(data);

        if ((err && err.message !== prevSendErrorMessage) || savedMessagesCnt < 5 || savedMessagesCnt % 100 === 0) {
            if(err) prevSendErrorMessage = err.message;
            log.warn('Not connected', printConnectionInfo(socket, cfg),
                '. Save ', (savedMessagesCnt + 1), ' message to send later ',
                (socket ?
                    'Socket pending: ' + socket.pending + '; connecting: ' + socket.connecting +
                    '; destroyed: ' + socket.destroyed : 'Connection was not started'),
                (err ? (': ' + err.message) : '') );
        }
        if(unsentData.size < maxUnsentMessagesCnt) return callback();

        try {
            var bufferedData = Buffer.from(JSON.stringify(Array.from(unsentData)));
            var messageCnt = unsentData.size;
            unsentData.clear();
        } catch(err) {
            return callback(new Error('Can\'t stringify data for save unsent message: ' + err.message));
        }

        if(!bufferedData || !bufferedData.length || bufferedData.length > maxMessageLen) {
            log.warn('Can\'t send data. Unsent message wrong or too long: ', bufferedData.length, '/ ',
                maxMessageLen, ': ', bufferedData.toString('utf8', 0, 512) + '... ',
                printConnectionInfo(socket, cfg, false));
        }

        zlib.brotliCompress(bufferedData, function(err, compressedData) {
            if(err) return callback(new Error('Can\'t compress data: ' + err.message));

            var message = Buffer.alloc(4);
            message.writeUInt32LE(compressedData.length, 0);
            message = Buffer.concat([message, compressedData]);

            if(!writableStorageStream) {
                if(fs.existsSync(storageFileName)) {
                    log.warn('File ' + storageFileName +
                        ' is existed before create a new writable stream to this file. Try to truncate file. ',
                        printConnectionInfo(socket, cfg, false));
                }
                //{flags: 'w', autoClose: true}.
                // 'w': Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
                writableStorageStream = fs.createWriteStream(storageFileName);

                writableStorageStream.on('error', (err) => {
                    writableStorageStream = null;
                    log.warn('Error with save unsent IPC data to ', storageFileName, ': ', err.message,
                        ': ', printConnectionInfo(socket, cfg, false));
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
            log.info('Saving ', savedMessagesCnt, ' messages to ', storageFileName, ': ',
                printConnectionInfo(socket, cfg, false));
            if(socket && !socket.pending && !socket.destroyed && !socket.connecting &&
                savedMessagesCnt + unsentData.size === unsentMessagesCnt) {
                sendUnsentData(function(err) {
                    if(err) log.warn(err.message);
                });
            }

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
            log.info('Sending unsent '+ savedMessagesCnt + ' messages from ' + storageFileName + ', size: ' +
                fs.statSync(storageFileName).size + 'B. ', printConnectionInfo(socket, cfg, false));
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
            if(!storageFD) {
                return callback(new Error('The storage ' + storageFileName +
                    ' is not initialized or closed for reading size of the compressed data. storageFD: ' + storageFD));
            }

            fs.read(storageFD, sizeBuf, 0, 4, filePos,
                function (err, bytesRead, sizeBuf) {
                if(err) return callback(new Error('Can\'t read data size from ' + storageFileName + ': ' + err.message));

                if(!bytesRead || bytesRead !== 4) {
                    continueReading = false;
                    return callback();
                }

/*
add check for dataSize > 2147483647 because receive error:

PID: 83440 [thread:getCountersValue-zabbix-active-trapper]
Stack: RangeError [ERR_OUT_OF_RANGE]: The value of "length" is out of range. It must be >= 0.
Received -2103406993
at Object.read (fs.js:554:3)
at D:\ALEPIZ\lib\IPC.js:836:20 (fs.read(storageFD, compressedData, 0, dataSize, filePos + 4, function...))
at FSReqCallback.wrapper [as oncomplete] (fs.js:561:5)
 */
                var dataSize = sizeBuf.readUInt32LE(0);
                if(dataSize <= 0 || dataSize > 2147483647) {
                    return callback(new Error('An invalid data size value (' + dataSize + ') was read from ' +
                        storageFileName));
                }

                try {
                    var compressedData = Buffer.alloc(dataSize);
                } catch (e) {
                    return callback(new Error('Possible error occurred while reading data size from ' + storageFileName +
                        ': can\'t allocate buffer for compressed data with size: ' + dataSize + ': ' + e.message));
                }


                if(!storageFD) {
                    return callback(new Error('The storage ' + storageFileName +
                        ' is not initialized or closed for reading compressed data. storageFD: ' + storageFD));
                }

                fs.read(storageFD, compressedData, 0, dataSize, filePos + 4,
                    function (err, bytesRead, compressedData) {
                    if(err) {
                        return callback(new Error('Can\'t read data ' + dataSize + 'B from ' + storageFileName +
                            ': ' + err.message));
                    }

                    if(!bytesRead || bytesRead !== dataSize) {
                        return callback(new Error('Can\'t read unsent data (' + dataSize + 'B) from ' + storageFileName +
                            ': available only ' + bytesRead + '/' + dataSize + ' for reading.'));
                    }

                    filePos += dataSize + 4;

                    //log.debug('Read data size: ', dataSize,'B: ', compressedData);
                    zlib.brotliDecompress(compressedData, function (err, stringifiedData) {
                        if(err) {
                            return callback(new Error('Can\'t decompress unsent data from ' + storageFileName +
                                ': ' + err.message));
                        }

                        try {
                            var unsentDataFromStorage = JSON.parse(stringifiedData.toString('utf8'));
                        } catch (e) {
                            return callback(new Error('Can\'t parse unsent stringified data: ' + e.message +
                                '; Data: ' + stringifiedData));
                        }

                        if(!socket || socket.pending || socket.destroyed || socket.connecting) return callback();

                        sentMessagesCnt += unsentDataFromStorage.length;
                        async.eachSeries(unsentDataFromStorage, function (dataObj, callback) {
                            send(dataObj.data, dataObj.messageID, dataObj.options, callback);
                        }, function(err) {
                            log.info('Reading ', (err ? 'but not sending ': 'and sending '), unsentDataFromStorage.length,
                                ' (total: ', sentMessagesCnt, ') messages (compressed/decompressed size:',
                                dataSize, 'B/', stringifiedData.length, 'B) from ', storageFileName,
                                ': ', printConnectionInfo(socket, cfg, false));
                            if(err) log.warn('Error while sending messages: ', err.message);
                            callback();
                        });
                    });
                });
            });
        }, function (err) {

            if(storageFD) {
                log.info('Sent ', sentMessagesCnt, ' messages form ', storageFileName,
                    ': ', printConnectionInfo(socket, cfg, false));
                fs.close(storageFD, function (err) {
                    if(err) log.warn('Can\'t close ', storageFileName, ': ', err.message);

                    storageFD = null;

                    fs.unlink(storageFileName, function (err) {
                        if (err || fs.existsSync(storageFileName)) {
                            log.warn('Can\'t delete file ', storageFileName, ' with unsent data: ',
                                (err ? err.message : 'There was no error deleting the file, but the file still exists'),
                                ': ', printConnectionInfo(socket, cfg, false));
                        } else {
                            log.info('Successfully deleting file with unsent data ', storageFileName,
                                ': ', printConnectionInfo(socket, cfg, false));
                        }
                    });
                });
            }

            if(unsentData.size) {
                //log.info('Sending unsent ', unsentData.size, ' messages from memory');
                let copyUnsentData = new Set(unsentData);
                unsentData.clear();
                copyUnsentData.forEach(function (dataObj) {
                    send(dataObj.data, dataObj.messageID, dataObj.options);
                });
            }
            unsentMessagesCnt = savedMessagesCnt = 0;
            processedUnsentData = false;
            prevSendErrorMessage = '';
            return callback(err);
        });
    }
};

function printConnectionInfo(socket, cfg, forServer, delayBeforeReconnect) {

    var info = (forServer && cfg ? cfg.localAddress : cfg.serverAddress) + ':' + cfg.serverPort;
    if(socket) {
        if (forServer && socket.remoteAddress) {
            info = socket.remoteAddress + ':' + socket.remotePort + '->' + info;
        } else if (!forServer && socket.localAddress) {
            info = socket.localAddress + ':' + socket.localPort + '->' + info;
        }
    }

    if(delayBeforeReconnect) {
        info += ', reconnecting after ' + (delayBeforeReconnect / 1000) + 'sec';
    }
    return ' ' + info;
}

// create new messageID form process pid * 0x10000 plus previous message ID + 2
// even for client, odd for server
// must be >= 0 and <= 0xffff
function getNewMessageID(messageID, firstMessageID) {
    //var id = messageID ? messageID % 0x10000 : firstMessageID - 2;
    //id = id < maxMessageID-1 ? id + 2 : firstMessageID;
    //return process.pid * 0x10000 + id;
    return (messageID && messageID < maxMessageID - 1 ? messageID + 2 : firstMessageID);
}

function dataSender(log, err, socket, data, sentMessageID, callback) {

    try {
        var stringifiedData = JSON.stringify({
            data: data,
            err: err && err.stack ? err.stack : err
        });

        if(!stringifiedData || !stringifiedData.length || stringifiedData.length > maxMessageLen) {
            err1 = new Error('Can\'t send data. Message too long: ' + stringifiedData.length + '/ ' +
                maxMessageLen+ ': ' + stringifiedData.substring(0, 512) + '...');
            log.error(err1.message);
            var preparedData = Buffer.from(JSON.stringify({
                data: null,
                err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
            }));
        } else preparedData = Buffer.from(stringifiedData);
    } catch(err) {
        var err1 = new Error('Can\'t stringify sending data: ' + err.message);
        log.error(err1.message);
        preparedData = Buffer.from(JSON.stringify({
            data: null,
            err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
        }));
    }

    if(preparedData.length > maxMessageLen) {
        err1 = new Error('Can\'t send data. Message too long: ' + preparedData.length + '/ ' +
            maxMessageLen+ ': ' + preparedData.toString('utf8', 0, 512) + '...');
        log.error(err1.message);
        preparedData = Buffer.from(JSON.stringify({
            data: null,
            err: err && err.stack ? (err.stack + ' AND ' + err1.stack) : err1.stack
        }));
    }

    var message = Buffer.from(magic + '.........');
    message.writeInt8(version, 4);
    message.writeUInt32LE(preparedData ? preparedData.length : 0, 5);
    message.writeUInt32LE(sentMessageID === undefined || sentMessageID === null ? 0 : sentMessageID, 9);
    message = Buffer.concat([message, preparedData]);

    //log.debug('send ', serverAddress, ':', serverPort,': length: ', message.length, '(length in header: ', (preparedData.length + headerLength), '), data: ', message.toString());
    //socket.write(message, callback);
    socket.write(message, function(err) {
        if(typeof callback === 'function') callback(err);
        else if(err) log.error('Can\'t write to socket: ', err, ': id: ', sentMessageID, ': ', data);
    });

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

    /** Parse received data and return parsed result (callback(err, result)
     * @param {Buffer} data
     * @returns {*}
     */
    function dataParser(data) {
        isParserRunning = true;

        while (data.length >= headerLength) {
            var dataLength = data.readUInt32LE(5);
            if(data.length < dataLength + headerLength) break;

            var receivedMagic = data.toString('utf8', 0, magicLength);
            var receivedVersion = data.readInt8(4);
            if (receivedMagic !== magic || receivedVersion !== version) {
                log.error('Incorrect header, skip part of received data: "' + receivedMagic + '":' +
                    receivedVersion + ': '+ data.toString('utf8'), data);
                newData = Buffer.alloc(0);
                break;
            }

            var receivedMessageID = data.readUInt32LE(9);

            //log.debug('header + data length: ', (dataLength + headerLength), ', real data length: ', data.length, ', data: ', data);

            if(!dataLength) {
                return callback(new Error('Received message without data (len: ' + data.length +
                    '; len value from header: ' + dataLength + ')'), receivedMessageID);
            }

            var resultStr = data.toString('utf8', headerLength, dataLength + headerLength);
            try {
                var result = JSON.parse(resultStr);
            } catch (err) {
                //log.warn('Can\'t parse JSON in received data (len: ' + data.length + '; len value from header: ' + dataLength + ') data: "' + resultStr + '" (', data,'): ' + err.message);
                return callback(new Error('Can\'t parse JSON in received data (len: ' + data.length +
                    '; len value from header: ' + dataLength + ') data: "' + resultStr + ': ' +
                    err.message), receivedMessageID);
            }

            if(typeof result !== 'object') {
                return callback(new Error('Received data has unknown format (len: ' + data.length +
                    '; len value from header: ' + dataLength + ') data: "' + resultStr), receivedMessageID);
            }

            data = newData = newData.subarray(dataLength + headerLength);
            //log.debug('Receive ',socket.remoteAddress, ':', socket.remotePort,': length: ', dataSavedForDebug.length, '(waiting: ', (dataLength + headerLength), (resultStr ? ', processed data' : ', wait to next data part' ), '), data: ', dataSavedForDebug.toString());

            //if(result.err) log.warn(result.err);
            callback(result.err ? new Error(result.err) : null, receivedMessageID, result.data);
        }
        isParserRunning = false;
    }
}

// cleanup unused callbacks
function cleanUpCallbackStack(callbackStack, keepCallbackInterval, maxCallbacksCnt, log) {
    if(callbackStack.size < maxCallbacksCnt) return;

    var now = Date.now();
    var err = new Error('Timeout ' + keepCallbackInterval / 60000 +
        'min occurred while waiting for IPC\\threads\\proc callback calling');
    var cleanUpCallbacksNum = 0;

    for(var [id, callbackObj] of callbackStack.entries()) {
        if(callbackObj && callbackObj.options && !callbackObj.options.permanent &&
            (callbackObj.timestamp  + keepCallbackInterval < now || callbackObj.removed)) {
            if (typeof callbackObj.func === 'function') callbackObj.func(err);
            callbackStack.delete(id);
            ++cleanUpCallbacksNum;
        }
    }

    if(cleanUpCallbacksNum && log && typeof log.warn === 'function') {
        log.warn('Cleaning ' + cleanUpCallbacksNum + ' callbacks older then ' + keepCallbackInterval / 60000 +
            'min from stack');
    }
    //return callbackIDsForRemove;
}

function setSocketErrorCounter(cfg) {
    return {
        num: 0,
        maxNum: Number(cfg.maxSocketErrorsCnt) === parseInt(cfg.maxSocketErrorsCnt, 10) &&
        Number(cfg.maxSocketErrorsCnt) ? Number(cfg.maxSocketErrorsCnt) : 50,
        time: 0,
        maxTime: Number(cfg.maxSocketErrorsTime) === parseInt(cfg.maxSocketErrorsTime, 10) &&
        Number(cfg.maxSocketErrorsTime) ? Number(cfg.maxSocketErrorsTime) : 60000,
        timeToLive: Number(cfg.maxSocketErrorsTTL) === parseInt(cfg.maxSocketErrorsTTL, 10) &&
        Number(cfg.maxSocketErrorsTTL) ? Number(cfg.maxSocketErrorsTTL) : 300000,
    };
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
        process.exit(4);
    }
}

IPC.service = function () {
    var log = require('../serverLog/simpleLog')('Service');

    log.info('Starting scheduled IPC service for remove unused IPC temp files  with "', storageFileExtension,
        '" in ', storageDirName);
    removeUnusedIPCStorageFiles();
    setInterval(removeUnusedIPCStorageFiles, 300000);

    function removeUnusedIPCStorageFiles() {
        /*
        log.info('Starting scheduled searching unused files in ', storageDirName,
            ' with "', storageFileExtension, '" extension for deleting...');
        */
        var foundFiles = [];
        fs.readdir(storageDirName, 'utf8', function (err, files) {
            if(err) {
                log.error('Can\'t read ' + storageDirName + ': ' + err.message)
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
                        // some time err.message is undefined
                        log.warn('Can\'t stat ', filePath, ': ', err);
                        return callback();
                    }
                    if(!stats.isFile() || stats.birthtimeMs > Date.now() - 3600000) return callback();

                    fs.access(filePath, fs.constants.W_OK, function (err) {
                        if(err) {
                            log.warn('Can\'t get access to ', filePath, ' for delete: ', err.message);
                            return callback();
                        }

                        fs.unlink(filePath, function (err) {
                            if(err) log.warn('Can\'t delete unused file ', filePath, ': ', err.message);
                            else foundFiles.push(filePath);

                            callback();
                        });
                    });
                });
            }, function(err) {
                if(err) log.error(err.message);
                if(foundFiles.length) {
                    log.info('Deleting ', foundFiles.length,' unused files in ', storageDirName,
                        ': ', foundFiles);
                }
            });
        });
    }
}