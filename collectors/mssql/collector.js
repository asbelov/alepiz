/*
* Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-9-18 16:13:42
*/

var Connection = require('tedious').Connection;
var Request = require('tedious').Request;
//var TYPES = require('tedious').TYPES;
var log = require('../../lib/log')(module);

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

    var password = param.password;
    param.password = '*****';

    if(!/^[0-9a-zA-Z-_]+$/.test(param.server) && // for incorrect host name can contain '_', can beginning from digit and not contain domain name
        !/^(([a-zA-Z]|[a-zA-Z][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z]|[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9])$/.test(param.server) &&
        !/^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(param.server) &&
        !/^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/.test(param.server)
    ) {
        log.error('Incorrect host MSSQL server name or IP address: ', param.server, ': ', param);
        return callback();
    }

    if(!param.type || ['default', 'ntlm', 'azure-active-directory-password', 'azure-active-directory-access-token',
        'azure-active-directory-msi-vm', 'azure-active-directory-msi-app-service'].indexOf(param.type.toLowerCase()) === -1
    ) {
        log.error('Incorrect type of the authentication method (' , param.type, '), valid types are default, ntlm, azure-active-directory-password, azure-active-directory-access-token, azure-active-directory-msi-vm, or azure-active-directory-msi-app-service');
        return callback();
    }
    param.type = param.type.toLowerCase();

    param.port = Number(param.port);
    if(param.port !== parseInt(String(param.port), 10) || param.port < 1 || param.port > 65535) {
        log.error('Incorrect TCP port: ', param.port, ': ', param);
        return callback();
    }

    if(!param.query) {
        log.error('MSSQL query is not set: ', param.query, ': ', param);
        return callback();
    }

    var config = {
        server: param.server,
        authentication: {
            type: param.type,
            options: {}
        },
        options: {
            port: param.port,
            validateBulkLoadParameters: false,
            rowCollectionOnDone: true,
        }
    };
    
    if(param.userName) config.authentication.options.userName = param.userName;
    if(password) config.authentication.options.password = password;
    if(param.domain) config.authentication.options.domain = param.domain;
    if(param.database) config.options.database = param.database;
    if(param.language) config.options.language = param.language;
    config.options.encrypt = !!Number(param.encrypt);
    
    if(param.options) {
        try {
            var options = JSON.parse(param.options);
        } catch(e) {
            log.error('Can\'t parse addition options ', param.options, ' for connect to MSSQL: ', e.message,
                ': ', param);
            return callback();
        }
        
        for(var key in options) {
            config.options[key] = options[key];
        }
    }

    var connection = new Connection(config);
    if(password) config.authentication.options.password = '*****';


    connection.connect(function(err) {
        if(err) {
            log.error('Can\'t connect to MSSQL ', param.server, ', user: ', param.userName, ', DB: ', param.database ,
                ' : ', err.message, '; config: ', config)
            return callback();
        }
        log.debug('Connected to ', param.server, 'using ', config);

        var request = new Request(param.query, function(err) {
            if(err) {
                log.error('Can\'t execute query "', param.query, '" to DB ', param.database, ' : ', err.message, ': ', config);
                callback();
            }
            connection.close();
        });

        var callbackAlreadyCalled = false;
        request.on('done', function (rowCount, more, rows) {
            parseResult(param, rowCount, more, rows, function(err, result) {
                if(!callbackAlreadyCalled && Array.isArray(result)) {
                    callbackAlreadyCalled = true;
                    callback(null, result);
                }
            });
        });

        request.on('doneInProc', function (rowCount, more, rows) {
            parseResult(param, rowCount, more, rows, function(err, result) {
                if(!callbackAlreadyCalled && Array.isArray(result)) {
                    callbackAlreadyCalled = true;
                    callback(null, result);
                }
            });
        });

        request.on('doneProc', function (rowCount, more, rows) {
            parseResult(param, rowCount, more, rows, function(err, result) {
                if(!callbackAlreadyCalled && Array.isArray(result)) {
                    callbackAlreadyCalled = true;
                    callback(null, result);
                }
            });
        });

        connection.execSql(request);
    });
};

function parseResult(param, rowCount, more, rawRows, callback) {
    //log.debug('Query returned ', rawRows);

    if(!Array.isArray(rawRows)) {
        //log.info('Query ', param.query, 'to DB ', param.database ,' returned nodata: ', rawRows);
        return callback();
    }

    var rows = rawRows.map(function (columns) {
        var row = {};
        columns.forEach(function (column) {
            if(column.metadata && column.metadata.colName) {
                row[column.metadata.colName] = column.value;
            }
        });
        return row;
    });
    callback(null, rows);
}
