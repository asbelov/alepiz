/*
 * Copyright (C) 2015. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created by Alexander Belov on 24.07.2015.
 */
var net = require('net');
var dns = require('dns');
var log = require('../../lib/log')(module);
var throttling = require('../../lib/throttling');


var collector = {};
module.exports = collector;

var ZBX_NOTSUPPORTED_Length = String('ZBX_NOTSUPPORTED').length;
var minResponseLength = String('ZBXD').length + 1 + 8 + 1;

collector.get = function(param, callback) {

    if(param.itemParameters) param.itemParameters = '['+param.itemParameters+']';
    else param.itemParameters= '';

	var sentData = param.item + param.itemParameters;
    var errorMessage = 'Zabbix agent error for ' + param.host + ':' + param.port + ':' + sentData + ': ';
    sentData += '\n';

    var addressPrepareDst;
    // checking for Internet domain name
    if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z\d\-]*[a-zA-Z\d])\.)*([A-Za-z]|[A-Za-z][A-Za-z\d\-]*[A-Za-z\d])$/.test(param.host)) {
        addressPrepareDst = dns.lookup; // dns.lookup(param.host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

        // checking for IPv4 address family
    } else if(/^((\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(param.host)) { // IPv4
        addressPrepareDst = function(IPv4, callback) { callback(null, IPv4, 4); };
        // checking for IPv6 address family
    } else if(/^(([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,7}:|([\da-fA-F]{1,4}:){1,6}:[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,5}(:[\da-fA-F]{1,4}){1,2}|([\da-fA-F]{1,4}:){1,4}(:[\da-fA-F]{1,4}){1,3}|([\da-fA-F]{1,4}:){1,3}(:[\da-fA-F]{1,4}){1,4}|([\da-fA-F]{1,4}:){1,2}(:[\da-fA-F]{1,4}){1,5}|[\da-fA-F]{1,4}:((:[\da-fA-F]{1,4}){1,6})|:((:[\da-fA-F]{1,4}){1,7}|:)|fe80:(:[\da-fA-F]{0,4}){0,4}%[\da-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([\da-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/.test(param.host)) { // IPv6
        addressPrepareDst = function(IPv6, callback) { callback(null, IPv6, 6); };
    } else {
        log.error('Incorrect host name or IP address: ' + param.host);
        return callback();
    }

    var addressPrepareSrc;
    if(!param.localAddress) {
        addressPrepareSrc = function(noAddress, callback) { callback(null, noAddress); };
    } else if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z\d\-]*[a-zA-Z\d])\.)*([A-Za-z]|[A-Za-z][A-Za-z\d\-]*[A-Za-z\d])$/.test(param.localAddress)) {
        addressPrepareSrc = dns.lookup; // dns.lookup(param.host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

        // checking for IPv4 address family
    } else if(/^((\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(param.localAddress)) { // IPv4
        addressPrepareSrc = function(IPv4, callback) { callback(null, IPv4, 4); };
        // checking for IPv6 address family
    } else if(/^(([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,7}:|([\da-fA-F]{1,4}:){1,6}:[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,5}(:[\da-fA-F]{1,4}){1,2}|([\da-fA-F]{1,4}:){1,4}(:[\da-fA-F]{1,4}){1,3}|([\da-fA-F]{1,4}:){1,3}(:[\da-fA-F]{1,4}){1,4}|([\da-fA-F]{1,4}:){1,2}(:[\da-fA-F]{1,4}){1,5}|[\da-fA-F]{1,4}:((:[\da-fA-F]{1,4}){1,6})|:((:[\da-fA-F]{1,4}){1,7}|:)|fe80:(:[\da-fA-F]{0,4}){0,4}%[\da-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([\da-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/.test(param.localAddress)) { // IPv6
        addressPrepareSrc = function(IPv6, callback) { callback(null, IPv6, 6); };
    } else {
        log.error('Incorrect host name or IP address: ' + param.host);
        return callback();
    }


    addressPrepareSrc(param.localAddress, function(err, addressSrc/*, family*/) {
        if (err) {
            log.error('Can\'t resolve IP address for Internet domain host name using for binding to local address ' + param.localAddress + ': ' + err.message);
            return callback();
        }

        addressPrepareDst(param.host, function(err, addressDst/*, family*/) {
            if (err) {
                log.error('Can\'t resolve IP address for Internet domain host name ' + param.host + ': ' + err.message);
                return callback();
            }


            var socket = net.connect({
                host: addressDst,
                port: param.port,
                localAddress: addressSrc,
                timeout: param.socketTimeout || 180000,
            }, function () {
                var zabbixData = Buffer.from('ZBXDVLLLLLLLL');
                zabbixData.writeInt8(1, 4);
                zabbixData.writeUInt32LE(sentData.length, 5);
                zabbixData.writeUInt32LE(0, 9);
                zabbixData = Buffer.concat([zabbixData, Buffer.from(sentData)]);
                // async write to socket
                socket.write(zabbixData, function(err) {
                    if(err) log.info('Can\'t write data to socket: ', err.message);
                }); // new protocol after zabbix-agent 4.0 with header
                //socket.write(data, function(err) { // old protocol, version before zabbix-agent 4.0 without header
                //    if(err) log.info('Can\'t write data to socket: ', err.message);
                //});
            });

            var data = Buffer.alloc(0);

            socket.on('data', function (dataPart) {
                data = Buffer.concat([data, Buffer.from(dataPart)]);
                //console.log('Zabbix agent received: ', dataPart);
            });

            socket.on('end', function() {
                var header, version, length;
                socket.destroy();

                //console.log('Zabbix agent received at the end: ', data);

                if (data.length < minResponseLength) {
                    data = Buffer.alloc(0);
                    log.error(errorMessage + 'response size too low');
                    return callback();
                }
                header = data.toString('utf8', 0, 4);
                version = data.readInt8(4);

                if (header !== "ZBXD" || version !== 1) {
                    data = Buffer.alloc(0);
                    log.error(errorMessage + 'incorrect header: ' + header + ':' + version);
                    return callback();
                }

                length = data.readUInt32LE(5);
                if (data.length !== (4 + 1 + 8 + length)) {
                    data = Buffer.alloc(0);
                    log.error(errorMessage + 'incorrect data length: ' + length);
                    return callback();
                }
                var result = data.toString('utf8', data.length - length);
                data = Buffer.alloc(0);

                if(result.indexOf('ZBX_NOTSUPPORTED') === 0) {
                    log.warn(errorMessage + data.toString('utf8', data.length - length + ZBX_NOTSUPPORTED_Length + 1));
                    result = null;
                }
                
                // return only numeric values
                if(param.onlyNumeric) {
                    result = Number(result);
                    if(isNaN(parseFloat(String(result))) || !isFinite(result)) return callback();
                }
                if(!throttling.check(param.$id, result, param, collector)) return callback();

                if(result && param.LLD) parseLLD(result, callback);
                else if(result && param.CSV) parseCSV(result, callback);
                else callback(null, result);
            });

            socket.on('error', function (err) {
                // use log.info() so that problems with host unavailability do not clog up the errors.log
                log.info(errorMessage, err.message);
                callback();
            });

            socket.on('timeout', function () {
                log.warn(errorMessage, 'socket timeout occurred: ', socket.timeout);
                socket.end();
            });
        });
    });
};
collector.removeCounters = throttling.remove;
collector.destroy = throttling.remove;

function parseLLD(result, callback) {
	var lldObject;
	try {
		lldObject = JSON.parse(result);
    } catch(err) {
		log.error('Can\'t parse JSON LLD object "' + JSON.stringify(result) + '": ' + err.message);
	    return callback();
	}

	// In zabbix-agent before 4.2 LDD object mast be an object {data: [...]}
	// In zabbix-agent 4.2 LDD object can be an array [...]
	if(!lldObject || (!Array.isArray(lldObject) && !Array.isArray(lldObject.data))) {
	    log.error('Error in LLD object: "' + result + '"');
        return callback();
    }


	callback(null, lldObject.data ? lldObject.data : lldObject);
    /*
	lldObject.data.forEach(function(obj) {
		callback(null, JSON.stringify(obj));
	});
	*/
}                      

function parseCSV(result, callback) {

    var lines = result.split(/[\r\n]+/).filter(function (line) {
        return !!line;
    });
    if(!lines.length) {
        log.error('Result has not lines and is not in a CSV format');
        return callback(new Error());
    }
    var headerString = lines.shift();
    var headers = headerString.split(',').map(function (header) {
        return header.replace(/^"(.*?)"$/, '$1');
    });
    if(!headers.length) {
        log.error('Result has not CSV header and is not in a CSV format');
        return callback();
    }
    var resultArray = [];
    lines.forEach(function (lineStr) {
        var line = lineStr.split(',');
        var obj = {};
        headers.forEach(function (header, i) {
            if(line[i] !== undefined)
                obj['{#' + header.toUpperCase() + '}'] = line[i].replace(/^"(.*?)"$/, '$1');
        });
        resultArray.push(obj);
    });
    callback(null, resultArray);
}