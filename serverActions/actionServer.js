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
    actionsInProgressUser = new Map(),
    actionsInProgressSystem = new Map(),
    hungUserActions = new Map(),
    hungSystemActions = new Map(),
    processedNotInQueue = 0,
    processedInQueue = 0,
    droppedAction = 0,
    maxConcurrentUserActionsNum = 0,
    maxConcurrentSystemActionsNum = 0,
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
                '; user in progress/max/hung: ', (actionsInProgressUser.size + processedNotInQueue), '/',
                maxConcurrentUserActionsNum, '/', hungUserActions.size,
                '; system in progress/max/hung: ', (actionsInProgressSystem.size + processedNotInQueue), '/',
                maxConcurrentSystemActionsNum, '/', hungSystemActions.size,
                '; processed/dropped: ', processedInQueue, '/', droppedAction,
                '. Memory: ', memUsage, 'Mb/', maxMemSize, 'Mb');

            droppedAction = processedInQueue = 0;

            if (memUsage * 1.5 > maxMemSize &&
                (actionsInProgressUser.size || actionsInProgressSystem.size||
                    hungUserActions.size || hungSystemActions.size || processedNotInQueue)) {
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
    var _maxConcurrentUserActionsNum = confActions.get('maxConcurrentUserActionsNum');
    if(!_maxConcurrentUserActionsNum ||
        _maxConcurrentUserActionsNum !== parseInt(String(_maxConcurrentUserActionsNum), 10) ||
        _maxConcurrentUserActionsNum < 1) _maxConcurrentUserActionsNum = 40;

    if(maxConcurrentUserActionsNum !== _maxConcurrentUserActionsNum) {
        if(maxConcurrentUserActionsNum) {
            log.info('Parameter maxConcurrentUserActionsNum was changed from ', maxConcurrentUserActionsNum, ' to ',
                _maxConcurrentUserActionsNum);
        }

        maxConcurrentUserActionsNum = _maxConcurrentUserActionsNum;
    }

    var _maxConcurrentSystemActionsNum = confActions.get('maxConcurrentSystemActionsNum');
    if(!_maxConcurrentSystemActionsNum ||
        _maxConcurrentSystemActionsNum !== parseInt(String(_maxConcurrentSystemActionsNum), 10) ||
        _maxConcurrentSystemActionsNum < 1) _maxConcurrentSystemActionsNum = 2;

    if(maxConcurrentSystemActionsNum !== _maxConcurrentSystemActionsNum) {
        if(maxConcurrentSystemActionsNum) {
            log.info('Parameter maxConcurrentSystemActionsNum was changed from ', maxConcurrentSystemActionsNum, ' to ',
                _maxConcurrentSystemActionsNum);
        }

        maxConcurrentSystemActionsNum = _maxConcurrentSystemActionsNum;
    }

    // checking for halted actions
    if(actionsInProgressUser.size > maxConcurrentUserActionsNum) {
        actionsInProgressUser.forEach((actionInProgress, actionProgressID) => {
            if (actionInProgress.startTime) {
                var actionTimeout = actionInProgress.action.conf.timeout;
                if (Number(actionTimeout) !== parseInt(String(actionTimeout), 10) || actionTimeout < 0) {
                    actionTimeout = 60000;
                } else actionTimeout *= 1000;

                if (actionTimeout && Date.now() - actionInProgress.startTime < actionTimeout) return;

                log.warn('User action ', actionInProgress.action.conf.name, ' runs for a long time. Processed from ',
                    new Date(actionInProgress.startTime).toLocaleString(),
                    '. Process time/Action timeout: ',
                    Math.round((Date.now() - actionInProgress.startTime) / 1000), 'sec/',
                    actionTimeout / 1000, 'sec');

                hungUserActions.set(actionProgressID, actionInProgress);
                actionsInProgressUser.delete(actionProgressID);
            }
        });
    }

    // checking for halted actions
    if(actionsInProgressSystem.size > maxConcurrentSystemActionsNum) {
        actionsInProgressSystem.forEach((actionInProgress, actionProgressID) => {
            if (actionInProgress.startTime) {
                var actionTimeout = actionInProgress.action.conf.timeout;
                if (Number(actionTimeout) !== parseInt(String(actionTimeout), 10) || actionTimeout < 0) {
                    actionTimeout = 60000;
                } else actionTimeout *= 1000;

                if (actionTimeout && Date.now() - actionInProgress.startTime < actionTimeout) return;

                log.warn('System action ', actionInProgress.action.conf.name, ' runs for a long time. Processed from ',
                    new Date(actionInProgress.startTime).toLocaleString(),
                    '. Process time/Action timeout: ',
                    Math.round((Date.now() - actionInProgress.startTime) / 1000), 'sec/',
                    actionTimeout / 1000, 'sec');

                hungSystemActions.set(actionProgressID, actionInProgress);
                actionsInProgressSystem.delete(actionProgressID);
            }
        });
    }

    // run actions from the user queue if there are not many simultaneous actions being in progress
    if(actionQueueUser.size && actionsInProgressUser.size < maxConcurrentUserActionsNum) {
        return runQueue(actionQueueUser, 1);
    }

    // run actions from the system queue if there are not many simultaneous actions being in progress
    if(actionsQueueSystem.size && actionsInProgressSystem.size < maxConcurrentSystemActionsNum) {
        return runQueue(actionsQueueSystem, 2);
    }
}

/**
 * Run action (in thread or inline)
 * @param {Set<{param: Object, callback: function, actionConf: Object}>} actionQueue action QUEUE
 * @param {1|2} queueType 1 - user queue, 2 system queue
 */
function runQueue(actionQueue, queueType) {
    var action = setShift(actionQueue);

    var actionProgressID = unique.createID();

    const myRunAction = action.conf.runActionInline ? runAction : runActionInQueue;
    if(queueType === 1) {
        actionsInProgressUser.set(actionProgressID, {
            startTime: Date.now(),
            action: action,
        });
    } else {
        actionsInProgressSystem.set(actionProgressID, {
            startTime: Date.now(),
            action: action,
        });
    }
    myRunAction(action.param, function (err, data) {
        ++processedInQueue;
        action.callback(err, data);

        if(queueType === 1) actionsInProgressUser.delete(actionProgressID);
        else actionsInProgressSystem.delete(actionProgressID);

        if(hungUserActions.has(actionProgressID)) {
            var actionInProgressUser = hungUserActions.get(actionProgressID);
            log.info('Hung user action ', actionInProgressUser.action.conf.name, ' is finished. Processed from ',
                new Date(actionInProgressUser.startTime).toLocaleString(),
                '. Process time/Action timeout: ',
                Math.round((Date.now() - actionInProgressUser.startTime) / 1000), 'sec/',
                actionInProgressUser.action.conf.timeout / 1000, 'sec');
            hungUserActions.delete(actionProgressID)
        } else if(hungSystemActions.has(actionProgressID)) {
            var actionInProgressSystem = hungSystemActions.get(actionProgressID);
            log.info('Hung system action ', actionInProgressSystem.action.conf.name, ' is finished. Processed from ',
                new Date(actionInProgressSystem.startTime).toLocaleString(),
                '. Process time/Action timeout: ',
                Math.round((Date.now() - actionInProgressSystem.startTime) / 1000), 'sec/',
                actionInProgressSystem.action.conf.timeout / 1000, 'sec');
            hungSystemActions.delete(actionProgressID)
        }
        var t = setTimeout(runActionFromQueue, 0);
        t.unref();
    });
}