/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 18.04.2022, 22:11:22
*/
const https = require("https");
const http = require("http");
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

    var transport = param.transport;

    if(!transport.token) return callback(new Error('Telegram bot token is not set in configuration'));
    if(!transport.chatID) return callback(new Error('Telegram chat ID is not set in configuration'));



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

    var messageTemplate = typeof param.message === 'object' && typeof param.message.text === 'string' ?
        param.message.text : '%:MESSAGE:%';

    var message = encodeURIComponent(messageTemplate.replace(/%:MESSAGE:%/gi, param.text));

    var options = {
        host: 'api.telegram.org',
        method: 'POST',
        port: 443,
        timeout: 10000,
        path: `/bot${transport.token}/sendMessage?chat_id=${transport.chatID}&parse_mode=html&text=${message}`,
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

                var reqChild = https.get(options, responseProcessor);
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
    } else req = https.request(options, responseProcessor);

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
