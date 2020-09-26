/*
 * Copyright © 2019. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var collector = require('../zabbix-active/collector');

collector.init(10056);

module.exports = collector;