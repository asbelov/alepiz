/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var querystring = require('querystring'); // internal node module
var URL = require('url').URL; // internal node module, new URL('https://測試'); = https://xn--g6w251d/
var async = require('async');

var media = {};
module.exports = media;

/*
transport {
    protocol: http | https
    method: GET|POST
    host: 'go.qtelecom.ru'
    port: 443
    path:
    user:
    pass:
    family 4|6, default try both
    localAddress: Local interface to bind for network connections
    timeout: A number specifying the socket timeout in milliseconds. This will set the timeout before the socket is connected.
    proxyHost:
    proxyPort:
    proxyUser:
    proxyPass:
    phonesDiv: ',',
    phonePrefix: 8, // +7 913 987 1122 => 89139871122
    phoneLen: 10,
    response: string regExp. if contain %:PHONE:%, then check response for all rcpt phones
}

message: {
        user: <userName>
        pass: <Password>
        action: "post_sms",
        sender: %:SENDER_PHONE:%
        message: "%:TEXT:%"
        target:  %:PHONE:% | %:PHONES:%.
            if set %:PHONE:% then send for each phone number.
            When %:PHONES:%, then join all phones to string with divider phonesDiv and send all phone numbers once
    }
*/
media.send = function (param, callback) {

    if(typeof param.message !== 'object') return callback(new Error('Message object is not specified'));

    var pass = param.message.pass || '';
    param.message.pass = '****'
    var transport = param.transport;
    var errStr = checkParam(transport);
    if(errStr) return callback(new Error(errStr + ' in ' + JSON.stringify(param)));

    if(transport.user) {
        var auth = 'Basic ' + Buffer.from(transport.user + ':' + (transport.pass || '')).toString('base64');
        transport.pass = '****';
    }

    if(transport.proxyUser) {
        var proxyAuth = 'Basic ' + Buffer.from(transport.proxyUser + ':' + (transport.proxyPass || '')).toString('base64');
        transport.proxyPass = '****';
    }

    if(transport.protocol && transport.protocol.toLowerCase() === 'https') var server = https;
    else {
        server = http;
        transport.protocol = 'http';
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
        method: transport.method,
        rejectUnauthorized: false,
        headers: {
            'Accept-Charset': 'utf-8',
        },
    }
    if(transport.port) options.port = transport.port;

    if(transport.method === 'POST') options.headers['Content-Type'] = 'application/x-www-form-urlencoded';

    if(transport.user) options.auth = auth;
    if(transport.timeout) options.timeout = transport.timeout;
    if(transport.family === 4 || transport.family === 6) options.family = transport.family;
    if(transport.localAddress) options.localAddress = transport.localAddress;

    var responses = [], URLs = createURL(
        param.message,
        pass,
        param.text,
        param.sender,
        param.rcpt,
        transport.phonesDiv,
        transport.phonePrefix,
        transport.phoneLen || 10
    );

    async.each(URLs, function (obj, callback) { // obj: [{phone:..., query: url}, ....]

        if(transport.proxyHost) {
            options.path = new URL(transport.path + (transport.method === 'GET' ? '?' + obj.query : ''),
                transport.protocol + '://' + transport.host + (transport.port ? ':' + transport.port : '')).toString();
        } else options.path = transport.path + (transport.method === 'GET' ? '?' + obj.query : '');

        if(transport.method === 'POST') options.headers['Content-Length'] = Buffer.byteLength(obj.query);
        if(transport.proxyHost) {
            var req = proxyServer.request(proxyOptions).on('connect', function (response, socket) {
                if(response.statusCode === 200 && typeof server[transport.method.toLowerCase()] === 'function') {
                    options.socket = socket;

                    var reqChild = server[transport.method.toLowerCase()](options, function (response) {
                        responseProcessor(response, obj, callback);
                    });
                    reqChild.on('error', (err) => {
                        //log.error('Error send message ', param, ': ', err);
                        responses.push({
                            phone: obj.phone,
                            data: err.message,
                        });

                        callback();
                    });

                    if(transport.method === 'POST') reqChild.write(obj.query);
                    reqChild.end();
                } else {
                    log.warn('Proxy ', transport.proxyHost ,':', transport.proxyPort, ' returned status code: ',
                        response.statusCode, ': status message: "', response.statusMessage , '" for query ',
                        JSON.stringify(options).replace(/pass=.*?&/g, 'pass=****&').
                        replace(/"auth":"Basic .*?"/gi, '"auth":"Basic ***"'));
                    callback();
                }
            })
        } else {
            req = server.request(options, function (response) {
                responseProcessor(response, obj, callback);
            });
            if(transport.method === 'POST') req.write(obj.query);
        }

        req.on('error', (err) => {
            //log.error('Error send message ', param, ': ', err);
            responses.push({
                phone: obj.phone,
                data: err.message,
            });

            callback();
        });

        req.end();
    }, function() {
        var errCnt = 0;
        if(transport.response) {
            responses.forEach(function (response) {

                if (response.phone && transport.response.indexOf('%:PHONE:%') !== -1) {
                    var str = transport.response.replace(/%:PHONE:%/g, response.phone);
                } else str = transport.response;

                if(!response.data && str) {
                    log.warn('No response for phone ', response.phone, ', waiting for: ', str);
                    ++errCnt;
                } else if(response.data.toLowerCase().indexOf(str.toLowerCase()) === -1) {
                    try {
                        var re = new RegExp(str, 'mgi');
                    } catch (e) {
                        log.warn('Can\'t make regExp from ', str, ' for check response for ', param, ': ', e.message);
                        ++errCnt;
                        return;
                    }
                    if (!re.test(response.data)) {
                        log.warn('Invalid response for phone ', response.phone, ': ', response.data, '; waiting for regExp: ', str);
                        ++errCnt;
                    }
                }
            });
        }

        if(!errCnt) {
            log.info('SMS message "', param.text, '" sent ',
                (transport.response ? 'successfully' : 'with unknown status'),
                ' to ', param.rcpt, '; responses: ', responses);
        } else {
            log.error('SMS message "', param.text, '" sent with error to ', param.rcpt, '; responses: ', responses,
                '; param: ', param);
        }
        callback();
    });

    function responseProcessor(response, obj, callback) {

        var rawData = Buffer.alloc(0);
        response.on('data', (chunk) => {
            rawData = Buffer.concat([rawData, chunk]);
        });
        response.on('end', function() {

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
                if(err) {
                    log.warn('Can\'t decompress data using ', response.headers['content-encoding'],
                        ' method for ', JSON.stringify(options).replace(/pass=.*?&/g, 'pass=****&').
                        replace(/"auth":"Basic .*?"/gi, '"auth":"Basic ***"'),
                        ': ', err.message);
                }

                responses.push({
                    phone: obj.phone,
                    data: buffer ? buffer.toString() : '',
                });

                if(response.statusCode !== 200) {
                    log.warn('Returned status code: ', response.statusCode,
                        ': status message: "', response.statusMessage , '" for query ',
                        JSON.stringify(options).replace(/pass=.*?&/g, 'pass=****&').
                        replace(/"auth":"Basic .*?"/gi, '"auth":"Basic ***"'));
                }
                callback();
            });
        });
    }
};

