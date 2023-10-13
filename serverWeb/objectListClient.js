/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');

var connectionInitialized = false;
var clientIPC;

var objectListClient = {
    stop: function(callback) {callback()},
    kill: function () {},
};

module.exports = objectListClient;

/**
 * Connect to the server
 * @param {function(void)} callback callback()
 */
objectListClient.connect = function (callback) {
    if(connectionInitialized) return callback();

    var cfg = confWebServer.get(); // configuration for each module
    cfg.id = 'webServer';
    cfg.reconnectDelay = 0;
    cfg.connectOnDemand = true;
    cfg.socketTimeout = 1800000;
    clientIPC = new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.error(err.message);
        if (_clientIPC) {
            clientIPC = _clientIPC;
            log.info('Initialized connection to the object list (web) server: ', cfg.serverAddress, ':', cfg.serverPort);
            callback();
        }
    });
}


objectListClient.renameObjectsInCache = function (newObjects) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'renameObjects',
            objects: newObjects,
        });
    });
}

objectListClient.addNewObjectsToCache = function (newObjectsNames, newDescription, newOrder, disabled, color, createdTimestamp) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'addObjects',
            newObjectsNames: newObjectsNames,
            newDescription: newDescription,
            newOrder: newOrder,
            disabled: disabled ? 1 : 0,
            color: color,
            createdTimestamp: createdTimestamp,
        });
    });
}

objectListClient.updateObjectsInCache = function (objectIDs, updateData) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'updateObjects',
            objectIDs: objectIDs,
            updateData: updateData,
        });
    });
}

objectListClient.deleteObjectsFromCache = function (objectIDs) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'deleteObjects',
            objectIDs: objectIDs,
        });
    });
}

objectListClient.insertInteractionsToCache = function (interactions) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'insertInteractions',
            interactions: interactions,
        });
    });
}

objectListClient.deleteInteractionFromCache = function (interactions) {
    objectListClient.connect(function () {
        clientIPC.send({
            operation: 'deleteInteractions',
            interactions: interactions,
        });
    });
}
