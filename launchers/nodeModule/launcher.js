/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var conf = require('../../lib/conf');
var path = require("path");

var servers = {};

module.exports = function(prms, args, callback){
    if(!prms || !prms.javaScript) return callback(new Error('Java script file is not specified for launcher "nodeModule"'));

    var javaScript = path.join(__dirname, '..', '..', conf.get('actions:dir'), prms.actionID, prms.javaScript);

    if(!servers[javaScript] || prms.updateAction) {
        try {
            // delete old javaScript from require cache for reread
            if(prms.updateAction && require.resolve(javaScript) && require.cache[require.resolve(javaScript)]) delete require.cache[require.resolve(javaScript)];

            log.warn('Attaching nodejs file ', javaScript, (prms.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));
            servers[javaScript] = require(javaScript);
        } catch (err) {
            return callback(new Error('Can\'t attach source js file: ' + javaScript + ' for launcher "nodeModule": ' + err.message));
        }
    }

    try {
        servers[javaScript](args, callback);
    } catch (err) {
        callback(new Error('Error occurred while executing js file ' + javaScript + ' for launcher "nodeModule": ' + err.message));
    }
};