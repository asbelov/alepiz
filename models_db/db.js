/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');

if(confSqlite.get('directAccessToDBFile') || confSqlite.get('disableServer')) {
    module.exports = require('./dbWrapper');
    log.info('Used direct reading and writing to DB file from ', path.basename(module.parent.filename));
} else {
    log.info('Used dbServer for reading and writing to DB from ', path.basename(module.parent.filename));
    module.exports = require('../serverDB/dbClient');
}
