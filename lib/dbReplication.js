/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var maxMessageID = 0xffffffff; // messageID must be >= 0 and <= 4294967295

module.exports = function (initDB, id, callback) {
    var mainCfg = conf.get('replication:client');
    var cfg = mainCfg[id];
    if(!cfg || mainCfg.disable || cfg.disable) {
        log.info('Replication for ', id, ' is disabled or not configured');
        return callback(null, initDB);
    }

    var messageID,
        messageNum,
        firstMessageID = 1, // must be always 1. or change order messages algorithm in replicationServer.js
        stmts = new Map(),
        callbackAlreadyRunning = false,
        messageQueue = [],
        replicationMessagesCnt = 0;

    cfg.id = 'dbReplication:'+id;
    var clientIPC = new IPC.client(cfg, function(err, message, isConnected) {
        if(err) log.error('[',id,']: ', err);

        if(message) {
            if(message.err) log.error('[',id,']: error from replication server: ', message.err.stack);
            return;
        }

        function STMT(messageID) {
            this.run = function() {
                var args = Array.prototype.slice.call(arguments);
                var callback = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
                var param = args.length ? (args.length === 1 ? args[0] : args): null;

                messageNum = getNewMessageID(messageNum, firstMessageID);
                log.debug('[',id,']: sending prepared run :', param, '; id: ', messageID);
                ++replicationMessagesCnt;
                messageQueue.push({
                    param: param,
                    type: 'run',
                    id: messageID,
                    num: messageNum,
                });

                var stmt = stmts.get(messageID);
                if(callback) stmt.run(param, callback);
                else stmt.run(param);
            };
            this.bind = function() { runStmt('bind', Array.prototype.slice.call(arguments)); };
            this.reset = function() { runStmt('reset', Array.prototype.slice.call(arguments)); };
            this.finalize = function(callback) {
                var stmt = stmts.get(messageID);
                if(stmt) {
                    if(typeof callback === 'function') stmt.finalize(callback);
                    else stmt.finalize();

                    stmts.delete(messageID);
                } else log.error('[',id,']: trying to finalize undefined statement with id: ', messageID);
            };
            this.get = function() { runStmt('get', Array.prototype.slice.call(arguments)); };
            this.all = function() { runStmt('all', Array.prototype.slice.call(arguments)); };
            this.each = function() { runStmt('each', Array.prototype.slice.call(arguments)); };

            function runStmt(func, args) {
                var callback = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
                var param = args.length ? (args.length === 1 ? args[0] : args): null;

                log.debug('[',id,']: executing ', func, ': param: ', param);

                if(param && callback) stmt[func](param, callback);
                else if(param && !callback) stmt[func](param);
                else if(!param && callback) stmt[func](callback);
                else stmt[func]();
            }
        }

        function DB() {

            // copy all properties from initDB to DB
            for(var obj in initDB) {
                if(!initDB.hasOwnProperty(obj)) continue;
                this[obj] = initDB[obj];
            }

            this.sendReplicationData = sendReplicationData;

            this.prepare = function() {
                var args = Array.prototype.slice.call(arguments);
                var callback = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
                var sql = args.shift();
                var param = args.length ? (args.length === 1 ? args[0] : args): null;

                messageID = getNewMessageID(messageID, firstMessageID);
                messageNum = getNewMessageID(messageNum, firstMessageID);
                log.debug('[',id,']: sending prepare: ', sql, '; param: ', param, '; id: ', messageID);
                ++replicationMessagesCnt;
                messageQueue.push({
                    sql: sql,
                    type: 'prepare',
                    param: param,
                    id: messageID,
                    num: messageNum,
                });

                if(param && callback) stmts.set(messageID, initDB.prepare(sql, param, callback));
                else if(!param && callback) stmts.set(messageID, initDB.prepare(sql, callback));
                else if(param && !callback) stmts.set(messageID, initDB.prepare(sql, param));
                else stmts.set(messageID, initDB.prepare(sql));

                return new STMT(messageID)
            };

            this.run = function() {
                var args = Array.prototype.slice.call(arguments);
                var callback = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
                var sql = args.shift();
                var param = args.length ? (args.length === 1 ? args[0] : args): null;

                messageNum = getNewMessageID(messageNum, firstMessageID);
                log.debug('[',id,']: sending run: ', sql, '; param: ', param);
                ++replicationMessagesCnt;
                messageQueue.push({
                    sql: sql,
                    type: 'run',
                    param: param,
                    num: messageNum,
                });

                if(param && callback) initDB.run(sql, param, callback);
                else if(param && !callback) initDB.run(sql, param);
                else if(!param && callback) initDB.run(sql, callback);
                else initDB.run(sql);
            };

            this.exec = function() {
                var args = Array.prototype.slice.call(arguments);

                messageNum = getNewMessageID(messageNum, firstMessageID);
                log.debug('[',id,']: sending exec: ', args[0]);
                ++replicationMessagesCnt;
                messageQueue.push({
                    sql: args[0],
                    type: 'exec',
                    num: messageNum,
                });

                if(args.length === 2) initDB.exec(args[0], args[1]);
                else initDB.exec(args[0]);
            };

            this.serialize = function(callback) { initDB.serialize(callback); };
            this.serialize = function() { initDB.serialize(); };

            this.parallelize = function(callback) { initDB.parallelize(callback); };
            this.parallelize = function() { initDB.parallelize(); };

            this.close = function(callback) { initDB.close(callback); };
            this.close = function() { initDB.close(); };

            this.configure = function(option, value) { initDB.configure(option, value) };

            this.get = function() { runFunc('get', Array.prototype.slice.call(arguments)); };
            this.all = function() { runFunc('all', Array.prototype.slice.call(arguments)); };
            this.each = function() { runFunc('each', Array.prototype.slice.call(arguments)); };

            function runFunc(func, args) {
                var complete = func === 'each' && args.length && typeof args[args.length - 1] !== 'function' ? args.pop() : null;
                var callback = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
                var sql = args.shift();
                var param = args.length ? (args.length === 1 ? args[0] : args) : null;

                log.debug('[',id,']: executing ', func, ': ', sql, '; param: ', param, '; complete: ', complete);

                if(param && callback && !complete) initDB[func](sql, param, callback);
                else if(!param &&  callback && !complete) initDB[func](sql, callback);
                else if(param && !callback && !complete) initDB[func](sql, param);
                else if(!param && !callback && !complete) initDB[func](sql);
                else if( param &&  callback &&  complete) initDB[func](sql, param, callback, complete);
                else if( param && !callback &&  complete) initDB[func](sql, param, complete);
                else if(!param &&  callback &&  complete) initDB[func](sql, callback, complete);
                else if(!param && !callback &&  complete) initDB[func](sql, complete);
            }
        }

        if(isConnected) log.info('[',id,']: successfully connected to replication server');

        if(!callbackAlreadyRunning) {
            callbackAlreadyRunning = true;
            callback(null, new DB());
        }
    });

    function sendReplicationData(callback) {
        if(messageQueue.length) {
            var messageQueueCopy = messageQueue.slice();
            messageQueue = [];
            clientIPC.send(messageQueueCopy, callback);
        } else if(typeof callback === 'function') callback();
    }

    setInterval(sendReplicationData, 2000);

    setInterval(function() {
        log.info('[', id ,']: count of sending messages to replication server: ', replicationMessagesCnt);
        replicationMessagesCnt = 0;
    }, 60000);
};

// create new messageID form process pid * 0x10000 plus previous message ID + 2
function getNewMessageID(messageID, firstMessageID) {
    return (messageID && messageID < maxMessageID-1 ? messageID + 2 : firstMessageID);
}
