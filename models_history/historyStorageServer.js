/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
const threads = require('../lib/threads');
const Database = require('better-sqlite3');
const fs = require("fs");
const exitHandler = require("../lib/exitHandler");
const countersDB = require("../models_db/countersDB");
const historyStorage = require('../models_history/historyStorage');
var parameters = require('../models_history/historyParameters');
const setShift = require('../lib/utils/setShift');

// array of minutes for trends. long time (keepTrends time) keeps only trends with time interval 60
// trends less the 60 will keep as history data (keepHistory time)
var trendsTimeIntervals = historyStorage.trendsTimeIntervals;
var transProcessArgID = historyStorage.transProcessArgID;
var getDbPaths = historyStorage.getDbPaths;

var db;
var functions = {};
var trendsData = new Map();
var objectsParameters = new Map();
var transactionInProgress = 0;
var transactionDescriptionInProgress = '';
var transactionsFunctions = new Set();
var callbackOnStop;
var lastTruncate = Date.now();

var slowRecords = {
    timeAvg: 0,
    recordsNumAvg: 0,
    recordsNum: 0,
};

// if(module.parent) {} === if(require.main !== module) {}
if(require.main !== module) {
    const Conf = require('../lib/conf');
    const confHistory = new Conf('config/history.json');
    parameters.init(confHistory.get());

    var isTransactionProcess = false;
    var dbPath = getDbPaths(parameters)[0];
    dbOpen();
    module.exports = functions;
} else {
    isTransactionProcess = threads.workerData && threads.workerData[0];
    dbPath = threads.workerData && threads.workerData[1];

    new threads.child({
        module: 'historyStorage',
        cleanUpCallbacksPeriod: 86400000,
        onMessage: onMessage,
        onStop: onStop,
        onDestroy: function () {
            if(db && typeof db.close === 'function') {
                try {
                    db.close();
                    log.exit('Storage DB closed successfully');
                } catch (err) {
                    log.exit('Error while close storage DB: ' + err.message);
                }
            }
        },
        onDisconnect: function () {  // exit on disconnect from parent (then server will be restarted)
            log.exit('History storage process ' + process.pid + ' was disconnected from server unexpectedly. Exiting');
            onStop(function () {
                log.disconnect(function () { process.exit(2) });
            });
        },
    });
}

function dbOpen() {
    if(!isTransactionProcess && !fs.existsSync(dbPath)) return setTimeout(dbOpen, 30000);

    log.info('Open storage file ', dbPath, ' for ', (isTransactionProcess ? 'transactions' : 'queries'),' operations...');
    try {
        db = new Database(dbPath, {
            readonly: !isTransactionProcess,
            timeout: Number(parameters.dbLockTimeout) || 5000
        });
    } catch (err) {
        return log.warn('Can\'t open DB ', dbPath, ': ', err.message);
    }

    try {
        if(isTransactionProcess) {
            db.pragma('synchronous = "OFF"');
            db.pragma('foreign_keys = "ON"');
            db.pragma('encoding = "UTF-8"');
            db.pragma('journal_mode = "WAL"');
        }
    } catch (err) {
        log.warn('Can\'t set some required pragma modes to ', dbPath, ': ', err.message);
    }
}


// starting after receiving message with parameters from parent
function init(callback) {
    isTransactionProcess = isTransactionProcess && isTransactionProcess === transProcessArgID;
    dbPath = isTransactionProcess ? dbPath : getDbPaths(parameters)[0];

    setInterval(function() {
        if(!slowRecords.timeAvg) return;
        log.warn('Slow queries avg time: ', Math.round(slowRecords.timeAvg / 1000),' sec; avg records number/query: ',
            Math.round(slowRecords.recordsNumAvg), '; all records number: ', slowRecords.recordsNum);
        slowRecords = {
            timeAvg: 0,
            recordsNumAvg: 0,
            recordsNum: 0,
        };
    }, 60000);


    dbOpen();

    if(isTransactionProcess) {
        log.info('Loading object parameters...');
        try {
            var rows = db.prepare('SELECT * FROM objects').all();  // id, type, cachedRecords
        } catch (err) {
            return log.throw('Can\'t get data from objects table from storage DB: ' + err.message);
        }

        rows.forEach(function (row) {
            objectsParameters.set(row.id, row);
        });

        log.info('Loading trends data...');
        try {
            rows = db.prepare('SELECT id, trends FROM objects').all();
        } catch (err) {
            return log.throw('Can\'t initialize replication for storage DB ' + dbPath +
                ': Can\'t load trends data from DB' + err.message);
        }

        rows.forEach(function(row) {
            if(!row.trends) return;
            try {
                var trendObj = JSON.parse(row.trends);
                trendsData.set(row.id, new Map());
                var trendData = trendsData.get(row.id);

                // convert trend time intervals to Number
                for(var key in trendObj) {
                    if(Number(key) === parseInt(String(key), 10)) key = Number(key);
                    trendData.set(key, trendObj[key]);
                }
            } catch (e) {
                log.warn('Can\'t parse trends data for object ', row.id, ': ', e.message, '; data: ', row.trends);
            }
        });
    }

    log.info('Init history storage child ', process.pid, ' for ', dbPath, ' is complete');
    callback();
}

