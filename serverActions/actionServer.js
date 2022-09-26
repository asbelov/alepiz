/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.07.2017.
 */

var log = require('../lib/log')(module);
var async = require('async');
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');


var actionsDB = require('../models_db/actionsDB');

var tasksDB = require('../rightsWrappers/tasksDB');
const actionConf = require('../lib/actionsConf');
var actionClient = require('./actionClient');

var userDB = require('../models_db/usersDB');
var auditUsersDB = require('../models_db/auditUsersDB');
var transaction = require('../models_db/transaction');
const thread = require("../lib/threads");
const path = require("path");
const runAction = require('./runAction');

var systemUser = conf.get('systemUser') || 'system';
var runActionProcess, runActionThread, runActionThreadUser;

// initialize exit handler: dumping update events status on exit
log.info('Starting the action runner server...');

var actionsQueueSystem = new Set(),
    actionQueueUser = new Set(),
    createSessionQueue = new Set(),
    lastProcessedAction = {},
    processedNotInQueue = 0,
    processedInQueue = 0,
    droppedAction = 0,
    maxMemSize = confActions.get('maxMemSize') || conf.get('maxMemSize') || 4096,
    maxQueueLength = confActions.get('maxQueueLength') || 1000;

var cfg = confActions.get();

attachRunAction(cfg.serverNumber || 5, function (err, _runActionSystem) {
    if(err) throw err;

    attachRunAction(cfg.userServerNumber || 3, function (err, _runActionUser) {
        if (err) throw err;
        runActionThread = _runActionSystem;
        runActionThreadUser = _runActionUser;

        cfg.id = 'actionServer';
        new IPC.server(cfg, function (err, msg, socket, callback) {
            if (err) log.error(err.message);

            if (msg && msg.msg === 'runAction') return addActionToQueue(msg.param, callback);
            if (msg && msg.msg === 'createSession') return addCreateSessionToQueue(msg.param, callback);
            if (msg && msg.msg === 'markTaskCompleted') return tasksDB.markTaskCompleted(msg.taskID, callback);
            if (msg && msg.msg === 'getActionConfig') return actionsDB.getActionConfig(msg.user, msg.actionID, callback);
            if (msg && msg.msg === 'setActionConfig') return actionsDB.setActionConfig(msg.user, msg.actionID, msg.config, callback);

            if (socket === -1) {
                actionClient.connect(function () {
                    new proc.child({
                        module: 'actionServer',
                        onDisconnect: function () {  // exit on a disconnect from parent (then server will be restarted)
                            if (runActionProcess) runActionProcess.stop();
                            log.exit('Action server was disconnected from parent unexpectedly. Exiting');
                            log.disconnect(function () {
                                process.exit(2)
                            });
                        },
                    });
                });
            }
        });

        setInterval(function () {
            maxMemSize = confActions.get('maxMemSize') || conf.get('maxMemSize') || 4096;
            maxQueueLength = confActions.get('maxQueueLength') || 1000;
            var memUsage = Math.round(process.memoryUsage().rss / 1048576);

            log.info('Queue system: ', actionsQueueSystem.size , '/', maxQueueLength, ', user: ', actionQueueUser.size,
                '; processed in queue: ', processedInQueue,
                ', not in queue: ', processedNotInQueue,
                '; dropped: ', droppedAction,
                (lastProcessedAction.startTime ?
                    '. Action "' + lastProcessedAction.action.conf.name + '" started on ' +
                    new Date(lastProcessedAction.startTime).toLocaleString() :
                    '. No action processing'),
                '. Memory: ', memUsage, 'Mb/', maxMemSize, 'Mb');

            droppedAction = processedInQueue = 0;

            if (memUsage * 1.5 > maxMemSize && (lastProcessedAction.startTime || processedNotInQueue)) {
                try {
                    global.gc();
                    log.warn('Processing garbage collection on server... Before ', memUsage, 'Mb, after ',
                        Math.round(process.memoryUsage().rss / 1048576), 'Mb');
                } catch (e) {
                }
            }
        }, 60000);
    });
});


function attachRunAction(serverNumber, callback) {
    if(!cfg.serverNumber || cfg.serverNumber < 1) {
        log.info('Include runAction in action server');
        return callback(null, runAction);
    }


    runActionProcess = new thread.parent({
        childrenNumber: serverNumber,
        childProcessExecutable: path.join(__dirname, 'runAction.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        module: 'runAction',
    }, function(err, runActionProcess) {
        if(err) return callback(new Error('Can\'t initializing runAction process: ' + err.message));

        runActionProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run runAction process: ' + err.message));

            log.info('Starting ', serverNumber, ' threads of the runAction');
            callback(null, runActionProcess.sendAndReceive);
        });
    });
}

