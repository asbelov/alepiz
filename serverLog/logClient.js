/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('./simpleLog')(module);
const async = require('async');
const IPC = require('../lib/IPC');
const calc = require('../lib/calc');
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
var cntOfGetLogRecordsFunction = 0;

module.exports = function (parentModule) {

    exitHandler.init(null, parentModule, {});
    cfg.id = 'log:' + createLabel(parentModule);

    if (!clientIPC) {
        clientIPC = new IPC.client(cfg, function (err, msg, _clientIPC) {
            if (err) log.warn('IPC client error: ', err.message);
        });
    }

    var logObj = createLogObject(parentModule, sendToLogServer);

    logObj.raw = sendToLogServer;

    logObj.options = function () {
        var args = Array.prototype.slice.call(arguments);
        var options = args.pop();
        sendToLogServer('I', args, parentModule, options);
    };

    /**
     * Add a new session
     * @param {Object} sessionObj sessionParameters
     * @param {number|string} sessionObj.user userID ar username
     * @param {number} sessionObj.sessionID sessionID
     * @param {string} sessionObj.actionID action directory name
     *   to the auditDB. In the future can be add to audit another session type if necessary
     * @param {number} [sessionObj.startTimestamp] timestamp when action was started
     * @param {number} [sessionObj.stopTimestamp] timestamp when action was stopped
     * @param {string} [sessionObj.description] action description
     * @param {Object} [sessionObj.objects] objects for action
     */
    logObj.addNewSession = function (sessionObj) {
        clientIPC.send(sessionObj);
    }

    /**
     * Get log records or session data from auditDB.
     * @param {string} initLastRecordIDs last record ID or 0
     * @param {string|number|null} user userID or username or null
     * @param {string|Array|null} sessionIDs array with sessionIDs or string with comma separated sessionIDs or null
     * @param {function(Error)|function(null, Array)} callback callback(err, records), where records is a array of
     * records objects
     */
    logObj.getAuditData = getAuditData;

    logObj.disconnect = clientIPC.stop;

    return logObj;
}


/**
 * Send log message to the log server
 *
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level log level
 * @param {Array} args array of log arguments
 * @param {NodeModule} parentModule parent node module
 * @param {object|undefined} [options] log options
 */
function sendToLogServer(level, args, parentModule, options) {
    var dataToSend = prepareLogMessage(level, args, parentModule);
    if(!dataToSend) return;

    calcDebugCondition(dataToSend.condition, dataToSend.cfg, function () {

        for (var mod = module; mod; mod = mod.parent) {
            if (mod.sessionID) {
                dataToSend.sessionID = Number(mod.sessionID);
                break;
            }
        }

        dataToSend.options = options;

        if(clientIPC && clientIPC.isConnected() && dataToSend.level !== 'EXIT' && dataToSend.level !== 'TROW') {
            clientIPC.send(dataToSend);
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
    });
}

/**
 * Calculate the condition that debugging information needs to be printed when using the log.debug function
 * The last parameter of the log.debug() can be a condition for debugging.
 * If the result of calculation the debugging condition is true, then debugging information
 * will be printed in the log file.
 *
 * @param condition {Object} description of the debugging condition.
 * @param condition.expr {string} condition, f.e. '%:VAR1:% > %:VAR_FROM_CONF1:% || %:VAR2:% == %:VAR_FROM_CONF2:%'
 * @param condition.vars {Object} variables, f.e. {VAR1: <value1>, VAR2: <value2>}. Other variables from example
 * (VAR_FROM_CONF1, VAR_FROM_CONF2) mast be specified in the log configuration file conf/log.json
 * @param {object} cfg log configuration
 * @param {function()} callback callback()
 * @example
 * Example of the conf/log.json part with variables VAR_FROM_CONF1 and VAR_FROM_CONF2
 * ....
 * "server": {
 *     "file": "server.log"
 *     "vars": {
 *         "VAR_FROM_CONF1": 1,
 *         "VAR_FROM_CONF2": 2
 *     }
 * },
 */
function calcDebugCondition(condition, cfg, callback) {
    if(!condition) return callback();

    var vars = {};
    if(typeof condition.vars === 'object') {
        for (let variableName in condition.vars) {
            vars[variableName] = condition.vars[variableName];
        }
    }
    for(let variableName in cfg.vars) {
        vars[variableName] = cfg.vars[variableName];
    }

    calc(condition.expr, vars, null,
    function (err, result, functionDebug, unresolvedVariables) {
        if(err && !unresolvedVariables) {
            log.warn('The condition for debugging cannot be calculated: ', err.message,
                '; condition ', condition,
                '; debug: ', functionDebug);
        }

        if(!unresolvedVariables && (result || err)) callback();
    });
}

/**
 * Get log records or session data from auditDB.
 * @param {string} initLastRecordIDs last record ID or 0
 * @param {string|number|null} user userID or username or null
 * @param {string|Array|null} sessionIDs array with sessionIDs or string with comma separated sessionIDs or null
 * @param {function(Error)|function(null, Array)} callback callback(err, records), where records is a array of
 * records objects
 */

function getAuditData (initLastRecordIDs, user, sessionIDs, callback) {
    try {
        var lastRecordIDs = JSON.parse(initLastRecordIDs);
    } catch (e) {
        log.error('Can\'t get log records: error while parse lastRecordIDs (', initLastRecordIDs,
            '): ', e.message);
        return callback();
    }

    if(typeof sessionIDs === 'string') {{
        sessionIDs = sessionIDs.split(',').map(sessionID => Number(sessionID));
    }}

    ++cntOfGetLogRecordsFunction;
    if(cntOfGetLogRecordsFunction >= 300) {
        --cntOfGetLogRecordsFunction;
        return callback(new Error('Maximum count of log retrievers (browsers) occurred: ' + cntOfGetLogRecordsFunction));
    }

    connectToRemoteLogNodes(function () {
        var logRecordRows = {};
        async.eachOf(Object.fromEntries(allClientIPC), function (clientIPC, hostPort, callback) {
            if (typeof clientIPC.sendAndReceive !== 'function') return callback();
            clientIPC.sendExt({
                lastRecordID: lastRecordIDs[hostPort] || 0,
                user: user,
                sessionIDs: sessionIDs,
            }, {
                sendAndReceive: true,
                dontSaveUnsentMessage: true,
            }, function (err, rows) {

                if (Array.isArray(rows) && rows.length) {
                    log.debug('Return audit records for ', hostPort,', user: ', user, ', sessions: ',  sessionIDs,
                        ', lastRecordID: ', lastRecordIDs[hostPort], ' || 0, Error: ', err,
                        '\nlogRecords: \n',
                        (Array.isArray(rows) &&
                            rows.map(row=>(row.message || row.actionID).substring(0, 100)
                                .replace(/\n/gm, ''))
                                .join('...\n'))
                    );

                    var lastID = rows[0].id;
                    var firstID = rows[0].id;
                    rows.forEach(row => {
                        if (row.id > lastID) lastID = row.id
                        if (row.id < firstID) firstID = row.id
                    });
                    rows[0].lastID = lastID;
                    rows[0].firstID = firstID;

                    logRecordRows[hostPort] = rows;
                }

                callback(err);
            });
        }, function (err) {
            log.debug('Return audit records for user: ', user, ', sessions: ',  sessionIDs,
                ', lastRecordIDs: ', lastRecordIDs, ', logRecords for: \n', Object.keys(logRecordRows));
            --cntOfGetLogRecordsFunction;
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
