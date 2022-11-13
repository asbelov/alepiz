/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const IPC = require('../lib/IPC');

module.exports = DB;

function DB (cfg) {
    var clientIPC,
        isConnectionWasRunningBefore = false,
        cacheWithDbCommandsBeforeEstablishedConnection = new Set();

    var dbClient = {
        maxVariableNumber: require('../models_db/dbWrapper').maxVariableNumber,
        connect: connect,
    };

    connect();

    function connect(callback) {
        isConnectionWasRunningBefore = true;

        if (cfg.clientIPC) {
            clientIPC = cfg.clientIPC;
            dbClient.clientIPC = clientIPC;
            if (typeof callback === 'function') callback();
        } else {
            new IPC.client(cfg, function (err, msg, _clientIPC) {
                if (err) log.error(err.message);

                // call callback only after connect for send data from cacheWithDbCommandsBeforeEstablishedConnection
                if (_clientIPC) {
                    log.info('Connected to dbServer');
                    clientIPC = _clientIPC;
                    dbClient.clientIPC = clientIPC;
                    if (typeof callback === 'function') callback();
                }
            });
        }
    }

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

    function dbDo(func, args, stmtID, prepareCallback) {
        if(!clientIPC) {
            cacheWithDbCommandsBeforeEstablishedConnection.add({
                func: func,
                args: args,
                stmtID: stmtID,
                prepareCallback: prepareCallback
            });
            if(!isConnectionWasRunningBefore) {
                connect(function () {
                    cacheWithDbCommandsBeforeEstablishedConnection
                        .forEach(obj => dbDo(obj.func, obj.args, obj.stmtID, obj.prepareCallback));
                    cacheWithDbCommandsBeforeEstablishedConnection.clear();
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

    return dbClient;
}