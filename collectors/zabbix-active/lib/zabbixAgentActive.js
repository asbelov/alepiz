// noinspection SpellCheckingInspection

/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 24.07.2015.
 * https://www.zabbix.com/documentation/3.0/ru/manual/appendix/items/activepassive
 * https://www.zabbix.com/documentation/4.0/ru/manual/appendix/items/activepassive
 */
const log = require('../../../lib/log')(module);
const net = require('net');
const throttling = require('../../../lib/throttling');
const Conf = require('../../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/zabbix-active/settings.json');

var collector = {};
module.exports = collector;

var counters = new Map();
var countersOCID2ZabbixHost = new Map();
var countersParameters = new Map();
var agentSessions = new Map();
var headerLength = String('ZBXD').length + 1 + 8;
var errorMessage = 'Zabbix agent active check error: ';
var serverPort = 10051;
var server;
var isServerRunning = false;
var stopServerInProgress = false;
var logZabbixAgentErrors = confSettings.get('logZabbixAgentErrors');
var logZabbixAgentErrorObtainPerformanceInformation =
    confSettings.get('logZabbixAgentErrorObtainPerformanceInformation');
var initializingDelay = Number(confSettings.get('initializingDelay') || 120000);
var startTime = Date.now();
var delayedData = new Set();

collector.get = function(param, callback) {

    if(!param || !param.zabbixHostname) return callback();

    if(!isServerRunning) {
        log.info('Staring active check collector');
        isServerRunning = true;
        createServer();
    }

    var zabbixHostname = param.zabbixHostname.toLowerCase();
    var key = param.itemParameters ? param.item+'['+param.itemParameters+']' : param.item;
    var OCID = Number(param.$id);

    if(!counters.has(zabbixHostname)) counters.set(zabbixHostname, new Map());
    // update counter parameters for existing OCID
    else if(OCID && countersOCID2ZabbixHost.has(OCID)) {
        var oldZabbixHostname = countersOCID2ZabbixHost.get(OCID);

        // for different old and new zabbixHostnames at first deleting existing counter
        if (zabbixHostname !== oldZabbixHostname) collector.removeCounters([OCID]);
        else if (counters.get(zabbixHostname).has(OCID)) { // for equal zabbixHostnames replace old parameters to the new
            counters.get(zabbixHostname).set(OCID, {
                key: key,
                delay: Number(param.pollingFreq),
                lastlogsize: 0,
                mtime: 0,
            });

            log.info('Replace param for counters with existing OCID ', OCID, ' and equal hostnames "', zabbixHostname,
                '": ', counters.get(zabbixHostname).get(OCID));
            var dontCreateNewCounter = true;
        }
    }

    // add parameters even if a counter for this OCID exists, because the parameters may have changed
    var isCounterExist = false, lowerCaseKey = key.toLowerCase();
    var keyCallbacks = countersParameters.get(zabbixHostname);
    if(!keyCallbacks) {
        countersParameters.set(zabbixHostname, new Map([[lowerCaseKey, new Map([
            ['callbacks', new Map([[OCID, callback]])],
            ['onlyNumeric', Boolean(param.onlyNumeric)],
        ]) ]]));
    } else {
        var keyParam = countersParameters.get(zabbixHostname).get(lowerCaseKey);
        if(!keyParam) {
            keyCallbacks.set(lowerCaseKey, new Map([
                ['callbacks', new Map([[OCID, callback]])],
                ['onlyNumeric', Boolean(param.onlyNumeric)],
            ]));
        } else {
            isCounterExist = true;
            countersParameters.get(zabbixHostname).get(lowerCaseKey).get('callbacks').set(OCID, callback);
            countersParameters.get(zabbixHostname).get(lowerCaseKey).set('onlyNumeric', Boolean(param.onlyNumeric));
        }
    }

    throttling.init(zabbixHostname + '-' + lowerCaseKey, param, collector);

    if(dontCreateNewCounter) return;

    countersOCID2ZabbixHost.set(OCID, zabbixHostname);
    counters.get(zabbixHostname).set(OCID, {
		key: key,
		delay: Number(param.pollingFreq),
        lastlogsize: 0,
        mtime: 0,
    });
    if(isCounterExist) {
        log.info('Add another OCID ', OCID, ' to an existing counter "', zabbixHostname,
            '": ', counters.get(zabbixHostname).get(OCID));
    } else {
        log.info('Add: ', OCID, ': "',
            zabbixHostname, '": ', counters.get(zabbixHostname).get(OCID));
    }
};

