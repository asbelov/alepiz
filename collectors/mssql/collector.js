/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const mssql = require("msnodesqlv8");
const log = require('../../lib/log')(module);


var collector = {};
module.exports = collector;
/*
    get data and return it to server

    param - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $counterID: <counterID>,
        $objectID: <objectID>,
        $parentID: <parentObjectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $counterID - counter ID,
    $objectID - object ID
    $parentID - parent objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

collector.get = function(param, callback) {

    for(var key in param) {
        if(!param.hasOwnProperty(key)) continue;
        if(typeof param[key] === 'string' && param[key].indexOf(';') !== -1 && key !== 'query') {
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
    if(param.driver) config.push('Driver={' + param.driver.replace(/^{(.+?)}$/, '$1') + '}');
    else config.push('Driver={SQL Server}');

    param.port = Number(param.port);
    if(param.port && (param.port !== parseInt(String(param.port), 10) || param.port < 1 || param.port > 65535)) {
        log.error('Incorrect TCP port: ', param.port, ': ', param);
        return callback();
    }

    if(!param.server) {
        log.error('MSSQL server not specified: ', param.server, ': ', param);
        return callback();
    } else config.push('Server=' + param.server + (param.port ? ',' + String(param.port) : ''));

    if(param.userName) {
        config.push('Uid=' + param.userName);
        if(password) config.push('Pwd=' + password);
    }

    if(param.database) config.push('Database={' + param.database.replace(/^{(.+?)}$/, '$1') + '}');
    if(param.trusted) config.push('Trusted_Connection=' + (param.trusted ? 'yes' : 'no'));

    var connectionTimeout = param.connectionTimeoutSec || 2;
    var queryTimeout = param.queryTimeoutSec || 2;

    if(connectionTimeout !== parseInt(String(connectionTimeout), 10) || connectionTimeout < 1) connectionTimeout = 2;
    if(queryTimeout !== parseInt(String(queryTimeout), 10) || queryTimeout < 1) queryTimeout = 2;

    var connectionString = config.join('; ');
    mssql.open({
        conn_str: connectionString,
        conn_timeout: connectionTimeout, // specified in seconds.
    }, function (err, con) {

        if(err) {
            var ret = param.query ? JSON.stringify({unableToConnect: err.message}) : 0;
            con && typeof con.close  === 'function' ? con.close(() => callback(null, ret)) : callback(null, ret);
            return;
        }
        //log.debug('Connected to ', param.server, 'using ', param);
        if(!param.query) return con.close(() => callback(null, 1));

        var q = con.query({
            query_str: param.query,
            query_timeout: queryTimeout, // specified in seconds.
        }, function (err, rows) {
            if(err) return con.close(() => callback(new Error('Error in query "' + param.query + '": ' + err.message)));

            con.close(() => callback(null, rows));
        });

        q.on('error', function(err) {
            log.error('Query error: ', err.message, '; ', param);
        });

        q.on('info', function(err) {
            log.info('Query info: ', err.message, '; ', param);
        });
    });
};
