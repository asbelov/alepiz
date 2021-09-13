/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var path = require('path');
var async = require('async');

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var threads = require('../lib/threads');
var collectorsCfg = require('../lib/collectors');
var conf = require('../lib/conf');
const { type } = require('os');
conf.file('config/conf.json');

// collectorPath, serverAddressIPC, serverPortIPC
if(!module.parent) return runCollector(process.argv[2], process.argv[3], process.argv[4]);  //standalone process


var activeCollector = {};
module.exports = activeCollector;
var collectors = new Map(), collectorsObj = new Map();
/* collectors[serverAddress + ':' + port] = {
    names: <array of collectors names>
    IPC: <clientIPC for connect to collectors>
}*/

activeCollector.startCollector = startCollector;

activeCollector.startAll = function (killTimeout, onExit, callback) {
    var activeCollectors = new Map();
    collectors = new Map();
    console.log('Active collectors!!!!')
    collectorsCfg.get(null, function (err, _collectorsObj) {
        if (err) return callback(err);

        collectorsObj = new Map(Object.entries(_collectorsObj));

        for(var collectorName of collectorsObj.keys()) {
            getCollectorParameters(collectorName);
        }

        async.each(Array.from(collectorsObj.keys()), function (collectorName, callback) {
            var collectorCfg = collectorsObj.get(collectorName);
            // it is not the same as a separate collector. This means that we can receive data from the collector once at a time.
            if (!collectorCfg.active && !collectorCfg.separate) return callback();

            startCollector(collectorName, killTimeout, onExit, function (err, collectorProcess) {
                if (err) { // don't exit if collector is not started
                    log.error('Error starting active collector ', collectorName, ': ' , err.message);
                    return callback();
                }

                // collector was started before
                if(!collectorProcess) return callback();

                if (!activeCollectors.has(collectorName)) {
                    activeCollectors.set(collectorName, collectorProcess);
                    log.info('Starting ', collectorProcess.type ,' collector ', collectorName, ' successfully');
                    callback();
                } else log.error('Collector ', collectorName, ' already running and now run again');
            });
        }, function (err) {
            callback(err, activeCollectors);
        });
    });
};

function getCollectorParameters(collectorName) {
    if(!collectorsObj.has(collectorName)) collectorsObj.set(collectorName, {});

    var serverAddress = collectorsObj.get('serverAddress') ||
        conf.get('collectors:'+collectorName+':serverAddress') ||
        conf.get('collectors:defaultSettings:serverAddress');

    if(serverAddress) collectorsObj.get(collectorName).serverAddress = serverAddress;

    var localAddress = collectorsObj.get('localAddress') ||
            conf.get('collectors:'+collectorName+':localAddress') ||
            conf.get('collectors:defaultSettings:localAddress');

    if (localAddress) collectorsObj.get(collectorName).localAddress = localAddress;

    var port = collectorsObj.get('port') ||
            conf.get('collectors:'+collectorName+':port') ||
            conf.get('collectors:defaultSettings:port');

    if (port) collectorsObj.get(collectorName).port = port;
}