collector.init = function(newServerPort) {
    serverPort = newServerPort;
};

// must be a synced function ar rewrite removing counters with existing OCID and different zabbixHostnames above
collector.removeCounters = function(OCIDs, callback) {
    if(typeof callback !== 'function') callback = function () {};
    if(!Array.isArray(OCIDs) || !OCIDs.length) return callback();

    var existingOCIDs = [];
    OCIDs.forEach(function(OCID) {
        OCID = Number(OCID);
        if(!countersOCID2ZabbixHost.has(OCID)) return;
        var zabbixHostname = countersOCID2ZabbixHost.get(OCID);

        // typeof null === 'object'
        if(counters.has(zabbixHostname) && typeof counters.get(zabbixHostname).get(OCID) === 'object') {
            var foundCallbackForDelete = false, lowerCaseKey = counters.get(zabbixHostname).get(OCID).key.toLowerCase();
            for(var callbackOCID of countersParameters.get(zabbixHostname).get(lowerCaseKey).get('callbacks').keys()) {

                if(OCID === callbackOCID) {
                    countersParameters.get(zabbixHostname).get(lowerCaseKey).get('callbacks').delete(OCID);
                    foundCallbackForDelete = true;
                    existingOCIDs.push(OCID + ':' + zabbixHostname + '(' + counters.get(zabbixHostname).get(OCID).key + ')');
                }
            }
            if(foundCallbackForDelete) {
                if(!countersParameters.get(zabbixHostname).get(lowerCaseKey).get('callbacks').size) {
                    countersParameters.get(zabbixHostname).delete(lowerCaseKey);
                    counters.get(zabbixHostname).delete(OCID);
                    if(!counters.get(zabbixHostname).size) counters.delete(zabbixHostname);
                }
            }
        }
        countersOCID2ZabbixHost.delete(OCID);
    });
    throttling.remove(OCIDs);

    if(existingOCIDs.length) log.info('Removed ', existingOCIDs.length, ' counters: ', existingOCIDs.join('; '));

    callback();
};

collector.destroy = stopServer;

function stopServer(callback){
    if(!server || stopServerInProgress) return callback();
    stopServerInProgress = true;

    log.info('Stopping Zabbix active collector');
    server.close(function(err) {
        server = null;
        counters.clear();
        countersParameters.clear();
        agentSessions.clear();
        isServerRunning = false;
        stopServerInProgress = false;
        throttling.remove();
        callback(err);
    });
}

