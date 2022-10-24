/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const thread = require('../lib/threads');
const db = require('../models_db/dbWrapper');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');

var dbServerThread, stopInProgress;
var stmtID = 1, maxStmtID = 0xffffffff; // maxStmtID must be >= 0 and <= 4294967295
var stmts = new Map();
var stmtsDeleteInterval = confSqlite.get('stmtsDeleteInterval') || 18000000;
var stmtsMaxNum = 10000;
var serverType = thread.workerData[0];
var socket = thread.workerData[1];
var serverTypeAndSocket = serverType + (socket ? ': ' + socket : '');

log.info('Starting dbSubServer ', serverTypeAndSocket ,' thread');

dbServerThread = new thread.child({
    module: 'dbSubServer:' + serverTypeAndSocket,
    onDestroy: stopDBServer,
    onStop: stopDBServer,
    onMessage: processMessage,
});

// clearing unused stmts
setInterval(function () {
    if(stmts.size < stmtsMaxNum) return;
    var deletedStmts = 0, timeToDelete = Date.now() - stmtsDeleteInterval;
    stmts.forEach((stmtObj, myStmtID) => {
        if(stmtObj.timestamp < timeToDelete) {
            stmts.delete(myStmtID);
            ++deletedStmts;
        }
    });

    if(deletedStmts) log.info('Deleted DB statements: ', deletedStmts, '; remain ', stmts.size);
}, stmtsDeleteInterval);

function processMessage(message, callback) {
    if(message.stop) return stopDBServer(callback);

    var args = Array.isArray(message.args) ? message.args : [];

    if(message.func === 'prepare') {
        var myStmtID = getStmtID();
        args.push(function (err) {
            callback(err, myStmtID);
        });
        stmts.set(myStmtID, {
            timestamp: Date.now(),
            stmt: db.prepare.apply(this, args),
        });
//log.info('Create stmt ' + myStmtID + ' for ' + args[0]);
    } else if(message.stmtID) {
        myStmtID = Number(message.stmtID);
        if(!stmts.has(myStmtID)) {
            return callback(new Error('Can\'t find db statement with ID ' + myStmtID + '. Current stmt ID: ' +
                stmtID + '; message: ' + JSON.stringify(message)) + '; all stmt IDs: ' + Array.from(stmts.keys()));
        }

        if(message.func === 'finalize') {
            stmts.delete(myStmtID);
//log.info('Delete stmt ' + myStmtID + '; stmt size ' + stmts.size);
            return callback();
        }
//log.info('Process stmt ' + myStmtID + '; ', message);
        var stmtObj = stmts.get(myStmtID);
        stmtObj.timestamp = Date.now();
        if(typeof stmtObj.stmt[message.func] !== 'function') {
            return callback(new Error('Can\'t find DB function ' + message.func + '. Statement ID ' + myStmtID +
                '. Current stmt: ' + stmtID + '; ' + JSON.stringify(message)) + '; ' + Array.from(stmts.keys()));
        }

        args.push(callback);
        stmtObj.stmt[message.func].apply(this, args);
    } else {
        if(typeof db[message.func] !== 'function') {
            return callback(new Error('Can\'t find DB function ' + message.func + '; ' + JSON.stringify(message)));
        }

        args.push(callback);
        db[message.func].apply(this, args);
    }
}

function getStmtID() {
    stmtID = stmtID >= maxStmtID ? 1 : stmtID + 1;
    return stmtID;
}

function stopDBServer(callback) {
    if (stopInProgress) {
        if(typeof callback === 'function') callback();
        return;
    }

    stopInProgress = true;
    log.warn('Stopping ' + serverTypeAndSocket + '...');
    try {
        db.close();
    } catch (err) {
        log.exit('Cant close DB: ', err.message);
    }
    if(typeof callback === 'function') callback();
}