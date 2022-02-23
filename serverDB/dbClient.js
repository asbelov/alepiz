/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);

var IPC = require('../lib/IPC');
var thread = require('../lib/threads');
var Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');
const path = require("path");

var cfg = confSqlite.get(); // configuration for each module
var clientIPC, connectInProgress = false, cache = [], dbServerProcess;

var dbClient = {
    stop: function(callback) {callback()},
    kill: function () {},
    maxVariableNumber: require('../models_db/dbWrapper').maxVariableNumber,
};
module.exports = dbClient;

dbClient.connect = function (callback) {

    cfg.id = 'dbClient';
    clientIPC = new IPC.client(cfg, function (err, msg, isConnecting) {
        if (err) log.error(err.message);
        else if (isConnecting && typeof callback === 'function') {
            log.info('Connecting to dbServer');
            callback();
            callback = null; // prevent running callback on reconnect
        }
    });
};

// starting dbClient child process and IPC system
dbClient.start = function (_callback) {
    var callback = function(err, isDbServerExit) {
        if(typeof _callback === 'function') return _callback(err, isDbServerExit);
        if(err) log.error(err.message)
    };

    if(cfg.disableServer) {
        log.info('dbClient is disabled in configuration and not started');
        return callback();
    }

    dbServerProcess = new thread.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'dbServer.js'),
        restartAfterErrorTimeout: 0, // was 2000
        killTimeout: 3000,
        module: 'dbClient',
    }, function(err, dbServerProcess) {
        if(err) return callback(new Error('Can\'t initializing dbServer process: ' + err.message));

        dbServerProcess.start(function (err) {
            if(err) return callback(new Error('Can\'t run dbServer process: ' + err.message));

            log.info('dbServer was started: ', cfg);
            callback();
        });
    });

    dbClient.stop = dbServerProcess.stop;
    dbClient.kill = dbServerProcess.kill;
};

function dbDo(func, args, stmtID, prepareCallback) {
    if(!clientIPC) {
        cache.push({
            func: func,
            args: args,
            stmtID: stmtID,
            prepareCallback: prepareCallback
        });
        if(!connectInProgress) {
            connectInProgress = true;
            dbClient.connect(function () {
                cache.forEach((obj => {
                    dbDo(obj.func, obj.args, obj.stmtID, obj.prepareCallback);
                }));
                cache = [];
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
