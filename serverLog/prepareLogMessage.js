/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const path = require("path");
const createMessage = require('./createMessage');
const createConfig = require('./createConfig');
const createLabel = require('./createLabel');

module.exports = prepareLogMessage;

const levelOrder = {D: 0, I: 1, W: 2, E: 3, EXIT: 4, THROW: 5};

/**
 * Prepare log message for write to log file or send to log server
 *
 * @param {"D"|"I"|"W"|"E"|"EXIT"|"THROW"} level log level
 * @param {Array} args array of log arguments
 * @param {NodeModule} parentModule parent node module
 * @returns {undefined|{level: ("D"|"I"|"W"|"E"|"EXIT"|"THROW"), cfg: (any), label: (string|NodeModule|string), timestamp: number}}
 */
function prepareLogMessage(level, args, parentModule) {
    if(!args.length) return;

    var label = createLabel(parentModule);

    var cfg = createConfig(label);
    if (levelOrder[level] < levelOrder[cfg.logLevel]) return;

    if(!cfg.auditLogLevel) cfg.auditLogLevel = 'I';
    if(levelOrder[level] < levelOrder[cfg.auditLogLevel]) cfg.logToAudit = false;

    var date = new Date();

    var dataToSend = {
        level: level,
        label: label,
        timestamp: date.getTime(),
        cfg: cfg,
    }

    if(level === 'D' &&
        args[args.length - 1] &&
        typeof args[args.length - 1].expr === 'string' &&
        typeof cfg.vars === 'object') {

        dataToSend.condition = args.pop();
    }

    dataToSend.messageBody = createMessage.createBody(args, level, Number(cfg.printObjectWithDepth) || 10);

    return dataToSend;
}
