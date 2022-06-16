/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 18.04.2022, 22:11:22
*/
const https = require("https");
const http = require("http");
const zlib = require("zlib");
var log = require('../../lib/log')(module);

var media = {};
module.exports = media;

/*
Send message
param: {
    configID: <string> - configuration ID
    transport: <object> - configuration for transport for your media from config.json
    message: <object> - message template for your media from config.json
    sender: <array> - sender in array [{address: <sender address>, fullName: <full name>}]
    rcpt: <array> - recipients in array [{address: <address>, fullName: <full name>}, ...]
    text: <string> - message text
}
callback(err);
*/
media.send = function (param, callback) {

    var messageTemplate = typeof param.message === 'object' && typeof param.message.text === 'string' ?
        param.message.text : '%:MESSAGE:%';

    var message = encodeURIComponent(messageTemplate.replace(/%:MESSAGE:%/gi, param.text));

    var transport = param.transport;
    transport.host = 'api.telegram.org';

    if(transport.proxyUser) {
        var proxyAuth = 'Basic ' + Buffer.from(transport.proxyUser + ':' + (transport.proxyPass || '')).toString('base64');
        transport.proxyPass = '****';
    }

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
    }
    var options = {
        host: transport.host,
        method: 'GET',
        port: 443,
        rejectUnauthorized: false,
        path: `/bot${transport.token}/sendMessage?chat_id=${transport.chatID}&parse_mode=html&text=${message}`,
        headers: {
            'Accept-Charset': 'utf-8',
        },
    }
    if(transport.timeout) options.timeout = transport.timeout;
    if(transport.family === 4 || transport.family === 6) options.family = transport.family;
    if(transport.localAddress) options.localAddress = transport.localAddress;

    if(transport.proxyHost) {
        var req = proxyServer.request(proxyOptions).on('connect', function (response, socket) {
            if(response.statusCode === 200) {
                options.socket = socket;

                var reqChild =  https.get(options, responseProcessor);
                reqChild.on('error', (err) => {
                    log.error('Error send message ', param, ': ', err);
                    callback();
                });

                reqChild.end();
            } else {
                log.warn('Proxy ', transport.proxyHost ,':', transport.proxyPort, ' returned status code: ',
                    response.statusCode, ': status message: "', response.statusMessage , '" for query ',
                    JSON.stringify(options).replace(/"auth":"Basic .*?"/gi, '"auth":"Basic ***"'));
                callback();
            }
        })
    } else req = https.request(options, responseProcessor);

    req.on('error', (err) => {
        log.error('Error send message ', param, ': ', err);
        callback();
    });

    req.end();

    function responseProcessor(response) {

        var rawData = Buffer.alloc(0);
        response.on('data', (chunk) => {
            rawData = Buffer.concat([rawData, chunk]);
        });
        response.on('end', function() {

            if(response.statusCode !== 200) {
                var decompress;
                switch (response.headers['content-encoding']) {
                    case 'br':
                        decompress = zlib.brotliDecompress;
                        break;
                    case 'gzip':
                        decompress = zlib.gunzip;
                        break;
                    case 'deflate':
                        decompress = zlib.deflate;
                        break;
                    default:
                        decompress = function(buf, callback) { return callback(null, buf); }
                        break;
                }

                decompress(rawData, function (err, buffer) {
                    if (err) {
                        log.warn('Can\'t decompress data using ', response.headers['content-encoding'],
                            ' method: ', err.message);
                    }
                    log.warn('Returned status code: ', response.statusCode,
                        ': status message: "', response.statusMessage, '" for query ',
                        JSON.stringify(options).replace(/"auth":"Basic .*?"/gi, '"auth":"Basic ***"'),
                        (buffer ? '; response: ' + buffer.toString() : ''));
                    callback();
                });
            } else {
                log.info('Message "', param.text, '" sent successfully to ', transport.host);
                callback();
            }
        });
    }
};