function checkParam(transport) {
    if(!transport.host) return 'Host is not specified';

    if(typeof transport.method !== 'string') transport.method = 'GET';
    else {
        transport.method = transport.method.toUpperCase();
        if(transport.method !== 'GET' && transport.method !== 'POST') return 'Unknown method';
    }

    if(transport.protocol === 'https' && !transport.port) transport.port = 443;
    else transport.port = Number(transport.port);
    if(transport.port && (transport.port !== parseInt(String(transport.port), 10) ||
        transport.port < 1 ||
        transport.port > 32767)) return 'Invalid TCP port';

    if(transport.proxyHost) {
        if (!transport.proxyPort) return 'Proxy TCP port is not specified';

        transport.proxyPort = Number(transport.proxyPort);
        if (transport.proxyPort !== parseInt(String(transport.proxyPort), 10) ||
            transport.proxyPort < 1 ||
            transport.proxyPort > 65535) return 'Invalid proxy TCP port';
    }

    if(transport.timeout && Number(transport.timeout) !== parseInt(String(transport.timeout), 10)) {
        return 'Incorrect timeout';
    }

    if(transport.family && transport.family !== 4 && transport.family !== 6) {
        return 'Incorrect IP family';
    }

    if(!transport.path || typeof transport.path !== 'string') transport.path = '';
    else if(transport.path.slice(transport.path.length - 1) !== '/') transport.path += '/';
}

function createURL(query, pass, text, sender, rcpt, phonesDiv, phonePrefix, phoneLen) {
    var phones = [];
    rcpt.forEach(function (user) {
        if(!user.address) return;
        phones.push(getPhone(user.address, phonePrefix, phoneLen));
    });

    var multiple = [],
        newQuery = {},
        senderPhone = sender ? getPhone(sender[0].address, phonePrefix, phoneLen) : ''; // sometimes sender has not phone number
    for(var key in query) {
        if(query[key] === '%:TEXT:%') newQuery[key] = text;
        else if(query[key] === '%:PHONES:%') newQuery[key] = phones.join(typeof phonesDiv === 'string' ? phonesDiv : ',');
        else if(query[key] === '%:SENDER_PHONE:%') newQuery[key] = senderPhone;
        else if(query[key] === '%:PHONE:%') multiple.push(key);
        else if(key === 'pass') newQuery[key] = pass;
        else newQuery[key] = query[key];
    }

    if(!multiple.length) {
        return [{
            phone: phones.join(','),
            query: querystring.stringify(newQuery)
        }];
    }

    var newQueries = [];
    rcpt.forEach(function (user) {
        if(!user.address) return; // don't send SMS to user without phone number
        var phone = getPhone(user.address, phonePrefix, phoneLen);
        multiple.forEach(function (key) {
            newQuery[key] = phone;
        });

        newQueries.push({
            phone: phone,
            query: querystring.stringify(newQuery)
        });
    });

    return newQueries;
}

function getPhone(phone, prefix, phoneLen) {
    if(!prefix && prefix !== 0) prefix = '';

    var newPhone = phone.replace(/[ \-]/g, '');
    return String(prefix + newPhone.slice(-phoneLen));
}