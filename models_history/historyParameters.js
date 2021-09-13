/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 15.10.2016.
 */
var log = require('../lib/log')(module);

var parameters = {
    localAddress: "127.0.0.1",
    serverAddress: "127.0.0.1",
    maxSocketErrorsCnt: 500, // for IPC system
    serverPort: 10163,
    workersNum: 0,
    exitOnNoClients: 180000,
    cacheServiceInterval: 600, //sec
    restartHistoryInterval: 5400, // sec = 1 hour 30 minutes
    restartStorageModifier: false,
    restartStorageQueryProcesses: true,
    restartHistory: false,
    // hh:mm:ss.msc 1234567890123456\n = 30 ~ 32.
    // js Numeric is a double precision-64 bit approx 16 digits, https://en.wikipedia.org/wiki/IEEE_754-1985
    // set both block sizes multiple to a file system block size
    // don't change this values if you has an existing databases
    numberType: 0,
    textType: 1,
    initCachedRecords: 5,
    queryMaxResultNumbers: 5000,
    queryMaxResultStrings: 50,
    dbPath: 'db',
    tempDir: 'temp',
    dbFile: 'storage.db',
    db: [], // [{path:.., file:...}, {path:.., file:..},...]
    dumpFileName: 'unsavedData.json',
    queriesMaxQueueLength: 200,
    slowQueueSec: 15,
    cacheServiceExitTimeout: 86400000, // exit when running more then 24 hours
    cacheServiceTimeout: 3600000, // terminate cache service when running more then 1 hour
    cacheServiceTimeoutForSaveObjectRecords: 300000, // terminate cache service when saving records for object more then 5 min
    timeoutForDeleteObjectRecords: 60000, // terminate delete operation when delete delayed more then 60 sec per object id
    timeoutForCommitTransaction: 180000, // log slow committed transaction (more then 3 min)
    housekeeperInterval: 1800000, // how often houseKeeper will running
    housekeeperWaitTimeout: 1200000, // time to wait until the housekeeper is not checked or not made changes
    housekeeperWatchdogCheckInterval: 300000, // time interval for checking housekeeper
    storageQueryingProcessesNum: 0, // Number of storage querying processes. if 0 then number will be equal to CPUs number.
    reloadKeepHistoryInterval: 300000, // every 5min reload KeepHistory settings. Send data to history only if KeepHistory !== 0

    init: function (initParameters) {
        for (var parameter in initParameters) {
            if (!initParameters.hasOwnProperty(parameter)) continue;
            if (parameters.hasOwnProperty(parameter)) parameters[parameter] = initParameters[parameter];
        }

        log.debug('Init history with parameters: ', parameters);
    }
};

module.exports = parameters;

