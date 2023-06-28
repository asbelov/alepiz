/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var snmp = require("net-snmp");
var dns = require('dns');
var log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

collector.get = function(prms, callback) {

    if(!prms.host || !prms.OID) return callback(new Error('Can\'t get SNMP data: host or OIDs is not defined in collector parameters: ' + JSON.stringify(prms)));

    var OIDs = Array.isArray(prms.OID) ? prms.OID : prms.OID.split(/[,;]/);

    OIDs = OIDs.map(function(OID) {
        OID = OID.trim();
        if(OID.charAt(0) === '.') return OID.substring(1); // remove first dot from OIDs
        else return OID;
    });

// checking for Internet domain name
    if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(prms.host)) {
        var addressPrepare = dns.lookup; // dns.lookup(prms.host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

        // checking for IPv4 address family
    } else if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(prms.host)) { // IPv4
        addressPrepare = function(IPv4, callback) { callback(null, IPv4, 4);};
        // checking for IPv6 address family
    } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(prms.host)) { // IPv6
        addressPrepare = function(IPv6, callback) { callback(null, IPv6, 6);};
    } else return callback(new Error('Incorrect host name or IP address: ' + prms.host));

    // resolving IP address for internet domain name target
    addressPrepare(prms.host, function(err, address, family) {
        if (err) return callback(new Error('Can\'t resolve IP address for Internet domain host name ' + prms.host + ': ' + err.message));

        port = 161;
        if (prms.port) {
            var port = parseInt(prms.port, 10);
            if (!(port && port > 0 && port < 0xFFFF)) port = 161;
        }

        var timeout = parseInt(prms.timeout, 10);
        if(!timeout || timeout < 1) timeout = 3000;
        else timeout *= 1000; // convert seconds to milliseconds;

        var version = prms.version === 1 ? snmp.Version1 : snmp.Version2c;
        var retries = Number(prms.retries) === parseInt(String(prms.retries), 10) ? Number(prms.retries) : 1;

        // Default options
        var options = {
            port: port, // default 161
            retries: retries,
            //sourceAddress:
            //sourcePort:
            timeout: timeout, // default 5000 ms
            transport: (family === 4 ? 'udp4' : 'udp6') , // udp6 or udp4
            trapPort: 162,
            version: version,
            idBitsSize: 32 // Either 16 or 32, defaults to 32. Used to reduce the size of the generated id for compatibility with some older devices.
        };

        // sometime we halt with error "InvalidAsn1Error"
        try {
            var session = snmp.createSession(address, prms.community, options);
        } catch (e) {
            return callback(new Error('Can\'t create SNMP session for ' + prms.host + '(' + address + '), OIDs: "' + OIDs.join(',') + '": ' + e.message));
        }

        try {
            session.get(OIDs, function (errorMessage, varBinds) {
                try { session.close(); }
                catch(e) { log.warn('Can\'t close SNMP session for ' + prms.host + '(' + address + '), OIDs: "' + OIDs.join(',') + '": ' + e.message); }

                if (errorMessage || !varBinds || !Array.isArray(varBinds))
                    return callback(new Error('Error getting SNMP data from host: ' + prms.host +
                        '(' + address + '), OIDs: "' + OIDs.join(',') + '": ' +
                        (errorMessage ? errorMessage : ' result is empty')));

                for (var i = 0, errorMessages = [], results = []; i < varBinds.length; i++) {
                    if (snmp.isVarbindError(varBinds[i])) errorMessages.push('"' + varBinds[i].OID + '": ' + snmp.varbindError(varBinds[i]));
                    else {
                        if(Buffer.isBuffer(varBinds[i].value)) results.push(varBinds[i].value.toString('utf8'));
                        else results.push(varBinds[i].value);
                    }
                }

                if(errorMessages.length) log.info('Receiving errors while getting SNMP from host: ' + prms.host +
                    '(' + address + '), OIDs: ' + errorMessages.join('; '));

                callback(null, Array.isArray(prms.OID) || prms.OID.split(/[,;]/).length > 1 ? results : results[0]);
            });
        } catch (e) {
            callback(new Error('Can\'t get data by SNMP: ' + e.message));
        }
    });
};