function truncateWal() {
    if(Date.now() - lastTruncate < 30000) return;
    lastTruncate = Date.now();
    fs.stat(dbPath + '-wal', (err, stat) => {
        if (err) {
            if (err.code !== 'ENOENT') log.error('Can\'t stat ', dbPath + '-wal: ', err.message);
        } else if (stat.size > 104857600) { // 100Mb
            log.warn('Size of ', dbPath + '-wal file is a ',
                Math.round(stat.size/1048576), 'Mb. Truncating wal and optimizing DB...');
            try {
                db.pragma('wal_checkpoint(TRUNCATE)');
            } catch (err) {
                log.error('Can\' truncate WAL checkpoint: ', err.message);
            }
            try {
                db.pragma('optimize');
            } catch (err) {
                log.error('Can\' optimize DB: ', err.message);
            }
        }
    });
}

function addSlowRecord(receiveTime, recordsNum) {
    if(slowRecords.timeAvg) {
        slowRecords.timeAvg = (slowRecords.timeAvg + receiveTime) / 2;
        slowRecords.recordsNumAvg = (slowRecords.recordsNumAvg - recordsNum) / 2;
    }
    else {
        slowRecords.timeAvg = receiveTime;
        slowRecords.recordsNumAvg = recordsNum;
    }
    slowRecords.recordsNum += recordsNum;
}

function onMessage(message, callback) {
    if (message && message.restart) {
        log.warn('Receiving message for restart history ', message.restart,' for ', dbPath,'...');
        onStop(function (err) {
            if(message.waitForCallback) callback();

            if(err) log.error('Error when preparing to stop history ', message.restart,' for ', dbPath,': ', err.message);
            else log.warn('History ', message.restart ,' for ', dbPath, ' successfully stopped.');

            log.disconnect(function () {
                exitHandler.exit(12, 10000); // process.exit(12)
            });
        });
        return;
    }

    // init parameters
    if(message && typeof message.parameters === 'object') {
        parameters = message.parameters;
        init(callback);
        return;
    }

    if (!message || !message.funcName || !functions[message.funcName] || !message.arguments)
        return log.error('Incorrect message: ', message);

    var storageFunctionArguments = message.arguments.slice();
    storageFunctionArguments.push(function () {
        var storageFunctionResult = Array.prototype.slice.call(arguments);
        //log.info('Send data back for ', message, ': ', storageFunctionResult);
        //console.log('Send data back for ', message, ': ', storageFunctionResult);

        // callback arguments is [err, data]
        var err = storageFunctionResult[0];
        //return message without callback back
        var result = storageFunctionResult[1];

        callback(err, result);
    });
    functions[message.funcName].apply(this, storageFunctionArguments);
}

function onStop(callback) {
    var timeToWaitForDB = transactionInProgress || isTransactionProcess ? 300 : 15; //sec
    var terminateTimeout = setTimeout(function () {
        log.warn('Cannot close DB ', dbPath, ' in ', timeToWaitForDB,'sec. Terminate...');
        if (typeof callback === 'function') callback();
        callback = null;
    }, timeToWaitForDB * 1000);

    if(!transactionInProgress) {
        transactionDescriptionInProgress = 'Stopping storage';
        callbackOnStop = function(err) {
            if (err) log.error('Error while committing an unexpected transaction: ' + err.message);
            else log.error('Unexpected transaction committed successfully');
        };

        log.warn('Closing the DB for ', (isTransactionProcess ?
            ('transactions process ' + dbPath + '...') : 'queries process...'));

        try {
            db.close();
        } catch (err) {
            log.error('Error while close storage DB for ' + (isTransactionProcess ?
                'transactions process ' + dbPath + ': ' : 'queries process: ') + err.message);
        }

        clearTimeout(terminateTimeout);
        if (typeof callback === 'function') callback();
        callback = null;

    } else {
        var waitingTimeout = setTimeout(function() {
            log.warn('Continue waiting while last transaction is committed for ' + dbPath +
                '... Transaction queue: ', transactionsFunctions.size,
                (transactionInProgress ?
                    ', last transaction started at ' + (new Date(transactionInProgress)).toLocaleString() +
                    '(' + transactionDescriptionInProgress + ')' :
                    ', no transaction in progress'));
        }, 30000);
        log.warn('Continue waiting while last transaction is committed for ' + dbPath +
            '... Transaction queue: ', transactionsFunctions.size,
            (transactionInProgress ?
                ', last transaction started at ' + (new Date(transactionInProgress)).toLocaleString() +
                '(' + transactionDescriptionInProgress + ')':
                ', no transaction in progress'));

        // clear transaction queue
        transactionsFunctions.clear();

        // function will run after transaction.commit
        callbackOnStop = function(err) {
            // prevent to run transaction
            transactionInProgress = Date.now();
            transactionDescriptionInProgress = 'Stopping storage after commit';
            clearTimeout(waitingTimeout);
            if (err) log.error('Error while commit transaction for ' + dbPath + ': ' + err.message);
            else log.warn('Transaction commit successfully for ' + dbPath);

            log.warn('Closing the DB after commit transaction for ' + dbPath + '...');
            try {
                db.close();
                log.warn('Storage DB closed successfully after commit transaction for ' + dbPath);
            } catch (err) {
                log.error('Error while close storage DB after commit transaction for ' + dbPath + ': ' + err.message);
            }

            clearTimeout(terminateTimeout);
            if (typeof callback === 'function') callback();
            callback = null;
        };
    }
}

