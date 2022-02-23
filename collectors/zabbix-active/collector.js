
const collector = require('../zabbix-active/lib/zabbixAgentActive');

collector.init(10051);

module.exports = collector;

/*
For test restart after exception in collector

const log = require('../../lib/log')(module);
setTimeout(function () {
    log.exit('Throw zabbix-agent-active-add for restart check!!!');
    throw(new Error('Throw zabbix-agent-active-add for restart check'))
}, 180000);
 */