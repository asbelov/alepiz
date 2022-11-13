/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./log')(module);
const async = require('async');
const Conf = require('./conf');
const IPC = require("./IPC");

const confMyNode = new Conf('config/node.json');
const confNodes = new Conf('config/nodes.json');

/**
 * Connect to remote nodes for specified server type ("actions", "tasks", "history", "db")
 * @param {string} serverType="actions"|"tasks"|"history"|"db" server type for connect to
 * @param {string} clientID the name of the connected services to identify in the log file
 * @param {function(Error)|function(null, allClientIPC: Map)} callback callback(null, allClientIPC), where allClientIPC is a
 *  new Map([{"<host1>:<port1>": <clientIPC1>}, {"<host2>:<port2>": <clientIPC2>}, ....]). where
 *  <hostN> is a serverAddress, <portN> is a serverPort from nodes.json,
 *  <clientIPCN> is a object returned by a new IPC.client(...)
 */
module.exports = function(serverType, clientID,  callback) {
    var nodesCfg = confNodes.get('nodes');
    var indexOfOwnNode = confMyNode.get('indexOfOwnNode')
    if(!Array.isArray(nodesCfg) || !nodesCfg.length ||
        indexOfOwnNode !== parseInt(String(indexOfOwnNode)) || indexOfOwnNode < 0 ||
        indexOfOwnNode >= nodesCfg.length) {
        return callback(new Error('Error in nodes configuration: indexOfOwnNode: ' + indexOfOwnNode +
            ', nodes cfg: ' + JSON.stringify(nodesCfg)));
    }
    var allClientIPC = new Map();
    async.each(nodesCfg, function (nodeCfg, callback) {
        // don't connect to own node
        if(nodeCfg.alepizID === indexOfOwnNode) return callback();

        var remoteServerCfg = nodeCfg[serverType];
        if(typeof (remoteServerCfg) !== 'object') {
            log.error('Error in node configuration for ', serverType, ': ', nodeCfg);
            return callback();
        }
        const hostPort = remoteServerCfg.serverAddress + ':' + remoteServerCfg.serverPort;

        if(remoteServerCfg.id === undefined) remoteServerCfg.id = clientID + ':' + hostPort;
        if (remoteServerCfg.reconnectDelay === undefined) remoteServerCfg.reconnectDelay = 60000;
        if (remoteServerCfg.connectionTimeout === undefined) remoteServerCfg.connectionTimeout = 2000;
        if (remoteServerCfg.keepCallbackInterval === undefined) remoteServerCfg.keepCallbackInterval = 86400000;
        if (remoteServerCfg.maxReconnectAttempts === undefined) remoteServerCfg.maxReconnectAttempts = 0;
        if (remoteServerCfg.maxSocketErrorsCnt === undefined) remoteServerCfg.maxSocketErrorsCnt = 100000;

        new IPC.client(remoteServerCfg, function (err, msg, clientIPC) {
            if (err) {
                log.warn('Error connected to ', serverType, ' node ', hostPort,': ', err.message, ': ',
                    JSON.stringify(nodeCfg));
            }
            if (clientIPC) {
                log.info('Initialized connection to the remote ', serverType, ' node ', hostPort, '...');
                allClientIPC.set(hostPort, clientIPC);
                return callback();
            }
            if(msg) log.warn('Received unexpected message from ', serverType, 'node ', hostPort,': ', msg);
        });
    }, function () {
        callback(null, allClientIPC);
    });
}