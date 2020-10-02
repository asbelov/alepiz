/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.07.2017.
 */
var async = require('async');

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var path = require("path");
var rightsWrapper = require('../rightsWrappers/actions');
var actions = require('../lib/actionsConf');
var history = require('../models_history/history');
var server = require('../lib/server');

var tasksDB = require('../rightsWrappers/tasksDB');
var actionClient = require('../lib/actionClient');

var userDB = require('../models_db/usersDB');
var auditUsersDB = require('../models_db/auditUsersDB');
var transaction = require('../models_db/transaction');

var systemUser = conf.get('systemUser') || 'system';

/*
Don't concatenate this file with actionClient.js because it will making circulate requirements in task.js file
*/

if(module.parent) initServer();
else runServerProcess(); //standalone process

var ajax = {}, launchers = {};

// connecting to history and collector server process for actions, which communicate with a history and collector server
// Don't create ordered callback series, it's does not work. I don't know why
server.connect();
history.connect();

function initServer() {
    var actionServer = {};
    module.exports = actionServer;
// starting action server child process and IPC system
    actionServer.runAction = runAction;

    actionServer.stop = function(callback) { callback();  };
    actionServer.start = function (_callback) {

        var callback = function(err) {
            if(typeof _callback === 'function') return _callback(err);
            if(err) log.error(err.message);
        };

        new proc.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            restartAfterErrorTimeout: 500,
            killTimeout: 1000,
            module: 'actionServer',
        }, function (err, actionServerProcess) {
            if(err) return callback(new Error('Can\'t initializing action server: ' + err.message));

            actionServerProcess.start(function (err) {
                if(err) return callback(new Error('Can\'t run action server: ' + err.message));

                actionServer.stop = actionServerProcess.stop;
                callback();
            });
        });
    };
}

function runServerProcess() {
    // initialize exit handler: dumping update events status on exit
    log.info('Starting actions runner server process');

    var actionsQueue = [],
        processedActions = 0,
        maxMemSize = conf.get('maxMemSize') || 4096;

    var cfg = conf.get('actions');

    cfg.id = 'actionServer';
    new IPC.server(cfg, function(err, msg, socket, callback) {
        if(err) log.error(err.message);

        if(msg && msg.msg === 'runAction') return runActionsQueue(msg.prms, callback);
        if(msg && msg.msg === 'createSession') return createSession(msg.prms, callback);
        if(msg && msg.msg === 'markTaskCompleted') return tasksDB.markTaskCompleted(msg.taskID, callback);

        if(socket === -1) {
            actionClient.connect(function() {
                new proc.child({
                    module: 'actionServer',
                    onDisconnect: function() {  // exit on disconnect from parent (then server will be restarted)
                        log.exit('Action server was disconnected from parent unexpectedly. Exiting');
                        process.exit(2);
                    },
                });
            });
        }
    });

    /*
      Create new session ID for each running actions or if no action running
      return sessionID
    */
    function createSession(prms, callback) {

        var user = prms.user, actionID = prms.actionID, actionName = prms.actionName;

        // Must be an integer
        var sessionID = parseInt(String(new Date().getTime()) + String(parseInt(String(Math.random() * 100), 10)), 10);

        userDB.getID(user, function(err, userID) {
            if (err) return callback(new Error('Can\'t get user ID for user ' + user + ': ' + err.message));

            // use transaction for prevent locking database when inserting action data and session parameters
            transaction.begin(function (err) {
                if(err) return callback(err);

                auditUsersDB.addNewSessionID(userID, sessionID, actionID, actionName, new Date().getTime(), function (err) {
                    if(err) return transaction.rollback(err, callback);

                    transaction.end(function (err) {
                        callback(err, sessionID);
                    });
                });
            });
        });
    }

    function runActionsQueue(prms, callback) {
        actionsQueue.push({
            prms: prms,
            callback: callback
        });

        var memUsage = Math.round(process.memoryUsage().rss / 1048576);
        if (memUsage * 1.5 > maxMemSize && processedActions && prms.user === systemUser) {
            try {
                global.gc();
                log.info('Processing garbage collection on server... Before ', memUsage, 'Mb, after ',
                    Math.round(process.memoryUsage().rss / 1048576), 'Mb');
            } catch (e) {}
            memUsage = Math.round(process.memoryUsage().rss / 1048576);
            if(memUsage * 1.5 > maxMemSize && actionsQueue.length === 1)
                log.warn('High memory usage ', memUsage, 'Mb/', maxMemSize,
                    'Mb. Starting add actions to queue. Processed actions: ', processedActions);

            return;
        }

        var action = actionsQueue.shift();
        ++processedActions;
        runAction(action.prms, function (err, data) {
            --processedActions;
            action.callback(err, data);

            if(actionsQueue.length && (action.prms.user === systemUser || !processedActions)) {
                action = actionsQueue.shift();
                if(!actionsQueue.length) log.info('Finishing processing action queue. Memory usage ',
                    Math.round(memUsage), 'Mb/', maxMemSize, 'Mb. Processed actions: ', processedActions);
                runActionsQueue(action.prms, action.callback);
            }
        });
    }
}


/*
Execute action, run ajax or add action to a new task

prms: {
    actionID:..,
    executionMode:..,
    user:... (for check rights for action)
    args:...
    sessionID:...
}

callback(err, data)
data: returned data for ajax or action execution

 */
