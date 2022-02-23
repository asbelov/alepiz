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
const async = require('async');
const Conf = require('../../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/zabbix-active/settings.json');

var collector = {};
module.exports = collector;

var counters = {};
var countersIDX = {};
var countersParameters = {};
var agentSessions = {};
var headerLength = String('ZBXD').length + 1 + 8;
var errorMessage = 'Zabbix agent active check error: ';
var serverPort = 10051;
var server;
var isServerRunning = false;
var stopServerInProgress = false;
var countersForRemove = {};
var logZabbixAgentErrors = confSettings.get('logZabbixAgentErrors');
var logZabbixAgentErrorObtainPerformanceInformation =
    confSettings.get('logZabbixAgentErrorObtainPerformanceInformation');

collector.get = function(param, callback) {

    if(!param || !param.zabbixHostname) return callback();

    if(!isServerRunning) {
        log.info('Staring active check server');
        isServerRunning = true;
        createServer();
    }

    var zabbixHostname = param.zabbixHostname.toLowerCase();
    var key = param.itemParameters ? param.item+'['+param.itemParameters+']' : param.item;

    if(!counters[zabbixHostname] || !counters[zabbixHostname].length) counters[zabbixHostname] = [];
    // update counter parameters for existing OCID
    else if(Number(param.$id) && countersIDX[param.$id] && countersIDX[param.$id].num !== undefined) {
        var num = countersIDX[param.$id].num;
        var oldZabbixHostname = countersIDX[param.$id].zabbixHostname;

        // for different old and new zabbixHostnames at first deleting existing counter
        if (zabbixHostname !== oldZabbixHostname) collector.removeCounters([param.$id]);
        // for equal zabbixHostnames replace old parameters to the new
        else if (counters[zabbixHostname][num]) {
            counters[zabbixHostname][num] = {
                key: key,
                delay: Number(param.pollingFreq),
                lastlogsize: 0,
                mtime: 0,
            };

            log.info('Replace param for counters with existing OCID ', param.$id, ' and equal hostnames "', zabbixHostname,
                '": ', counters[zabbixHostname][num]);
            var dontCreateNewCounter = true;
        }
    }

    // add parameters even if a counter for this OCID exists, because the parameters may have changed
    var isCounterExist = false;
    if(!countersParameters[zabbixHostname]) countersParameters[zabbixHostname] = {};
    if(!countersParameters[zabbixHostname][key.toLowerCase()] ||
        !countersParameters[zabbixHostname][key.toLowerCase()].callbacks || // typeof null === 'object'
        typeof countersParameters[zabbixHostname][key.toLowerCase()].callbacks !== 'object'
    ) {
        countersParameters[zabbixHostname][key.toLowerCase()] = {
            callbacks: {},
        };
    } else isCounterExist = true;
    countersParameters[zabbixHostname][key.toLowerCase()].callbacks[param.$id] = callback;
    countersParameters[zabbixHostname][key.toLowerCase()].onlyNumeric = !!param.onlyNumeric;

    throttling.init(zabbixHostname + '-' + key.toLowerCase(), param, collector);

    if(dontCreateNewCounter) return;

    countersIDX[param.$id] = {
        num: counters[zabbixHostname].length, // number of the counters with equal zabbixHostname
        zabbixHostname: zabbixHostname,
    };
    counters[zabbixHostname].push({
		key: key,
		delay: Number(param.pollingFreq),
        lastlogsize: 0,
        mtime: 0,
    });
    if(isCounterExist) {
        log.info('Adding another OCID ', param.$id, ' to an existing counter "', zabbixHostname,
            '": ', counters[zabbixHostname][counters[zabbixHostname].length-1]);
    } else {
        log.info('Adding a new counter with OCID ', param.$id, ' for hostname   "',
            zabbixHostname, '": ', counters[zabbixHostname][counters[zabbixHostname].length - 1]);
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
        if(!countersIDX[OCID]) return;
        var num = countersIDX[OCID].num;
        var zabbixHostname = countersIDX[OCID].zabbixHostname;
        if(num === undefined) return;

        // typeof null === 'object'
        if(counters[zabbixHostname] && counters[zabbixHostname][num] && typeof counters[zabbixHostname][num] === 'object') {
            var foundCallbackForDelete = false;
            for(var callbackOCID in countersParameters[zabbixHostname][counters[zabbixHostname][num].key.toLowerCase()].callbacks) {
                if(Number(OCID) === Number(callbackOCID)) {
                    delete countersParameters[zabbixHostname][counters[zabbixHostname][num].key.toLowerCase()].callbacks[OCID];
                    foundCallbackForDelete = true;
                    existingOCIDs.push(OCID + ':' + zabbixHostname + '(' + counters[zabbixHostname][num].key + ')');
                }
            }
            if(foundCallbackForDelete) {
                if(!Object.keys(countersParameters[zabbixHostname][counters[zabbixHostname][num].key.toLowerCase()].callbacks).length) {
                    delete countersParameters[zabbixHostname][counters[zabbixHostname][num].key.toLowerCase()];
                    counters[zabbixHostname][num] = null; // don't delete array item for saving order of 'num'
                }
            }
        }
        delete countersIDX[OCID];
        delete countersForRemove[OCID];
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
        counters = {};
        countersParameters = {};
        agentSessions = {};
        isServerRunning = false;
        stopServerInProgress = false;
        throttling.remove();
        callback(err);
    });
}