/*
SELECT * FROM table LIMIT 3 OFFSET 4 will skip first 4 and get next 3 records
[01 02 03 04 5 6 7 8 9] => [5 6 7]
[13 12 11 10 9 8 7 6 5 4 3 2 1] => [9 8 7]

recordsType: [0|1|2]: 0 - number and string, 1 number, 2 - string
 */
functions.getRecordsFromStorageByIdx = function (id, offset, cnt, firstTimestamp, maxRecordsCnt, recordsType, callback) {

    var startTime = Date.now();
    var timeStampCondition = firstTimestamp ? 'AND timestamp < $firstTimestamp ' : '';

    if(recordsType < 2) {
        var tableType = 'numbers';
        if(cnt > parameters.queryMaxResultNumbers) cnt = parameters.queryMaxResultNumbers;
    } else {
        tableType = 'strings';
        if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;
    }

    try {
        var records1 = db.prepare('SELECT data, timestamp FROM ' + tableType + ' WHERE objectID=$id ' +
            timeStampCondition + 'ORDER BY timestamp DESC LIMIT $count OFFSET $offset').all({
            id: id,
            offset: offset,
            count: cnt,
            firstTimestamp: firstTimestamp || undefined
        });
    } catch (err) {
        return callback(err);
    }

    if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
        addSlowRecord(Date.now() - startTime, records1.length);
    }
    /*
    log.debug('Getting records for object id: ' + id + ', from '+ tableType +', position: ' + offset + ', count: ' + cnt + ': ', records1);
     */

    if(recordsType > 0) return callback(null, records1.reverse());

    if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;

    try {
        var records2 = db.prepare('SELECT data, timestamp FROM strings WHERE objectID=$id ' + timeStampCondition +
            'ORDER BY timestamp DESC LIMIT $count OFFSET $offset').all({
            id: id,
            offset: offset,
            count: cnt,
            firstTimestamp: firstTimestamp || undefined
        });
    } catch (err) {
        return callback(err);
    }

    if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
        addSlowRecord(Date.now() - startTime, records2.length);
    }

    if(!records2.length) return callback(null, records1.reverse());

    Array.prototype.push.apply(records1, records2);
    records1.sort(function (a, b) {
        return a.timestamp - b.timestamp; // inc sorting
    });

    /*
    log.debug('Getting records for object id: ' + id + ', from strings, position: ' + offset + ', count: ' + cnt + ': ', records2);
     */
    // remove first unneeded and return not more than required number of records
    callback(null ,records1.slice(Math.max(records1.length - cnt, 0)));
};

/*
return requested records from a storage

id: object ID

recordsType: [0|1|2]: 0 - number and string, 1 number, 2 - string

callback(err, records), where
records: [{data:.., timestamp:..}, ....], sorted by ascending timestamp
*/
functions.getRecordsFromStorageByTime = function (id, timeFrom, timeTo, maxRecordsCnt, recordsType, callback) {

    var startTime = Date.now();
    if(recordsType < 2) {
        if(maxRecordsCnt > parameters.queryMaxResultNumbers) maxRecordsCnt = parameters.queryMaxResultNumbers;
        var cnt = parameters.queryMaxResultNumbers;
    } else cnt = parameters.queryMaxResultStrings;

    getTableName(id, timeFrom, timeTo, maxRecordsCnt, recordsType, function(tableType) {
        /*
        Note that the BETWEEN operator is inclusive. It returns true when the test_expression is less than or equal
        to high_expression and greater than or equal to the value of low_expression:
        test_expression >= low_expression AND test_expression <= high_expression

        Use DESC for show last records if number of the records are more than cnt
        */
        try {
            var records1 = db.prepare('SELECT data, timestamp FROM ' + tableType + ' WHERE objectID=$id AND ' +
                'timestamp BETWEEN $timeFrom AND $timeTo ORDER BY timestamp DESC LIMIT $queryMaxResult').all({
                id: id,
                timeFrom: timeFrom,
                timeTo: timeTo,
                queryMaxResult: cnt,
            });
        } catch (err) {
            return callback(err);
        }
        if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
            addSlowRecord(Date.now() - startTime, records1.length);
        }
        /*
        log.debug('Getting records from ' + tableType + ' for object id: ', id, ', from: ',
            (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
            ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records1);
        */
        if(recordsType > 0) {
            if(records1.length) {
                records1 = records1.reverse();
                records1[0].isDataFromTrends = tableType !== 'numbers';
            }
            return callback(null, records1);
        }

        if(cnt > parameters.queryMaxResultStrings) cnt = parameters.queryMaxResultStrings;

        try {
            var records2 = db.prepare('SELECT data, timestamp FROM strings WHERE objectID=$id AND ' +
                'timestamp BETWEEN $timeFrom AND $timeTo ORDER BY timestamp DESC LIMIT $queryMaxResult').all({
                id: id,
                timeFrom: timeFrom,
                timeTo: timeTo,
                queryMaxResult: cnt,
            });
        } catch (err) {
            return callback(err);
        }

        if (Date.now() - startTime > parameters.slowQueueSec * 1000) {
            addSlowRecord(Date.now() - startTime, records2.length);
        }

        if(!records2.length) {
            if(records1.length) {
                records1 = records1.reverse();
                records1[0].isDataFromTrends = tableType !== 'numbers';
            }
            return callback(null, records1);
        }

        Array.prototype.push.apply(records1, records2);
        records1.sort(function (a, b) {
            return a.timestamp - b.timestamp; // inc sorting
        });

        /*
        log.debug('Getting records from strings for object id: ', id, ', from: ',
            (new Date(timeFrom)).toLocaleString(), '(', timeFrom, ')',
            ' to: ', (new Date(timeTo)).toLocaleString(), '(', timeTo, '): ', records2);
        */
        records1[0].isDataFromTrends = tableType !== 'numbers';
        return callback(null, records1);
    });
};

