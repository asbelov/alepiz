/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.07.2017.
 */

const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const proc = require('../lib/proc');
const setShift = require('../lib/utils/setShift')
const unique = require('../lib/utils/unique');
const Conf = require('../lib/conf');
const conf = new Conf('config/common.json');
const confActions = new Conf('config/actions.json');


const actionsDB = require('../models_db/actionsDB');
const actionsDBSave = require('../models_db/modifiers/actionsDB');

const actionConf = require('../lib/actionsConf');

const thread = require("../lib/threads");
const path = require("path");
const runAction = require('./runAction');

var systemUser = conf.get('systemUser') || 'system';
var runActionProcess, runActionInQueue, runActionThreadNotInQueue;

// initialize exit handler: dumping update events status on exit
log.info('Starting the action runner server...');

var actionsQueueSystem = new Set(),
    actionQueueUser = new Set(),
    actionsInProgress = new Map(),
    hungActions = new Map(),
    processedNotInQueue = 0,
    processedInQueue = 0,
    droppedAction = 0,
    maxConcurrentActionsNum = 0,
    maxMemSize = confActions.get('maxMemSize') || conf.get('maxMemSize') || 4096,
    maxQueueLength = confActions.get('maxQueueLength') || 1000;

/**
 * @description Action server configuration
 * @type {{serverNumber: number, queueServerNumber: number, id: string}}
 */
var cfg = confActions.get();

