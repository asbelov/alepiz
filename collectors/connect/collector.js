var net = require('net');
var dns = require('dns');
var async = require('async');
var log = require('../../lib/log')(module);


var collector = {};
module.exports = collector;


collector.get = function(prms, callback) {

    if(!prms.hosts) return callback(new Error('Hosts is not set: ' + JSON.stringify(prms)));
    if(!prms.port)  return callback(new Error('port is not set: ' + JSON.stringify(prms)));

	var hostsArray = prms.hosts.split(/[ ]*[,;][ ]*/), checkedHosts = [];
	if(!hostsArray || !hostsArray.length) return callback(null, '');

    async.each(hostsArray, function(host, callback) {
		var addressPrepareDst;
        // checking for Internet domain name
        if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(host)) {
            addressPrepareDst = dns.lookup; // dns.lookup(host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

            // checking for IPv4 address family
        } else if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(host)) { // IPv4
            addressPrepareDst = function(IPv4, callback) { callback(null, IPv4, 4); };
            // checking for IPv6 address family
        } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(host)) { // IPv6
            addressPrepareDst = function(IPv6, callback) { callback(null, IPv6, 6); };
        } else {
            log.error('Incorrect host name or IP address: ' + host);
            return callback();
        }

        var addressPrepareSrc;
        if(!prms.localAddress) {
            addressPrepareSrc = function(noAddress, callback) { callback(null, noAddress); };
        } else if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(prms.localAddress)) {
            addressPrepareSrc = dns.lookup; // dns.lookup(host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

            // checking for IPv4 address family
        } else if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(prms.localAddress)) { // IPv4
            addressPrepareSrc = function(IPv4, callback) { callback(null, IPv4, 4); };
            // checking for IPv6 address family
        } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(prms.localAddress)) { // IPv6
            addressPrepareSrc = function(IPv6, callback) { callback(null, IPv6, 6); };
        } else {
            log.error('Incorrect host name or IP address: ' + host);
            return callback();
        }
        
        addressPrepareSrc(prms.localAddress, function(err, addressSrc/*, family*/) {
            if (err) {
                log.error('Can\'t resolve IP address for Internet domain host name using for binding to local address ' + prms.localAddress + ': ' + err.message);
                return callback();
            }

            addressPrepareDst(host, function(err, addressDst/*, family*/) {
                if (err) {
                    log.error('Can\'t resolve IP address for Internet domain host name ' + host + ': ' + err.message);
                    return callback();
                }

                var socket = net.connect({
                    host: addressDst,
                    port: prms.port,
                    localAddress: addressSrc
                }, function () {
                    socket.end();
                });

                socket.on('end', function(){
                    socket.end();
                    checkedHosts.push(host);
                    callback();
                });

                socket.on('error', function (err) {
                    log.info('Got an error while connecting to ', host, ':', prms.port, ': ', err.message);
                    callback();
                });
            });
        });
        
    }, function(err) {
        callback(err, checkedHosts.join(','));
    });
};
