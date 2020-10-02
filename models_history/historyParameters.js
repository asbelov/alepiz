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
    queryMaxResultNumbers: 1000,
    queryMaxResultStrings: 50,
    dbPath: 'db',
    dbFile: 'storage.db',
    dumpFileName: 'unsavedData.json',
    queriesMaxQueueLength: 200,
    slowQueueSec: 15,
    cacheServiceExitTimeout: 86400000, // exit when running more then 24 hours
    cacheServiceTimeout: 3600000, // terminate cache service when running more then 1 hour
    cacheServiceTimeoutForSaveObjectRecords: 600000, // terminate cache service when saving records for object more then 10 min
    housekeeperInterval: 3600000, // how often houseKeeper will running

    init: function (initParameters) {
        for (var parameter in initParameters) {
            if (!initParameters.hasOwnProperty(parameter)) continue;
            if (parameters.hasOwnProperty(parameter)) parameters[parameter] = initParameters[parameter];
        }

        log.debug('Init history with parameters: ', parameters);
    }
};

module.exports = parameters;