function startCollector(collectorName, killTimeout, onExit, callback) {

    var serverAddress = collectorsObj.get(collectorName).serverAddress,
        localAddress = collectorsObj.get(collectorName).localAddress,
        port = collectorsObj.get(collectorName).port;

    if(collectors.has(serverAddress + ':' + port)) return callback();

    if(!port || port !== parseInt(port, 10))
        return callback(new Error('TCP port for active collectors ' + collectorName +
            ' is not specified or error ('+ port + '). Set it in general conf.json'));

    if(!serverAddress) return callback(new Error('Server address for active collector ' + collectorName +
        ' is not specified ('+ serverAddress + '). Set it in general conf.json'));

    if(!localAddress) return callback(new Error('Local address for active collector ' + collectorName +
        ' is not specified ('+ localAddress + '). Set it in general conf.json'));

    var collectorsNames = getCollectorNamesWithSameIPAndPort(serverAddress, port);
    collectors.set(serverAddress + ':' + port, {
        names: collectorsNames,
    });

    new proc.parent({
        childProcessExecutable: __filename,
        args: [collectorsNames.join(','), serverAddress, port],
        childrenNumber: 1,
        onChildExit: function() { onExit(collectorName); },
        restartAfterErrorTimeout: 0, // we will restart server with all children after exit one of children
        killTimeout: killTimeout - 2000, // set kill timeout less then in server for success restart
        module: 'activeCollector',
    }, function(err, collectorProc) {
        if(err) {
            collectors.delete(serverAddress + ':' + port);
            return callback(new Error('Error occurred while initializing active collectors ' +
                collectorsNames.join(',') + ': ' + err.message));
        }

        collectorProc.start(function(err) {
            callback(err, {
                stop: collectorProc.stopAll,
                kill: collectorProc.killAll,
                type: collectorsObj.get(collectorName).active ? 'active' : 'separate',
            });
        });
    });
}

function getCollectorNamesWithSameIPAndPort(serverAddress, port) {
    // searching collectors with same IP and port
    var collectorsNames = [];
    for(var anotherCollectorName of collectorsObj.keys()) {
        if(serverAddress && serverAddress === collectorsObj.get(anotherCollectorName).serverAddress &&
            port && port === collectorsObj.get(anotherCollectorName).port
        ) collectorsNames.push(anotherCollectorName);
    }

    return collectorsNames;
}


activeCollector.connect = function (collectorName, callback) {
    if(!collectorName) return callback(new Error('Collector name is not set for connect to active collector'));

    connectToCollector(collectorName, function (err, clientIPC) {
        if(err) return callback(err);

        activeCollector.disconnect = clientIPC.disconnect;

        /* if connected */
        var collector = {};

        collector.get = function (param, callback) {
            clientIPC.sendAndPermanentReceive({
                name: collectorName,
                type: 'get',
                data: param,
            }, callback);
        };

        collector.removeCounters = function (OCIDs, callback) {
            clientIPC.sendAndReceive({
                name: collectorName,
                type: 'removeCounters',
                data: OCIDs
            }, callback);
        };

        collector.throttlingPause = function (throttlingPause, callback) {
            clientIPC.sendAndReceive({
                name: collectorName,
                type: 'throttlingPause',
                data: throttlingPause
            }, callback);
        };

        collector.destroy = function (callback) {
            clientIPC.sendAndReceive({
                name: collectorName,
                type: 'destroy',
            }, callback);
        };

        collector.sendMsg = function (message, callback) {
            var send = typeof callback === 'function' ? clientIPC.sendAndReceive : clientIPC.send;
            send({
                name: collectorName,
                type: 'serverMsg',
                data: message
            }, callback);
        }

        callback(null, collector);
    });
};

function connectToCollector(collectorName, callback) {
    var reconnectInProgress = false;

    getCollectorParameters(collectorName);
    getCollectorParameters(collectorName);
    var serverAddress = collectorsObj.get(collectorName).serverAddress,
        localAddress = collectorsObj.get(collectorName).localAddress,
        port = collectorsObj.get(collectorName).port;

    // connectToCollector and startAll can be in different processes
    // init collectors again
    if(!collectors.has(serverAddress + ':' + port)) {
        collectors.set(serverAddress + ':' + port, {
            names: getCollectorNamesWithSameIPAndPort(serverAddress, port)
        });
    }

    // already connected
    if(collectors.get(serverAddress + ':' + port).IPC) return callback(null, collectors.get(serverAddress + ':' + port).IPC);

    // run IPC system
    collectors.get(serverAddress + ':' + port).IPC = new IPC.client({
        serverAddress: serverAddress,
        serverPort: port,
        localAddress: localAddress,
        separateStorageByProcess: true,
        id: path.basename(module.parent.filename, '.js') + '=>' + collectors[serverAddress + ':' + port].names.join(','),
    }, function(err, message, isConnected) {

        // prevent to start this function after reconnect
        if (reconnectInProgress) {
            if (err) log.error(err);
            return;
        } else reconnectInProgress = true;

        if (!isConnected) return log.warn('Receiving unexpected message: ', message);

        if(err) collectors.get(serverAddress + ':' + port).IPC = null;
        callback(err, collectors.get(serverAddress + ':' + port).IPC);
    });
}

