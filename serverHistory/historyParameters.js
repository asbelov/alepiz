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
    cacheServiceInterval: 300, //sec
    initCachedRecords: 5,
    queryMaxResultNumbers: 5000,
    queryMaxResultStrings: 50,
    dbPath: 'db',
    tempDir: 'temp',
    dbFile: 'history.db',
    db: [], // [{path:.., file:...}, {path:.., file:..},...]
    dumpFileName: 'unsavedData.json',
    queriesMaxQueueLength: 200,
    slowQueueSec: 15,
    dbLockTimeout: 5000, // the number of milliseconds to wait when executing queries on a locked database, before throwing a SQLITE_BUSY error (default: 5000).
    cacheServiceExitTimeout: 0, // exit when running more than 24 hours
    cacheServiceTimeout: 0, // terminate cache service when running more than 1 hour
    cacheServiceTimeoutForSaveObjectRecords: 0, // terminate cache service when saving records for object more than 5 min
    timeoutForDeleteObjectRecords: 0, // terminate delete operation when delete delayed more than 60 sec per object id
    timeoutForCommitTransaction: 0, // log slow committed transaction (more than 3 min)
    maxNumberObjectsToDeleteAtTime: 100, // maximum number of objects to delete at one time
    pauseBetweenDeletingSeriesObjects: 1000, // pause between deleting a series of objects
    housekeeperInterval: 1800000, // how often houseKeeper will run
    housekeeperWaitTimeout: 0, // time to wait until the housekeeper is not checked or not made changes
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