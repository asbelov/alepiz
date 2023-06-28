/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const db = require('../db');
const setShift = require('../../lib/utils/setShift');

var transaction = {};
module.exports = transaction;

var delayedCallbacks = new Set(),
    transactionInProgress = false,
    truncateInProgress = 0;


/**
 * Begin transaction.
 * Don't use async operation inside transaction for possible rollback transaction
 * f.e. don't use async.each() or async.parallel(). try to use async.eachSeries() or async.series() instead
 * @param {function(Error)|function()} callback callback(err|undefined) err is description why can't begin transaction
 */
transaction.begin = function(callback) {
    if(transactionInProgress) {
        // you will get many warnings on discovery processes if uncomment this
        log.debug('Add new transaction to queue, length of queue: ', delayedCallbacks.size + 1);
        delayedCallbacks.add(callback);
        return;
    }

    transactionInProgress = true;

    //log.debug('Begin transaction. No ', (new Error).stack);
    db.exec('BEGIN', callback);
};

/**
 * Finish transaction
 * @param {function(Error)|function()} callback callback(err|undefined) err is description why can't finish transaction
 */
transaction.end = function(callback) {
    log.debug('Commit transaction. No ', (new Error).stack);
    db.exec('COMMIT', function(err) {
        if(err) log.warn('Error committing transaction. Stack: ', err.stack);
        runDelayedTransaction(err, callback);
    });
};

/**
 * Rollback transaction on error
 * @param {Error} err error with description, why need to rollback transaction
 * @param {function(Error)} callback callback(err) started after rollback transaction
 */
transaction.rollback = function(err, callback){
    log.debug('Rollback transaction. Stack: ', err.stack || err);
    db.exec('ROLLBACK', function(errRollBack) {
        if(errRollBack) log.error('Error while rollback transaction: ', errRollBack.message);
        runDelayedTransaction(err, callback);
    });
};

/**
 * Run delayed transaction after current transaction has been finished
 * @param {Error|undefined} err error from the parent function
 * @param  {function(Error)} callback callback(err)
 */
function runDelayedTransaction(err, callback) {
    if(!delayedCallbacks.size) {
        transactionInProgress = false;
        var now = Date.now();
        if(!truncateInProgress && now - truncateInProgress > 900000) {
            truncateInProgress = now;
            db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function (err) {
                if (err) log.warn('Can\'t truncate WAL journal file: ', err.message);
                truncateInProgress = 0;
            });
        }
        callback(err);
        return;
    }

    var delayedCallback = setShift(delayedCallbacks);
    transactionInProgress = false;
    // trying to fix bug with RangeError: Maximum call stack size exceeded
    // transaction.begin(delayedCallback);
    var t = setTimeout(transaction.begin, 0, delayedCallback);
    t.unref();
    callback(err);
}