/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var async = require('async');
var log = require('../../lib/log')(module);

var zabbix = require('../zabbix/collector');
var SNMP = require('../SNMP/collector');
var spawn = require('child_process').spawn; // for run external ping
var recode = require('../../lib/recode');
var dns = require('dns');
var path = require('path');
var fs = require('fs');
var conf = require('../../lib/conf');
conf.file('config/conf.json');

var collector = {};
module.exports = collector;
/*
    get data and return it to server

    param - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

var stopScanning = false;
var scanIDs = {};
var discoveryIPFile = path.join(conf.get('tempDir'), conf.get('collectors:discovery:discoveryIP'));

collector.get = function(param, callback) {
    var ID = Date.now();

    log.info('Starting scanning hosts in IP ranges ', param.ranges, '; ID: ', param.$id);

    param.sleep = parseInt(String(param.sleep), 10);
    if(!param.sleep) param.sleep = 30000;
    else param.sleep *= 1000;

    var IPs = prepareIPsForScan(param.ranges, param.$id);

    if(!IPs || !IPs.length || (param.useSNMP && !param.SNMPOIDs) || (param.useZabbix && !param.zabbixItems)) {
        log.error('Error in discovery parameters: ', param);
        return callback({IP: 0});
    }

    param.SNMPOIDs = param.SNMPOIDs.split(/[ ]*[,;][ ]*/);
    param.zabbixItems = param.zabbixItems.split(/[ ]*[,;][ ]*/);


    if(!scanIDs[param.$id]) scanIDs[param.$id] = {};
    scanIDs[param.$id][ID] = true;

    scan(IPs, param, ID, callback);
};

collector.removeCounters = function(OCIDs, callback) {
    if (!OCIDs.length) return callback();

    var findIDs = [];
    OCIDs.forEach(function (OCID) {
        if(scanIDs[OCID]) {
            Object.keys(scanIDs[OCID]).forEach(function (ID) {
                scanIDs[OCID][ID] = false;
            });
            findIDs.push(OCID);

            var myDiscoveryIPFile = discoveryIPFile + '-' + OCID;

            try {
                fs.unlinkSync(myDiscoveryIPFile);
                log.info('File ', myDiscoveryIPFile, ' was removed');
            } catch (err) {
                log.warn('Can\'t remove file ', myDiscoveryIPFile, ': ', err.message);
            }
        }
    });

    if(findIDs.length) log.info('Receiving message for stop scanning for IDs', findIDs);

    callback();
};

/*
    destroy objects when reinit collector
    destroy function is not required and can be skipping

    callback(err);
*/
collector.destroy = function(callback) {

    stopScanning = true;
    callback();
};

function prepareIPsForScan(ranges, id, runFromBeginning) {
    if(discoveryIPFile && !runFromBeginning) {
        try {
            var currentIP = fs.readFileSync( discoveryIPFile + '-' + id).toString();
        } catch (e) {
            log.error('Can\'t load last discovered IP address from file ', discoveryIPFile + '-' + id, ': ', e.message);
        }
    }

    if(!ranges) {
        log.error('Nothing to discovery. IP range not specified');
        return;
    }

    var IPs = [];
    ranges.split(/[ ]*[;,][ ]*/).forEach(function(range) { // ranges separator can be a ',' or ';'
        var firstLastIPs = range.split(/[ ]*-[ ]*/); // IPs separator is a '-'
        if(firstLastIPs.length === 2) {
            var firstIP = firstLastIPs[0];
            var lastIP = firstLastIPs[1];
        } else firstIP = lastIP = range; // range is a single IP address

        if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(firstIP) &&
            /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(lastIP)) { // IPv4
            var family = 4;
        } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(firstIP) &&
            /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(lastIP)) { // IPv6)
            family = 6;
        } else return log.error('Incorrect IP addresses for make scan range: ', firstIP,
            (firstIP !== lastIP ? ':' + lastIP : ''), ' (', range, ') form IP ranges: ', ranges);

        if(firstIP === lastIP) IPs.push(firstIP);
        else Array.prototype.push.apply(IPs, createIPsList(firstIP, lastIP, family));
    });

    // IPs = [192.168.0.1, 192.168.1.2, 192.168.1.3, 192.168.1.4, 192.168.1.5]; currentIP 192.168.1.3 (idx = 3)
    // IPs.splice(0, 2) = [192.168.1.4, 192.168.1.5]
    if(currentIP) {
        var idx = IPs.indexOf(currentIP); // idx can be from 0 to IPs.length-1
        if(idx !== -1 && idx !== 0) IPs.splice(0, idx); // remove all elements before idx
    }

    log.debug('IP address from previous discovery scan is ', currentIP, '; IP addresses for scan: ', IPs);

    return IPs;
}

