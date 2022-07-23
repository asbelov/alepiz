/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-2-12 23:18:29
*/

var dns = require('dns');
//var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

collector.get = function(param, callback) {

    if(!param.host) {
        if(param.returnErrors) return callback(null, 'Host name is not set');
        else return callback(null, 0);
    }

    param.host = param.host.trim();
    
    if(/^((\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(param.host)) { // IPv4
        if(param.getHostname) addressPrepare = dns.reverse; // dns.reverse(param.host, function(err, [hostname1, hostname2,...]) {})
        else addressPrepare = function(IPv4, callback) { callback(null, IPv4, 4);};
        // checking for IPv6 address family
    } else if(/^(([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,7}:|([\da-fA-F]{1,4}:){1,6}:[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,5}(:[\da-fA-F]{1,4}){1,2}|([\da-fA-F]{1,4}:){1,4}(:[\da-fA-F]{1,4}){1,3}|([\da-fA-F]{1,4}:){1,3}(:[\da-fA-F]{1,4}){1,4}|([\da-fA-F]{1,4}:){1,2}(:[\da-fA-F]{1,4}){1,5}|[\da-fA-F]{1,4}:((:[\da-fA-F]{1,4}){1,6})|:((:[\da-fA-F]{1,4}){1,7}|:)|fe80:(:[\da-fA-F]{0,4}){0,4}%[\da-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([\da-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/.test(param.host)) { // IPv6
        if(param.getHostname) addressPrepare = dns.reverse; // dns.reverse(param.host, function(err, [hostname1, hostname2,...]) {})
        else addressPrepare = function(IPv6, callback) { callback(null, IPv6, 6);};
    } else if(!param.checkHostname || /^(([a-zA-Z]|[a-zA-Z][a-zA-Z\d\-]*[a-zA-Z\d])\.)*([A-Za-z]|[A-Za-z][A-Za-z\d\-]*[A-Za-z\d])$/.test(param.host)) {
        var addressPrepare = dns.lookup; // dns.lookup(param.host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6
        // checking for IPv4 address family
    } else {
        if(param.returnErrors) return callback(null, 'Incorrect host name or IP address: ' + param.host);
        else return callback(null, 0);
    }

    addressPrepare(param.host, function(err, result/*, family*/) {
        if(err) {
        	if(param.returnErrors) return callback(null, err.message);
            else return callback(null, 0);
        }
        return callback(null, result || 0);
    });
};