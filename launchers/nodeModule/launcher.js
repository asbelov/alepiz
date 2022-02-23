/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var Conf = require('../../lib/conf');
const confActions = new Conf('config/actions.json');
var path = require("path");
var runInThread = require('../../lib/runInThread');

var servers = {};
var initCache = {};

module.exports = nodeLauncher;

function nodeLauncher (param, args, callback){
    if(!param || !param.javaScript) return callback(new Error('JavaScript file is not specified for launcher "nodeModule"'));

    var javaScript = path.join(__dirname, '..', '..', confActions.get('dir'), param.actionID, param.javaScript);

    if(servers[javaScript] && !servers[javaScript].func) {
        if(!initCache[javaScript]) initCache[javaScript] = [];
        initCache[javaScript].push({
            args: args,
            callback: callback,
        });
        return;
    }

    updateActionServer(javaScript, param, function (err) {
        if(err) return callback(err);

        runCache(javaScript);

        try {
            servers[javaScript].func(args, callback);
        } catch (err) {
            callback(new Error('Error occurred while executing js file ' + javaScript + ' for launcher "nodeModule": ' + err.stack));
        }
    });
}

function updateActionServer(javaScript, param, callback) {
    waitingForUpdateServer(javaScript, function () {
        if (servers[javaScript] && !param.updateAction) return callback();

        servers[javaScript] = {};

        if (param.startAsThread) {
            if (param.updateAction && servers[javaScript] && typeof servers[javaScript].exit === 'function') {
                servers[javaScript].exit();
            }

            log.info('Starting nodejs file ', javaScript, ' as a thread',
                (param.updateAction ? '. Required action update. Previous thread will be terminated.' : ' at a first time'));
            runInThread(javaScript, null,function (err, serverObj) {
                if (err) return callback(new Error('Can\'t start js file : ' + javaScript +
                    '  as a thread for launcher "nodeModule": ' + err.message));

                servers[javaScript] = serverObj;
                callback();
            });
        } else {
            try {
                // delete old javaScript from require cache for reread
                if (param.updateAction && require.resolve(javaScript) && require.cache[require.resolve(javaScript)]) {
                    delete require.cache[require.resolve(javaScript)];
                }

                log.info('Attaching nodejs file ', javaScript,
                    (param.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));

                servers[javaScript] = {
                    func: require(javaScript),
                };
                return callback();
            } catch (err) {
                return callback(new Error('Can\'t attach source js file: ' + javaScript + ' for launcher "nodeModule": ' + err.stack));
            }
        }
    });
}

function waitingForUpdateServer(javaScript, callback) {
    if(servers[javaScript] && typeof servers[javaScript].func !== 'function') {
        setTimeout(waitingForUpdateServer, 100, javaScript, callback);
    } else callback();
}


function runCache(javaScript) {
    if(!initCache[javaScript] || !initCache[javaScript].length) return;

    var args = initCache[javaScript].shift();
    servers[javaScript].func(args.args, args.callback);
    runCache(javaScript);
}