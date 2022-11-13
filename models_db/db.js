/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

//const log = require('../lib/log')(module);
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');

var cfg = confSqlite.get(); // configuration for each module

if(cfg.directAccessToDBFile || cfg.disableServer) {
    module.exports = require('./dbWrapper');
    //log.info('Used direct reading and writing to DB file from ', path.basename(module.parent.filename));
} else {
    //log.info('Used dbServer for reading and writing to DB from ', path.basename(module.parent.filename));
    const DB = require('../serverDB/dbClient');
    cfg.id = 'dbClient';
    module.exports = new DB(cfg);
}