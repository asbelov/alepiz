/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const runInThread = require('../../lib/runInThread');
const path = require("path");

const Conf = require('../../lib/conf');
const confActions = new Conf('config/actions.json');

var actionServers = {};

module.exports = nodeLauncher;

function nodeLauncher (param, args, callback){
    if(!param || !param.javaScript) return callback(new Error('JavaScript file is not specified for launcher "nodeModule"'));

    var server_js = path.join(__dirname, '..', '..', confActions.get('dir'),
        param.actionID, param.javaScript);

    updateActionServer(server_js, param, function (err) {
        if(err) return callback(err);

        //try {
            actionServers[server_js].func(args, callback);
        /*
        } catch (err) {
            callback(new Error('Error occurred while executing js file ' + server_js +
                ' for launcher "nodeModule": ' + err.stack));
        }
        */
    });
}

function updateActionServer(server_js, param, callback) {
    waitingForUpdateServer(server_js, function () {
        if (actionServers[server_js] && !param.updateAction) return callback();

        actionServers[server_js] = {};

        if (param.startAsThread) {
            if (param.updateAction && actionServers[server_js] && typeof actionServers[server_js].exit === 'function') {
                actionServers[server_js].exit();
            }

            log.debug('Starting nodejs file ', server_js, ' as a thread',
                (param.updateAction ?
                    '. An action update is required. Previous thread was terminated.' : ' at a first time'));

            runInThread(server_js, {module: module},function (err, serverObj) {
                if (err) {
                    return callback(new Error('Can\'t start js file : ' + server_js +
                        '  as a thread for launcher "nodeModule": ' + err.message));
                }

                actionServers[server_js] = serverObj;
                callback();
            });
        } else {
            //try {
                // delete old server_js from require cache for reread
                if (param.updateAction && require.resolve(server_js) && require.cache[require.resolve(server_js)]) {
                    delete require.cache[require.resolve(server_js)];
                }

                log.debug('Attaching nodejs file ', server_js,
                    (param.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));

                actionServers[server_js] = {
                    func: require(server_js),
                };
                return callback();
            /*
            } catch (err) {
                return callback(new Error('Can\'t attach source js file: ' + server_js +
                    ' for launcher "nodeModule": ' + err.stack));
            }
            */
        }
    });
}

function waitingForUpdateServer(server_js, callback) {
    if(actionServers[server_js] && typeof actionServers[server_js].func !== 'function') {
        setTimeout(waitingForUpdateServer, 100, server_js, callback);
    } else callback();
}