/*
 node.exe = process.argv[0]
 __filename = process.argv[1]
 collectorNamesStr = process.argv[2] (comma separated collector names)
 serverAddress = process.argv[3] (server IP address for IPC)
 serverPort = process.argv[4] (server port for IPC)
 */
function runCollector(collectorNamesStr, serverAddress, serverPort) {

    var history = require('../models_history/history');

    var stopInProgress = false;
    var collectorNames = collectorNamesStr.split(',');
    var collectorsObj = new Map()

    collectorNames.forEach(function (collectorName) {
        var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), collectorName, 'collector.js');
        try {
            log.info('Attaching new collector ', collectorName, ': ', collectorPath );
            collectorsObj.set(collectorName, require(collectorPath));
        } catch (err) {
            log.error('Error attaching active collector ', collectorName,' code ', collectorPath, ': ', err.message);
        }
    });

    history.connect(serverPort, function () {
        new IPC.server({
            serverAddress: serverAddress,
            serverPort: serverPort,
            id: collectorNamesStr,
        }, function (err, message, socket, callback) {
            if (err) {
                if (stopInProgress) return;
                stopInProgress = true;

                log.exit(err.message);
                destroyCollectors(function () {
                    log.disconnect(function () { process.exit(2) });
                });
                return;
            }

            // on connect
            if (socket === -1) {
                log.info('Active collectors ', collectorNamesStr, ' starting and listening ', serverAddress, ':', serverPort, ' for IPC');
                stopInProgress = false;
                new proc.child({
                    module: 'activeCollector',
                    onStop: function (callback) {
                        if (stopInProgress) return callback();
                        stopInProgress = true;
                        log.warn('Stopping ' + collectorNamesStr);

                        destroyCollectors(callback);
                    },
                    onDestroy: destroyCollectors,
                    onDisconnect: function () {  // exit on disconnect from parent (then server will be restarted)
                        log.exit('Active collectors ' + collectorNamesStr +
                            ' was disconnected from parent unexpectedly. Exiting');
                        log.disconnect(function () { process.exit(2) });
                    },
                });
                return;
            }

            // on message received
            if (!message || !message.type || !message.name ||
                !collectorsObj.has(message.name) || typeof collectorsObj.get(message.name)[message.type] !== 'function') {
                callback();
                return log.info('Unknown active collector message for ', collectorNamesStr, ': ', message);
            }

            try {
                if (message.data !== undefined) {
                    if (message.type !== 'get') collectorsObj.get(message.name)[message.type](message.data, callback);
                    else { // save collector data to history
                        collectorsObj.get(message.name).get(message.data, function (err, result) {
                            //if(Number(message.data.id$) === 155101) log.warn('Add record ', message.data.$id, ':', result, ': ', message);
                            //log.warn('Add record ', message.data.$id, ':', result, ': ', message);
                            callback(err, history.add(message.data.$id, result));
                        });
                    }
                } else collectorsObj.get(message.name)[message.type](callback);
            } catch (e) {
                log.error('Error running collector function ', collectorNamesStr, ': ', message.name, '.', message.type, ': ', e.stack, ' (data: ', message.data, ')');
            }
        });
    });

    function destroyCollectors(callback) {
        async.each(Array.from(collectorsObj.keys()), function (collectorName, callback) {
            var collector = collectorsObj.get(collectorName);
            if(collector && typeof collector.destroy === 'function') {
                collector.destroy(function (err) {
                    if(err) log.error(collectorName, ': ', err.message);
                    callback();
                });
            } else callback();
        }, function () {
            log.warn('All active and separate collectors are stopped');
            if(typeof callback === 'function') callback();
        });
    }

    function startServers(callback) {
        
    }
}