/*
  Create new session ID for each running actions or if no action running
  return sessionID.
*/
function createSession(param, callback) {

    var user = param.user, actionID = param.actionID, actionName = param.actionName;

    // Must be an integer
    var sessionID = parseInt(String(new Date().getTime()) + String(parseInt(String(Math.random() * 100), 10)), 10);

    userDB.getID(user, function(err, userID) {
        if (err) return callback(new Error('Can\'t get user ID for user ' + user + ': ' + err.message));

        // use transaction for prevent locking database when inserting action data and session parameters.
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

function addCreateSessionToQueue(param, callback) {
    createSessionQueue.add({
        param: param,
        callback: callback,
    });
    runActionFromQueue();
}

function addActionToQueue(param, callback) {
    actionConf.getConfiguration(param.actionID, function (err, actionConf) {
        if(err) return callback(err);

        // run ajax, addTask and notInQueue actions without queue
        // param.notInQueue set in routes/actions.js for run the action started by the user without a queue
        if(param.executionMode !== 'server' || actionConf.notInQueue || param.notInQueue) {
            const myRunAction = actionConf.runActionInline ? runAction : runActionThreadUser;
            ++processedNotInQueue;
            myRunAction(param, function (err, data) {
                --processedNotInQueue;
                callback(err, data);
            });
            return;
        }

        if (param.user !== systemUser) { // add user action to the user queue
            actionQueueUser.add({
                param: param,
                callback: callback,
                conf: actionConf,
            });
        } else { // add system action to the system queue
            // drop action if action queue too big.
            if(actionsQueueSystem.size > maxQueueLength) {
                ++droppedAction;
                return callback(new Error('Action queue length too big ' + actionsQueueSystem.size + '/' + maxQueueLength +
                    ' for run action ' + param.actionID + '. Action will not be running.'));
            }

            actionsQueueSystem.add({
                param: param,
                callback: callback,
                conf: actionConf,
            });
        }

        runActionFromQueue();
    });
}
/*
All actions can be running in order
 */
function runActionFromQueue() {

    if(lastProcessedAction.startTime) {
        var actionTimeout = lastProcessedAction.action.conf.timeout;
        if(Number(actionTimeout) !== parseInt(String(actionTimeout), 10) || actionTimeout < 0) actionTimeout = 60000;
        else actionTimeout *= 1000;

        if (actionTimeout && Date.now() - lastProcessedAction.startTime < actionTimeout) return;

        log.warn('Action ', lastProcessedAction.action.conf.name, ' processed from ',
            new Date(lastProcessedAction.startTime).toLocaleString(),
            ' (', Math.round((Date.now() - lastProcessedAction.startTime) / 1000), 'sec/', actionTimeout/1000,
            'sec). Running the next action');
    }

    // first creating sessions
    if(createSessionQueue.size) {
        var sessions = Array.from(createSessionQueue);
        createSessionQueue.clear();

        lastProcessedAction = {
            startTime: Date.now(),
            action: {
                conf: {
                    timeout: 60,
                    name: 'createSessions: ' + JSON.stringify(sessions),
                }
            },
        };
        async.eachSeries(sessions, function (session, callback) {
            createSession(session.param, function (err, sessionID) {
                session.callback(err, sessionID);
                lastProcessedAction = {};
                callback();
            });
        }, function () {
            setTimeout(runActionFromQueue, 0).unref();
        });
        return
    }

    // run actions from user queue
    if(actionQueueUser.size) return runQueue(actionQueueUser);

    // run actions from system queue
    if(actionsQueueSystem.size) return runQueue(actionsQueueSystem);
}

function runQueue(actionQueue) {

    // action = actionQueue.shift() for Set()
    var actionQueueIterator = actionQueue.values();
    var action = actionQueueIterator.next().value
    actionQueue.delete(action);

    const myRunAction = action.conf.runActionInline ? runAction : runActionThread;
    lastProcessedAction = {
        startTime: Date.now(),
        action: action,
    };
    myRunAction(action.param, function (err, data) {
        ++processedInQueue;
        action.callback(err, data);
        lastProcessedAction = {};
        setTimeout(runActionFromQueue, 0).unref();
    });
}