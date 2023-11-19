/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../lib/log')(module);
var fs = require('fs');
var path = require('path');
var async = require('async');

var usersDB = require('../models_db/usersDB');
const variablesReplace = require('../lib/utils/variablesReplace');
var prepareUser = require('../lib/utils/prepareUser');
var Conf = require('../lib/conf');
const confCommunicationMedia = new Conf('config/communicationMedia.json');

var communication = {};
module.exports = communication;

var communicationDir = confCommunicationMedia.get('dir') || 'communication';
var configFileName = confCommunicationMedia.get('configuration') || 'config.json';
var serverFileName = confCommunicationMedia.get('server') || 'server.js';
var defaultConfigID = confCommunicationMedia.get('defaultConfigID') || 'default';
var reloadSourceEveryTime = confCommunicationMedia.get('reloadSourceEveryTime') || false;
var communicationMedia = new Map();

/**
 * Send message
 * @param {Object} param message parameters
 * @param {Object} param.message parameters for for specific communication media
 * @param {Array<number>} [param.priorities] array of priorities ID from userCommunicationPriorities.priority [<num1>, <num2>,..].
 * @param {string} param.mediaID one of the communication medias. If set mediaID then priorities will be skipped
 * @param {string} [param.configID] configuration ID from config.json of selected media ID
 * @param {string} param.sender username from the table table users and field name
 * @param {Array<string>} [param.rcpt] array of the usernames from the table table users and field name
 * @param {string} [param.text] message text
 * @param {Object} [param.variables] {<name>: <value>, ....}, will be replaced in param.text and in all message parameters
 * @param {function(Error)|function(null, Array<string>)} callback callback(err, <array of used mediaIDs>)
 *
 * @example
 * example of the param.message object for the email mediaID
 * param.message: {
 *         from:
 *         to:
 *         cc:
 *         bcc:
 *         replyTo:
 *         subject:
 *         html:
 *         text:
 *         attachments:
 * }
 */
communication.send = function(param, callback) {

    getMedias(param.sender, null, function (err, sender) {
        if(err) {
            return callback(new Error('Can\'t get sender media information: ' + err.message +
                ' for ' + JSON.stringify(param)));
        }

        if(param.mediaID && Array.isArray(param.priorities) && param.priorities.length) {
            log.warn('Both parameters mediaID and priorities are set. Using mediaID: ', param.mediaID,
                '; priorities: ', param.priorities);
        }
        getMedias(param.rcpt, param.mediaID || param.priorities, function (err, rcpt) {
            if(err) {
                return callback(new Error('Can\'t get recipients media information: ' + err.message +
                    ' for ' + JSON.stringify(param)));
            }

            var medias = param.mediaID ? [param.mediaID] : (rcpt && typeof rcpt === 'object' ? Object.keys(rcpt) : null);
            if(!Array.isArray(medias) || !medias.length) {
                return callback(new Error('Can\'t define media ID for ' + JSON.stringify(param)));
            }

            async.each(medias, function (mediaID, callback) {
                getConfig(mediaID, param.configID, param.message, param.variables, function(err, transport, message, configID) {
                    if(err) return callback(err);

                    var mediaSource = path.join(__dirname, '..', communicationDir, mediaID, serverFileName);
                    if(reloadSourceEveryTime && require.resolve(mediaSource) && require.cache[require.resolve(mediaSource)]) {
                        delete require.cache[require.resolve(mediaSource)];
                        communicationMedia.delete(mediaSource);
                    }

                    if(!communicationMedia.has(mediaSource)) {
                        try {
                            log.info('Attaching communication media source file ', mediaSource);
                            communicationMedia.set(mediaSource, require(mediaSource));
                        } catch (err) {
                            return callback(new Error('Can\'t attach communication media source file: ' +
                                mediaSource + ': ' + err.message));
                        }
                    }

                    try {
                        communicationMedia.get(mediaSource).send({
                            configID: configID,
                            transport: transport,
                            message: message,
                            sender: sender[mediaID],
                            rcpt: rcpt[mediaID],
                            text: replaceVariables(param.text, param.variables),
                        }, function(err, info) {
                            if(err) return callback(err);
                            if(info) log.info(info);
                            callback()
                        });
                    } catch (e) {
                        return callback(new Error('Error occurred while sending message by communication media "' +
                            mediaSource + '": ' + e.stack));
                    }
                });
            }, function(err) {
                callback(err, medias);
            });
        });
    });
}


