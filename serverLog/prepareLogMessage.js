/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const createMessage = require('./createMessage');
const createConfig = require('./createConfig');
const {threadId} = require('worker_threads');

module.exports = prepareLogMessage;

const levelOrder = {D: 0, I: 1, W: 2, E: 3, EXIT: 4, THROW: 5};
// TID_PID = ":<TID>:<PID>" or ":<PID>"
const TID_PID = (threadId ? ':' + threadId + ':' : ':') + process.pid;


/**
 * Prepare log message for write to log file or send to log server
 *
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level log level
 * @param {Array} args array of log arguments
 * @param {object|undefined} [options] log options
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} options.level log level when used log.options() function
 * @param {Array<string>} options.filenames log file names when used log.options() function
 * @param {string} label label
 * @returns {undefined|{
 *      level: ("D"|"I"|"W"|"E"|"EXIT"|"THROW"),
 *      label: string,
 *      timestamp: number,
 *      logToAudit: Boolean,
 *      cfg: Object,
 *      filenames: Array,
 *      TID_PID: string,
 *      messageBody: string,
 * }}
 */
function prepareLogMessage(level, args, options, label) {
    if(!args.length) return;

    if(options && options.level) level = options.level;

    var cfg = createConfig(label);
    if (levelOrder[level] < levelOrder[cfg.logLevel]) return;

    if(level === 'D' &&
        args[args.length - 1] &&
        typeof args[args.length - 1].func === 'function' &&
        typeof cfg.vars === 'object') {

        var condition = args.pop();
        if(!calcDebugCondition(condition, cfg.vars)) return;
    }

    var message =
        createMessage.createBody(args, level, cfg);

    return {
        level: level,
        label: label,
        timestamp: Date.now(),
        logToAudit: cfg.logToAudit && levelOrder[level] >= levelOrder[cfg.auditLogLevel || 'I'],
        cfg: cfg,
        filenames: options && options.filenames,
        TID_PID: TID_PID,
        messageBody: message,
    };
}

/**
 * Calculate the condition that debugging information needs to be printed when using the log.debug function
 * The last parameter of the log.debug() can be a condition for debugging.
 * If the result of calculation the debugging condition is true, then debugging information
 * will be printed in the log file.
 *
 * @param {Object|undefined} condition condition for write debug information
 * @param {function(Object)} condition.func if function return true, print debug information.
 *  Function parameters is an object with variables f.e.
 *  {"EXPECTED_ACTION_ID": <expectedActionID>, "ACTION_ID": <requiredActionID>}
 * @param {Object} condition.vars variables, f.e. {VAR1: <value1>, VAR2: <value2>}. Other variables from example
 * (VAR_FROM_CONF1, VAR_FROM_CONF2) mast be specified in the log configuration file conf/log.json
 * @param {object} cfgVars condition variables from log.json
 * @return {Boolean} true, if condition is met
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
function calcDebugCondition(condition, cfgVars) {
    if(!condition || typeof condition.func !== 'function') return false;

    // always print the debug info if variables were not set in log.json
    if(typeof cfgVars !== 'object') return true;

    var vars = {};
    if(typeof condition.vars === 'object') {
        for (let variableName in condition.vars) {
            vars[variableName] = condition.vars[variableName];
        }
    }
    for(let variableName in cfgVars) {
        vars[variableName] = cfgVars[variableName];
    }

    return condition.func(vars);
}
