/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const recode = require('../../lib/recode');
const Conf = require("../../lib/conf");
const log = require('../../lib/log')(module);
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/ping/settings.json');


/*
Collector ping targets using raw-socket module.
!!! Return data in milliseconds, not seconds !!!
* forking process with raw-socket, received message from parent, pinging targets
* on packet loss collector stop pinging using internal raw-socket module, run external ping program and
* checking, is packet loss really occur. Because some time raw-socket skip packet, and it's needing for packet
* loss checking
* if external ping received 60 echo reply packets, collector try to switch to internal ping for target
* while new packet loss will occur
 */


// if(module.parent) {} === if(require.main !== module) {}
if(require.main !== module) initServerCommunication();
else runServerProcess(); //standalone server process


function initServerCommunication() {
    var cp = require('child_process');
    var spawn = require('child_process').spawn;
    var dns = require('dns');

    var collector = {};
    module.exports = collector;

    var targets = {},
        serverProcess,
        restartInProgress = 0,
        isServerInitialising = false,
        externalPingProcesses = {},
        pingServerRestartTime = Date.now();

    /*
    Killing all external ping programs
    Sending message to ping server for exiting
    reinitializing all global variables to default values
     */
    collector.destroy = function (callback) {
        log.debug('Receiving signal for destroying collector');

        for(var address in externalPingProcesses) {
            if(!externalPingProcesses.hasOwnProperty(address)) continue;

            log.info('Killing external ping program for ', targets[address] ? targets[address].host : 'UNKNOWN', '(', address, ')');
            if(externalPingProcesses[address] && typeof externalPingProcesses[address].kill === 'function') {
                externalPingProcesses[address].kill('SIGINT');
            }
        }

        if(serverProcess) {
            serverProcess.send({type: 'exit'});
            serverProcess = undefined;
        }
        isServerInitialising = false;
        targets = {};
        externalPingProcesses = {};

        if(typeof callback === 'function') return callback();
    };

    collector.removeCounters = function(OCIDs, callback) {
        if(!Object.keys(targets).length) return callback();

        var targetsInfo = [];
        Object.keys(targets).forEach(function(address) {
            if(OCIDs.indexOf(targets[address].OCID) !== -1) {

                targetsInfo.push(targets[address].host + '(' + address + ')');

                // destroying requested target
                if(serverProcess) serverProcess.send({type: 'destroyTarget', data: address });
                delete targets[address];
            }
        });

        if(targetsInfo.length) log.info('Complete destroyed targets: ', targetsInfo.join(', '));
        callback();
    };

    /*
        get data and return it to server

        param - object with collector parameters {<parameter1>: <value>, <parameter2>: <value>}
        callback(err, result)
        result - object {timestamp: <timestamp>, value: <value>} or simple value
    */

    collector.get = function(param, callback) {

        // checking for correct values
        if(typeof callback !== 'function') return log.error('Ping: callback is not a function');

        if(!param || !param.host) return callback(new Error('Ping: parameter host not defined'));

        if(!param.pingInterval || Number(param.pingInterval) < 1) param.pingInterval = 1000;
        else param.pingInterval = Number(param.pingInterval) * 1000; // convert seconds to milliseconds

        if(!param.packetsCnt || Number(param.packetsCnt) < 0) param.packetsCnt = 0;
        else param.packetsCnt = Number(param.packetsCnt);

        if(!param.timeout || Number(param.timeout) < 2) param.timeout = 3000;
        else param.timeout = Number(param.timeout) * 1000; // convert seconds to milliseconds;
        if(param.timeout < param.pingInterval){
            log.warn('Ping: ', param.host, '(', param.address || '', ') ping interval ', param.pingInterval/1000,
                ' more than ping timeout ', param.timeout/1000, '. Set timeout to ', (param.pingInterval + 3000)/1000);
            param.timeout = param.pingInterval + 3000;
        }

        if(!param.packetSize) param.packetSize = 64;
        else {
            param.packetSize = Number(param.packetSize);
            if(!param.packetSize) param.packetSize = 64;
            // 20 bytes IP headers + 28 bytes ICMP packet, contain 64 bit ICMP header, two 64 bit timestamp fields
            // and field with 32 bit sequence number
            else if(param.packetSize < 48) param.packetSize = 48;
            else if(param.packetSize > 4096) param.packetSize = 4096; // maximum size of ICMP package
        }

        param.packetSize -= 20; // subtract 20 bytes of IP header from packet size

        param.host = param.host.toLowerCase();

        // checking for Internet domain name
            // checking for IPv4 address family
        if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(param.host)) { // IPv4
            var addressPrepare = function(IPv4, callback) { callback(null, IPv4, 4);};
            // checking for IPv6 address family
        } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(param.host)) { // IPv6
            addressPrepare = function(IPv6, callback) { callback(null, IPv6, 6);};
        } else { // lookup IP by dns
            addressPrepare = dns.lookup; // dns.lookup(param.host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6
        }

        // resolving IP address for internet domain name target
        addressPrepare(param.host, function(err, address, family) {
            if(err) {
                // don't run callback(err) for retrying resolve host in the next time
                log.error('Can\'t resolve IP address for Internet domain host name ', param.host, ': ', err.message, ' Retry after 9 minutes');
                setTimeout(collector.get, 540000, param, callback);
                return;
            }

            // when restarting ping for this address, keep old sequenceNumber
            var sequenceNumber = targets[address] && targets[address].sequenceNumber ? targets[address].sequenceNumber : 0;

            targets[address] = {
                OCID: param.$id,
                host: param.host,
                address: address,
                interval: param.pingInterval,
                packetSize: param.packetSize,
                packetsCnt: param.packetsCnt,
                sequenceNumber: sequenceNumber,
                timeout: param.timeout,
                family: family,
                callback: callback
            };

            // running ping server if it was not ran before and sending target object to it for starting ping
            if(!isServerInitialising) {
                isServerInitialising = true;

                runServer(function() {
                    sendMessageToPing(targets[address]);
                });
            } else sendMessageToPing(targets[address]);

        });
    };


    /** sending message to the ping server to starting ping for specific host
     * @param {Object} target - target object
     * @example
     * targets = {
     *      OCID: param.$id,
     *      host: param.host,
     *      address: address,
     *      interval: param.pingInterval,
     *      packetSize: param.packetSize,
     *      packetsCnt: param.packetsCnt,
     *      sequenceNumber: sequenceNumber,
     *      timeout: param.timeout,
     *      family: family,
     *      callback: callback
     * };
     */
    function sendMessageToPing(target) {
        if(serverProcess) {
            serverProcess.send({
                type: 'echoRequest',
                data: target
            });
        } else {
            log.info('Waiting while ping server initializing for ', target.host, '(', target.address,')');
            setTimeout(sendMessageToPing, 500, target);
        }
    }

    // running (forking) ping server and process signals and messages from it
    function runServer(callback) {

        log.info('Ping: running server. External ping is ',
            confSettings.get('dontUseExternalPing') ? 'disabled' : 'enabled');

        //if(serverProcess && typeof serverProcess.kill === 'function') serverProcess.kill();
        serverProcess = cp.fork(__filename);

        serverProcess.on('error', function (err) {
            log.error('Ping server process return error, restarting: ' + err.message);
            restartingServer();
        });

        serverProcess.on('exit', function () {
            log.error('Ping server process exiting, restarting');
            restartingServer();
        });


        serverProcess.on('message', function(message) {
            // when server initializing completed, running callback of runServer() function
            if(message.type === 'initCompleted' && typeof callback === 'function') {
                return callback();
            }

            // on received echo reply message from server, process it
            if(message.type === 'echoReply') return processingEchoReply(message);

            if(message.type === 'destroyTarget' && targets[message.data]) {
                delete targets[message.data];
                return;
            }

            if(message.type === 'sequenceNumber') {

                if(message.data.sequenceNumber === parseInt(message.data.sequenceNumber, 10) && targets[message.data.address]) {
                    targets[message.data.address].sequenceNumber = message.data.sequenceNumber;
                } else log.warn('Received message with a new sequence number or unknown target or error: ', message);

            }
        });

        if(serverProcess) serverProcess.send({type: 'init'});
    }

    /*
    starting ping server after 1 sec
    Clear packet loss counters for all targets
    Send messages to ping server for starting ping for all targets
     */
    function restartingServer() {
        if(restartInProgress) {
            log.warn('Getting request for restart ping server but restart now in progress');
            return;
        }

        restartInProgress = Date.now();

        // watchdog
        setTimeout(function() {
            if(restartInProgress && Date.now() - restartInProgress > 20000) {
                restartInProgress = 0;
                log.error('Previous ping server restart possible failed. Try to restart ping server again');
                restartingServer();
            }
        }, 30000);

        if(serverProcess && typeof serverProcess.kill === 'function') serverProcess.kill();
        serverProcess = undefined;

        setTimeout(function() {
                runServer(function () {
                    pingServerRestartTime = Date.now();
                    restartInProgress = 0;

                    for (var address in targets) {
                        if(!targets.hasOwnProperty(address)) continue;
                        sendMessageToPing(targets[address]);
                    }
                });
            }, 1000
        );
    }

    /*
    Processing echo reply message
        message = {
           type: 'echoReply',
           data: {
               address: <address>,
               value: RTT,
               timestamp: Date.now()
               externalPing: true|undefined
           }
        }

        if receiving legal round trip time, return it using callback for save into the Database
        if packet loss occur, run external ping program for checking packet loss and send message to ping server for
        destroying target host in it. When external ping program received 60 legal echo reply packets, try to switch
        to ping target using ping server. Restarting ping server for it
    */
    function processingEchoReply(message) {
        var address = message.data.address;

        // checking is callback for target exist
        if(!targets[address] || typeof targets[address].callback !== 'function')
            return log.error('Receiving ping echo reply for unknown target ', address);

        // if received legal RTT or received any value from external ping.exe,
        // sending received value into the Database end exit
        if(message.data.value > 0 || message.data.externalPing ||
            confSettings.get('dontUseExternalPing')) {

            targets[address].callback(null, {
                value: message.data.value,
                timestamp:  message.data.timestamp
            });

            return;
        }

        // packet loss processing

        // destroy target with packet loss in a ping server
        if(serverProcess) serverProcess.send({type: 'destroyTarget', data: address });

        // stopping switch to external ping if external ping for this host already running
        // I don't know how, but some time it's happened. May be after notebook hibernation
        if(externalPingProcesses[address] && externalPingProcesses[address].pid) {
            return log.warn('Trying to switch from internal ping server to ping using external program, but external ping for ',
                targets[address].host, '(', address, ') already running with PID ',
                externalPingProcesses[address].pid, '. Stopping internal ping for target');
        }

        log.info('Switch target ', targets[address].host, '(', address,
            ') from internal ping server to ping using external program');

        // getting sequence number for target for syncing with ping server.
        // It will be set when receiving message reply to target object
        if(serverProcess) serverProcess.send({type: 'getSequenceNumber', data: address});

        // ping target, using external program ping.exe
        externalPing(targets[address], function(err){
            if(err) return log.error(err.message);

            // external ping exiting only when received some packets from target.
            // restart server and try to ping target using internal server
            if(!serverProcess || !targets[address]) return;

            // don't restart ping server if last restart time was smaller than 60 sec ago
            // only starting ping for target
            if(Date.now() - pingServerRestartTime < 60000) return sendMessageToPing(targets[address]);

            // restarting ping server and send message for pinging for all targets
            if(serverProcess) serverProcess.send({type: 'exit'});
        });
    }

    /*
    Run external ping program
     */
    function externalPing (target, callback) {

        // external ping program settings
        // tested for Russian Windows 10
        var externalProgram = 'ping.exe',
        externalProgramArguments = ['-t', '-l', target.packetSize, '-w', target.timeout, target.address],
        // for debugging
        //externalProgramArguments = ['-t', '-l', target.packetSize, '-w', target.timeout, '193.178.135.25'],
        // Ответ от 195.93.187.9: число байт=32 время=3мс TTL=54
        // Ответ от 127.0.0.1: число байт=32 время<1мс TTL=128
        // Ответ от ::1: время<1мс
        // Reply from 192.168.236.200: bytes=32 time<1ms TTL=64
        // Request timed out.
        // Превышен интервал ожидания для запроса.
        regExpForExtractRTT = /^.*[=<]([\d]+)[^ \s\d][\s\S]*$/;

        // forking and remember child object to global variable for kill it, if needed
        var child = externalPingProcesses[target.address] = spawn(externalProgram, externalProgramArguments);

        var stderr = '', lastPacketSentTime = Date.now(), legalRTTCnt = 0;

        // receiving data on stdout
        child.stdout.on('data', function(data) {

            // decode received buffer to UTF-8
            var stdout = recode.decode(data, 'cp866');
            // extracted RTT from received data. If failed, result will be equal to NaN
            var result = Number(stdout.replace(regExpForExtractRTT, "$1"));

            // console.log(result, ': ', stdout);

            if(!target.address || !targets[target.address]) {
                log.info('Received echo replay packets from unknown target "', target.address,
                    '" by external ping. Kill it');
                child.kill('SIGINT');
                return;
            }

            // if RTT successfully extracted from stdout of external ping
            if(Number(result)) {
                ++legalRTTCnt; // increase successfully extracted RTT counter

                // if number of successfully extracted RTT > 60, stopping external ping program
                // and try to switch to ping server for target
                // killing external ping for it and running callback at child.on('exit'...) for
                // switch to internal ping
                if(legalRTTCnt > 60) {
                    log.info('Received ', legalRTTCnt, ' echo replay packets from ', target.host, '(', target.address,
                        ') using external ping. Try to switch to internal ping server');
                    child.kill('SIGINT');
                }
            } else { // packet loss or stdout did not contain data about RTT
                // return packet loss only if last packet was sending more than <timeout> time ago
                if(Date.now() - lastPacketSentTime <= target.timeout) return;

                log.info('Packet LOSS for ', target.host, '(', target.address, '); sequence ', target.sequenceNumber,
                    ', received from external ping program');
                legalRTTCnt = 0;
                result = 0;
            }

            lastPacketSentTime = Date.now(); // set last packet set time to current time for packet loss processing

            // sending result into the Database
            processingEchoReply({
                type: 'echoReply',
                data: {
                    externalPing: true,
                    address: target.address,
                    timestamp: Date.now(),
                    value: Number(result)
                }
            });

            // stopping ping object when sequenceNumber more than requested packets count
            if(++target.sequenceNumber > target.packetsCnt && target.packetsCnt) {
                externalPingProcesses[target.address].kill('SIGINT');
                delete targets[target.address];
            }
        });

        child.stderr.on('data', function(data) {
            stderr += recode.decode(data, 'cp866');
        });

        child.on('exit', function(/*code*/) {
            if(stderr) var err = new Error('ping.exe: ' + stderr);
            else err = null;

            delete externalPingProcesses[target.address];

            callback(err);
        });

        child.on('error', function(err) {
            callback(new Error('ping.exe: ' + err.message));
        });
    }
}