function getTableName(id, timeFrom, timeTo, maxRecordsCnt, recordsType, callback) {
    if (!maxRecordsCnt || maxRecordsCnt === 1) return callback('numbers');
    //0 - number and string, 1 number, 2 - string
    if (recordsType >= 2) return callback('strings');

    var requiredTimeInterval = ((timeTo - timeFrom) / (maxRecordsCnt - 1)) / 60000;

    if(requiredTimeInterval < trendsTimeIntervals[0] / 2) return callback('numbers');
    var idx = trendsTimeIntervals.length - 1;
    if(requiredTimeInterval < trendsTimeIntervals[0]) idx = 0;
    else {
        for (var i = 0; i < trendsTimeIntervals.length - 1; i++) {
            if (requiredTimeInterval - trendsTimeIntervals[i] <= trendsTimeIntervals[i+1] - requiredTimeInterval) {
                idx = i;
                break;
            }
        }
    }

    var debugInfo = [];

    // trendsTables = [2, 10, 30, 60]; idx = 2; trendsTimeIntervals.slice(0,idx+1).reverse() = [30, 10, 2];
    var trendTimeIntervals = trendsTimeIntervals.slice(0, idx + 1).reverse();
    for(i = 0; i < trendTimeIntervals.length; i++) {
        var trendsTableName = 'trends' + trendTimeIntervals[i] + 'min';
        try {
            var count = db.prepare('SELECT count(*) AS num FROM ' + trendsTableName +
                ' WHERE objectID=$id AND timestamp BETWEEN $timeFrom AND $timeTo').all({
                id: id,
                timeFrom: timeFrom,
                timeTo: timeTo,
            });
            if (!count[0] || count[0].num * 0.8 < maxRecordsCnt) {
                debugInfo.push(trendsTableName + ': ' + count[0].num);
            } else break;
        } catch (err) {
            log.error('Can\'t get number of rows for object ', id,
                ', time interval: ',
                (new Date(timeFrom)).toLocaleString(), '-', (new Date(timeTo)).toLocaleString(),
                ' from table "', trendsTableName, '": ', err.message);
        }
        trendsTableName = null;
    }

    if(trendsTableName) return callback(trendsTableName);

    log.debug('Using numbers table for get ', maxRecordsCnt,' records for object ', id,
        ', time interval: ', (new Date(timeFrom)).toLocaleString(), ' - ', (new Date(timeTo)).toLocaleString(),
        '; required time interval: ', Math.round(requiredTimeInterval), 'min; ',
        ' records in trends: ', debugInfo.join('; '));
    return callback('numbers');
}

functions.getLastRecordTimestampForValue = function (id, value, callback) {
    if (!isNaN(parseFloat(value)) && isFinite(value)) var table = 'numbers';
    else table = 'strings';

    var startTime = Date.now();

    try {
        var row = db.prepare('SELECT timestamp FROM ' + table +
            ' WHERE objectID=$id AND data=$value ORDER BY timestamp DESC LIMIT 1').get({
            id: id,
            value: value,
        });
    } catch (err) {
        return callback(new Error('Can\'t get last timestamp for object id: ' + id + ', value: ' + value +
            ' from history table ' + table + ': ' + err.message));
    }
    if (Date.now() - startTime > parameters.slowQueueSec * 1000)
        log.warn('Getting last timestamp ', (Date.now() - startTime),
            'ms for object id: ' + id + ', value: ' + value +
            ' from history table "' + table + '" is: ' + (row ? row.timestamp : 'not found'));
    else
        log.debug('Last timestamp for object id: ' + id + ', value: ' + value +
            ' from history table "' + table + '" is: ' + (row ? row.timestamp : 'not found'));
    callback(null, row ? row.timestamp : undefined);
};

functions.getTransactionsQueueInfo = function(callback) {
    if(!transactionInProgress && transactionsFunctions.size) {
        log.warn('Starting ', transactionsFunctions.size, ' halted transactions');
        functions.beginTransaction(setShift(transactionsFunctions));
    }
    return callback(null, {
        len: transactionsFunctions.size,
        timestamp: transactionInProgress,
        description: transactionDescriptionInProgress,
    });
}

