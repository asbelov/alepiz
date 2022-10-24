/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');

var clientIPC, connectInProgress = false, cache = new Set(), dbServerProcess;

var dbClient = {
    maxVariableNumber: require('../models_db/dbWrapper').maxVariableNumber,
};
module.exports = dbClient;

dbClient.connect = function (callback) {
    var cfg = confSqlite.get(); // configuration for each module

    cfg.id = 'dbClient';
    new IPC.client(cfg, function (err, msg, _clientIPC) {
        if (err) log.error(err.message);
        else if (_clientIPC && typeof callback === 'function') {
            log.info('Connected to dbServer');
            clientIPC = _clientIPC;
            callback();
            callback = null; // prevent running callback on reconnect
        }
    });
};

function dbDo(func, args, stmtID, prepareCallback) {
    if(!clientIPC) {
        cache.add({
            func: func,
            args: args,
            stmtID: stmtID,
            prepareCallback: prepareCallback
        });
        if(!connectInProgress) {
            connectInProgress = true;
            dbClient.connect(function () {
                cache.forEach(obj => dbDo(obj.func, obj.args, obj.stmtID, obj.prepareCallback));
                cache.clear();
            });
        }
        return;
    }

    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

    var dataToSend = {
        func: func,
        args: args,
        stmtID: stmtID,
    };

    if(func !== 'prepare') {
//if(stmtID) log.info('Send stmt: ', dataToSend)
        callback ? clientIPC.sendAndReceive(dataToSend, callback) : clientIPC.send(dataToSend);
    } else {
//log.info('1Prepare stmt ', dataToSend);
        clientIPC.sendAndReceive(dataToSend, function(err, _stmtID) {
//log.info('2Prepare stmt: ', _stmtID, '; ', dataToSend);
            prepareCallback(_stmtID);
            if(callback) callback(err);
        });
    }
}

dbClient.serialize = function (callback) { callback(); }
dbClient.close = function (callback) { callback(); }

dbClient.all = function () {
    dbDo('all', Array.prototype.slice.call(arguments));
}

dbClient.get = function () {
    dbDo('get', Array.prototype.slice.call(arguments));
}

dbClient.run = function () {
    dbDo('run', Array.prototype.slice.call(arguments));
}

dbClient.exec = function () {
    dbDo('exec', Array.prototype.slice.call(arguments));
}

dbClient.prepare = function () {
    return new STMT(Array.prototype.slice.call(arguments));
}


function STMT(prepareArgs) {
    var stmtID = null;

    dbDo('prepare', prepareArgs, undefined, function (_stmtID) {
        stmtID = _stmtID;
    });

    this.run = function () {
        dbDo('run', Array.prototype.slice.call(arguments), stmtID);
    }

    this.get = function () {
        dbDo('get', Array.prototype.slice.call(arguments), stmtID);
    }

    this.all = function () {
        dbDo('all', Array.prototype.slice.call(arguments), stmtID);
    }

    this.finalize = function () {
        dbDo('finalize', Array.prototype.slice.call(arguments), stmtID);
    }
}