/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var net = require('net');
const tls = require('tls');
const { Transform } = require('stream');
const fs = require('fs');
var path = require('path');
var dns = require('dns');

var log = require('../../lib/log')(module);

var cfg, protoLogPath = 'logs/proto.log', fd, num = 0;

module.exports = function(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    cfg = args.actionCfg;

    if(args.func === 'startProxy') return startProxy(cfg.localAddress, 0, args.dstAddr, args.dstPort, callback);
    return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
};


function startProxy(srcHost, srcPort, dstHost, dstPort, callback) {
    getAddr(srcHost, function (err, srcAddr) {
        if(err) return callback(err);

        getAddr(dstHost, function (err, dstAddr) {
            if(err) return callback(err);

            log.info('Run proxy for: ', srcHost, '(', srcAddr, '):', srcPort, '=>', dstHost, '(', dstAddr, '):', dstPort);

            getCerts(function (err, options) {
                if (err) log.error('Can\'t get certificate files: ', err.message);

                var createServer = err || !options ? net.createServer : tls.createServer;

                var server = createServer(options || {}, function (clientToProxySocket) {
                    new Proxy(srcHost, srcPort, dstHost, dstAddr, dstPort, clientToProxySocket);
                });

                server.on('error', (err) => {
                    // If port for server.listen() is omitted or is 0, the operating system will assign an arbitrary unused port, which can be
                    // retrieved by using server.address().port after the 'listening' event has been emitted.
                    if (srcPort) log.warn('Server error: ', err);
                    else {
                        srcPort = server.address().port + 1;
                        log.warn('Server error: ', err, ', try to use port ', srcPort);
                        srcPort = server.address().port + 1;
                        setTimeout(startProxy, 1000, srcAddr, srcPort, dstAddr, dstPort, callback);
                    }
                });

                server.on('close', () => {
                    log.info('Client disconnected');
                    if(fd && typeof fd.end === "function") fd.end();
                    fd = null;
                });

                server.listen({
                    host: srcAddr || '127.0.0.1',
                    port: srcPort,
                    exclusive: true
                }, () => {
                    // If port is omitted or is 0, the operating system will assign an arbitrary unused port, which can be
                    // retrieved by using server.address().port after the 'listening' event has been emitted.
                    if (!srcPort) srcPort = server.address().port;
                    log.info('Proxy server starting at ', srcAddr, ' and bound to TCP port ', srcPort);
                    callback(null, srcPort);
                });
            });
        });
    });
}

function Proxy(srcHost, srcPort, dstHost, dstAddr, dstPort, clientToProxySocket) {

    log.info('Client connected: ', clientToProxySocket.remoteAddress, ':', clientToProxySocket.remotePort,
        '->', clientToProxySocket.localAddress, ':', clientToProxySocket.localPort);

    // We need only the data once, the starting packet
    clientToProxySocket.once('data', (chunk) => {
        protoLog('data', chunk);

        chunk = replaceHdr(chunk, 'GET /', [{
            from: 'Sec-Fetch-Site: .+?\r?\n',
            to: 'Sec-Fetch-Site: document\r\n',
        }, {
            from: 'Sec-Fetch-Dest: .+?\r?\n',
            to: 'Sec-Fetch-Dest: none\r\n',
        }, {
            from: 'Referer: .+?\r?\n',
            to: '',
        }, {
            from: 'Accept-Encoding: .+\r?\n',
            to: '',
        }, {
            from: srcHost + ':' + srcPort,
            to: dstHost + ':' + dstPort,
        }, {
            from: srcHost,
            to: dstHost,
        }]);


        // By Default port is 80
        log.info('Destination address:port ', dstAddr, ':', dstPort);

        var createConnection = cfg.protocol === 'https' ? tls.connect : net.createConnection;
        var proxyToServerSocket = createConnection({
            host: dstAddr,
            port: Number(dstPort),
            servername: dstHost,
            rejectUnauthorized: false,
            ALPNProtocols: ['http/1.1', 'http/1.0'],
        }, () => {
            log.info('Established connection from proxy to ', dstAddr, ':', dstPort);
            proxyToServerSocket.write(chunk);

            clientToProxySocket.pipe(transformClient).pipe(proxyToServerSocket);
            proxyToServerSocket.pipe(transformServer).pipe(clientToProxySocket);

            proxyToServerSocket.on('error', (err) => {
                clientToProxySocket.end();
                clientToProxySocket.destroy();
                log.warn('Error in connection from proxy to ', dstAddr, ':', dstPort, ': ', err);
            });

            proxyToServerSocket.on('end', () => {
                clientToProxySocket.end();
                clientToProxySocket.destroy();
                log.warn('Destination server ', dstAddr, ':', dstPort, ' finished connection');
            });
        });

        clientToProxySocket.on('error', (err) => {
            log.warn('Error in connection to proxy: ', err.message);
        });
    });

    const transformClient = new Transform({
        transform(chunk, encoding, callback) {
            protoLog('client', chunk);
            chunk = replaceHdr(chunk, 'GET /', [{
                from: srcHost + ':' + srcPort,
                to: dstHost + ':' + dstPort,
            }, {
                from: srcHost,
                to: dstHost,
            }, {
                from: 'Accept-Encoding: .+\r?\n',
                to: '',
            }]);
            this.push(chunk);
            callback();
        }
    });

    const transformServer = new Transform({
        transform(chunk, encoding, callback) {
            chunk = replaceHdr(chunk, '', [{ // magic 'HTTP/1.1'
                from: 'X-Frame-Options: sameorigin\r?\n',
                to: '',
            }, {
                from: dstHost + ':' + dstPort,
                to: srcHost + ':' + srcPort,
            }, {
                from: dstHost,
                to: srcHost,
            }]);
            protoLog('srv', chunk);
            this.push(chunk);
            callback();
        }
    });
}