function runServerProcess() {

    var raw = require('raw-socket');

    var targets = {},
        hostID = [],
        socketV4,
        socketV6,
        isSocketsInitialising = false;

    init();

    function init() {

        process.on('message', function (message) {

            if (message.type === 'echoRequest') {

                var target = message.data;
                if(!target) return log.error('Target not set for ping host, message: ', message);
                var address = target.address;

                var ID = targets[address] && targets[address].ID !== undefined ? targets[address].ID : hostID.length;
                if (ID > 4294967295) {
                    return log.error('Can\'t add host ' + target.host + '(' + address +
                        ') to ping server: host ID has reached maximum value (4294967295)');
                }
                hostID.push(address);

                var packetTemplate = Buffer.alloc(target.packetSize);
                if (target.family === 4) packetTemplate.writeUInt8(0x08, 0); // ICMP types for IPv4
                else packetTemplate.writeUInt8(0x80, 0); // ICMP types for IPv6

                // write host ID into two ICMP Echo replay fields: Identifier and sequence number
                // I don't know why, but if I write sequence number and change it after every packet for IPv6 ping
                // I don't received ICMP Echo reply
                packetTemplate.writeUInt32BE(ID, 4);

                var sequenceNumber = targets[address] && targets[address].sequenceNumber ? targets[address].sequenceNumber : 0;
                sequenceNumber = target.sequenceNumber ? target.sequenceNumber : sequenceNumber;

                targets[address] = {
                    host: target.host,
                    address: target.address,
                    interval: target.interval,
                    packetSize: target.packetSize,
                    packetsCnt: target.packetsCnt,
                    timeout: target.timeout,
                    sequenceNumber: sequenceNumber,
                    packetTemplate: packetTemplate,
                    ID: ID,
                    family: target.family,
                    processedSequences: {},
                    lastPacketTime: 0,
                };

                log.info((sequenceNumber ? 'Updating' : 'Adding'),
                    (target.host !== target.address ? ' host "' + target.host + '"' : ''),
                    ' IPv', target.family, ' address: ', address,
                    ' hostID: ', ID, ' interval: ', target.interval / 1000, ' timeout: ', target.timeout / 1000,
                    ' packet size: ', target.packetSize, ' packet count: ', target.packetsCnt,
                    ' sequence number: ', sequenceNumber);

                if(target.timeID) clearInterval(target.timeID);
                sendICMPMessage(targets[address]);
                return;
            }

            if (message.type === 'init') {
                if (!isSocketsInitialising) {
                    isSocketsInitialising = true;
                    log.info('Ping: initializing sockets for IPv4, IPv6');
                    initSocket(4);
                    initSocket(6);
                    // 350 to prevent receiving a packet loss and a subsequent reply packet at the same time
                    setInterval(watchdog, 350);
                    setInterval(function() {
                        log.info('Ping ', Object.keys(targets).length, ' hosts: ', Object.keys(targets).sort().join(', '));
                    }, 360000);
                    setTimeout(function () {
                        process.send({type: 'initCompleted'});
                    }, 200);
                }
                return;
            }

            if (message.type === 'destroyTarget') {
                if(!message.data || targets[message.data] === undefined) {
                    return log.warn('Ping: Can\'t destroying target with IP "', message.data,
                        '": address not found in a targets object');
                }
                return destroyTarget(targets[message.data]);
            }

            if (message.type === 'getSequenceNumber') return process.send({
                type: 'sequenceNumber',
                data: {
                    sequenceNumber: targets[message.data] ? targets[message.data].sequenceNumber : 0,
                    address: message.data
                }
            });

            if (message.type === 'exit') {
                log.warn('Ping: server received exit message, exiting');

                // sending sequences numbers to parent before exit for save it
                for(var _address in targets) {
                    if(!targets.hasOwnProperty(_address)) continue;

                    process.send({
                        type: 'sequenceNumber',
                        data: {
                            sequenceNumber: targets[_address].sequenceNumber,
                            address: _address
                        }
                    });
                }

                try {
                    socketV4.close();
                    socketV6.close();
                } catch (err) {
                    log.error('Error while closing socket: ', err.message);
                }

                process.exit(2);
            }
        });
    }

    function destroyTarget(target) {

        if (target) {
            log.info('Ping: Destroying target "', target.address, '"');
            clearInterval(target.timeID);
            delete(targets[target.address]);
        } else log.error('Ping: Destroying target "', target, '" error: address not found in a targets object');
    }


    function reInitSocket(family) {
        try {
            if (family === 4) socketV4.close();
            else socketV6.close();
        } catch (err) {
            log.error('Error while closing socket for IPv', family, ': ', err.message);
        }

        // delete old ajax from require cache for reread
        delete require.cache[require.resolve('raw-socket')];
        raw = require('raw-socket');

        initSocket(family);
    }

    function initSocket(family) {

        //log.info('Init IPv', family, ' socket');

        // https://www.npmjs.com/package/raw-socket
        // "Under load raw socket can experience packet loss, this may vary from system to system depending on hardware. On some systems the SO_RCVBUF socket option to will help to alleviate packet loss."
        // also trying to set bufferSize socket option
        // but, as far as I can see, it does not help on Windows
        // TODO on next packet loss occur:
        // catch packets using Wireshark and examine is packet loss really occur
        // catch packets from real ping and try to make same packet
        var socketOption = {
            level: 'SOL_SOCKET',
            name: 'SO_RCVBUF',
            val: 32768 * 1024 // default 65536 bytes. Max length is 32 bit = 4294967295
        };

        if (family === 4) var socket = raw.createSocket({protocol: raw.Protocol.ICMP, bufferSize: socketOption.val});
        else socket = raw.createSocket({
            protocol: raw.Protocol.ICMPv6,
            addressFamily: raw.AddressFamily.IPv6,
            bufferSize: socketOption.val
        });

        // set socket option, then get and print it for testing
        var buffer = Buffer.alloc(4);
        socket.getOption(raw.SocketLevel[socketOption.level], raw.SocketOption[socketOption.name], buffer, buffer.length);
        var currentValue = buffer.readUInt32LE(0);
        buffer.writeUInt32LE(socketOption.val, 0);
        socket.setOption(raw.SocketLevel[socketOption.level], raw.SocketOption[socketOption.name], buffer, buffer.length);
        socket.getOption(raw.SocketLevel[socketOption.level], raw.SocketOption[socketOption.name], buffer, buffer.length);
        log.info('Init socket IPv', family,' option "', socketOption.name, '" was ', currentValue, ', now set to ',
            buffer.readUInt32LE(0));

        socket.on("close", function () {
            log.info('Socket IPv', family, ' is closed');
        });

        socket.on("error", function (err) {
            log.error('Socket IPv', family, ' get error', recode.decode(err, 'cp866'), '(', err, ')');
            reInitSocket(family);
        });

        socket.on("message", function (buffer, source) {
            // The length of the IPv4 header is in multiples of double words
            if (family === 4) var ip_length = (buffer[0] & 0x0f) * 4;
            // IPv6 raw sockets don't pass the IPv6 header back to us. Setting offset = 0
            else ip_length = 0;

            processReceivedICMPMessage(buffer, ip_length, source);
        });

        if (family === 4) socketV4 = socket;
        else socketV6 = socket;
    }

    function processReceivedICMPMessage(buffer, ip_length, source) {

        // getting timestamp from received ICMP package
        var seconds = buffer.readDoubleBE(ip_length + 8);
        var nanoseconds = buffer.readDoubleBE(ip_length + 16);

        // calculating timestamps difference
        var diff = process.hrtime([seconds, nanoseconds]);

        // getting host ID
        var ID = buffer.readUInt32BE(ip_length + 4); // hostID

        // getting sequence number
        var sequenceNumber = buffer.readUInt32BE(ip_length + 24);

        var RTT = (diff[1] + 1e9 * diff[0]) / 1e6; // milliseconds

        if (targets[hostID[ID]] === undefined)
            return log.info('Received packet from undefined host ID ', ID, ' from ', source, '; RTT: ', RTT,
                'ms; sequence number: ', sequenceNumber);

        if(sequenceNumber > targets[hostID[ID]].sequenceNumber) {
            /*
            log.info('Received packet with invalid sequence number from host ', targets[hostID[ID]].host,
                ' (IP from socket: ', source, '; original target IP: ', hostID[ID],
                '); sequence: ', sequenceNumber, '/', targets[hostID[ID]].sequenceNumber,'; ', 'RTT: ', RTT);
             */
            return;
        }

        // don't return data from first sent echo request packet or if sequence was deleted from processedSequences,
        // according timeout for receiving packet or if received some packets for one sequence
        if (!targets[hostID[ID]].processedSequences[sequenceNumber]) {
            return log.info('Received lost packet from host ', targets[hostID[ID]].host,
                ' (IP from socket: ', source, '; original target IP: ', hostID[ID],
                '); sequence: ', sequenceNumber, '/', targets[hostID[ID]].sequenceNumber,'; ', 'RTT: ', RTT);
        }
        else {
            //log.info('Received good packet from ',targets[hostID[ID]].host,'(', source, '); sequence: ',sequenceNumber,'; RTT: ', RTT);
            delete targets[hostID[ID]].processedSequences[sequenceNumber];
        }

        if(RTT < 0) return log.warn('Received packet with strange negative RTT from ', targets[hostID[ID]].host,
            '(', source, '=', hostID[ID], '); sequence: ', sequenceNumber, '; RTT: ', RTT);

        process.send({
            type: 'echoReply',
            data: {
                address: hostID[ID],
                value: RTT,
                timestamp: Date.now()
            }
        });

        targets[hostID[ID]].timeID = setTimeout(sendICMPMessage, targets[hostID[ID]].interval, targets[hostID[ID]]);

        //console.log ('received ' + buffer.length + ' bytes for hostID ' +ID+ ', RTT: ' + RTT + 'ms, seqNum: ' + sequenceNumber + ' seconds: ' + seconds + ' nanoseconds: ' + nanoseconds + ' diff seconds: ' + diff[0] + ' diff nanoseconds: ' + diff[1]);
        //console.log ("data: " + buffer.toString ("hex").match(/.{1,4}/g).join(' '));
    }


    /*
     8 bit: type: 0x08 for IPv4 or 0x80 for IPv6
     8 bit: code: 0x00
    16 bit: checksum
    16 bit: ID
    16 bit: sequence number
    in our case we set 32 bit hostID into ID and sequence number fields
    ...   : payLoad data, f.e. timestamp or other data. In our case it's:
    64 bit: seconds
    64 bit: nanoseconds
    32 bit: sequence Number
    -----------
    28 bytes ICMP package + 20 bytes of IP header
    */
    function sendICMPMessage(target) {

        if(target.lastPacketTime && target.lastPacketTime + target.interval > Date.now()) {
            log.info('Preventing an attempt to send a packet more often than the time interval ', target.interval / 1000
                ,'sec for ', target.host, '(', target.address, '). Last packet send ',
                Math.round((Date.now() - target.lastPacketTime) / 1000), 'sec ago');
            return;
        }

        // stop sending packet if sequenceNumber > required packetCnt
        if (target.packetsCnt && target.sequenceNumber > target.packetsCnt) {
            process.send({
                type: 'destroyTarget',
                data: target.address
            });
            return destroyTarget(target);
        }

        var buffer = Buffer.from(target.packetTemplate);

        if(target.sequenceNumber > 0xFFFFFFFF) target.sequenceNumber = 1;
        try {
            buffer.writeUInt32BE(target.sequenceNumber, 24); // payLoad: 32 bit sequence number
        } catch(err) {
            log.error('Can\'t add 32bit sequence number "',target.sequenceNumber,
                '" to the echo request packet for ', target.host, '(', target.address, '):', err.message);
            buffer.writeUInt32BE(0, 24);
        }
        var timestamp = process.hrtime();
        buffer.writeDoubleBE(timestamp[0], 8); // payLoad: seconds
        buffer.writeDoubleBE(timestamp[1], 16); // payLoad: nanoseconds is the remaining part of the real time that can't be represented in second precision
        raw.writeChecksum(buffer, 2, raw.createChecksum(buffer));

        if (target.family === 4) var socket = socketV4;
        else socket = socketV6;

        socket.send(buffer, 0, buffer.length, target.address, function (err/*, bytes*/) {
            if (err) {
                log.error('Ping IPv', target.family, ' for ', target.host, '(', target.address,
                    ') error sending packet: ', recode.decode(Buffer.from(err.message), 'cp866'),
                    '; raw error: ', err);
            }

            target.processedSequences[target.sequenceNumber] = target.lastPacketTime = Date.now();
            ++target.sequenceNumber;

            //console.log ('sent ' + (bytes+20) + ' bytes to ' + target.address + ' (IPv' + target.family+ ', hostID: ', buffer.readUInt32BE(4) ,'), seqNum ' + (target.sequenceNumber) + ' seconds: ' +timestamp[0] + ' nanoseconds: ' + timestamp[1]);
            //console.log ("data: " + buffer.toString ("hex").match(/.{1,4}/g).join(' '));
        });
    }

    /*
    Checking for packet loss and for sending packets termination
    watchdog running every 350 seconds
     */
    function watchdog() {

        // watchdog will be checked for sending packets to all targets not often then 1 second
        var now = Date.now();
        for (var address in targets) {
            if(!targets.hasOwnProperty(address)) continue;

            var target = targets[address];

            // return if target was destroyed
            if (targets[address] === undefined) continue;

            for(var sequenceNumber in target.processedSequences) {
                if(!target.processedSequences.hasOwnProperty(sequenceNumber)) continue;

                if(now - target.processedSequences[sequenceNumber] > target.timeout) {

                    log.info('Packet LOSS for ', target.host, '(', target.address, '); delay: ',
                        now - target.processedSequences[sequenceNumber], '/', target.timeout, 'ms; sequence ',
                        sequenceNumber, ', waiting replies from sequences: ',
                        Object.keys(target.processedSequences).join(','));

                    process.send({
                        type: 'echoReply',
                        data: {
                            address: target.address,
                            value: 0,
                            timestamp: Date.now()
                        }
                    });

                    delete target.processedSequences[sequenceNumber];
                    //reInitSocket(target.family); it's does not help

                    setTimeout(sendICMPMessage, target.interval > 5000 ? 5000 : target.interval , target);
                }
            }

            if (target.lastPacketTime && now - target.lastPacketTime > target.timeout + 1000) {
                log.info('Ping: last packet for ', target.host, '(', target.address, ') was sending ',
                    now - target.lastPacketTime, 'ms ago. It is more than timeout ', target.timeout,
                    'ms. Restarting ping for this host');
                sendICMPMessage(target);
            }
        }
    }
}