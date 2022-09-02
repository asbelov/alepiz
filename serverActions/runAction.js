/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
const actions = require("../lib/actionsConf");
const async = require("async");
const rightsWrapper = require("../rightsWrappers/actions");
const tasksDB = require("../rightsWrappers/tasksDB");
const path = require("path");
const runInThread = require("../lib/runInThread");
var Conf = require('../lib/conf');
const thread = require("../lib/threads");
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');
const confLaunchers = new Conf('config/launchers.json');


var systemUser = conf.get('systemUser') || 'system';
var ajax = {}, launchers = {};

var serverNumber = confActions.get('serverNumber') || 0;

if(serverNumber < 1 || module.parent) {
    module.exports = runAction;
} else {
    new thread.child({
        module: 'runAction',
        onMessage: runAction,
    });
}

/*
Execute action, run ajax or add action to a new task

param: {
    actionID:..,
    executionMode:..,
    user:... (for check rights for action)
    args:...
    sessionID:...
}

callback(err, data)
data: returned data for ajax or action execution

 */
function runAction(param, callback) {

    var actionID = param.actionID;
    var executionMode = param.executionMode;

    module.sessionID = param.sessionID;
    if(param.user !== systemUser && executionMode === 'server') {
        log.info('Running action: ', actionID, ', parameters: ',
            // replace passwords in parameters
            JSON.stringify(param).replace(/"(.*?pass.*?":)"[^"]*?"/gi, '$1"****"'));
    }
    else { // don't log action start, running by for system users (running automatically)
        log.debug('Running action: ', actionID, ', execution mode: ', executionMode, ', parameters: ',
            // replace passwords in parameters
            JSON.stringify(param).replace(/"(.*?pass.*?":)"[^"]*?"/gi, '$1"****"'));
    }

    // checking in parallel for objects compatibility and user action rights
    actions.getConfiguration(actionID, function(err, actionCfg){
        if(err) return callback(err);

        if(!param.args) param.args = {};
        param.args.actionName = actionCfg.name;
        param.args.actionID = actionID;

        async.parallel([
            function(callback){
                // we can't control, what action send to us by ajax
                if(executionMode === 'ajax') return callback(null, actionCfg);

                if (!'o' in param.args) return callback(new Error('Error in parameter specification for run action'));

                if(param.args.o) {
                    try {
                        var objects = JSON.parse(param.args.o);
                        for(var i = 0; i < objects.length; i++) {
                            var ID = objects[i].id;
                            if(ID && Number(ID) === parseInt(String(ID), 10) && objects[i].name && typeof(objects[i].name) === 'string') {
                                ID = Number(ID);
                                continue;
                            }
                            return callback(new Error('Some objects are incorrect in parameter "o": ' + param.args.o));
                        }
                    }
                    catch (err) {
                        return callback(new Error('Error in parameter specification for action: can\'t convert "o" parameter from string "' +
                            JSON.stringify(param.args.o) + '" to JSON: ' + err.message));
                    }
                } else objects = [];

                if(objects.length) {
                    var objectsNames = objects.map(function (object) {
                        return (object.name)
                    });
                } else objectsNames = [];

                rightsWrapper.checkForObjectsCompatibility(actionCfg, objectsNames, function(err){
                    if(err) return callback(err);
                    callback(null, actionCfg);
                });
            },

            function(callback){
                rightsWrapper.checkActionRights(param.user, actionID, executionMode, callback);
            }
        ], function(err, result){
            if(err) return callback(err);

            var actionCfg = result[0]; // action configuration
            //var rights = result[1]; // rights.view, rights.run, rights.makeTask = true|false
            param.args.username = param.user;
            param.args.sessionID = param.sessionID;
            param.args.actionCfg = actionCfg;
            if(executionMode === 'makeTask'){
                module.sessionID = param.sessionID;
                log.debug('Saving action settings: ', param.args);

                // saving action parameters
                tasksDB.saveAction(param.user, param.sessionID, param.args, callback);
            } else if(executionMode === 'ajax') {
                if(!confActions.get('dir')) return callback(new Error('Undefined "actions:dir" parameter in main configuration'));
                if(!actionCfg.ajaxServer) return callback(new Error('Undefined "ajaxServer" parameter in action configuration'));

                var ajaxSource = path.join(__dirname, '..', confActions.get('dir'), actionID, actionCfg.ajaxServer);

                module.sessionID = param.sessionID;
                updateActionAjax(ajaxSource, param.updateAction, actionCfg.startAjaxAsThread, function (err) {
                    if(err) return callback(err);

                    try {
                        ajax[ajaxSource].func(param.args, callback);
                    } catch (err) {
                        callback(new Error('Error occurred while executing ajax for action "' + actionID + '": ' +
                            err.message + '; ajax: ' + JSON.stringify(ajax[ajaxSource]) + '; ' + err.stack));
                    }
                })
            } else {
                var launcherName = actionCfg.launcher;
                if(!launcherName) return callback(new Error('Undefined "launcher" parameter in action configuration'));
                if(!confLaunchers.get('dir')) return callback(new Error('Undefined "launchers:dir" parameter in main configuration'));
                if(!confLaunchers.get('fileName')) return callback(new Error('Undefined "launchers:fileName" parameter in main configuration'));
                var launcherSource = path.join(__dirname, '..', confLaunchers.get('dir'), launcherName, confLaunchers.get('fileName'));

                module.sessionID = param.sessionID;
                // delete old launcher from require cache for reread
                if(param.updateAction && require.resolve(launcherSource) && require.cache[require.resolve(launcherSource)]) {
                    delete require.cache[require.resolve(launcherSource)];
                }

                if(!launchers[launcherSource] || param.updateAction) {
                    try {
                        log.info('Attaching launcher file ', launcherSource,
                            (param.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time.'));
                        launchers[launcherSource] = require(launcherSource);
                    } catch (err) {
                        return callback(new Error('Can\'t attach launcher source file: ' + launcherSource +
                            ' for action "' + actionID + '": ' + err.message));
                    }
                }

                actionCfg.timeout = Number(actionCfg.timeout);
                if(actionCfg.timeout === parseInt(String(actionCfg.timeout), 10) && actionCfg.timeout > 1) {
                    var actionTimeoutWatchdog = setTimeout(function () {
                        if(typeof callback !== 'function') return;
                        var savedCallback = callback;
                        callback = null;
                        savedCallback(new Error('Timeout ' + actionCfg.timeout +'sec occurred while execute action ' + actionCfg.name));
                    }, actionCfg.timeout * 1000)
                }

                try {
                    actionCfg.launcherPrms.actionID = actionID;
                    actionCfg.launcherPrms.updateAction = param.updateAction;
                    var startActionTimestamp = Date.now();
                    launchers[launcherSource](actionCfg.launcherPrms, param.args, function(err, result) {
                        clearTimeout(actionTimeoutWatchdog);
                        if(typeof callback !== 'function') {
                            log.error('Action ', actionCfg.name, ' returned after timeout ', actionCfg.timeout,
                                'sec result: ', result, (err ? '; Error: ' + err.message : ' '), ' executing time: ',
                                Math.round((Date.now() - startActionTimestamp)/1000), 'sec');
                        } else {
                            var savedCallback = callback;
                            callback = null;
                            savedCallback(err, result);
                        }
                    });
                } catch (err) {
                    clearTimeout(actionTimeoutWatchdog);
                    if(typeof callback === 'function') {
                        var savedCallback = callback;
                        callback = null;
                        savedCallback(new Error('Error occurred while executing action "' + actionID + '": '+err.stack));
                    } else {
                        log.error('Action ', actionCfg.name, ' returned error after timeout ', actionCfg.timeout,
                            ': ', err.stack);
                    }
                }
            }
        });
    });
}

function updateActionAjax(ajaxSource, updateAction, startAjaxAsThread, callback) {
    waitingForUpdateAjax(ajaxSource, function () {
        if(ajax[ajaxSource] && !updateAction) return callback();

        if(startAjaxAsThread) {
            if(updateAction && ajax[ajaxSource]) {
                if(typeof ajax[ajaxSource].exit === 'function') ajax[ajaxSource].exit();
                else log.error('ajax[ajaxSource].exit is not a function: ', Object.keys(ajax[ajaxSource]))
            }
            ajax[ajaxSource] = {};

            log.info('Starting ajax ', ajaxSource, ' as a thread',
                (updateAction ? '. Required action update. Previous thread will be terminated.' : ' at a first time'));
            runInThread(ajaxSource, null,function (err, ajaxObj) {
                if(err) return callback(new Error('Can\'t start ajax : ' + ajaxSource + '  as a thread: ' + err.message));

                ajax[ajaxSource] = ajaxObj;
                callback();
            });
        } else {
            ajax[ajaxSource] = {};
            try {
                // delete old javaScript from require cache for reread
                if(updateAction && require.resolve(ajaxSource) && require.cache[require.resolve(ajaxSource)]) {
                    delete require.cache[require.resolve(ajaxSource)];
                }

                log.info('Attaching ajax ', ajaxSource,
                    (updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time'));

                ajax[ajaxSource] = {
                    func: require(ajaxSource),
                };
                return callback();
            } catch (err) {
                return callback(new Error('Can\'t attach ajax ' + ajaxSource + ': ' + err.message));
            }
        }
    });
}

function waitingForUpdateAjax(ajaxSource, callback) {
    if(ajax[ajaxSource] && typeof ajax[ajaxSource].func !== 'function') {
        setTimeout(waitingForUpdateAjax, 100, ajaxSource, callback);
    } else callback();
}