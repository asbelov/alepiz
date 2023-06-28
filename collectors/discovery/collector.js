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
const Conf = require('../../lib/conf');
const conf = new Conf('config/common.json');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/discovery/settings.json');

var collector = {};
module.exports = collector;

/** When true, then break all scanning processes
 * @type {boolean}
 */
var stopScanning = false;
/** scanID[OCID][ID] where ID is a Date.now()
 * @type {Object}
 */
var scanIDs = new Map();
/** path to the file for save last discovered IP address in the ranges. For continue discovery after stop
 * @type {string}
 */
var discoveryIPFile = path.join(conf.get('tempDir') || 'temp', confSettings.get('discoveryIP'));

/** Scanning hosts in specified IP ranges using ping, DNS name lookup, SNMP and zabbix
 *
 * @param {Object} param Object with scanning parameters
 * @param {uint} param.$id - OCID (automatic set)
 * @param {string} param.ranges - comma separated IP rages (f.e. "192.168.1.1-192.168.1.254,172.10.1.1-172.10.5.2")
 * @param {uint} [param.sleep=30] - sleep time in seconds between host scanning
 * @param {uint} [param.scanRepetitionTime]  - sleep time in seconds between ranges scanning. If not set, scanning specified IP ranges once
 * @param {boolean} [param.usePing] - use ping for scan host
 * @param {boolean} [param.getHostname] - use DNS lookup hostname when scanning host
 * @param {boolean} [param.useSNMP] - use SNMP protocol when scanning host
 * @param {string} [param.SNMPCommunity='public'] - SNMP community for SNMP protocol
 * @param {string|Array} param.SNMPOIDs] - comma separated SNMP OIDs. It will be converted to array after
 * @param {boolean} [param.useZabbix] - use zabbix protocol when scanning host
 * @param {string|Array} [param.zabbixItems] - comma separated Zabbix items for scanning. It will be converted to array after
 * @param {string} [param.zabbixPort] - Zabbix server port for passive check
 * @param {function(Error)|function(null, result)} callback
 */
collector.get = function(param, callback) {
    var ID = Date.now();
    param.$id = Number(param.$id);

    log.info('Starting scan hosts for IP ranges ', param.ranges, '; ID: ', param.$id,
        ', starting at ', (new Date(ID).toLocaleString()));

    param.sleep = parseInt(String(param.sleep), 10);
    if (!param.sleep || param.sleep < 0) param.sleep = 30000;
    else param.sleep *= 1000;

    var IPs = prepareIPsForScan(param.ranges, param.$id);

    if (!IPs || !IPs.length || (param.useSNMP && !param.SNMPOIDs) || (param.useZabbix && !param.zabbixItems)) {
        log.error('Error in discovery parameters: ', param);
        return callback({ IP: 0 });
    }

    param.SNMPOIDs = param.SNMPOIDs.split(/ *[,;] */);
    param.zabbixItems = param.zabbixItems.split(/ *[,;] */);


    if (!(scanIDs.get(param.$id) instanceof Map)) scanIDs.set(param.$id, new Map());
    else {
        log.info('Scanning hosts for IP ranges ', param.ranges, ' for ID: ', param.$id,
            ' in progress. Add new scan process and mark other processes (',
            scanIDs.get(param.$id), ') for terminate');
        for (var oldID of scanIDs.get(param.$id).keys()) scanIDs.get(param.$id).set(oldID, false);
    }
    scanIDs.get(param.$id).set(ID, true);

    scan(IPs, param, ID, callback);
};

/** remove specified counters from scan
 *
 * @param {Array} OCIDs - Array of integer OCIDs for removing
 * @param {function()} callback - called when done without parameters
 */
