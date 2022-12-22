/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const IPC = require('../lib/IPC');
const path = require("path");
const calc = require('../lib/calc');
const writeLog = require('./writeLog');
const createMessage = require('./createMessage');
const createConfig = require('./createConfig');

const Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');

var clientIPC;
var topDirName = path.join(__dirname, '..');
var levelOrder = {S:0, D:1, I:2, W:3, E:4, EXIT:5};

module.exports = function (parentModule) {

    var log = {};
    log.silly = function () {
        prepareLogMessage('S', Array.prototype.slice.call(arguments), parentModule)
    };

    log.debug = function () {
        prepareLogMessage('D', Array.prototype.slice.call(arguments), parentModule)
    };

    log.info = function () {
        prepareLogMessage('I', Array.prototype.slice.call(arguments), parentModule)
    };

    log.warn = function () {
        prepareLogMessage('W', Array.prototype.slice.call(arguments), parentModule)
    };

    log.error = function () {
        prepareLogMessage('E', Array.prototype.slice.call(arguments), parentModule)
    };

    log.exit = function () {
        prepareLogMessage('EXIT', Array.prototype.slice.call(arguments), parentModule)
    };

    log.throw = function () {
        prepareLogMessage('THROW', Array.prototype.slice.call(arguments), parentModule)
    };

    log.raw = prepareLogMessage;

    log.options = function () {
        var args = Array.prototype.slice.call(arguments);
        var options = args.pop();
        prepareLogMessage('I', args, parentModule, options);
    };

   if (!clientIPC) {
        clientIPC = new IPC.client(confLog.get(), function (err) {
            if (err) prepareLogMessage('E', [err.message], module);
        });
    }

    log.disconnect = clientIPC.stop;

   return log;
}

function prepareLogMessage(level, args, module, options) {
    if(!args.length) return;
    if (options && options.level) level = options.level;

    var label = options && options.emptyLabel ? '' :
        ( typeof module.filename === 'string' ?
            module.filename
                .substring((topDirName + path.sep).length, module.filename.lastIndexOf('.')) // remove topDir and extension
                .split(path.sep).join(':') : // replace all '\' or '/' to ':'
            (module || '') );
    var cfg = createConfig(label);
    if (levelOrder[level] < levelOrder[cfg.logLevel]) return;

    if(level === 'D' && typeof args[0] === 'object' &&
        typeof args[0].expr === 'string' && typeof cfg.vars === 'object') {
        /**
         * The first parameter of the log.debug() can be a condition for debugging.
         * If the result of calculation the debugging condition is true, then debugging information
         * will be printed in the log file.
         *
         * @param condition {Object} description of the debugging condition.
         * @param condition.expr {string} condition, f.e. '%:VAR1:% > %:VAR_FROM_CONF1:% || %:VAR2:% == %:VAR_FROM_CONF2:%'
         * @param condition.vars {Object} variables, f.e. {VAR1: <value1>, VAR2: <value2>}. Other variables from example
         * (VAR_FROM_CONF1, VAR_FROM_CONF2) mast be specified in the log configuration file conf/log.json
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
         * ....
         */
        var condition = args.shift();
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
            if(err && !unresolvedVariables.length) {
                sendLogMessage('W', label, cfg, [
                        'The condition for debugging cannot be calculated: ', err.message,
                        '; condition ', condition,
                        '; debug: ', functionDebug,
                    ], module, options);
            }

            if(!unresolvedVariables.length && (result || err)) {
                sendLogMessage(level, label, cfg, args, module, options);
            }
        });
    } else sendLogMessage(level, label, cfg, args, module, options);
}

function sendLogMessage(level, label, cfg, args, module, options) {
    var message = createMessage(args, level, label, Number(cfg.printObjectWithDepth) || 10);

    for (var mod = module, sessionID = ''; mod; mod = mod.parent) {
        if (mod.sessionID) {
            sessionID = mod.sessionID;
            break;
        }
    }

    var dataToSend = {
        level: level,
        label: label,
        message: message,
        options: options,
        sessionID: sessionID,
    }

    if(clientIPC && clientIPC.isConnected() && level !== 'EXIT' && level !== 'TROW') {
        clientIPC.send(dataToSend);
    } else {
        writeLog(dataToSend);

        if(level === 'THROW') {
            if(clientIPC && typeof clientIPC.stop === 'function') {
                clientIPC.stop(function () {
                    process.exit(2);
                })
            } else process.exit(2);
        }
    }
}