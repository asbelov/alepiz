/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const collector = require('../zabbix-active/lib/zabbixAgentActive');

collector.init(10056);

module.exports = collector;