function replaceHdr(chunk, magic, replaces) {
    var str = chunk.toString(), replaceNum = 0;

    if(magic && str.indexOf(magic) === -1) return chunk;

    replaces.forEach(function (r) { //[{from:..., to:....}, ...]
        var re = new RegExp(r.from, 'igm');
        if(re.test(str)) {
            str = str.replace(re, r.to);
            replaceNum++;
        }
    });

    if(replaceNum) return Buffer.from(str);
    else return chunk;
}

function getAddr(host, callback) {
    // checking for Internet domain name
    if(/^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-_]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-_]*[A-Za-z0-9])$/.test(host) || host === 'localhost') {
        var addressPrepare = dns.lookup; // dns.lookup(host, function (err, IP, family) {}) // address: 192.168.0.1; family: 4|6

        // checking for IPv4 address family
    } else if(/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(host)) { // IPv4
        addressPrepare = function(IPv4, callback) { callback(null, IPv4, 4);};
        // checking for IPv6 address family
    } else if(/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(host)) { // IPv6
        addressPrepare = function(IPv6, callback) { callback(null, IPv6, 6);};
    } else return callback(new Error('Incorrect host name or IP address: ' + host));

    addressPrepare(host, callback); // callback(err, IP, 4|6)
}

function getCerts(callback) {
    if(!cfg.privatePath || !cfg.keyFile || !cfg.certFile) return callback();

    try {
        var options = {
            key: fs.readFileSync(path.join(__dirname, '..', '..', cfg.privatePath, cfg.keyFile)),
            cert: fs.readFileSync(path.join(__dirname, '..', '..', cfg.privatePath, cfg.certFile)),

            // This is necessary only if using client certificate authentication.
            //requestCert: true,

            // This is necessary only if the client uses a self-signed certificate.
            //ca: [ path.join(__dirname, '..', '..', cfg.privatePath, cfg.clientCertFile) ]
        };

        log.info('Successfully loading certificates for incoming TLS connections');
    } catch(err) {
        return callback(err)
    }

    return callback(null, options);
}

function protoLog() {
    try {
        if (!fd) fd = fs.createWriteStream(protoLogPath);
        var args = Array.prototype.slice.call(arguments);
        var id = args.shift();
        var message = id + ' start:' + num + ':==============\n' + args.map(a => a.toString()).join('') + '\n' + id + ' end:' + num++ + ':==============\n';
        //console.log(message);

        fd.write(message);
    } catch (e) {
        log.warn('Proto log: ', e.message);
    }
}