function getConfig(mediaID, configID, initMessageConfig, variables, callback) {
    var mediaPath = path.join(__dirname, '..', communicationDir, mediaID);
    var configFile = path.join(mediaPath, configFileName);

    fs.readFile(configFile, 'utf-8', function(err, configStr) {
        if(err) {
            return callback(new Error('Can\'t read communication media ' + mediaID + ' configuration file ' +
            configFile + ': ' + err.message));
        }

        try {
            var cfg = JSON.parse(configStr);
        } catch (e) {
            return callback(new Error('Can\'t parse communication media ' + mediaID + ' configuration file ' +
                configFile + ': ' + e.message));
        }

        // if the configuration with configID is not found, try to use the configuration with defaultConfigID
        configID = typeof cfg[configID] === 'object' ? configID : defaultConfigID;

        // if no configurations are found return an error
        if(typeof cfg[configID] !== 'object') {
            return callback(new Error('Can\'t find configuration ID ' + configID + ' and default configuration ' +
                defaultConfigID + ' for communication media ' + mediaID + ' configuration file ' + configFile));
        }

        // try using transport configuration from the found configID
        var transport = typeof cfg[configID].transport === 'object' ?
            cfg[configID].transport : (
                // if transport configuration is a string, then this is a link to another configID
                typeof cfg[configID].transport === 'string' &&
                // trying to get transport configuration from another configID
                cfg[cfg[configID].transport] && typeof cfg[cfg[configID].transport].transport === 'object' ?
                cfg[cfg[configID].transport].transport : null
            );

        //if no transport configuration is found, an error is returned
        if(!transport) {
            return callback(new Error('Can\'t find transport for configuration ID ' + configID +
                ' or default configuration ' +
                defaultConfigID + ' for communication media ' + mediaID + ' configuration file ' + configFile));
        }


        // concatenate init message configuration and default message configuration from configID
        var messageCfg = appendToObject(initMessageConfig);
        if(typeof cfg[configID].message === 'object') {
            messageCfg = appendToObject(cfg[configID].message, messageCfg, variables, mediaPath);
            delete cfg[configID].message;
        }

        callback(null, transport, messageCfg, configID);
    })
}

function replaceVariables(str, variables) {
    if(!variables || typeof variables !== 'object' || !Object.keys(variables).length) return str;
    var res = variablesReplace(str, variables);

    if(!res) return str;
    return res.value;
}

/*
append items of source object to destination
source - source object
dest - destination object

return dest - destination object
 */
function appendToObject (source, dest, variables, mediaPath) {
    if(!dest || typeof dest !== 'object') dest = {};

    for(var key in source) {
        if(!source.hasOwnProperty(key)) continue;

        if(dest[key] === undefined) {
            if((key === 'html' || key === 'text') && typeof source[key] === 'object' && typeof source[key].path === 'string') {
                try {
                    if(!path.isAbsolute(source[key].path)) var templatePath = path.join(mediaPath, source[key].path);
                    else templatePath = source[key].path;

                    var text = fs.readFileSync(templatePath, 'utf8');
                } catch(e) {
                    log.warn('Can\'t get template file: ', source[key].path, ': ', e.message);
                    dest[key] = source[key];
                    continue;
                }
                dest[key] = replaceVariables(text.split('\n').join(''), variables);
            } else
            // typeof null is an object, checking for it
            if(source[key] !== null && typeof source[key] === 'object') dest[key] = appendToObject(source[key], variables);
            else {
                if(typeof source[key] !== 'string') dest[key] = source[key];
                else dest[key] = replaceVariables(source[key], variables);
            }
        }
    }

    return dest;
}

/*
users: array of user names,
priorities: array of priorities or string - mediaID

callback(err, medias), where
medias: {
    <mediaID1>: [{
        address:
        fullName:
        //userName,
        //priority:
    }, {}, .. ],
    ....
}
 */
function getMedias(initUsers, priorities, callback) {

    if(typeof initUsers === 'string') initUsers = [initUsers];
    if(!Array.isArray(initUsers) || !initUsers.length) return callback(null, {});

    var users = initUsers.map(function (user) {
        return prepareUser(user);
    });

    usersDB.getCommunicationMediaForUsers(users, function (err, rows) {
        if(err) {
            return callback(new Error('Can\'t get communication medias for users ' + users.join(', ') +
                ': ' + err.message));
        }

        if(!rows.length) return callback(new Error('Users [' + users.join(', ') + '] are not found'));

        var medias = {}, existingAddresses = {};
        rows.forEach(function (row) {
            if(!row.mediaID) return;
            if(!priorities ||
                (typeof priorities === 'string' && priorities.toLowerCase() === row.mediaID.toLowerCase()) ||
                (Array.isArray(priorities) && priorities.indexOf(row.priority) !== -1)) {
                if(!medias[row.mediaID]) medias[row.mediaID] = [];
                if(!existingAddresses[row.address]) {
                    existingAddresses[row.address] = true;
                    medias[row.mediaID].push({
                        address: row.address,
                        fullName: row.fullName,
                    });
                }
            }
        });
        callback(null, medias);
    });
}

communication.getMedias = function(callback) {
    var dir = path.join(__dirname, '..', communicationDir);

    fs.readdir(dir, {withFileTypes: true}, function (err, dirEntArr) {
        if (err) return callback(new Error('Can\'t read communication media dir ' + dir + ': ' + err.message));

        var medias = {};
        async.each(dirEntArr, function (dirEnt, callback) {
            if (!dirEnt.isDirectory()) return callback();

            var cfgFile = path.join(dir, dirEnt.name, configFileName);
            fs.readFile(cfgFile, 'utf8', function (err, cfgStr) {
                if(err) {
                    return callback(new Error('Can\'t get communication media config file ' + cfgFile +
                        ': ' + err.message));
                }

                try {
                    var cfg = JSON.parse(cfgStr);
                } catch (e) {
                    {
                        return callback(new Error('Can\'t parse communication media config file ' + cfgFile +
                            ': ' + e.message));
                    }
                }
                medias[dirEnt.name] = {
                    description: cfg.description,
                    address: cfg.address,
                    re: cfg.re,
                }
                callback();
            });
        }, function (err) {
            callback(err, medias);
        });
    });
};