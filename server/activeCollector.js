/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var path = require('path');
var async = require('async');

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var collectorsCfg = require('../lib/collectors');
var Conf = require('../lib/conf');
const confServer = new Conf('config/server.json');

var activeCollector = {};
module.exports = activeCollector;

var collectors = {}, collectorsObj = {};
/* collectors[serverAddress + ':' + port] = {
    names: <array of collectors names>
    IPC: <clientIPC for connect to collectors>
}*/

activeCollector.startAll = function (killTimeout, onExit, callback) {
    var activeCollectors = {};
    var separateCollectors = {};
    collectors = {};

    collectorsCfg.get(null, function (err, _collectorsObj) {
        if (err) return callback(err);

        collectorsObj = _collectorsObj;

        for(var collectorName in collectorsObj) {
            getCollectorParameters(collectorName);
        }

        async.eachOf(collectorsObj, function (collectorCfg, collectorName, callback) {
            // it is not the same as a separate collector. This means that we can receive data from the collector once at a time.
            if (!collectorCfg.active && !collectorCfg.separate) return callback();

            startCollector(collectorName, killTimeout, onExit, function (err, collectorProcess) {
                if (err) { // don't exit if collector is not started
                    log.error('Error starting active collector ', collectorName, ': ' , err.message);
                    return callback();
                }

                if (!activeCollectors[collectorName] && collectorCfg.active) {
                    activeCollectors[collectorName] = collectorProcess;
                    log.info('Starting active collector ', collectorName, ' successfully');
                    callback();
                } else if (!separateCollectors[collectorName] && collectorCfg.separate) {
                    separateCollectors[collectorName] = collectorProcess;
                    log.info('Starting separate collector ', collectorName, ' successfully');
                    callback();
                    // if collector is already running and restarting and callback always called before, don't call callback
                } else log.error('Collector ', collectorName, ' already running and now run again');
            });
        }, function (err) {
            callback(err, activeCollectors, separateCollectors);
        });
    });
};

function getCollectorParameters(collectorName) {
    if(!collectorsObj[collectorName]) collectorsObj[collectorName] = {};

    var serverAddress = collectorsObj.serverAddress ||
        confServer.get('collectors:' + collectorName + ':serverAddress') ||
        confServer.get('collectors:defaultSettings:serverAddress');

    if(serverAddress) collectorsObj[collectorName].serverAddress = serverAddress;

    var localAddress = collectorsObj.localAddress ||
            confServer.get('collectors:' + collectorName + ':localAddress') ||
            confServer.get('collectors:defaultSettings:localAddress');

    if(localAddress) collectorsObj[collectorName].localAddress = localAddress;

    var port = collectorsObj.port ||
            confServer.get('collectors:' + collectorName + ':port') ||
            confServer.get('collectors:defaultSettings:port');

    if(port) collectorsObj[collectorName].port = port;
}

function startCollector(collectorName, killTimeout, onExit, callback) {

    var serverAddress = collectorsObj[collectorName].serverAddress,
        localAddress = collectorsObj[collectorName].localAddress,
        port = collectorsObj[collectorName].port;

    if(collectors[serverAddress + ':' + port]) return callback();

    if(!port || port !== parseInt(port, 10))
        return callback(new Error('TCP port for active collectors ' + collectorName +
            ' is not specified or error ('+ port + '). Set it in conf/server.json'));

    if(!serverAddress) return callback(new Error('Server IP address for active collector ' + collectorName +
        ' is not specified ('+ serverAddress + '). Set it in conf/server.json'));

    if(!localAddress) return callback(new Error('Local IP address for active collector ' + collectorName +
        ' is not specified ('+ localAddress + '). Set it in conf/server.json'));

    var collectorsNames = getCollectorNamesWithSameIPAndPort(serverAddress, port);
    collectors[serverAddress + ':' + port] = {
        names: collectorsNames,
    };

    new proc.parent({
        childProcessExecutable: path.join(__dirname, 'activeCollectorServer.js'),
        args: [collectorsNames.join(','), serverAddress, port],
        childrenNumber: 1,
        restartAfterErrorTimeout: 3000, // we will restart server with all children after exit one of children
        killTimeout: killTimeout - 2000, // set kill timeout less than in server for success restart
        module: 'activeCollector',
    }, function(err, collectorProc) {
        if(err) {
            delete collectors[serverAddress + ':' + port];
            return callback(new Error('Error occurred while initializing active collectors ' +
                collectorsNames.join(',') + ': ' + err.message));
        }

        collectorProc.start(function(err) {
            callback(err, {
                stop: collectorProc.stopAll,
                kill: collectorProc.killAll,
                sendAll: collectorProc.sendAll,
            });
        });
    });
}

