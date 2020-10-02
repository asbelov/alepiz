/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
http://localhost:10160/?rate=7&volume=100&message=I%20can%20speak%20very%20quickly%20and%20loudly&severity=10
 */

var log = require('../../lib/log')(module);
var http = require('http');
var https = require('https');
var querystring = require('querystring'); // internal node module

var media = {};
module.exports = media;

var port = 10160;

/*
transport {
    host: 'localhost'
    localAddress: Local interface to bind for network connections
    proxyHost:
    proxyPort:
    proxyUser:
    proxyPass:
}

message: {
        rate: 1,
        volume: 100,
        severity: 1,
    }
*/
media.send = function (param, callback) {

    var transport = param.transport;
    if(!transport.host) transport.host = 'localhost';

    if(!param.text) return callback(new Error('Text not specified in ' + JSON.stringify(param)));

    if(transport.proxyHost) {
        if (!transport.proxyPort) return callback(new Error('Proxy TCP port is not specified in ' + JSON.stringify(param)));

        transport.proxyPort = Number(transport.proxyPort);
        if (transport.proxyPort !== parseInt(String(transport.proxyPort), 10) ||
            transport.proxyPort < 1 ||
            transport.proxyPort > 65535) return callback(new Error('Invalid proxy TCP port in ' + JSON.stringify(param)));
    }

    if(transport.proxyUser) {
        var proxyAuth = 'Basic ' + Buffer.from(transport.proxyUser + ':' + (transport.proxyPass || '')).toString('base64');
        transport.proxyPass = '****';
    }

    if(typeof param.message !== 'object') param.message = {};
    var message = {
        rate: Number(param.message.rate),
        volume: Number(param.message.volume),
        message: param.text,
        severity: Number(param.message.severity),
    };

    if(message.rate !== parseInt(String(message.rate), 10) || message.rate < -10 || message.rate > 10)  message.rate = 1;
    if(message.volume !== parseInt(String(message.volume), 10) || message.volume < 0 || message.volume > 100)  message.volume = 100;
    if(message.severity !== parseInt(String(message.severity), 10))  message.severity = 0;

    var options = {
        host: transport.host,
        method: 'GET',
        port: port,
        timeout: 10000,
        path: '/?' + querystring.stringify(message),
        headers: {
            'Accept-Charset': 'utf-8',
        },
    }

    if(transport.localAddress) options.localAddress = transport.localAddress;

    if(transport.proxyHost) {
        var proxyServer = transport.proxyProtocol && transport.proxyProtocol.toLowerCase() === 'https' ? https : http;
        var proxyOptions = {
            host: transport.proxyHost,
            port: transport.proxyPort,
            method: 'CONNECT',
            rejectUnauthorized: false,
            path: transport.host,
            headers: {
                'Accept-Charset': 'utf-8',
            },
        }
        if(proxyAuth) proxyOptions.headers['Proxy-Authorization'] = proxyAuth;

        var req = proxyServer.request(proxyOptions).on('connect', function (response, socket) {
            if (response.statusCode === 200) {
                options.socket = socket;

                var reqChild = http.get(options, responseProcessor);
                reqChild.on('error', (err) => {
                    log.error('Error send message: ', param, ': ', err);
                    callback();
                });

                reqChild.end();
            }else {
                log.warn('Proxy ', transport.proxyHost ,':', transport.proxyPort, ' returned status code: ',
                    res.statusCode, ': status message: "', res.statusMessage , '" for query ',options);
                callback();
            }
        });
    } else req = http.request(options, responseProcessor);

    req.on('error', (err) => {
        log.error('Error send message: ', param, ': ', err);
        callback();
    });

    req.end();

    function responseProcessor(res) {
        var buffers = [];
        res.on('data', (chunk) => {
            buffers.push(chunk);
        });
        res.on('end', function () {
            if (res.statusCode !== 200) {
                log.warn('Returned status code: ', res.statusCode, ' for query ', options, '; param: ', param,
                    '; response: ', Buffer.concat(buffers).toString());
            } else log.info('Message "', param.text, '" sent successfully to ', transport.host);
            callback();
        });
    }
};