function scan(IPs, param, ID, callback) {
    var startTime = Date.now();
    var myDiscoveryFile = discoveryIPFile + '-' + param.$id;

    async.eachSeries(IPs, function(IP, asyncCallback) {
        if(stopScanning || (scanIDs[param.$id] && scanIDs[param.$id][ID] === false)) {

            delete scanIDs[param.$id][ID];
            if(!Object.keys(scanIDs[param.$id]).length) delete scanIDs[param.$id];
            stopScanning = false;

            return asyncCallback(new Error('Stopping scanning hosts in IP range ' + param.ranges + ', ID: ' + param.$id));
        }

        scanHost(IP, param, function(err, result) {
            if(stopScanning || (scanIDs[param.$id] && scanIDs[param.$id][ID] === false)) return asyncCallback();

            if(myDiscoveryFile) {
                try {
                    fs.writeFileSync(myDiscoveryFile, IP);
                } catch (e) {
                    log.error('Can\'t save current IP to ', myDiscoveryFile, ': ', e.message);
                }
            }

            if(result && Object.keys(result).length) {
                result.IP = IP;
                callback(null, JSON.stringify(result));
            }

            if(Object.keys(result).length === 1 || (Object.keys(result).length === 2 && result.ping === 0)) asyncCallback();
            else setTimeout(asyncCallback, param.sleep);
        });
    }, function(err) {
        if(err) return log.info(err.message);

        if(param.scanRepetitionTime && Number(param.scanRepetitionTime) === parseInt(param.scanRepetitionTime, 10)) {
            log.info('Restarting scanning hosts in IP range ', param.ranges, ' after ', param.scanRepetitionTime, 'sec');
            setTimeout(scan,
                Number(param.scanRepetitionTime) * 1000,
                prepareIPsForScan(param.ranges, param.$id,true), param, ID, callback);
        } else {
            log.info('Scanning hosts in IP range ', param.ranges, ' is done, ID: ', param.$id);
        }
        callback(null, '{"scanTime": ' +(Date.now() - startTime)+ '}');
    });
}

function createIPsList(firstIP, lastIP, family) {

    if(family === 4)
        return makeIPsArray(firstIP.split('.'), lastIP.split('.'), '.', 10);

    if(family === 6)
        return makeIPsArray(convertIPv6To8GroupsRepresentation(firstIP), convertIPv6To8GroupsRepresentation(lastIP), ':', 16);

    function makeIPsArray(firstGroups, lastGroups, div, base) {
        for(var i = firstGroups.length - 1; i >= 0; i--) {
            var oldIPs = (IPs ? IPs.slice() : []), IPs = []; // copy IPs to oldIPs;
            for(var group = firstGroups[i]; group <= lastGroups[i]; group++) {
                if(i === firstGroups.length - 1) IPs.push(group.toString(base));
                else {
                    for (var j = 0; j < oldIPs.length; j++) {
                        IPs.push(group.toString(base) + div + oldIPs[j]);
                    }
                }
            }
        }
        return IPs;
    }

    function convertIPv6To8GroupsRepresentation(IP) {
        var groups = IP.split(':');

        if(groups.length === 8) return groups;

        var missingGroupsCnt = 8 - groups.length;
        for(var i = 0; i < groups.length; i++) {
            if(groups[i] === '') {
                groups[i] = 0x0000;
                if(i === 0) continue;

                for(var j = 0; j < missingGroupsCnt; j++) groups.splice(i, 0, 0x0000);
            } else groups[i] = parseInt(groups[i], 16);
        }

        return groups;
    }
}

