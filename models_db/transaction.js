/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var db = require('../lib/db');
var log = require('../lib/log')(module);

var transaction = {};
module.exports = transaction;

var delayedCallbacks = [],
    transactionInProgress = false;


// Don't use asynс operation inside transaction for possible rollback transaction
// f.e. don't use async.each() or async.parallel(). try to use async.eachSeries() or async.series() instead
transaction.begin = function(callback) {
    if(transactionInProgress) {
        // you will get many warnings on discovery processes if uncomment this
        log.debug('Add new transaction to queue, length of queue: ', delayedCallbacks.length + 1);
        delayedCallbacks.push(callback);
        return;
    }

    transactionInProgress = true;

    log.debug('Begin transaction. No ', (new Error).stack);
    db.serialize(function() {
        db.exec('BEGIN', callback);
    });
};

transaction.end = function(callback) {
    log.debug('Commit transaction. No ', (new Error).stack);
    db.exec('COMMIT', function(err) {
        runDelayedTransaction(function() {
            callback(err);
        });
    });
};

transaction.rollback = function(err, callback){
    log.warn('Rollback transaction. Stack: ', err.stack);
    db.exec('ROLLBACK', function(errRollBack) {
        if(errRollBack) log.error('Error while rollback transaction: ', errRollBack.message);
        runDelayedTransaction(function() {
            callback(err);
        });
    });
};

function runDelayedTransaction(callback) {
    if(!delayedCallbacks.length) {
        transactionInProgress = false;
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {
            if (err) log.error('Can\'t truncate WAL journal file: ', err.message);
            callback();
        });
        return;
    }

    var delayedCallback = delayedCallbacks.shift();
    transactionInProgress = false;
    transaction.begin(delayedCallback);
    callback();
}