/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var async = require('async');
var countersDB = require('../models_db/countersDB'); // for init housekeeper
var cache = require('./historyCache');
var storage = require('./historyStorage');
const parameters = require('./historyParameters');
const Conf = require("../lib/conf");
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());


var houseKeeper = {};
module.exports = houseKeeper;
var isHouseKeeperRunning = 0;
var houseKeeperLastCheckTime = 0;
var prevProcessedDataCnt = {
    processedDataCnt: 0,
    timestamp: Date.now(),
};
var watchdogInterval


/*
 run housekeeper in a child (history server) process
 remove old data from history and making trends depended to fields 'keepHistory' and 'keepTrends' in a counters DB
 running in a child history process.
 */

houseKeeper.run = function () {

    if(cache.terminateHousekeeper) {
        return log.warn('Prevent starting new housekeeper procedure, because receive message for terminating');
    }

    cache.getTransactionsQueueInfo(function (err, transQueue) {

        if(isHouseKeeperRunning) {
            if(transQueue.len > 2 && transQueue.timestamp !== 0) {
                return log.warn('Prevent starting new housekeeper procedure, because it always running at ',
                    (new Date(isHouseKeeperRunning)).toLocaleString(),
                    ' and transaction queue length: ', transQueue.len,
                    ', last transaction started at ', (new Date(transQueue.timestamp)).toLocaleString() +
                    '(' + transQueue.description + ')');
            } else if(parameters.housekeeperWaitTimeout &&
                Date.now() - houseKeeperLastCheckTime > parameters.housekeeperWaitTimeout) {
                log.warn('The housekeeper running at ', (new Date(isHouseKeeperRunning)).toLocaleString(),
                    ' and last checked by watchdog ',
                    Math.ceil((Date.now() - houseKeeperLastCheckTime) / 60000), ' minutes ago. Restarting');
            } else {
                return log.warn('Prevent starting new housekeeper procedure, because it\'s always running at ',
                    (new Date(isHouseKeeperRunning)).toLocaleString());
            }
        }
        isHouseKeeperRunning = houseKeeperLastCheckTime = Date.now();

        /*
        SELECT objectsCounters.id AS OCID, counters.keepHistory AS history, counters.keepTrends AS trends
        FROM counters JOIN objectsCounters ON counters.id=objectsCounters.counterID
         */
        countersDB.getKeepHistoryAndTrends(function(err, data) {
            if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;
            if (err) return log.error(err.message);
            if (!data || !data.length) {
                isHouseKeeperRunning = houseKeeperLastCheckTime = 0;
                log.info('[housekeeper] no objects in a database, exiting');
                return;
            }

            log.info('Starting housekeeper procedure for ', data.length,
                ' objects. Transaction queue length: ', transQueue.len,
                (transQueue.timestamp ?
                    ', last transaction started at ' + (new Date(transQueue.timestamp)).toLocaleString() +
                    '(' + transQueue.description + ')' :
                    ', no transaction in progress'));

            // removing zombies objects from history
            storage.removeZombiesFromStorage(function(err) {
                if(err) log.error(err.message);
            });

            storage.config('get', 'processedDataCnt', null, function(err, initProcessedDataCnt) {
                if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;
                if (err) log.error(err.message);

                // receiver from all storage result like
                // [  { id: 1617401838425, timestamp: 1617402139730, result: '0' },
                // { id: 1617401838436, timestamp: 1617402139730, result: '0' },  [length]: 2]
                if(Array.isArray(initProcessedDataCnt) && initProcessedDataCnt.length) {
                    var processedDataCnt = Number(initProcessedDataCnt[0].result);
                }
                if (!processedDataCnt || processedDataCnt < 0 || processedDataCnt >= data.length) {
                    log.info('Housekeeper remembered that object ', processedDataCnt,'/', data.length,
                        ' was last processed. Start from the beginning...');
                    processedDataCnt = 0;
                } else {
                    processedDataCnt = processedDataCnt - 1;
                    log.info('Housekeeper starts processing from ', processedDataCnt, '/', data.length, ' objects');
                }
                prevProcessedDataCnt = {
                    processedDataCnt: processedDataCnt,
                    timestamp: Date.now(),
                };

                if (watchdogInterval) clearInterval(watchdogInterval);
                watchdogInterval = setInterval(function () {
                    cache.getTransactionsQueueInfo(function (err, transQueue) {
                        log.info('HouseKeeper started at ', (new Date(isHouseKeeperRunning)).toLocaleString(),
                            '. Processed ', processedDataCnt, '/', data.length,
                            ' objects. There were  ', prevProcessedDataCnt.processedDataCnt, ' objects.',
                            (!prevProcessedDataCnt.processedDataCnt ? '' :
                                // convert speed from obj/milliseconds to obj/minutes
                                (' Speed: ' + Math.ceil((processedDataCnt - prevProcessedDataCnt.processedDataCnt) *
                                    60000 /
                                    (Date.now() - prevProcessedDataCnt.timestamp)) + ' objects/min.')),
                            ' Transaction queue length: ', transQueue.len,
                            (transQueue.timestamp ?
                                ', last transaction started at ' + (new Date(transQueue.timestamp)).toLocaleString() +
                                '(' + transQueue.description + ')' :
                                ', no transaction in progress')
                        );


                        if (parameters.housekeeperWaitTimeout && (transQueue.len < 2 || transQueue.timestamp === 0) &&
                            prevProcessedDataCnt.processedDataCnt === processedDataCnt &&
                            Date.now() - prevProcessedDataCnt.timestamp > parameters.housekeeperWaitTimeout) {
                            isHouseKeeperRunning = houseKeeperLastCheckTime = 0;
                            log.warn('Housekeeper is halted at ',
                                (new Date(prevProcessedDataCnt.timestamp)).toLocaleString(),
                                ' but processed ', processedDataCnt, '/', data.length, ' objects. Restarting from ',
                                processedDataCnt - 1);
                            if (cache.terminateHousekeeper) { // terminate house keeper;
                                return log.warn('Do not start a new housekeeper after halt because a termination ',
                                    'request was received.');
                            }

                            houseKeeper.run();
                            return;
                        }

                        houseKeeperLastCheckTime = Date.now();

                        if (prevProcessedDataCnt.processedDataCnt !== processedDataCnt) {
                            prevProcessedDataCnt = {
                                processedDataCnt: processedDataCnt,
                                timestamp: Date.now(),
                            };

                            storage.config('set', 'processedDataCnt',
                                (processedDataCnt >= data.length ? 0 : processedDataCnt), function (err) {
                                if (err) log.error(err.message);
                            });
                        }
                    });

                }, parameters.housekeeperWatchdogCheckInterval);

                async.eachOfLimit(data,200, function(housekeeperParams, idx, callback) {
                    if(cache.terminateHousekeeper) {
                        return callback(new Error('Receiving message for terminate housekeeper'));
                    }
                    if(idx < processedDataCnt) return callback();

                    var trends = housekeeperParams.trends;
                    var history = housekeeperParams.history;
                    if(history !== parseInt(history, 10) || history < 0) history = 0;
                    if(trends !== parseInt(trends, 10) || trends < 0) trends = 0;

                    processedDataCnt++;
                    // clean history and trends storage
                    cache.del([housekeeperParams.OCID], history, trends, callback);
                }, function(err) {
                    if(err) {
                        log.warn('Housekeeper finished with error: ', err.message, '; processed ',
                            processedDataCnt, '/', data.length, ' objects');
                    } else {
                        log.info('Housekeeper finished successfully, processed ', data.length, ' objects');
                    }

                    storage.config('set', 'processedDataCnt', (err ? processedDataCnt - 50 : 0), function (err) {
                        if (err) log.error(err.message);

                        clearInterval(watchdogInterval);
                        if(cache.terminateHousekeeper) {
                            isHouseKeeperRunning = houseKeeperLastCheckTime = 0;
                            return log.warn('Terminating housekeeper');
                        } // terminate house keeper;

                        // last start of housekeeper was more then housekeeperInterval.
                        // run housekeeper again immediately
                        if(Date.now() - isHouseKeeperRunning > parameters.housekeeperInterval) {
                            isHouseKeeperRunning = houseKeeperLastCheckTime = 0;
                            houseKeeper.run();
                        }
                        isHouseKeeperRunning = houseKeeperLastCheckTime = 0;
                    });
                });
            });
        });
    })
};