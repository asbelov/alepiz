/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const createLogObject = require('./createLogObject');
const prepareLogMessage = require('./prepareLogMessage');
const writeLog = require('./writeLog');
const connectToRemoteNodes = require("../lib/connectToRemoteNodes");
const createLabel = require('./createLabel');
const exitHandler = require('../lib/exitHandler');

const Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');

var cfg = confLog.get();
var clientIPC, allClientIPC, callbacksWhileConnecting = [];

/**
 * Initialize log
 * @param {{filename: string, [sessionID]: number}|NodeModule} parentModule
 * @return {{
 *  debug: Function,
 *  info: Function,
 *  warn: Function,
 *  error: Function,
 *  exit: Function,
 *  throw: Function,
 *  raw: Function,
 *  options: Function,
 *  addNewSession: Function,
 *  addSessionResult: Function,
 *  getAuditData: Function,
 *  disconnect: Function,
 *  addTaskComment: Function,
 *  addActionComment: Function,
 * }}
 */
module.exports = function (parentModule) {

    exitHandler.init(null, parentModule, {});
    var label = createLabel(parentModule);
    cfg.id = 'log:' + label;
    cfg.connectOnDemand = true;
    cfg.socketTimeout = 90000000; // disconnect after idle more then 25 hours

    clientIPC = new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.warn('IPC client error: ', err.message);
    });

    for (var mod = parentModule; mod; mod = mod.parent) {
        if (mod.sessionID) {
            var sessionID = Number(mod.sessionID);
            break;
        }
    }

    /**
     * @type {{
     *      debug: Function,
     *      info: Function,
     *      warn: Function,
     *      error: Function,
     *      exit: Function,
     *      throw: Function,
     *      [raw]: Function,
     *      [options]: Function,
     *      [addNewSession]: Function,
     *      [addSessionResult]: Function,
     *      [addTaskComment]: Function,
     *      [addActionComment]: Function,
     *      [getAuditData]: Function,
     *      [disconnect]: Function,
     * }}
     */
    var logObj = createLogObject(parentModule, sessionID, label, sendToLogServer);

    logObj.raw = function(level, args) {
        return sendToLogServer(level, args, parentModule, sessionID, label);
    }

    logObj.options = function () {
        var args = Array.prototype.slice.call(arguments);
        var options = args.pop();
        return sendToLogServer('I', args, parentModule, sessionID, label, options);
    };

    /**
     * Add a new session before run action
     * @param {Object} sessionObj sessionParameters
     * @param {number|string} sessionObj.username username
     * @param {number} sessionObj.sessionID sessionID
     * @param {string} sessionObj.actionID action directory name
     *   to the auditDB. In the future can be add to audit another session type if necessary
     * @param {number} [sessionObj.taskID] taskID if action was running from the task
     * @param {number} [sessionObj.taskSession] unique taskSession if action was running from the task
     * @param {number} sessionObj.startTimestamp timestamp when action was started
     * @param {Array} sessionObj.objects objects for action
     * @param {string} [sessionObj.descriptionTemplate] action template description for create action description
     * @param {Object} [sessionObj.args] action parameters {<name>:<value>,...} for create action description
     * @param {function} callback callback()
     */
    logObj.addNewSession = function (sessionObj, callback) {
        clientIPC.sendAndReceive(sessionObj, callback);
    }

    /**
     * Add stopTimestamp and error to the session after the action is completed
     * @param {Object} sessionObj sessionParameters
     * @param {number} sessionObj.sessionID sessionID
     * @param {number} sessionObj.stopTimestamp timestamp when action was stopped
     * @param {string|null} sessionObj.error action error
     */
    logObj.addSessionResult = function (sessionObj) {
        clientIPC.send(sessionObj);
    }

    /**
     * Add a new comment to the task in audit
     * @param {number} taskSessionID task session ID for identify the task
     * @param {string} comment a new comment for the task
     * @param {string} username username
     */
    logObj.addTaskComment = function (taskSessionID, comment, username) {
        connectToRemoteLogNodes(function () {
            async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
                if (typeof clientIPC.send !== 'function') return callback();
                clientIPC.sendExt({
                    taskSessionID: taskSessionID,
                    taskComment: comment,
                    username: username,
                }, {
                    sendAndReceive: false,
                    dontSaveUnsentMessage: true,
                }, function (err) {
                    if(err) log.error('Error add a new comment to the task: ', err.message, ': ', hostPort);
                    callback();
                });
            }, function () {});
        });
    }

    /**
     * Add a new comment to the action
     * @param {number} sessionID action session ID
     * @param {string} comment a new comment to the action
     * @param {string} username username
     */
    logObj.addActionComment = function (sessionID, comment, username) {
        connectToRemoteLogNodes(function () {
            async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
                if (typeof clientIPC.send !== 'function') return callback();
                clientIPC.sendExt({
                    sessionID: sessionID,
                    actionComment: comment,
                    username: username,
                }, {
                    sendAndReceive: false,
                    dontSaveUnsentMessage: true,
                }, function (err) {
                    if(err) log.error('Error add a new comment to the action: ', err.message, ': ', hostPort);
                    callback();
                });
            }, function () {});
        });
    }

    logObj.getAuditData = getAuditData;

    logObj.disconnect = clientIPC.stop;

    return logObj;
}


