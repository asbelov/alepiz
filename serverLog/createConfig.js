/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');

var configurations = new Map();

/**
 * Create a log configuration for specific log label from log.json file
 * @param {string} label log label (path to the js file, where was called the log function)
 * @return {{printObjectWithDepth: number, auditLogLevel: "D"|"I"|"W"|"E"|"EXIT"|"THROW"}} log configuration
 */
module.exports = function(label) {
    var confObj = configurations.get(label);
    // update configuration every 3 minutes
    if(confObj && Date.now() - confObj.timestamp < 180000) return confObj.cfg;

    var commonCfg = confLog.get();
    if(!label) return commonCfg;

    var labelParts = label.split(':');

    for(var i = 0, cfg = commonCfg; i < labelParts.length; i++) {
        if(cfg[labelParts[i]]) cfg = cfg[labelParts[i]];
        else break;
    }

    for (var key in commonCfg) {
        if(typeof commonCfg[key] !== 'object' && cfg[key] === undefined) {
            cfg[key] = commonCfg[key];
        }
    }

    configurations.set(label, {
        timestamp: Date.now(),
        cfg: cfg,
    })

    return cfg;
}