attachRunAction(cfg.serverNumber || 10, function (err, _runActionInQueue) {
    if(err) throw err;

    attachRunAction(cfg.queueServerNumber || 10, function (err, _runActionNotInQueue) {
        if (err) throw err;
        runActionInQueue = _runActionInQueue;
        runActionThreadNotInQueue = _runActionNotInQueue;

        cfg.id = 'actionServer';
        new IPC.server(cfg, function (err, msg, socket, callback) {
            if (err) log.error(err.message);

            if (msg && msg.msg === 'runAction') return addActionToQueue(msg.param, callback);
            if (msg && msg.msg === 'getActionConfig') {
                return actionsDB.getActionConfig(msg.user, msg.actionID, callback);
            }
            if (msg && msg.msg === 'setActionConfig') {
                return actionsDBSave.setActionConfig(msg.user, msg.actionID, msg.config, callback);
            }

            if (socket === -1) {
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
            }
        });

        setInterval(function () {
            maxMemSize = confActions.get('maxMemSize') || conf.get('maxMemSize') || 4096;
            maxQueueLength = confActions.get('maxQueueLength') || 1000;
            var memUsage = Math.round(process.memoryUsage().rss / 1048576);

            log.info('Queue system/max/user: ', actionsQueueSystem.size , '/', maxQueueLength, '/', actionQueueUser.size,
                '; in progress/max/hung: ', (actionsInProgress.size + processedNotInQueue), '/',
                maxConcurrentActionsNum, '/', hungActions.size,
                '; processed/dropped: ', processedInQueue, '/', droppedAction,
                '. Memory: ', memUsage, 'Mb/', maxMemSize, 'Mb');

            droppedAction = processedInQueue = 0;

            if (memUsage * 1.5 > maxMemSize && (actionsInProgress.size || hungActions.size || processedNotInQueue)) {
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

/**
 * Start runAction threads
 * @param {number} serverNumber number of runAction threads
 * @param {function(Error)|function(null, function)} callback callback(Error, runActionProcess.sendAndReceive)
 */
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

/**
 * Add action (server.js) to the actions queue or run action (ajax.js or server.js) immediately
 * The action will be running immediately if there is a ajax.js or action configuration has a option notInQueue: true
 * In other cases нру action will be running from user or system queue.
 * @param {Object} param action parameters
 * @param {function(Error)|function(Error, Object)} callback callback(err, actionResult)
 */
function addActionToQueue(param, callback) {
    actionConf.getConfiguration(param.actionID, function (err, actionConf) {
        if(err) return callback(err);

        // run ajax, addTask and notInQueue actions without queue
        // param.notInQueue set in routes/routerActions.js for run the action started by the user without a queue
        if(param.executionMode !== 'server' || actionConf.notInQueue || param.notInQueue) {
            const myRunAction = actionConf.runActionInline ? runAction : runActionThreadNotInQueue;
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
                return callback(new Error('Action queue length too big ' + actionsQueueSystem.size + '/' +
                    maxQueueLength +
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

/**
 * Run one action from QUEUE. If user queue is not empty, run action from user queue.
 * If system queue is not empty, then run action from system queue
 */
function runActionFromQueue() {
    var _maxConcurrentActionsNum = confActions.get('maxConcurrentActionsNum');
    if(!_maxConcurrentActionsNum ||
        _maxConcurrentActionsNum !== parseInt(String(_maxConcurrentActionsNum), 10) ||
        _maxConcurrentActionsNum < 1) _maxConcurrentActionsNum = 40;

    if(maxConcurrentActionsNum !== _maxConcurrentActionsNum) {
        if(maxConcurrentActionsNum) {
            log.info('Parameter maxConcurrentActionsNum was changed from ', maxConcurrentActionsNum, ' to ',
                _maxConcurrentActionsNum);
        }

        maxConcurrentActionsNum = _maxConcurrentActionsNum;
    }

    // checking for halted actions
    if(actionsInProgress.size > maxConcurrentActionsNum) {
        actionsInProgress.forEach((actionInProgress, actionProgressID) => {
            if (actionInProgress.startTime) {
                var actionTimeout = actionInProgress.action.conf.timeout;
                if (Number(actionTimeout) !== parseInt(String(actionTimeout), 10) || actionTimeout < 0) {
                    actionTimeout = 60000;
                } else actionTimeout *= 1000;

                if (actionTimeout && Date.now() - actionInProgress.startTime < actionTimeout) return;

                log.warn('Action ', actionInProgress.action.conf.name, ' runs for a long time. Processed from ',
                    new Date(actionInProgress.startTime).toLocaleString(),
                    '. Process time/Action timeout: ',
                    Math.round((Date.now() - actionInProgress.startTime) / 1000), 'sec/',
                    actionTimeout / 1000, 'sec');

                hungActions.set(actionProgressID, actionInProgress);
                actionsInProgress.delete(actionProgressID);
            }
        });
    }

    // too many concurrent actions are in progress
    if(actionsInProgress.size > maxConcurrentActionsNum) return;

    // run actions from user queue
    if(actionQueueUser.size) return runQueue(actionQueueUser);

    // run actions from system queue
    if(actionsQueueSystem.size) return runQueue(actionsQueueSystem);
}

/**
 * Run action (in thread or inline)
 * @param {Set<{param: Object, callback: function, actionConf: Object}>} actionQueue action QUEUE
 */
function runQueue(actionQueue) {
    var action = setShift(actionQueue);

    var actionProgressID = unique.createID();

    const myRunAction = action.conf.runActionInline ? runAction : runActionInQueue;
    actionsInProgress.set(actionProgressID, {
        startTime: Date.now(),
        action: action,
    });
    myRunAction(action.param, function (err, data) {
        ++processedInQueue;
        action.callback(err, data);
        actionsInProgress.delete(actionProgressID);

        if(hungActions.has(actionProgressID)) {
            var actionInProgress = hungActions.get(actionProgressID);
            log.info('Hung action ', actionInProgress.action.conf.name, ' is finished. Processed from ',
                new Date(actionInProgress.startTime).toLocaleString(),
                '. Process time/Action timeout: ',
                Math.round((Date.now() - actionInProgress.startTime) / 1000), 'sec/',
                actionInProgress.action.conf.timeout / 1000, 'sec');
            hungActions.delete(actionProgressID)
        }
        var t = setImmediate(runActionFromQueue);
        t.unref();
    });
}