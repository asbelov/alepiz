/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var log = require('../lib/log')(module);
var Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');

var webSecrets = {};
module.exports = webSecrets;

webSecrets.get = function (callback) {

    var webSecretFile = path.join(__dirname, '..', confWebServer.get('privatePath') || 'private', confWebServer.get('webSecretFile') || 'webSecret.json');

    fs.readFile(webSecretFile, 'utf8', function (err, webSecretJSON) {
        if(err) return callback(new Error('Can\'t open file ' + webSecretFile + ' with secrets: ' + err.message), webSecretFile);

        try {
            var web = JSON.parse(webSecretJSON)
        } catch (e) {
            return callback(new Error('Can\'t parse JSON file ' + webSecretFile + ': ' + e.message +
                '(' + webSecretJSON + ')'), webSecretFile);
        }

        if(!web.cookieSecret || !web.sessionSecret) {
            return callback(new Error('The file ' + webSecretFile +
                ' file does not contain a cookieSecret or sessionSecret: ' + webSecretJSON), webSecretFile);
        }

        callback(null, web);
    });
}

webSecrets.checkAndCreate = function (callback) {
    webSecrets.get(function (err, webSecretFile) {
        if(!err) return callback();

        log.warn('Generating a new web session and cookies secrets: ', err.message);

        var web = {};
        crypto.randomBytes(512, function (err, buffer) {
            web.cookieSecret = buffer.toString('hex');

            crypto.randomBytes(512, function (err, buffer) {
                web.sessionSecret = buffer.toString('hex');

                fs.writeFile(webSecretFile, JSON.stringify(web),'utf8',function (err) {
                    if(err) {
                        return callback(new Error('Can\'t save new web session and cookies secrets to ' + webSecretFile +
                            ': ' + err.message));
                    }

                    log.warn('Web session and cookies secrets successfully generated and saved to ', webSecretFile);
                    callback();
                });
            });
        });
    })
}