function scanHost(IP, param, callback) {

    var functions = {};

    if(param.usePing) functions.ping = function(callback) {
        var packetsCnt = 2;

        ping(IP, packetsCnt, function(err, RTT) {
            if(err) log.info(err.message);
            callback(null, RTT);
        });
    };

    if(param.getHostname) functions.hostname = function(callback) {
        // use OS resolve method instead of DNS resolving
        dns.lookupService(IP, 80, function(err, hostname) {
            if(err) log.info('Can\'t resolve IP address "', IP, '": ', err.message);
            if(/\.in-addr\.arpa/.test(hostname)) {
                log.info('Can\'t resolve IP address "', IP, '": no DNS record');
                hostname = undefined;
            }

            callback(null, hostname);
        });
    };

    if(param.useZabbix) functions.zabbix = function(callback) {

        var results = {};
        async.each(param.zabbixItems, function(item, callback) {
            zabbix.get({
                host: IP,
                port: param.zabbixPort,
                item: item,
                maxSkippingValues: 0, // disable throttling for discovery
            }, function (err, result) {

                if (err || result === undefined || result == null) log.info('Discovery zabbix error: ', err ? err.message : 'return ', result);
                else if(result) results[item] = result;
                callback(null);
            });
        }, function(/*err*/) {
            if(!Object.keys(results).length) return callback();

            callback(null, results);
        });


    };

    if(param.useSNMP) functions.SNMP = function(callback) {

        var results = {};

        SNMP.get({
            host: IP,
            community: param.SNMPCommunity,
            OID: param.SNMPOIDs
        }, function(err, resultsArray) {

            if(err) log.info(err.message);
            else {
                for(var i = 0; i < resultsArray.length; i++) {
                    results[param.SNMPOIDs[i]] = typeof resultsArray[i] === 'number' ? resultsArray[i] : resultsArray[i].toString();
                }
            }
            if(!Object.keys(results).length) return callback();
            if(Object.keys(results).length === 1) return callback(null, results[param.SNMPOIDs[0]]);
            callback(null, results);
        });
    };

    async.parallel(functions, callback); // callback(err, result) result: {ping: <RTT>, zabbix: <system.uname>, SNMP: <sysDescr>}
}


function ping(IP, packetsCnt, callback) {

    var RTT = 0, lastPacketSentTime = Date.now(), timeout = 3000;

    // external ping program settings
    // tested for Russian Windows 10
    var externalProgram = 'ping.exe',
        externalProgramArguments = ['-n', packetsCnt, '-w', timeout, IP],
        // for debugging
        //externalProgramArguments = ['-t', '-l', target.packetSize, '-w', target.timeout, '193.178.135.25'],
        regExpForExtractRTT = /^.*[=<]([\d]+)[^ \s\d][\s\S]*$/;

    // forking and remember child object to global variable for kill it, if needed
    var child = spawn(externalProgram, externalProgramArguments);


    // receiving data on stdout
    child.stdout.on('data', function(data) {

        // decode received buffer to UTF-8
        var stdout = recode.decode(data, 'cp866');
        // extracted RTT from received data. If fail, result will be equal to NaN
        var result = Number(stdout.replace(regExpForExtractRTT, "$1"));

        // console.log(result, ': ', stdout);

        // if RTT successfully extracted from stdout of external ping
        if (result) {
            if(!RTT) RTT = result;
            else RTT = (RTT + result) / 2;
        } else { // packet loss or stdout did not contain data about RTT
            // return packet loss only if last packet was sending more then <timeout> time ago
            if(Date.now() - lastPacketSentTime <= timeout) return;

            log.info('Packet LOSS for ', IP);
        }

        lastPacketSentTime = Date.now(); // set last packet set time to current time for packet loss processing
    });

    child.on('exit', function(/*code*/) {
        callback(null, RTT);
    });
}