functions.beginTransaction = function(description, callback) {
    if(typeof description === 'object' && typeof description.callback === 'function') {
        callback = description.callback;
        description = description.description;
    }
    if(typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

    if(transactionInProgress) {
        /*
        log.info(Date.now(), ' Adding transaction to queue: ', description, '(', transactionsFunctions.size, ') now processing ',
            transactionDescriptionInProgress, ' form ', (new Date(transactionInProgress).toLocaleString()),
            ': ', transactionInProgress);
         */
        transactionsFunctions.add({
            description: description,
            callback: callback,
        });
        return;
    }
    transactionInProgress = Date.now();
    transactionDescriptionInProgress = description;

    if(typeof callbackOnStop === 'function') return callback(new Error('Can\'t run new transaction while stopping'));

    truncateWal();
    try {
        db.prepare('BEGIN').run();
    } catch (err) {
        return callback(new Error('Can\'t start transaction for storage DB: ' + err.message));
    }
    callback();
};

functions.commitTransaction = function(err, _callback) {

    function callback(err) {
        if(err) log.warn('Error in transaction "', transactionDescriptionInProgress, '": ', err);
        if(typeof callbackOnStop === 'function') {
            if(err) log.info('Stopping DB after transaction "', transactionDescriptionInProgress ,'" error...');
            callbackOnStop(err);
        }
        clearInterval(commitWatchdog);

        //log.info(Date.now(), ' Finishing transaction: ', transactionDescriptionInProgress, ': ', transactionInProgress, ' (', transactionsFunctions.size, ')');
        transactionInProgress = 0;
        transactionDescriptionInProgress = '';
        if(transactionsFunctions.size) functions.beginTransaction(setShift(transactionsFunctions));
        if(typeof _callback === 'function') _callback(err);
        else {
            log.warn('Commit of transaction is finished after timeout, error: ', err);
        }
        _callback = null;
    }

    if(parameters.timeoutForCommitTransaction) {
        var commitWatchdog = setInterval(function () {
            var error = 'Commit or rollback transaction timeout: ' + transactionDescriptionInProgress + ', started at ' +
                (new Date(transactionInProgress)).toLocaleString() +
                ' (' + transactionInProgress + '), queue: ' + transactionsFunctions.size;
            log.warn(error);
            //callback(new Error(error));
        }, parameters.timeoutForCommitTransaction);
    }

    if(err) {
        try {
            db.prepare('ROLLBACK').run();
        } catch (errRollback) {
            return callback(new Error(err.message + '; and can\'t rollback transaction for storage DB :' +
                errRollback.message));
        }
        callback(err);
    } else {
        try {
            db.prepare('COMMIT').run();
        } catch (err) {
            return callback(new Error('Can\'t commit transaction for storage DB: ' + err.message));
        }
        callback();
    }
};

functions.delRecords = function (IDs, daysToKeepHistory, daysToKeepTrends, callback) {
    if (!callback) {
        callback = daysToKeepHistory;
        daysToKeepHistory = 0;
    }

    if(!IDs.length) return callback();

    var arrayPartsIdx = [0], iterateNum = 0, deletedObjectsNum = 0, printInfoTime = Date.now();

    // Math.ceil(.95)=1; Math.ceil(7.004) = 8
    for(var i = 1; i < Math.ceil(IDs.length / parameters.maxNumberObjectsToDeleteAtTime); i++) {
        arrayPartsIdx.push(i *  parameters.maxNumberObjectsToDeleteAtTime);
    }

    var deleteRecordsInProgress = 0;
    async.eachSeries(arrayPartsIdx, function (idx, callback) {
        var IDsPart = IDs.slice(idx, idx + parameters.maxNumberObjectsToDeleteAtTime);
        ++iterateNum;
        deletedObjectsNum += IDsPart.length;

        functions.beginTransaction('Delete records IDs: ' + IDsPart.join(', '), function (err) {
            if (err) return callback(err);

            //log.info(Date.now(), ' Starting del transaction:  ', transactionDescriptionInProgress, ': ', transactionInProgress);
            if(iterateNum === 1) deleteRecordsInProgress = Date.now();
            delRecords(IDsPart, daysToKeepHistory, daysToKeepTrends, function (err) {
                //log.info(Date.now(), ' Finishing del transaction: ', transactionDescriptionInProgress, ': ', transactionInProgress, ' (', transactionsFunctions.size, '): ', err);
                functions.commitTransaction(err, function(err) {

                    if(Date.now() - printInfoTime > 60000) {
                        log.info('Deleting ', Math.round(deletedObjectsNum * 100 / IDs.length),
                            '% (', deletedObjectsNum, '/', IDs.length, ') objects since ',
                            new Date(deleteRecordsInProgress).toLocaleString());
                        printInfoTime = Date.now();
                    }

                    if(iterateNum === arrayPartsIdx.length ) return callback(err);
                    setTimeout(callback, parameters.pauseBetweenDeletingSeriesObjects, err);
                });
            });
        });
    }, callback);
};

/*
functions.delRecords = function (IDs, daysToKeepHistory, daysToKeepTrends, _callback) {
    if (!_callback) {
        _callback = daysToKeepHistory;
        daysToKeepHistory = 0;
    }

    if(!IDs.length || deleteRecordsInProgress) return _callback();
    deleteRecordsInProgress = Date.now();

    function callback(err) {
        deleteRecordsInProgress = 0;
        return _callback(err);
    }

    functions.beginTransaction('Delete records IDs: ' + IDs.join(', '), function(err) {
        if(err) return callback(err);

        //log.info(Date.now(), ' Starting del transaction:  ', transactionDescriptionInProgress, ': ', transactionInProgress);
        delRecords(IDs, daysToKeepHistory, daysToKeepTrends, function(err) {
            //log.info(Date.now(), ' Finishing del transaction: ', transactionDescriptionInProgress, ': ', transactionInProgress, ' (', transactionsFunctions.size, '): ', err);
            functions.commitTransaction(err, callback);
        });
    });
};
 */

function delRecords(IDs, daysToKeepHistory, daysToKeepTrends, _callback) {

    var deleteRecordsDebugInfo = ['recordsIDs:  ' + IDs.join(',') + '; hist: ' + daysToKeepHistory + '; trends: ' + daysToKeepTrends];
    var callback = function (err) {
        clearTimeout(deleteRecordWatchdog);
        if(typeof _callback === 'function') _callback(err);
        else {
            log.warn('Delete record ', IDs, ' finished after timeout and rollback transaction, error: ', err,
                '; stack: ', deleteRecordsDebugInfo);
        }
    }

    if(parameters.timeoutForDeleteObjectRecords) {
        var deleteRecordWatchdog = setTimeout(function () {
            log.warn('Delete record timeout (', parameters.timeoutForDeleteObjectRecords * IDs.length / 1000,
                'sec). Starting rollback. Stack: ' + deleteRecordsDebugInfo.join('; '));
            _callback(new Error('Delete record timeout. Stack: ' + deleteRecordsDebugInfo.join('; ')));
            _callback = null;
        }, parameters.timeoutForDeleteObjectRecords * IDs.length);
    }

    if (daysToKeepHistory) {
        var now = new Date();
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToKeepHistory);
        var timestampForHistory = d.getTime();

        if (!daysToKeepTrends || daysToKeepTrends < daysToKeepHistory) daysToKeepTrends = daysToKeepHistory;
        d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToKeepTrends);
        var timestampForTrends = d.getTime();

        try {
            var stmtNumbers = db.prepare('DELETE FROM numbers WHERE objectID=$id AND timestamp<$timestamp');
            deleteRecordsDebugInfo.push('stmtNumbers OK');
        } catch (err) {
            deleteRecordsDebugInfo.push('stmtNumbers ' + err);
            if (err) return callback(new Error('Can\'t prepare to remove data from numbers table for objects: ' +
                IDs.join(',') + ' and for ' + daysToKeepHistory + ' days: ' + err.message));
        }

        try {
            var stmtStrings = db.prepare('DELETE FROM strings WHERE objectID=$id AND timestamp<$timestamp')
            deleteRecordsDebugInfo.push('stmtStrings OK');
        } catch (err) {
            deleteRecordsDebugInfo.push('stmtStrings ' + err);
            if (err) return callback(new Error('Can\'t prepare to remove data from strings table for objects: ' +
                IDs.join(',') + ' and for : ' + daysToKeepHistory + ' days: ' + err.message));
        }
        var stmtTrends = {};

        for(var i = 0; i < trendsTimeIntervals.length; i++) {
            var timeInterval = trendsTimeIntervals[i];
            try {
                stmtTrends[timeInterval] = db.prepare('DELETE FROM trends' + timeInterval +
                    'min WHERE objectID=$id AND timestamp<$timestamp');
                deleteRecordsDebugInfo.push('stmtTrends ' + timeInterval + ' OK');
            } catch (err) {
                deleteRecordsDebugInfo.push('stmtTrends ' + timeInterval + ' ' + err);
                return callback(new Error('Can\'t prepare to delete data from trends' + timeInterval +
                    'min table for objects ' + IDs.join(', ') + ': ' + err.messgage));
            }
        }

        for(var j = 0; j < IDs.length; j++) {
            var id = IDs[j];

            try {
                stmtNumbers.run({
                    id: id,
                    timestamp: timestampForHistory,
                });
                deleteRecordsDebugInfo.push('stmtNumbers run ' + id + ' OK');
            } catch (err) {
                deleteRecordsDebugInfo.push('stmtNumbers run ' + id + ' ' + err);
                if (err) return callback(new Error('Can\'t remove data from numbers table for object: ' + id +
                    ' and for ' + daysToKeepHistory + ' days: ' + err.message));
            }

            try {
                stmtStrings.run({
                    id: id,
                    timestamp: timestampForHistory,
                });
                deleteRecordsDebugInfo.push('stmtStrings run ' + id + 'OK');
            } catch (err) {
                deleteRecordsDebugInfo.push('stmtStrings run ' + id + ' ' + err);
                if (err) return callback(new Error('Can\'t remove data from strings table for object: ' + id +
                    ' and for ' + daysToKeepHistory + ' days: ' + err.message));
            }

            for(i = 0; i < trendsTimeIntervals.length; i++) {
                timeInterval = trendsTimeIntervals[i];
                try {
                    stmtTrends[timeInterval].run({
                        id: id,
                        // remove trends data with time interval less than 1 hours like history data
                        // (keepHistory time).
                        timestamp: timeInterval < 60 ? timestampForHistory: timestampForTrends,
                    });
                    deleteRecordsDebugInfo.push('stmtTrends ' + id + ' ' + timeInterval + ' run OK' );
                } catch (err) {
                    deleteRecordsDebugInfo.push('stmtTrends ' + id + ' ' + timeInterval + ' run ' + err);
                    return callback(new Error('Can\'t delete data from trends' +
                        timeInterval + 'min table for objectID: ' + id + ': ' + err.message));
                }
            }
        }
        deleteRecordsDebugInfo.push('finish');
    } else {
        try {
            var stmt = db.prepare('DELETE FROM objects WHERE id=?');
            deleteRecordsDebugInfo.push('stmtObjects OK');
        } catch (err) {
            deleteRecordsDebugInfo.push('stmtObjects ' + err);
            return callback(new Error('Can\'t prepare to remove all data for objects: ' +
                IDs.join(',') + ' from storage: ' + err.message));
        }

        for(j = 0; j < IDs.length; j++) {
            id = IDs[j];
            try {
                stmt.run(id);
                deleteRecordsDebugInfo.push('stmtObject ' + id + ' OK');
                objectsParameters.delete(id);
            } catch (err) {
                deleteRecordsDebugInfo.push('stmtObject ' + id + ': ' + err);
                return callback(new Error('Can\'t remove all data for object: ' + id + ' from storage: ' + err.message));
            }
        }
        deleteRecordsDebugInfo.push('finish');
    }
    callback();
}


