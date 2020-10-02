/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var countersDB = require('../models_db/countersDB'); // for init housekeeper
var log = require('../lib/log')(module);
var cache = require('../models_history/historyCache');
var storage = require('../models_history/historyStorage');

var houseKeeper = {};
module.exports = houseKeeper;
var isHouseKeeperRunning = 0;

/*
 run housekeeper in a child (history server) process
 remove old data from history and making trends depended to fields 'keepHistory' and 'keepTrends' in a counters DB
 running in a child history process.
 */

houseKeeper.run = function () {
    if(cache.terminateHousekeeper) {
        return log.error('Prevent starting new housekeeper procedure, because receive message for terminating');
    }

    if(isHouseKeeperRunning) {
        return log.warn('Prevent starting new housekeeper procedure, because it always running at ',
            (new Date(isHouseKeeperRunning)).toLocaleString());
    }
    isHouseKeeperRunning = Date.now();

    countersDB.getKeepHistoryAndTrends(function(err, data) {
        if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;
        if (err) return log.error(err.message);
        if (!data || !data.length) {
            isHouseKeeperRunning = 0;
            log.info('[housekeeper] no objects in a database, exiting');
            return;
        }

        log.info('Starting housekeeper procedure for ', data.length, ' objects...');

        // removing zombies objects from history
        storage.removeZombiesFromStorage(function(err) {
            if(err) log.error(err.message);
        });

        storage.config('get', 'processedDataCnt', null, function(err, processedDataCnt) {
            if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;
            if (err) log.error(err.message);

            processedDataCnt = Number(processedDataCnt);
            if (!processedDataCnt || processedDataCnt < 0 || processedDataCnt >= data.length) processedDataCnt = 0;
            else processedDataCnt = processedDataCnt - 1;

            var prevProcessedDataCnt = {
                processedDataCnt: 0,
                timestamp: Date.now(),
            };

            var watchdogInterval = setInterval(function () {
                log.info('HouseKeeper started at ', (new Date(isHouseKeeperRunning)).toLocaleString(),
                    ' and processed ', processedDataCnt, '/', data.length, ' objects');

                if (prevProcessedDataCnt.processedDataCnt === processedDataCnt &&
                    Date.now() - prevProcessedDataCnt.timestamp > 3600000) {
                    isHouseKeeperRunning = 0;
                    clearInterval(watchdogInterval);
                    log.error('Housekeeper is halted at ', (new Date(prevProcessedDataCnt.timestamp)).toLocaleString(),
                        ' but processed ', processedDataCnt, '/', data.length, ' objects. Restarting from ',
                        processedDataCnt - 50);
                    if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;

                    houseKeeper.run();
                    return;
                }

                if (prevProcessedDataCnt.processedDataCnt !== processedDataCnt) {
                    prevProcessedDataCnt = {
                        processedDataCnt: processedDataCnt,
                        timestamp: Date.now(),
                    };

                    storage.config('set', 'processedDataCnt', (processedDataCnt === data.length ? 0 : processedDataCnt), function (err) {
                        if (err) log.error(err.message);
                    });
                }

            }, 600000);

            async.eachOfLimit(data,200, function(housekeeperParams, idx, callback) {
                if(cache.terminateHousekeeper) return callback(new Error('Receiving message for terminate housekeeper'));
                if(idx < processedDataCnt) return callback();

                var trends = housekeeperParams.trends ? housekeeperParams.trends : 1;
                var history = housekeeperParams.history ? housekeeperParams.history : 1;

                processedDataCnt++;
                // clean history and trends storage
                cache.del([housekeeperParams.OCID], history, trends, callback);
            }, function(err) {
                if(err) log.error('Housekeeper finished with error: ', err.message);
                else log.info('Housekeeper finished successfully, processed ', data.length, ' objects');

                storage.config('set', 'processedDataCnt', (err ? processedDataCnt - 50 : 0), function (err) {
                    if (err) log.error(err.message);

                    clearInterval(watchdogInterval);
                    if(cache.terminateHousekeeper) return log.error('Terminating housekeeper'); // terminate house keeper;

                    // last start of housekeeper was more then 1 hour ago. run housekeeper again immediately
                    if(Date.now() - isHouseKeeperRunning > 3600000) {
                        isHouseKeeperRunning = 0;
                        houseKeeper.run();
                    }
                    isHouseKeeperRunning = 0;
                });
            });
        });
    });
};