function runAction(prms, callback) {

    var actionID = prms.actionID;
    var executionMode = prms.executionMode;

    module.sessionID = prms.sessionID;
    if(prms.user !== systemUser && executionMode === 'server') {
        log.info('Running action: ', actionID, ', parameters: ',
            // replace passwords in parameters
            JSON.stringify(prms).replace(/"(.*?pass.*?":)"[^"]*?"/gi, '$1"****"'));
    }
    else { // don't log action start, running by for system users (running automatically)
        log.debug('Running action: ', actionID, ', execution mode: ', executionMode, ', parameters: ',
            // replace passwords in parameters
            JSON.stringify(prms).replace(/"(.*?pass.*?":)"[^"]*?"/gi, '$1"****"'));
    }

    // checking in parallel for objects compatibility and user action rights
    actions.getConfiguration(actionID, function(err, actionCfg){
        if(err) return callback(err);

        if(!prms.args) prms.args = {};
        prms.args.actionName = actionCfg.name;
        prms.args.actionID = actionID;

        async.parallel([
            function(callback){
                // we can't control, what action send to us by ajax
                if(executionMode === 'ajax') return callback(null, actionCfg);

                if (!'o' in prms.args) return callback(new Error('Error in parameter specification for run action'));

                if(prms.args.o) {
                    try {
                        var objects = JSON.parse(prms.args.o);
                        for(var i = 0; i < objects.length; i++) {
                            var ID = objects[i].id;
                            if(ID && Number(ID) === parseInt(String(ID), 10) && objects[i].name && typeof(objects[i].name) === 'string') {
                                ID = Number(ID);
                                continue;
                            }
                            return callback(new Error('Some objects are incorrect in parameter "o": ' + prms.args.o));
                        }
                    }
                    catch (err) {
                        return callback(new Error('Error in parameter specification for action: can\'t convert "o" parameter from string "' +
                            JSON.stringify(prms.args.o) + '" to JSON: ' + err.message));
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
                rightsWrapper.checkActionRights(prms.user, actionID, executionMode, callback);
            }
        ], function(err, result){
            if(err) return callback(err);

            var actionCfg = result[0]; // action configuration
            //var rights = result[1]; // rights.view, rights.run, rights.makeTask = true|false
            prms.args.username = prms.user;
            prms.args.sessionID = prms.sessionID;
            if(executionMode === 'makeTask'){
                module.sessionID = prms.sessionID;
                log.debug('Saving action settings: ', prms.args);

                // saving action parameters
                tasksDB.saveAction(prms.user, prms.sessionID, prms.args, callback);
            } else if(executionMode === 'ajax') {
                if(!conf.get('actions:dir')) return callback(new Error('Undefined "actions:dir" parameter in main configuration'));
                if(!actionCfg.ajaxServer) return callback(new Error('Undefined "ajaxServer" parameter in action configuration'));

                var ajaxSource = path.join(__dirname, '..', conf.get('actions:dir'), actionID, actionCfg.ajaxServer);

                module.sessionID = prms.sessionID;
                // delete old ajax from require cache for reread on press update button
                if(prms.updateAction && require.resolve(ajaxSource) && require.cache[require.resolve(ajaxSource)]) delete require.cache[require.resolve(ajaxSource)];
                if(!ajax[ajaxSource] || prms.updateAction) {
                    try {
                        log.warn('Attaching file for run ajax ', ajaxSource, (prms.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time.'));
                        ajax[ajaxSource] = require(ajaxSource);
                    } catch (err) {
                        return callback(new Error('Can\'t attach ajax source file: ' + ajaxSource + ' for action "' + actionID + '": ' + err.message));
                    }
                }

                try {
                    ajax[ajaxSource](prms.args, callback);
                } catch (err) {
                    callback(new Error('Error occurred while executing ajax for action "' + actionID + '": ' + err.stack));
                }
            } else {
                var launcherName = actionCfg.launcher;
                if(!launcherName) return callback(new Error('Undefined "launcher" parameter in action configuration'));
                if(!conf.get('launchers:dir')) return callback(new Error('Undefined "launchers:dir" parameter in main configuration'));
                if(!conf.get('launchers:fileName')) return callback(new Error('Undefined "launchers:fileName" parameter in main configuration'));
                var launcherSource = path.join(__dirname, '..', conf.get('launchers:dir'), launcherName, conf.get('launchers:fileName'));

                module.sessionID = prms.sessionID;
                // delete old launcher from require cache for reread
                if(prms.updateAction && require.resolve(launcherSource) && require.cache[require.resolve(launcherSource)]) delete require.cache[require.resolve(launcherSource)];
                if(!launchers[launcherSource] || prms.updateAction) {
                    try {
                        log.warn('Attaching launcher file ', launcherSource, (prms.updateAction ? '. Required action update. Cached data was deleted.' : ' at a first time.'));
                        launchers[launcherSource] = require(launcherSource);
                    } catch (err) {
                        return callback(new Error('Can\'t attach launcher source file: ' + launcherSource + ' for action "' + actionID + '": ' + err.message));
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
                    actionCfg.launcherPrms.updateAction = prms.updateAction;
                    launchers[launcherSource](actionCfg.launcherPrms, prms.args, function(err, result) {
                        clearTimeout(actionTimeoutWatchdog);
                        if(typeof callback !== 'function') {
                            log.error('Action ', actionCfg.name, ' returned after timeout ', actionCfg.timeout,
                                'sec result: ', result, (err ? '; Error: ' + err.message : ' '),);
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

