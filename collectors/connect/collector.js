/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var net = require('net');
var dns = require('dns');
var async = require('async');
var log = require('../../lib/log')(module);


var collector = {};
module.exports = collector;


collector.get = function(param, callback) {

    if(!param.hosts) return callback(new Error('Hosts is not set: ' + JSON.stringify(param)));
    if(!param.port)  return callback(new Error('port is not set: ' + JSON.stringify(param)));

	var hostsArray = param.hosts.split(/ *[,;] */), checkedHosts = [];
	if(!hostsArray || !hostsArray.length) return callback(null, '');

    var socketTimeout = param.socketTimeout &&
        Number(param.socketTimeout) === parseInt(String(param.socketTimeout), 10) &&
        Number(param.socketTimeout) > 1 ?
        Number(param.socketTimeout) : 10000;

    async.each(hostsArray, function(host, callback) {
        checkHost(param.localAddress, function(err, addressSrc/*, family*/) {
            if (err) {
                log.error('Can\'t resolve IP address for Internet domain host name using for binding to local address ',
                    param.localAddress, ': ', err.message);
                return callback();
            }

            checkHost(host, function(err, addressDst/*, family*/) {
                if (err) {
                    log.error('Can\'t resolve IP address for Internet domain host name ', host, ': ', err.message);
                    return callback();
                }
                var isCallbackCalled = false;
                var socket = net.connect({
                    host: addressDst,
                    port: param.port,
                    localAddress: addressSrc,
                    timeout: socketTimeout,
                }, function () {
                    checkedHosts.push(host);
                    socket.destroy();
                    if(!isCallbackCalled) {
                        isCallbackCalled = true;
                        callback();
                    }

                });

                socket.on('end', function() {
                    if(!isCallbackCalled) {
                        isCallbackCalled = true;
                        callback();
                    }
                });
                socket.on('error', function() {
                    if(!isCallbackCalled) {
                        isCallbackCalled = true;
                        callback();
                    }
                });
                socket.on('timeout', function() {
                    socket.destroy();
                    if(!isCallbackCalled) {
                        isCallbackCalled = true;
                        callback();
                    }
                });
            });
        });
        
    }, function(err) {
        callback(err, checkedHosts.join(','));
    });
};

function checkHost(host, callback) {
    if(!host) return callback(null, null, 4);
    // Returns 0 for invalid strings, returns 4 for IP version 4 addresses, and returns 6 for IP version 6 addresses.
    var IPFamily = net.isIP(host);
    if(IPFamily) return callback(null, host, IPFamily);
    else return dns.lookup(host, callback);
    // dns.lookup(host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6
}