function createServer() {
    startTime = Date.now();

    server = net.createServer(function(socket) {
		// 'connection' listener
		//log.debug('Client connected: ', socket.remoteAddress, ':', socket.remotePort, '->', socket.localAddress, ':', socket.localPort);

        var prevData = Buffer.alloc(0);
        var isHeaderOK = false;
        var dataLength = 0;

        socket.on('data', function(dataPart) {

            var data = !prevData.length ? dataPart : Buffer.concat([prevData, Buffer.from(dataPart)]);

            // checking is header correct or not and get length of received data
            if(!isHeaderOK && data.length >= headerLength) {
                var header = data.toString('utf8', 0, 4);
				var version = data.readInt8(4);

				if (header !== "ZBXD" || version !== 1) {
                    socket.destroy();
					return log.error(errorMessage + 'incorrect header: ' + header + ':' + version);
                }

                dataLength = data.readUInt32LE(5);
                if(dataLength === 0) {
                    socket.destroy();
                    return log.error(errorMessage + 'data length in header (', dataLength,') is too small');
                }

                isHeaderOK = true;

                //log.debug('ZBX: header ok, data length: ', dataLength);
            }

            if(data.length === dataLength + headerLength) {
                prevData = Buffer.alloc(0);
                //log.debug('ZBX: header + data length: ', (dataLength + headerLength), ', real data length: ', data.length, ', data: ', data);

                var resultStr = data.toString('utf8', headerLength);

                var result;
                try {
                    result = JSON.parse(resultStr);
                } catch(err) {
                    socket.destroy();
                    return log.error(errorMessage + 'can\'t parse JSON in response: ', err.message, ': ', resultStr);
                }

                if(!result || !result.request) {
                    socket.destroy();
                    return log.error(errorMessage + 'error in request');
                }

                if(result.request.toLowerCase() === 'active checks') {
                    reqActiveChecks(result.host, socket);
                    socket.destroy();
                // "agent data" for zabbix active protocol. "sender data" for zabbix trapper protocol
                } else if(result.request.toLowerCase() === 'agent data' || result.request.toLowerCase() === 'sender data') {
                    reqAgentData(result, socket);
                    //socket.destroy();
                } else {
                    log.error(errorMessage, 'unknown request: ', result.request, ': ', result);
                    socket.destroy();
                }
            } else if(data.length > dataLength + headerLength) {
                prevData = Buffer.alloc(0);
                socket.destroy();
                log.error(errorMessage + 'received data length (', data.length,
                    ') is greater than specified in header (', dataLength + headerLength, ')');
            } else prevData = data;

            //log.debug('ZBX rcv ',socket.remoteAddress, ':', socket.remotePort,': length: ',data.length,', data: ', data.toString());
        });

        socket.on('error', function(err) {
            log.info('Active check socket error: ', err.message);
        });
	});

	server.on('error', function(err) {
		log.error('Active check collector error: ', err.message, '. Try to restart');

        setTimeout(function() {
            stopServer(function(err){
                if(err) log.error('Error while stopping collector: ', err.message);
                isServerRunning = true;
                createServer();
            });
        }, 1000);
	});

    server.listen(serverPort, function() {
        log.info('Collector bound to TCP port: ', serverPort);

        setTimeout(function () {
            log.info('Number of data delayed during initialization ', delayedData.size);
            delayedData.forEach((data) => reqAgentData(data.result, data.socket));
            delayedData.clear();
        }, initializingDelay);
    });
}

function sendToZabbix(err, socket, data) {
    if(err) {
        log.warn(errorMessage, err.message);
        data = JSON.stringify({response: 'error'});
    }

    if(!data || typeof data !== 'string') {
        log.error(errorMessage, 'attempt to return undefined or non-string data');
        data = JSON.stringify({response: 'error'});
    }

    var zabbixData = Buffer.from('ZBXDVLLLLLLLL');
    zabbixData.writeInt8(1, 4);
    zabbixData.writeUInt32LE(data.length, 5);
    zabbixData.writeUInt32LE(0, 9);
    zabbixData = Buffer.concat([zabbixData, Buffer.from(data)]);

    //log.debug('ZBX send ', socket.remoteAddress, ':', socket.remotePort,': length: ',data.length,', data: ', zabbixData.toString());

    // callback for async sending data
    socket.write(zabbixData, function (/*err*/) {
        // error will be logged in the socket.on('error', ...) event handler
        //if(err) log.info('Can\'t send data to zabbix: ', err.message);
    });
}

function reqActiveChecks(zabbixHostname, socket) {
    if(!zabbixHostname) return sendToZabbix(new Error('zabbixHostname not defined for active check request'), socket);

    zabbixHostname = zabbixHostname.toLowerCase();

    if(!counters.has(zabbixHostname) || !counters.get(zabbixHostname).size) {
        counters.delete(zabbixHostname);
        return sendToZabbix(new Error('active check not defined for ' + zabbixHostname + ': ' +
            socket.remoteAddress + ':' + socket.remotePort + '->' + socket.localAddress + ':' + socket.localPort), socket);
    }

    // filter Zabbix trappers.
    var data = [];
    for(var obj  of counters.get(zabbixHostname).values()) {
        if(obj.delay) data.push(obj);
    }

    sendToZabbix(null, socket, JSON.stringify({
        response: 'success',
        data: data,
    }));
}