/**
 * Send log message to the log server
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level log level
 * @param {Array} args array of log arguments
 * @param {{filename: string, sessionID: number}|NodeModule} parentModule parent node module for create log label and log file name
 * @param {number} sessionID sessionID
 * @param {string} label label
 * @param {Object|undefined} [options] log options
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} options.level log level when used log.options() function
 * @param {Array<string>} options.filenames log file names when used log.options() function
 * @return {Boolean} true if data was send to the log server and print to the log file. false in other case
 */
function sendToLogServer(level, args, parentModule, sessionID, label, options) {
    var dataToSend = prepareLogMessage(level, args, options, label);
    if(!dataToSend) return false;

    if(sessionID) dataToSend.sessionID = sessionID;
    else {
        for (var mod = parentModule; mod; mod = mod.parent) {
            if (mod.sessionID) {
                dataToSend.sessionID = Number(mod.sessionID);
                break;
            }
        }
    }

    if(dataToSend.level !== 'EXIT' && dataToSend.level !== 'TROW') {
        writeLog(dataToSend);
        if(dataToSend.sessionID && dataToSend.logToAudit) {
            clientIPC.send(dataToSend, function (err) {
                if (err) {
                    dataToSend.additionalLabel = '#';
                    writeLog(dataToSend);
                }
            });
        }
    } else {
        dataToSend.additionalLabel = '#';
        writeLog(dataToSend);

        if(dataToSend.level === 'THROW') {
            if(clientIPC && typeof clientIPC.stop === 'function') {
                clientIPC.stop(function () {
                    process.exit(2);
                })
            } else process.exit(2);
        }
    }

    return true;
}

/**
 * Get log records, users and action or session data from auditDB.
 * @param {Object} req data request
 * @param {'sessions'|'logRecords'|'usersAndActions'} req.auditData - type of the required audit data
 * @param {string} [req.lastRecordID] when getting log, set the lastRecordID[hostPort] = <number>
 * @param {string|number|null} [req.user] userID or username or null
 * @param {string|Array|null} [req.sessionIDs] array with sessionIDs or string with comma separated sessionIDs or null
 * @param {number} [req.from] session filter from date
 * @param {number} [req.to] session filter to date
 * @param {string} [req.userIDs] session filter comma separated user IDs
 * @param {string} [req.actionIDs] session filter comma separated action IDs
 * @param {string} [req.description] session filter description
 * @param {string} [req.taskIDs] comma separated taskID filter
 * @param {string} [req.message] session filter message
 * @param {string} [req.objectIDs] comma separated object IDs
 * @param {function(Error)|function(null, Array|{userIDs: Array, actionIDs: Array})} callback
 * callback(err, records), where records is a array of records objects or
 * callback(err, {userIDs: Array, actionIDs: Array} for filter in the audit action
 */

function getAuditData (req, callback) {
    if(typeof req.lastRecordID === 'string') {
        try {
            var lastRecordIDs = JSON.parse(req.lastRecordID);
        } catch (e) {
            log.error('Can\'t get log records: error while parse lastRecordIDs (', req.lastRecordID,
                '): ', e.message);
            return callback();
        }
    } else lastRecordIDs = req.lastRecordID || 0;

    if(typeof req.sessionIDs === 'string') {
        var sessionIDs = req.sessionIDs.split(',').map(sessionID => Number(sessionID));
    } else sessionIDs = req.sessionIDs || null;

    var user = req.user;

    connectToRemoteLogNodes(function () {
        var logRecordRows = {};
        async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
            if (typeof clientIPC.sendExt !== 'function') return callback();
            clientIPC.sendExt({
                auditData: req.auditData,
                lastRecordID: lastRecordIDs[hostPort] || 0,
                user: user,
                sessionIDs: sessionIDs,
                from: req.from,
                to: req.to,
                userIDs: req.userIDs,
                actionIDs: req.actionIDs,
                description: req.description,
                taskIDs: req.taskIDs,
                message: req.message,
                objectIDs: req.objectIDs,
            }, {
                sendAndReceive: true,
                dontSaveUnsentMessage: true,
            }, function (err, rows) {
                logRecordRows[hostPort] = rows;

                callback(err);
            });
        }, function (err) {
            log.debug('Return data from audit: ',
                JSON.stringify(logRecordRows, null, 4).substring(0, 1000), '...');

            return callback(err, logRecordRows);
        });
    });
}


function connectToRemoteLogNodes(callback) {
    if(allClientIPC) return callback();

    callbacksWhileConnecting.push(callback);
    // connection in progress
    if(callbacksWhileConnecting.length > 1) return;

    connectToRemoteNodes('audit', cfg.id, function (err, _allClientIPC) {
        if (!_allClientIPC) {
            log.warn('No remote nodes specified for audit');
            _allClientIPC = new Map();
        }
        _allClientIPC.set(cfg.serverAddress + ':' + cfg.serverPort, clientIPC);

        allClientIPC = _allClientIPC;
        callbacksWhileConnecting.forEach(callback => callback());
        callbacksWhileConnecting.length = 0;
        log.info('Connected to ', (allClientIPC.size - 1), ' remote log nodes for audit');
    });
}
