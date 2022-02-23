/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const fs = require("fs");
const countersDB = require("../models_db/countersDB");
const log = require('../lib/log')(module);

var storeUpdateEventsData = {
    saveUpdateEventsStatus: saveUpdateEventsStatus,
    loadUpdateEventsData: loadUpdateEventsData,
};

module.exports = storeUpdateEventsData;

function saveUpdateEventsStatus(myUpdateEventsStatusFilePath, updateEventsStatus) {
    try {
        fs.writeFileSync(myUpdateEventsStatusFilePath, JSON.stringify(Object.fromEntries(updateEventsStatus.entries())));
    } catch (e) {
        log.error('Can\'t save update events data to ', myUpdateEventsStatusFilePath, ': ', e.message);
        return;
    }
    log.warn('Update events data successfully saved to ', myUpdateEventsStatusFilePath);
}


/*
Load update events data from all files, saved by all servers, because we do not know which OCIDs server process
will be processed each time it starts
 */
function loadUpdateEventsData(updateEventsStatusFilesPath, serverID, callback) {
    var loadedUpdateEvents = 0;
    var updateEventsStatus = new Map();

    // get all OCIDs from DB for clearing not existed update events
    countersDB.getAllObjectsCounters(function (err, rows) {
        if(err) {
            log.error('Can\'t get OCIDs data: ', err.message);
            rows = [];
        }
        var OCIDs = {};
        rows.forEach(function (row) {
            OCIDs[row.id] = true;
        });

        updateEventsStatusFilesPath.forEach(function (filePath, idx) {
            // skip to load data from file with my serverID for loading letter
            if (idx === Number(serverID)) return;
            loadedUpdateEvents += loadUpdateEventsDataFromFile(filePath, OCIDs);
        });

        // loading data from file with my server ID
        if(Number(serverID) === parseInt(String(serverID), 10)) {
            loadedUpdateEvents += loadUpdateEventsDataFromFile(updateEventsStatusFilesPath[serverID], OCIDs);
        }

        log.info('Successfully loaded ', loadedUpdateEvents, ' update events');
        callback(null, updateEventsStatus);

        // remove update events files
        setTimeout(function () {
            updateEventsStatusFilesPath.forEach(function(filePath) {
                fs.unlink(filePath, function (err) {
                    if(!err) log.info('Removing file with loaded update events data: ', filePath);
                });
            });
        }, 300000);
    });

    function loadUpdateEventsDataFromFile(filePath, OCIDs) {
        try {
            var updateEventsStatusStr = fs.readFileSync(filePath, 'utf8');
            var _updateEventsStatus = JSON.parse(updateEventsStatusStr);
        } catch (e) {
            log.warn('Can\'t load update events data from ', filePath, ': ', e.message);
            return 0;
        }
        var removedUpdateEvents = 0;
        for(var key in _updateEventsStatus) {
            //key = <parentOCID>-<OCID>
            var pairs = key.split('-');
            if(OCIDs[pairs[0]] && OCIDs[pairs[1]]) updateEventsStatus.set(key, _updateEventsStatus[key]);
            else ++removedUpdateEvents;
        }

        if(removedUpdateEvents) {
            log.info('Skip to load ', removedUpdateEvents, '/', Object.keys(_updateEventsStatus).length,
                ' not existed update events from ', filePath);
        } else log.info('Loading ', Object.keys(_updateEventsStatus).length, ' update events from ', filePath);

        return Object.keys(_updateEventsStatus).length - removedUpdateEvents;
    }
}