functions.saveRecordsForObject = function (id, newObjectParameters, recordsForSave, callback) {
    if (!id) return callback(new Error('Undefined ID while saving records to storage DB'));

    var objectParametersObj = objectsParameters.get(Number(id));

    objectsParameters.set(Number(id), newObjectParameters);
    var savedTrends = 0,
        trendData = trendsData.get(id),
        initTrendsStr = trendData ? JSON.stringify(Object.fromEntries(trendData.entries())) : '';

    if (!objectParametersObj) {
        objectParametersObj = newObjectParameters;
        var err = createStorage(id, newObjectParameters);
        if(err) {
            return callback(new Error('Can\'t create storage parameters for object id ' + id + ': ' + err.message));
        }
    } if (objectParametersObj.cachedRecords !== newObjectParameters.cachedRecords) {
        try {
            db.prepare('UPDATE objects SET cachedRecords=$cachedRecords WHERE id=$id').run({
                cachedRecords: newObjectParameters.cachedRecords,
                id: id
            });
        } catch (err) {
            return callback(new Error('Can\'t update storage parameters for object id ' + id + ': ' + err.message));
        }
    }
    for(var i = 0; i < recordsForSave.length; i++) {
        var record = recordsForSave[i];

        var isNumber = true;
        if (!isNaN(parseFloat(String(record.data))) && isFinite(record.data)) record.data = Number(record.data);
        else if (typeof record.data === 'boolean') record.data = record.data ? 1 : 0;
        else {
            isNumber = false;
            if (typeof record.data === 'object') record.data = JSON.stringify(record.data);
            else if (typeof record.data !== 'string') record.data = String(record.data);
        }

        try {
            db.prepare('INSERT INTO ' + (isNumber ? 'numbers' : 'strings') +
                ' (objectID, timestamp, data) VALUES ($id, $timestamp, $data)').run({
                id: id,
                timestamp: record.timestamp,
                data: record.data,
            });
        } catch (err) {
            return callback(new Error('Can\'t insert data into the ' +
                (isNumber ? 'numbers' : 'strings') +
                ' table for object id ' + id + ', timestamp: ' + record.timestamp + ', data(' + typeof(record.data) +
                '): ' + record.data + ': ' + err.message));
        }

        // don't save trends for strings and when keepTrends = 0
        if (isNumber && newObjectParameters.keepTrends) {
            // save trends
            // trendsData[id] = {"10":{"timestamp":1609863584322,"data":0.5127103117898119},"30":{"timestamp":1609862915322,"data":0.5127103117898119},"60":{"timestamp":1609861114626,"data":0.5127103117898119},"prevRecordTimestamp":1609863794413}
            if (!trendsData.has(id)) {
                trendData = new Map([['prevRecordTimestamp', 0]]);
                trendsData.set(id, trendData);
            }

            for (var j = 0; j < trendsTimeIntervals.length; j++) {
                var timeInterval = Number(trendsTimeIntervals[j]);
                // timeInterval was converted to Number when trends data is loaded
                var trendDataForTimeInterval = trendData.get(timeInterval);
                if (!trendDataForTimeInterval) {
                    trendData.set(timeInterval, record); // record = {data:.., timestamp:...}
                    continue;
                }

                // The time interval between the current and the previous record is greater than the trend time interval
                var longTimeSpan = record.timestamp - trendData.get('prevRecordTimestamp') > timeInterval * 60000;

                // if the time interval between current and previous record greater than time interval between trends records
                // or if current record and previous record data are 0 then write the current record
                // f.e. (0 + 0) / 2 = 1.7487687511971466e-48 sec
                trendDataForTimeInterval.data =
                    longTimeSpan || (!record.data && !trendDataForTimeInterval.data) ?
                        record.data :
                        (record.data + trendDataForTimeInterval.data) / 2;

                if (record.timestamp - trendDataForTimeInterval.timestamp < timeInterval * 60000) continue;

                try {
                    db.prepare('INSERT INTO trends' + timeInterval +
                        'min (objectID, timestamp, data) VALUES ($id, $timestamp, $data)').run({
                        id: id,
                        timestamp: longTimeSpan ? record.timestamp :
                            record.timestamp + Math.round((record.timestamp - trendDataForTimeInterval.timestamp) / 2),
                        data: trendDataForTimeInterval.data,
                    });
                } catch (err) {
                    return callback(new Error('Can\'t insert data to trends' +
                        timeInterval + 'min table: objectID: ' + id + ' trends: ' +
                        JSON.stringify(Object.fromEntries(trendData.entries())) + '; record: ' +
                        JSON.stringify(record) + ': ' + err.message));
                }
                trendDataForTimeInterval.timestamp = record.timestamp;
                savedTrends++;
            }
            trendData.set('prevRecordTimestamp', record.timestamp);
        }
    }
    var trendsStr = trendData ? JSON.stringify(Object.fromEntries(trendData.entries())) : '';
    var saveDataTrendsStr = trendsStr !== initTrendsStr ? trendsStr : '';
    // check and don't save unchanged trend data
    if(saveDataTrendsStr) {
        try {
            db.prepare('UPDATE objects SET trends=$trendsStr WHERE id=$id').run({
                trendsStr: saveDataTrendsStr,
                id: id
            });
        } catch (err) {
            log.error('Can\'t update trends data for object ' + id + ': ' + err.message + '; data: ' + saveDataTrendsStr);
        }
    }

    log.debug('Saving ', recordsForSave.length, ' records, ', savedTrends, ' trends for object ', id,
        '. parameters: ', newObjectParameters, ': records: ', recordsForSave, ': trends: ', trendsStr);

    callback(err, {
        id: id,
        savedRecords: recordsForSave.length,
        savedTrends: savedTrends,
    });
};

