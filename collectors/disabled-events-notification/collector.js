/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-4-30 13:59:36
*/
var path = require('path');
var log = require('../../lib/log')(module);
var sqlite = require('../../lib/sqlite');
var conf = require('../../lib/conf');

var collector = {};
module.exports = collector;
/*
    get data and return it to server

    prms - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $counterID: <counterID>,
        $objectID: <objectID>,
        $parentID: <parentObjectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $counterID - counter ID,
    $objectID - object ID
    $parentID - parent objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

var db;

collector.get = function(param, callback) {

    if(!db) return initDB(param, callback);
    
    var checkTime = Date.now() + Number(param.daysBeforeEnable) * 86400000;
    var disablePeriod = Number(param.disablePeriod) * 86400000;
    
    db.all('SELECT events.counterID AS counterID, events.objectName AS objectName, events.counterName AS counterName, ' +
       'disabledEvents.disableUntil AS disableUntil, disabledEvents.timestamp AS timestamp,' +
        'disabledEvents.user AS user, disabledEvents.intervals AS disableIntervals ' +
        'FROM disabledEvents JOIN events ON disabledEvents.eventID = events.id ' +
        'WHERE disabledEvents.disableUntil < ? AND disabledEvents.disableUntil - disabledEvents.timestamp > ?',
        [checkTime, disablePeriod], function(err, rows) {
        
        if(err) {
            return callback(new Error('Can\'t get disabled events info which will be enable after ' +
				param.daysBeforeEnable + ' days (after ' +
                new Date(checkTime).toLocaleString().replace(/\.\d\d\d\d,/, '') +
                ') and was disabled on ' + param.disablePeriod + ' days: ' + err.message));
        }
log.info('Events: ', rows);
        var results = rows.map(function (row) {
            var disabledTimeIntervals = '';
            if (row.disableUntil && row.disableIntervals) {
                var intervals = row.disableIntervals.split(';'),
                    lastMidnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime(); // last midnight

                disabledTimeIntervals = intervals.map(function (interval) {
                    var fromTo = interval.split('-');
                    var from = new Date(lastMidnight + Number(fromTo[0])).toLocaleTimeString().replace(/:\d\d$/, '');
                    var to = new Date(lastMidnight + Number(fromTo[1])).toLocaleTimeString().replace(/:\d\d$/, '');
                    return from + '-' + to;
                }).join('; ');
            }
log.info('Intervals: ', disabledTimeIntervals);
            return {
                counterID: row.counterID,
                objectName: row.objectName,
                counterName: row.counterName,
                disableUntil: new Date(row.disableUntil).toLocaleString().replace(/\.\d\d\d\d,/, ''),
                disableTime: new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, ''),
                user: row.user,
                timeIntervals: disabledTimeIntervals || '-',
            };
        });
log.info('result: ', results);
        callback(null, results);
    });
};

/*
    destroy objects when reinit collector
    destroy function is not required and can be skipping

    callback(err);
*/
collector.destroy = function(callback) {
    /* if has an objects, that can be destroyed while reinit collectors
        do this here
    */
    if(db) {
        log.warn('Request received to destroy the collector. Closing the database ...');
        db.close(callback);
    }
    else callback();
};

function initDB(param, callback) {
    var dbPath = path.join(__dirname, '..', '..',
        conf.get('collectors:event-generator:dbPath'),
        conf.get('collectors:event-generator:dbFile'));

    sqlite.init(dbPath, function (err, _db) {
        if (err) return callback(new Error('Can\'t initialise event database ' + dbPath + ': ' + err.message));

        _db.exec('PRAGMA journal_mode = WAL', function (err) {
            if (err) return callback(new Error('Can\'t set journal mode to WAL: ' + err.message));

            db = _db;
            log.info('Initializing events system database is completed');
            return collector.get(param, callback);
        });
    });
}
