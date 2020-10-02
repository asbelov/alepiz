/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var collector = require('../zabbix-active/collector');

collector.init(10056);

module.exports = collector;