function reqAgentData(result, socket){
    if(!Array.isArray(result.data) || !result.data.length) {
        return sendToZabbix(new Error('unknown result for agent data'), socket);
    }

    var errCnt = 0;
    var timestamp = Date.now();
    var dataDuplacatesForHosts = new Set(), duplicateDataNum = 0;
    result.data.forEach(function(data) {

        if(!data.host || typeof data.host  !== 'string' || !data.key || typeof data.key !== 'string' ||
            data.value === undefined /* || !data.clock || !data.ns */) {

            log.error('Error while received zabbix data, not all required parameters are defined: host: ', data.host,
                    ', key: ', data.key, ', clock: ', data.clock, ', ns: ', data.ns, ', value: ', data.value, ': ', data);
            errCnt++;
            return;
        }

        if(result.session && data.id !== undefined) {
            if(!agentSessions.has(result.session)) agentSessions.set(result.session, data.id);
            else {
                if(agentSessions.get(result.session) < data.id) agentSessions.set(result.session, data.id);
                else {
                    dataDuplacatesForHosts.add(data.host);
                    ++duplicateDataNum;
                    /*
                    // some time received too many errors
                    log.info('Duplicate data received: ', data ,'; received ID (', result.session, ':', data.id,
                        '), <= previous ID (', result.session , ':', agentSessions.get(result.session), ')');
                     */
                    return;
                }
            }
        }

        var zabbixHost = data.host.toLowerCase();
        var zabbixKey = data.key.toLowerCase();
        
        if(!countersParameters.has(zabbixHost) || !countersParameters.get(zabbixHost).has(zabbixKey) ||
            !countersParameters.get(zabbixHost).get(zabbixKey).has('callbacks') ||
            !(countersParameters.get(zabbixHost).get(zabbixKey).get('callbacks') instanceof Map) ||
            !countersParameters.get(zabbixHost).get(zabbixKey).get('callbacks').size
        ) {
            // waiting for all counters to be initialized on collector startup
            if(Date.now() - startTime <  initializingDelay) {
                delayedData.add({
                    result: result,
                    socket: socket,
                });
                return;
            }
            log.info('Callback not defined for ', zabbixHost, '; key ',  zabbixKey);
            errCnt++;
            return;
        }

        if(data.state && logZabbixAgentErrors) {
            //console.log(logZabbixAgentErrorObtainPerformanceInformation, data.host, ':', data.key, ': ',data.value)
            if(logZabbixAgentErrorObtainPerformanceInformation ||
                data.value !== 'Cannot obtain performance information from collector.') {
                log.info('Zabbix agent returned error for active check ', data.host, ':', data.key, ': ', data.value);
            }
        }

        // return only numeric values
        if(countersParameters.get(zabbixHost).get(zabbixKey).get('onlyNumeric')) {
            var value = Number(data.value);
            if(isNaN(parseFloat(String(value))) || !isFinite(value)) return;
        } else value = data.value;

        if(!throttling.check(zabbixHost + '-' + zabbixKey, value)) return;

        if (data.clock && data.ns &&
            Number(data.clock) === parseInt(String(data.clock), 10) &&
            Number(data.ns) === parseInt(String(data.ns), 10)) {

            var res = {
                value: value,
                timestamp: Math.round(Number(data.clock) * 1000 + (Number(data.ns) / 1000000)) // convert to milliseconds
            };
        } else res = value;

        for(var OCID of countersParameters.get(zabbixHost).get(zabbixKey).get('callbacks').keys()) {
            if(typeof countersParameters.get(zabbixHost).get(zabbixKey).get('callbacks').get(OCID) !== 'function') {
                log.info('Callback not defined or callback type is not a function for ', zabbixHost, '; key ',
                    zabbixKey, '; OCID: ', OCID);
                errCnt++;
                continue;
            }
            countersParameters.get(zabbixHost).get(zabbixKey).get('callbacks').get(OCID)(null, res);
        }
    });

    if(duplicateDataNum) {
        log.info('Received ', duplicateDataNum, ' duplicate values for hosts: ',
            Array.from(dataDuplacatesForHosts).join(', '));
    }

    sendToZabbix(null, socket, JSON.stringify({
        response: 'success',
        info: 'processed: ' + (result.data.length - errCnt) + '; failed: ' + errCnt + '; total: ' + result.data.length +
            ' seconds spent: ' + String((Date.now() - timestamp) / 1000)
    }));
}