function getCollectorNamesWithSameIPAndPort(serverAddress, port) {
    // searching collectors with same IP and port
    var collectorsNames = [];
    for(var anotherCollectorName in collectorsObj) {
        if(serverAddress && serverAddress === collectorsObj[anotherCollectorName].serverAddress &&
            port && port === collectorsObj[anotherCollectorName].port
        ) collectorsNames.push(anotherCollectorName);
    }

    return collectorsNames;
}


activeCollector.connect = function (collectorName, callback) {
    if(!collectorName) return callback(new Error('Collector name is not set for connect to active collector'));
    // already connected
    if(collectorsObj[collectorName] && collectorsObj[collectorName].IPC) {
        return callback(null, collectorsObj[collectorName].IPC);
    }

    connectToCollector(collectorName, function (err, clientIPC) {
        if(err) return callback(err);

        /* if connected */
        var collector = new Collector(collectorName, clientIPC);

        if(!collectorsObj[collectorName]) collectorsObj[collectorName] = {};
        collectorsObj[collectorName].IPC = collector;
        callback(null, collector);
    });
};

function Collector(collectorName, clientIPC) {
    this.get = function (param, callback) {
        clientIPC.send({
            name: collectorName,
            type: 'get',
            data: param,
        }, callback);
    };

    this.getOnce = function (param, callback) {
        clientIPC.send({
            name: collectorName,
            type: 'getOnce',
            data: param,
        }, callback);
    };

    this.removeCounters = function (OCIDs, callback) {
        clientIPC.sendAndReceive({
            name: collectorName,
            type: 'removeCounters',
            data: OCIDs
        }, callback);
    };

    this.throttlingPause = function (throttlingPause, callback) {
        clientIPC.sendAndReceive({
            name: collectorName,
            type: 'throttlingPause',
            data: throttlingPause
        }, callback);
    };

    this.destroy = function (callback) {
        clientIPC.sendAndReceive({
            name: collectorName,
            type: 'destroy',
        }, callback);
    };

    this.sendToServer = function (message) {
        clientIPC.send(message);
    };
}

function connectToCollector(collectorName, callback) {
    var reconnectInProgress = false;

    getCollectorParameters(collectorName);
    var serverAddress = collectorsObj[collectorName].serverAddress,
        localAddress = collectorsObj[collectorName].localAddress,
        port = collectorsObj[collectorName].port;

    // connectToCollector and startAll can be in different process
    // init collectors again
    if(!collectors[serverAddress + ':' + port]) {
        collectors[serverAddress + ':' + port] = {
            names: getCollectorNamesWithSameIPAndPort(serverAddress, port)
        };
    }

    // already connected
    if(collectors[serverAddress + ':' + port].IPC) return callback(null, collectors[serverAddress + ':' + port].IPC);

    // run IPC system
    new IPC.client({
        serverAddress: serverAddress,
        serverPort: port,
        localAddress: localAddress,
        separateStorageByProcess: true,
        id: path.basename(module.parent.filename, '.js') + '=>' + collectors[serverAddress + ':' + port].names.join(','),
    }, function(err, message, clientIPC) {

        // prevent to start this function after reconnect
        if (reconnectInProgress) {
            if (err) log.error(err);
            return;
        } else reconnectInProgress = true;

        if (!clientIPC) return log.warn('Receiving unexpected message: ', message);

        collectors[serverAddress + ':' + port].IPC = clientIPC;
        callback(err, clientIPC);
    });
}