function createServer() {
    server = net.createServer(function(socket){
		// 'connection' listener
		//log.debug('Client connected: ', socket.remoteAddress, ':', socket.remotePort, '->', socket.localAddress, ':', socket.localPort);

        var data = Buffer.alloc(0);
        var isHeaderOK = false;
        var dataLength = 0;

        socket.on('data', function(dataPart){
            data = Buffer.concat([data, Buffer.from(dataPart)]);

            // checking is header correct or not and get length of received data
            if(!isHeaderOK && data.length >= headerLength) {
                var header = data.toString('utf8', 0, 4);
				var version = data.readInt8(4);

				if (header !== "ZBXD" || version !== 1){
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

            if(data.length === dataLength+headerLength){

                //log.debug('ZBX: header + data length: ', (dataLength + headerLength), ', real data length: ', data.length, ', data: ', data);

                var resultStr = data.toString('utf8', headerLength);

                var result;
                try {
                    result = JSON.parse(resultStr);
                } catch(err) {
                    socket.destroy();
                    return log.error(errorMessage + 'can\'t parse JSON in response: '+err.message);
                }

                if(!result || !result.request){
                    socket.destroy();
                    return log.error(errorMessage + 'error in request');
                }

                if(result.request.toLowerCase() === 'active checks'){
                    reqActiveChecks(result.host, socket, function(err, data) {
                        sendToZabbix(err, data, socket);
                        socket.destroy();
                    });
                // "agent data" for zabbix active protocol. "sender data" for zabbix trapper protocol
                } else if(result.request.toLowerCase() === 'agent data' || result.request.toLowerCase() === 'sender data') {
                    reqAgentData(result, function(err, data) {
                        sendToZabbix(err, data, socket);
                        //socket.destroy();
                    });
                } else {
                    log.error(errorMessage, 'unknown request: ', result.request, ': ', result);
                    socket.destroy();
                }
            } else if(data.length > dataLength+headerLength) {
                socket.destroy();
                return log.error(errorMessage + 'received data length (', data.length,') is more than specified in header (',(dataLength+headerLength),')');
            }

            //log.debug('ZBX rcv ',socket.remoteAddress, ':', socket.remotePort,': length: ',data.length,', data: ', data.toString());
        });

        socket.on('error', function(err){
            log.warn('Active check socket error: ', err.message, ' for: ', socket.remoteAddress, ':', socket.remotePort, '->', socket.localAddress, ':', socket.localPort);
        });
	});

	server.on('error', function(err) {
		log.error('Active check server error: ', err.message, '. Try to restart');

        setTimeout(function(){
            stopServer(function(err){
                if(err) log.error('Error while stopping server: ', err.message);
                isServerRunning = true;
                createServer();
            });
        }, 1000);
	});

    server.listen(serverPort, function() {
        log.info('Server bound to TCP port: ', serverPort);
    });
}

function sendToZabbix(err, data, socket){
    if(err) {
        log.warn(errorMessage, err.message);
        data = JSON.stringify({response: 'error'});
    }

    if(!data || typeof data !== 'string') {
        log.error(errorMessage, 'try to return undefined or not string data');
        data = JSON.stringify({response: 'error'});
    }

    var zabbixData = Buffer.from('ZBXDVLLLLLLLL');
    zabbixData.writeInt8(1, 4);
    zabbixData.writeUInt32LE(data.length, 5);
    zabbixData.writeUInt32LE(0, 9);
    zabbixData = Buffer.concat([zabbixData, Buffer.from(data)]);

    //log.debug('ZBX send ', socket.remoteAddress, ':', socket.remotePort,': length: ',data.length,', data: ', zabbixData.toString());

    // callback for async sending data
    socket.write(zabbixData, function (err) {
        if(err) log.info('Ca,\'t send data to zabbix: ', err.message);
    });
}

function reqActiveChecks(host, socket, callback) {
    if(!host) return callback(new Error('host not defined for active check request'));

    host = host.toLowerCase();

    if(!counters[host] || !counters[host].length) {
        return callback(new Error('active check not defined for host ' + host + ': ' +
            socket.remoteAddress + ':' + socket.remotePort + '->' + socket.localAddress + ':' + socket.localPort));
    }

    callback(null, JSON.stringify({
        response: 'success',
        // filter removed counters and Zabbix trappers. We don't splice removed counters array for save order
        data: counters[host].filter(function(obj) { return obj !== null && obj.delay; } ),
    }));
}

function reqAgentData(result, callback){
    if(!result.data || !result.data.length) return callback(new Error('unknown result for agent data'));

    var errCnt = 0;
    var timestamp = Date.now();
    async.each(result.data, function(data, callback){

        if(!data.host || typeof data.host  !== 'string' || !data.key || typeof data.key !== 'string' ||
            data.value === undefined /* || !data.clock || !data.ns */) {

            log.error('Error while received zabbix data, not all required parameters are defined: host: ', data.host,
                    ', key: ', data.key, ', clock: ', data.clock, ', ns: ', data.ns, ', value: ', data.value, ': ', data);
            errCnt++;
            return callback();
        }

        if(result.session && data.id !== undefined) {
            if(!agentSessions[result.session]) agentSessions[result.session] = data.id;
            else {
                if(agentSessions[result.session] < data.id) agentSessions[result.session] = data.id;
                else {
                    log.warn('Duplicate data received: ', data ,'; received ID (', result.session, ':', data.id,
                        '), <= previous ID (', result.session , ':', agentSessions[result.session], ')');
                    return callback();
                }
            }
        }

        var zabbixHost = data.host.toLowerCase();
        var zabbixKey = data.key.toLowerCase();
        
        if(!countersParameters[zabbixHost] || !countersParameters[zabbixHost][zabbixKey] ||
            !countersParameters[zabbixHost][zabbixKey].callbacks ||
            typeof countersParameters[zabbixHost][zabbixKey].callbacks !== 'object' ||
            !Object.keys(countersParameters[zabbixHost][zabbixKey].callbacks).length
        ) {
            log.info('Callback not defined or callback type is not a function for ', zabbixHost, '; key ',  zabbixKey);
            errCnt++;
            return callback();
        }

        if(data.state && logZabbixAgentErrors) {
            //console.log(logZabbixAgentErrorObtainPerformanceInformation, data.host, ':', data.key, ': ',data.value)
            if(logZabbixAgentErrorObtainPerformanceInformation ||
                data.value !== 'Cannot obtain performance information from collector.') {
                log.info('Zabbix agent returned error for active check ', data.host, ':', data.key, ': ', data.value);
            }
        }

        // return only numeric values
        if(countersParameters[zabbixHost][zabbixKey].onlyNumeric) {
            var value = Number(data.value);
            if(isNaN(parseFloat(String(value))) || !isFinite(value)) return callback();
        } else value = data.value;

        if(!throttling.check(zabbixHost + '-' + zabbixKey, value)) return callback();

        if (data.clock && data.ns &&
            Number(data.clock) === parseInt(String(data.clock), 10) &&
            Number(data.ns) === parseInt(String(data.ns), 10)) {

            var res = {
                value: value,
                timestamp: Math.round(Number(data.clock) * 1000 + (Number(data.ns) / 1000000)) // convert to milliseconds
            };
        } else res = value;

        for(var OCID in countersParameters[zabbixHost][zabbixKey].callbacks) {
            if(typeof countersParameters[zabbixHost][zabbixKey].callbacks[OCID] !== 'function') {
                log.info('Callback not defined or callback type is not a function for ', zabbixHost, '; key ',  zabbixKey, '; OCID: ', OCID);
                errCnt++;
                continue;
            }
            countersParameters[zabbixHost][zabbixKey].callbacks[OCID](null, res);
        }
        callback();

    }, function(err){
        if(err) return callback(err);

        return callback(null, JSON.stringify({
            response: 'success',
            info: 'processed: '+(result.data.length - errCnt)+'; failed: '+errCnt+'; total: '+result.data.length+' seconds spent: '+
                String((Date.now() - timestamp)/1000)
        }));
    });
}