/**
 *  Creating new object in the storage DB
 * @param id {Number} - object id (objectCounterID)
 * @param objectParameters {Object} - {cachedRecords: ...}
 */
function createStorage (id, objectParameters) {
    if (objectParameters === undefined) objectParameters = {cachedRecords: parameters.initCachedRecords};
    else if (!objectParameters.cachedRecords) objectParameters.cachedRecords = parameters.initCachedRecords;

    log.info('Creating new storage for object id: ', id, '. Storage parameters: ', objectParameters);
    try {
        db.prepare('INSERT INTO objects (id, cachedRecords, type) VALUES (?, ?, ?)')
            .run([id, objectParameters.cachedRecords, 0]);
    } catch (err) {
        return new Error('Can\'t create a new storage for id ' + id + ', cached records: ' +
            objectParameters.cachedRecords + ' in storage DB: ' + err.message);
    }
}

functions.removeZombiesFromStorage = function (callback) {
    log.info('Removing zombies objects from storage');

    try {
        var rows = db.prepare('SELECT * FROM objects').all();  // id, type, cachedRecords
    }  catch (err) {
        return callback(new Error('Can\'t get data from objects table from storage DB: ' + err.message));
    }

    var OCIDs = rows.map(row => row.id);
    countersDB.getObjectsCounters(OCIDs, function (err, rows) {
        if (err) return callback(new Error('Can\'t get data from objectsCounters table: ' + err.message));

        if (rows.length === OCIDs.length) {
            log.info('Zombies objects are not found in the storage');
            return callback();
        }

        var zombiesOCIDs = [];
        rows.forEach(function (row) {
            if (OCIDs.indexOf(row.id) === -1) zombiesOCIDs.push(row.id);
        });

        functions.delRecords(zombiesOCIDs, function (err) {
            if (err) {
                return callback(new Error('Error removing zombies objects from the storage: ' +
                    err.message));
            }

            log.info('Done removing zombie objects from storage. Removed ', zombiesOCIDs.length, ' objects');
            callback();
        });
    });
};

