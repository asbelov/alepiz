/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../../lib/log')(module);
const path = require('path');
const Conf = require('../../../lib/conf');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');

/**
 * Get events DB paths
 * @return {Array<string>} array with event DB paths
 */
module.exports = function() {
    var cfg = confSettings.get();

    if(Array.isArray(cfg.db) && cfg.db.length) {
        var dbPaths = cfg.db.map(function (obj) {
            if (obj && obj.path && obj.file) {
                if(obj.relative) return path.join(__dirname, '..', '..', '..', obj.path, obj.file);
                else return path.join(obj.path, obj.file);
            } else log.error('Can\'t create DB path from ', cfg.db, ': ', obj);
        });
    } else if (cfg.dbPath && cfg.dbFile) {
        dbPaths = [path.join(__dirname, '..', '..', '..', cfg.dbPath, cfg.dbFile)];
    }

    return dbPaths;
}