collector.removeCounters = function(OCIDs, callback) {
    if (!OCIDs.length) return callback();

    var findIDs = [];
    OCIDs.forEach(function(OCID) {
        OCID = Number(OCID);
        if (scanIDs.has(OCID)) {
            scanIDs.get(OCID).forEach(function(value, ID) {
                scanIDs.get(OCID).set(ID, false);
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

    if (findIDs.length) log.info('Receiving message for stop scan for IDs', findIDs);

    callback();
};

/** Set stopScanning to true for stop scanning host when destroying collector
 * @param {function()} callback - called when set stopScanning = true.
 */
collector.destroy = function(callback) {

    stopScanning = true;
    callback();
};

/** Converting comma separated IPv4 or IPv6 ranges to array of IP addresses
 *
 * @param {string} ranges - comma separated IP rages (f.e. "192.168.1.1-192.168.1.254,172.10.1.1-172.10.5.2")
 * @param {uint} id - OCID
 * @param {boolean} [runFromBeginning] - load last scanned IP address from file for start scan from it
 * @returns {Array|undefined} - return array of IP addresses or undefined when error occurred
 */
function prepareIPsForScan(ranges, id, runFromBeginning) {
    if (discoveryIPFile && !runFromBeginning) {
        try {
            var currentIP = fs.readFileSync(discoveryIPFile + '-' + id).toString();
        } catch (e) {
            log.error('Can\'t load last discovered IP address from file ', discoveryIPFile + '-' + id, ': ', e.message);
        }
    }

    if (!ranges) {
        log.error('Nothing to discovery. IP ranges were not specified');
        return;
    }

    var IPs = [];
    ranges.split(/ *[;,] */).forEach(function(range) { // ranges separator can be a ',' or ';'
        var firstLastIPs = range.split(/ *- */); // IPs separator is a '-'
        if (firstLastIPs.length === 2) {
            var firstIP = firstLastIPs[0];
            var lastIP = firstLastIPs[1];
        } else firstIP = lastIP = range; // range is a single IP address

        if (/^((\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(firstIP) &&
            /^((\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])\.){3}(\d|[1-9]\d|1\d{2}|2[0-4]\d|25[0-5])$/.test(lastIP)) { // IPv4
            var family = 4;
        } else if (/^(([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,7}:|([\da-fA-F]{1,4}:){1,6}:[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,5}(:[\da-fA-F]{1,4}){1,2}|([\da-fA-F]{1,4}:){1,4}(:[\da-fA-F]{1,4}){1,3}|([\da-fA-F]{1,4}:){1,3}(:[\da-fA-F]{1,4}){1,4}|([\da-fA-F]{1,4}:){1,2}(:[\da-fA-F]{1,4}){1,5}|[\da-fA-F]{1,4}:((:[\da-fA-F]{1,4}){1,6})|:((:[\da-fA-F]{1,4}){1,7}|:)|fe80:(:[\da-fA-F]{0,4}){0,4}%[\da-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([\da-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/.test(firstIP) &&
            /^(([\da-fA-F]{1,4}:){7}[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,7}:|([\da-fA-F]{1,4}:){1,6}:[\da-fA-F]{1,4}|([\da-fA-F]{1,4}:){1,5}(:[\da-fA-F]{1,4}){1,2}|([\da-fA-F]{1,4}:){1,4}(:[\da-fA-F]{1,4}){1,3}|([\da-fA-F]{1,4}:){1,3}(:[\da-fA-F]{1,4}){1,4}|([\da-fA-F]{1,4}:){1,2}(:[\da-fA-F]{1,4}){1,5}|[\da-fA-F]{1,4}:((:[\da-fA-F]{1,4}){1,6})|:((:[\da-fA-F]{1,4}){1,7}|:)|fe80:(:[\da-fA-F]{0,4}){0,4}%[\da-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([\da-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/.test(lastIP)) { // IPv6)
            family = 6;
        } else return log.error('Incorrect IP addresses for make scan range: ', firstIP,
            (firstIP !== lastIP ? ':' + lastIP : ''), ' (', range, ') form IP ranges: ', ranges);

        if (firstIP === lastIP) IPs.push(firstIP);
        else Array.prototype.push.apply(IPs, createIPsList(firstIP, lastIP, family));
    });

    // IPs = [192.168.0.1, 192.168.1.2, 192.168.1.3, 192.168.1.4, 192.168.1.5]; currentIP 192.168.1.3 (idx = 3)
    // IPs.splice(0, 2) = [192.168.1.4, 192.168.1.5]
    if (currentIP) {
        var idx = IPs.indexOf(currentIP); // idx can be from 0 to IPs.length-1
        if (idx !== -1 && idx !== 0) IPs.splice(0, idx); // remove all elements before idx
    }

    log.debug('IP address from previous discovery scan is ', currentIP, '; IP addresses for scan: ', IPs);

    return IPs;
}

/** Start scan IP addresses
 *
 * @param {Array} IPs - array of IP addresses
 * @param {Object} param - parameters from collector.get() function
 * @param {uint} ID - scan ID - timestamp (Date.now()) when range add to scan
 * @param {function(Error)|function(null, string)} callback - called when done. Return error or
 * stringified object with data of scan for every founded object
 * or string like '{"scanTime": ' + (Date.now() - startTime)+ '}' when scanning ranges is done
 * @example
 * // result returned
 *  {
 *      "ping":1,
 *      "IP":"127.0.0.1",
 *      "hostname": "PAD-ASBEL",
 *      "SNMP": "Hardware: Intel64 Family 6 Model 142 Stepping 10 AT/AT COMPATIBLE - Software: Windows Version 6.3 (Build 19043 Multiprocessor Free)",
 *      "zabbix": {
 *          "system.hostname":"PAD-ASBEL",
 *          "system.uname":"Windows PAD-ASBEL 10.0.19043 Microsoft Windows 10 Pro x64"
 *      }
 *  }
 */
function scan(IPs, param, ID, callback) {
    var startTime = Date.now();
    var myDiscoveryFile = discoveryIPFile + '-' + param.$id;

    async.eachSeries(IPs, function(IP, asyncCallback) {
        if (stopScanning || (scanIDs.has(param.$id) && scanIDs.get(param.$id).get(ID) === false)) return asyncCallback(true);

        log.info('Scanning host ', IP, ' from IP ranges ', param.ranges, '; ID: ', param.$id,
            ', scan was started at ', (new Date(ID).toLocaleString()));
        scanHost(IP, param, function(err, result) {
            if (stopScanning || (scanIDs.has(param.$id) && scanIDs.get(param.$id).get(ID) === false)) return asyncCallback(true);

            if (myDiscoveryFile) {
                try {
                    fs.writeFileSync(myDiscoveryFile, IP);
                } catch (e) {
                    log.error('Can\'t save current IP to ', myDiscoveryFile, ': ', e.message);
                }
            }

            if (result && Object.keys(result).length) {
                result.IP = IP;
                callback(null, JSON.stringify(result));
            }

            if (Object.keys(result).length === 1 || (Object.keys(result).length === 2 && result.ping === 0)) asyncCallback();
            else {
                var t = setTimeout(asyncCallback, param.sleep);
                t.unref();
            }
        });
    }, function(stop) {
        if (stop) {
            scanIDs.get(param.$id).delete(ID);
            if (!scanIDs.get(param.$id).size) {
                scanIDs.delete(param.$id);
                log.info('Stopping all processes for scan hosts for IP ranges ', param.ranges,
                    ', ID: ', param.$id, ', last process was started at ', (new Date(ID).toLocaleString()),
                    ', scan time: ', Math.round((Date.now() - startTime) / 1000), 'sec');
            } else {

                log.info('Stopping one of process for scan hosts for IP ranges ', param.ranges,
                    ', ID: ', param.$id, ', process was started at ', (new Date(ID).toLocaleString()),
                    ', scan time: ', Math.round((Date.now() - startTime) / 1000), 'sec')
            }

            if (!scanIDs.size) {
                log.info('All scan processes was stopped');
                stopScanning = false;
            }
            return;
        }

        if (param.scanRepetitionTime &&
            Number(param.scanRepetitionTime) === parseInt(param.scanRepetitionTime, 10) &&
            param.scanRepetitionTime > 0) {

            log.info('Restarting scan hosts for IP ranges ', param.ranges, ' after ',
                param.scanRepetitionTime, 'sec, starting at ', (new Date(ID).toLocaleString()), ', scanning time: ',
                Math.round((Date.now() - startTime) / 1000), 'sec');

            IPs = prepareIPsForScan(param.ranges, param.$id, true);
            var t = setTimeout(scan, Number(param.scanRepetitionTime) * 1000, IPs, param, ID, callback);
            t.unref();
        } else {
            scanIDs.get(param.$id).delete(ID);
            if (!scanIDs.get(param.$id).size) scanIDs.delete(param.$id);

            log.info('Scanning hosts for IP ranges ', param.ranges, ' is done, ID: ', param.$id,
                ', scan was started at ', (new Date(ID).toLocaleString()), ', scanning time: ',
                Math.round((Date.now() - startTime) / 1000), 'sec');
        }
        callback(null, '{"scanTime": ' + (Date.now() - startTime) + '}');
    });
}

/** Create array of IP addresses from IP range
 *
 * @param {string} firstIP - first IP address in a range
 * @param {string} lastIP  - last IP address in a range
 * @param {int} family - IP address family, can be 4 or 6
 * @returns {Array} - array of IP addresses
 */
function createIPsList(firstIP, lastIP, family) {

    if (family === 4)
        return makeIPsArray(firstIP.split('.'), lastIP.split('.'), '.', 10);

    if (family === 6)
        return makeIPsArray(convertIPv6To8GroupsRepresentation(firstIP), convertIPv6To8GroupsRepresentation(lastIP), ':', 16);

    function makeIPsArray(firstGroups, lastGroups, div, base) {
        for (var i = firstGroups.length - 1; i >= 0; i--) {
            var oldIPs = (IPs ? IPs.slice() : []),
                IPs = []; // copy IPs to oldIPs;
            for (var group = firstGroups[i]; group <= lastGroups[i]; group++) {
                if (i === firstGroups.length - 1) IPs.push(Number(group).toString(base));
                else {
                    for (var j = 0; j < oldIPs.length; j++) {
                        IPs.push(Number(group).toString(base) + div + oldIPs[j]);
                    }
                }
            }
        }
        return IPs;
    }

    function convertIPv6To8GroupsRepresentation(IP) {
        var groups = IP.split(':');

        if (groups.length === 8) return groups;

        var missingGroupsCnt = 8 - groups.length;
        for (var i = 0; i < groups.length; i++) {
            if (groups[i] === '') {
                groups[i] = 0x0000;
                if (i === 0) continue;

                for (var j = 0; j < missingGroupsCnt; j++) groups.splice(i, 0, 0x0000);
            } else groups[i] = parseInt(groups[i], 16);
        }

        return groups;
    }
}

/** Scan specific host for ping, DNS name lookup, SNMP and zabbix
 *
 * @param {string} IP - host IP address
 * @param {Object} param - parameters from {@member collector.get} function
 * @param {function(Error)|function(null, Object)} callback - return error or object with scan result
 * @example
 * // result returned
 *  {
 *      "ping":1,
 *      "IP":"127.0.0.1",
 *      "hostname": "PAD-ASBEL",
 *      "SNMP": "Hardware: Intel64 Family 6 Model 142 Stepping 10 AT/AT COMPATIBLE - Software: Windows Version 6.3 (Build 19043 Multiprocessor Free)",
 *      "zabbix": {
 *          "system.hostname":"PAD-ASBEL",
 *          "system.uname":"Windows PAD-ASBEL 10.0.19043 Microsoft Windows 10 Pro x64"
 *      }
 *  }
 */
function scanHost(IP, param, callback) {

    var functions = {};

    if (param.usePing) functions.ping = function(callback) {
        var packetsCnt = 2;

        ping(IP, packetsCnt, function(err, RTT) {
            if (err) log.info(err.message);
            callback(null, RTT);
        });
    };

    if (param.getHostname) functions.hostname = function(callback) {
        // use OS resolve method instead of DNS resolving
        dns.lookupService(IP, 80, function(err, hostname) {
            if (err) log.info('Can\'t resolve IP address "', IP, '": ', err.message);
            if (/\.in-addr\.arpa/.test(hostname)) {
                log.info('Can\'t resolve IP address "', IP, '": no DNS record');
                hostname = undefined;
            }

            callback(null, hostname);
        });
    };

    if (param.useZabbix) functions.zabbix = function(callback) {

        var results = {};
        async.each(param.zabbixItems, function(item, callback) {
            zabbix.get({
                host: IP,
                port: param.zabbixPort,
                item: item,
                maxSkippingValues: 0, // disable throttling for discovery
            }, function(err, result) {

                if (err || result === undefined || result == null) log.info('Discovery zabbix error: ', err ? err.message : 'return ', result);
                else if (result) results[item] = result;
                callback(null);
            });
        }, function( /*err*/ ) {
            if (!Object.keys(results).length) return callback();

            callback(null, results);
        });


    };

    if (param.useSNMP) functions.SNMP = function(callback) {

        var results = {};

        SNMP.get({
            host: IP,
            community: param.SNMPCommunity || 'public',
            OID: param.SNMPOIDs
        }, function(err, resultsArray) {

            if (err) log.info(err.message);
            else {
                for (var i = 0; i < resultsArray.length; i++) {
                    results[param.SNMPOIDs[i]] = typeof resultsArray[i] === 'number' ? resultsArray[i] : resultsArray[i].toString();
                }
            }
            if (!Object.keys(results).length) return callback();
            if (Object.keys(results).length === 1) return callback(null, results[param.SNMPOIDs[0]]);
            callback(null, results);
        });
    };

    async.parallel(functions, callback); // callback(err, result) result: {ping: <RTT>, zabbix: <system.uname>, SNMP: <sysDescription>}
}


/** ping host using ping.exe
 *
 * @param {string} IP - host IP address
 * @param {uint} packetsCnt - packet number
 * @param {function(null, int)} callback - return when done. RTT - ping round trip time for specified host
 */
function ping(IP, packetsCnt, callback) {

    var RTT = 0,
        lastPacketSentTime = Date.now(),
        timeout = 3000;

    // external ping program settings
    // tested for Russian Windows 10
    var externalProgram = 'ping.exe',
        externalProgramArguments = ['-n', packetsCnt, '-w', timeout, IP],
        // for debugging
        //externalProgramArguments = ['-t', '-l', target.packetSize, '-w', target.timeout, '193.178.135.25'],
        regExpForExtractRTT = /^.*[=<](\d+)[^ \s\d][\s\S]*$/;

    // forking and remember child object to global variable for kill it, if needed
    var child = spawn(externalProgram, externalProgramArguments);


    // receiving data on stdout
    child.stdout.on('data', function(data) {

        // decode received buffer to UTF-8
        var stdout = recode.decode(data, 'cp866');
        // extracted RTT from received data. If failed, result will be equal to NaN
        var result = Number(stdout.replace(regExpForExtractRTT, "$1"));

        // console.log(result, ': ', stdout);

        // if RTT successfully extracted from stdout of external ping
        if (result) {
            if (!RTT) RTT = result;
            else RTT = (RTT + result) / 2;
        } else { // packet loss or stdout did not contain data about RTT
            // return packet loss only if last packet was sending more than <timeout> time ago
            if (Date.now() - lastPacketSentTime <= timeout) return;

            log.info('Packet LOSS for ', IP);
        }

        lastPacketSentTime = Date.now(); // set last packet set time to current time for packet loss processing
    });

    child.on('exit', function( /*code*/ ) {
        callback(null, RTT);
    });
}