functions.config = function(action, name, value, callback) {
    if(action === 'get') {
        if(typeof(name) !== 'string') {
            return callback(new Error('Can\'t get incorrect or undefined parameter name from config table'));
        }

        try {
            var rows = db.prepare('SELECT * FROM config WHERE name = ?').all(name)
        } catch (err) {
            return callback(new Error('Can\'t get parameter ' + name + ' from config table: ' + err.message));
        }
        if(rows.length < 1) return callback();
        return callback(null, rows[0].value);
    }

    if(action === 'set') {
        if(typeof(name) !== 'string') {
            return callback(new Error('Can\'t set incorrect or undefined parameter name to config table'));
        }

        if(typeof value !== 'string' && typeof value !== 'number' && value !== null) {
            return callback(new Error('Can\'t set incorrect or undefined configuration parameter "' + name +
                '" value to config table'));
        }

        try {
            db.prepare('INSERT INTO config (name, value) VALUES ($name, $value) ON CONFLICT (name) DO UPDATE SET value=$value').run({
                name: name,
                value: String(value),
            });
        } catch(err) {
            return callback(new Error('Can\'t insert or update configuration parameter ' + name +
                ' = ' + String(value) + ' :' + err.message));
        }
        return  callback();
    }

    return callback(new Error('Can\'t set or get parameter ' + name + ' to config table: invalid action ' + action));
};