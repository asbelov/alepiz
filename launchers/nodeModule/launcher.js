/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const _log = require('../../lib/log');
const runInThread = require('../../lib/runInThread');
const path = require("path");

const Conf = require('../../lib/conf');
const confActions = new Conf('config/actions.json');

var actionServers = {};

module.exports = nodeLauncher;

/**
 * Run action as nodejs module
 * @param {Object} param launcher parameters
 * @param {Boolean} param.startAsThread start action in the separate working thread
 * @param {Boolean} param.updateAction run action in updateAction mode (reread server.js file)
 * @param {string} param.javaScript javascript file for run
 * @param {string} param.actionID action ID (i.e. action dir)
 * @param {number} param.sessionID sessionID for log to audit
 * @param {Object} args launcher arguments which send to the param.javaScript
 * @param {function(Error)|function(null, Object)} callback callback(err, actionResult)
 */
function nodeLauncher (param, args, callback){
    if(!param || !param.javaScript) return callback(new Error('JavaScript file is not specified for launcher "nodeModule"'));

    var server_js = path.join(__dirname, '..', '..', confActions.get('dir'), param.actionID, param.javaScript);

    updateActionServer(server_js, param, function (err) {
        if(err) return callback(err);
        module.sessionID = param.sessionID;
        actionServers[server_js].func(args, callback);
    });
}

function updateActionServer(server_js, param, callback) {
    var log = _log({
        filename: __filename,
    });

    waitingForUpdateServer(server_js, function () {
        if (actionServers[server_js] && !param.updateAction) return callback();

        actionServers[server_js] = {};

        if (param.startAsThread) {
            if (param.updateAction && actionServers[server_js] && typeof actionServers[server_js].exit === 'function') {
                actionServers[server_js].exit();
            }

            log.info('Starting nodejs file ', server_js, ' as a thread',
                (param.updateAction ?
                    '. An action update is required. Previous thread was terminated.' : ' at a first time'));

            // we use the "module" object as runInThread parameters to send a reference to the sessionID and change it
            // in the future when the sessionID changes
            module.sessionID = param.sessionID;
            runInThread(server_js, {module: module},function (err, serverObj) {
                if (err) {
                    return callback(new Error('Can\'t start js file : ' + server_js +
                        '  as a thread for launcher "nodeModule": ' + err.message));
                }

                actionServers[server_js] = serverObj;
                callback();
            });
        } else {
            // delete old server_js from require cache for reread
            if (param.updateAction && require.resolve(server_js) && require.cache[require.resolve(server_js)]) {
                delete require.cache[require.resolve(server_js)];
            }

            log.info('Attaching nodejs file ', server_js,
                (param.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));

            actionServers[server_js] = {
                func: require(server_js),
            };
            return callback();
        }
    });
}

function waitingForUpdateServer(server_js, callback) {
    if(actionServers[server_js] && typeof actionServers[server_js].func !== 'function') {
        setTimeout(waitingForUpdateServer, 100, server_js, callback);
    } else callback();
}
