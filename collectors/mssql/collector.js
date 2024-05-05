/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const mssql = require("msnodesqlv8");
const log = require('../../lib/log')(module);

var collector = {};
module.exports = collector;

/**
 * Run SQL query on MSSQL server
 * @param {Object} param collector parameters
 * @param {string} param.driver MSSQL driver (run ODBC Data Source (64-bit), tab "Drivers"). Default "SQL Server"
 * @param {string} param.server MSSQL server host or IP. Default 127.0.0.1
 * @param {string} param.port MSSQL server TCP port. Default 1433
 * @param {string} param.trusted Use Windows integrated (trusted) authentication. Default "yes"
 * @param {string} param.userName User name (for SQL Server authentication). Default "sa"
 * @param {string} param.password Password (SQL Server authentication)
 * @param {string} param.database Database to connect. Default "master"
 * @param {string} param.connectionTimeoutSec Connection timeout (sec). Default 2
 * @param {string} param.queryTimeoutSec Query timeout (sec). Default 2
 * @param {string} param.query MSSQL Query (check connection when empty)
 * @param {function(Error)|function()|function(null, 1)|function(null, string)|function(null, Array)} callback
 */
collector.get = function(param, callback) {

    for (var key in param) {
        if (!param.hasOwnProperty(key)) continue;
        if (typeof param[key] === 'string' && param[key].indexOf(';') !== -1 && key !== 'query') {
            return callback(new Error('Parameter ' + key + ' contain incorrect symbol ";"' + JSON.stringify(param)));
        }
    }

    var config = [],
        password = param.password;
    param.password = '*****';

    /*
    Ctrl+Q, type ODBC, Run ODBC Date Sources (64-bit). Select "Drivers" tab, choose one of drives for MSSQL. f.e.
    Driver={SQL Server Native Client 11.0}
    Driver={SQL Server Native Client 10.0}
    Driver={ODBC Driver 13for SQL Server}
    Driver={SQL Server}
     */
    if (param.driver) config.push('Driver={' + param.driver.replace(/^{(.+?)}$/, '$1') + '}');
    else config.push('Driver={SQL Server}');

    var port = Number(param.port);
    if (param.port && (port !== parseInt(String(param.port), 10) || port < 1 || port > 65535)) {
        log.error('Incorrect TCP port: ', port, ': ', param);
        return callback();
    }

    if (!param.server) {
        log.error('MSSQL server not specified: ', param.server, ': ', param);
        return callback();
    } else config.push('Server=' + param.server + (param.port ? ',' + String(param.port) : ''));

    if (param.userName) {
        config.push('Uid=' + param.userName);
        if (password) config.push('Pwd=' + password);
    }

    if (param.database) config.push('Database={' + param.database.replace(/^{(.+?)}$/, '$1') + '}');
    if (param.trusted) config.push('Trusted_Connection=' + (param.trusted ? 'yes' : 'no'));

    var connectionTimeout = param.connectionTimeoutSec || 2;
    var queryTimeout = param.queryTimeoutSec || 2;

    if (connectionTimeout !== parseInt(String(connectionTimeout), 10) || connectionTimeout < 1) connectionTimeout = 2;
    if (queryTimeout !== parseInt(String(queryTimeout), 10) || queryTimeout < 1) queryTimeout = 2;

    var connectionString = config.join('; ');
    mssql.open({
        conn_str: connectionString,
        conn_timeout: connectionTimeout, // specified in seconds.
    }, function(err, con) {

        if (err) {
            var ret = param.query ? JSON.stringify({ unableToConnect: err.message }) : 0;
            con && typeof con.close === 'function' ? con.close(() => callback(null, ret)) : callback(null, ret);
            return;
        }
        //log.debug('Connected to ', param.server, 'using ', param);
        if (!param.query) return con.close(() => callback(null, 1));
        var result = [];
        var q = con.query({
            query_str: param.query,
            query_timeout: queryTimeout, // specified in seconds.
        }, function(err, rows) {
            if (err) return con.close(() => callback(new Error('Error in query "' + param.query + '": ' + err.message)));

            if (rows.length > 0) result.push(rows);
        });

        q.on('error', function(err) {
            log.error('Query error: ', err.message, '; ', param);
        });

        q.on('info', function(err) {
            log.info('Query info: ', err.message, '; ', param);
        });

        q.on('done', function() {
            con.close(() => {
                if (result.length === 1) return callback(null, result[0]);
                callback(null, result);
            });
        });
    });
};