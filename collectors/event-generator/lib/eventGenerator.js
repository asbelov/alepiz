/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../../lib/log')(module);
const task = require('../../../lib/tasks');
const initDB = require('./initDB');
const Conf = require('../../../lib/conf');
const conf = new Conf('config/common.json');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
const eventActions = require('./eventsActions');


var eventGenerator = {};
module.exports = eventGenerator;

const systemUser = conf.get('systemUser') || 'system';
var isInitializing = 0;
var isEventProcessed = 0;
var db, dbPath, eventsCache = {}, repeatEventsCache = {}, disabledEventsCache = {},
    collectorHighPriorityActionsQueue = [], collectorActionsQueue = [],
    eventNum = 0, prevEventNum = 0, prevErrorTime = 0, processedEventsParam = 'You can not view this message';
/*
    get data and return it to server

    param - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

eventGenerator.init = function (_dbPath, callback) {
    dbPath = _dbPath;
    var cache = initDB.init(dbPath);

    db = cache.db;
    eventsCache = cache.eventsCache;
    disabledEventsCache = cache.disabledEventsCache;
    eventActions.init(cache, enableEvents, onSolvedEvent, onEvent);
    isInitializing = Date.now();
    var saveRepeatEventsCacheInterval = confSettings.get('saveRepeatEventsCacheInterval') * 1000 || 15000;
    setInterval(saveRepeatedEventsToCache, saveRepeatEventsCacheInterval);
    log.info('Events processor thread complete initializing for ', dbPath);
    callback();
}

eventGenerator.isEventDisabled = isEventDisabled; // for ajax

eventGenerator.get = eventGenerator.getOnce = function (param, _callback) {
    param.$dataTimestamp = Date.now();

    if(isOtherEventInProgress(param, _callback)) return;

    function callback(err, result) {
        if(typeof _callback === 'function') _callback(err, result);
        else if(err) log.error(err.message, ' for ', dbPath);

        isEventProcessed = 0;
        ++eventNum;
        if(!collectorHighPriorityActionsQueue.length) {
            collectorHighPriorityActionsQueue = [];
            return;
        }

        if(!collectorActionsQueue.length) {
            collectorActionsQueue = [];
            return;
        }


        /*
        setTimeout for
        PID: 87724, D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js
            Stack: RangeError: Maximum call stack size exceeded
                at JSON.stringify (<anonymous>)
                at isOtherEventInProgress (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:283:33)
                at Object.eventGenerator.get (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:65:8)
                at callback (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:78:24)
                at solveEvent (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:217:9)
                at Object.eventGenerator.get (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:173:9)
                at callback (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:78:24)
                at solveEvent (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:217:9)
                at Object.eventGenerator.get (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:173:9)
                at callback (D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js:78:24)
         */
        setTimeout(function () {
            var collectorAction = collectorHighPriorityActionsQueue.length ?
                collectorHighPriorityActionsQueue.shift() : collectorActionsQueue.shift();
            if(!collectorAction) return;

            eventGenerator.get(collectorAction.param, function(err, result) {
                if(typeof collectorAction.callback === 'function') collectorAction.callback(err, result);
                else if(err) log.error(err.message);
            });
        }, 0).unref();
    }

    if(param.action) {
        try {
            if(param.action === 'eventEditor') eventActions.eventEditor(db, param);
            else eventActions.dashboard(db, param);
        } catch (err) {
            return callback(err);
        }
        callback();
        return;
    }

    var OCID = param.$id;

    if(Number(OCID) !== parseInt(String(OCID), 10) || !Number(OCID) ||
        Number(param.$counterID) !== parseInt(String(param.$counterID), 10) || !Number(param.$counterID) ||
        typeof param.$variables !== 'object' || !param.$variables.OBJECT_NAME || !param.$variables.COUNTER_NAME) {
        return callback(new Error('Some parameters are not correct: ' + JSON.stringify(param)));
    }

    var eventTimestamp = param.$variables.UPDATE_EVENT_TIMESTAMP ?
        param.$variables.UPDATE_EVENT_TIMESTAMP : param.$dataTimestamp;

    // param.$variables.UPDATE_EVENT_STATE === undefined when we has not an update event expression
    if(param.$variables.UPDATE_EVENT_STATE === 1 || param.$variables.UPDATE_EVENT_STATE === undefined) {
        // !!!don't touch this horror
        if(disabledEventsCache[OCID]) {
            if(disabledEventsCache[OCID].disableUntil < Date.now()) {
                try {
                    enableEvents(db, {events: [{OCID: OCID}]});
                } catch (err) {
                    log.error(err.message, ' for ', dbPath);
                }
            }
            else {
                if(isEventDisabled(disabledEventsCache[OCID].intervals)) {
                    if(!eventsCache[OCID]) {
                        log.info('Disabled event occurred: ', param.$variables.OBJECT_NAME,
                            '(', param.$variables.COUNTER_NAME, '): importance: ',
                            param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(),
                            ', parentOCID: ', param.$parentID,
                            ', OCID: ', OCID, ', disabled: ', disabledEventsCache[OCID], ' for ', dbPath);
                    }
                    return callback();
                }
            }
        }

        if(!eventsCache[OCID]) {
            log.info('Event occurred: ', param.$variables.OBJECT_NAME, '(', param.$variables.COUNTER_NAME, '): importance: ',
                param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', param.$parentID,
                ', OCID: ', OCID, ' for ', dbPath);
        }

        try {
            var newEventID = onEvent(db, OCID, param.$objectID, param.$counterID, param.$variables.OBJECT_NAME,
                param.$variables.COUNTER_NAME, param.$parentID, param.importance, param.eventDescription,
                eventTimestamp, param.$dataTimestamp, param.pronunciation);
        } catch (err) {
            return callback(err);
        }

        var runTaskOnProblem = confSettings.get('runTaskOnProblem');
        if(param.problemTaskID && runTaskOnProblem) {
            task.runTask({
                userName: systemUser,
                taskID: param.problemTaskID,
                variables: param.$variables,
            },function(err) {
                if(err) log.error(err.message, ' for ', dbPath);
            });
        }

        if(Number(param.eventDuration) === parseInt(String(param.eventDuration), 10)) {
            param.eventDuration = Number(param.eventDuration);
            var solve_problem = function(newEventID) {
                solveEvent(newEventID, callback)
                param.$variables.UPDATE_EVENT_STATE = 0;
                eventGenerator.get(param, _callback); // use _callback()!!!
            }

            if(!param.eventDuration || param.eventDuration < 1) solve_problem(newEventID);
            else setTimeout(solve_problem, param.eventDuration * 1000, newEventID);
            return;
        }

        // save new event to history database too
        if(newEventID) callback(null, 1);
        else callback();
    } else if(param.$variables.UPDATE_EVENT_STATE === 0) {
        solveEvent(0, callback);
    } else {
        callback(new Error('Can\'t generate event: incorrect variable value for UPDATE_EVENT_STATE (' +
            param.$variables.UPDATE_EVENT_STATE + ') can be "1|0|undefined" for ' +
            param.$variables.OBJECT_NAME + '->' + param.$variables.PARENT_OBJECT_NAME + ': parent counter "' +
            (param.$variables.PARENT_COUNTER_NAME  || 'Undefined parent counter: ' +
                param.$variables.PARENT_COUNTER_NAME) + '" value: ' + param.$variables.PARENT_VALUE));
    }

    function solveEvent(newEventID, callback) {
        if(eventsCache[OCID]) {
            log.info('Event solved: ', param.$variables.OBJECT_NAME, '(', param.$variables.COUNTER_NAME, '): importance: ',
                param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', param.$parentID,
                ', OCID: ', OCID, ' for ', dbPath);
        } else var dontRunTask = true;

        try {
            onSolvedEvent(db, OCID, eventTimestamp);
        } catch (err) {
            return callback(err, newEventID ? 1 : undefined);
        }

        if(disabledEventsCache[OCID]) if(disabledEventsCache[OCID].disableUntil < Date.now()) {
            try {
                enableEvents(db, {events: [{OCID: OCID}]});
            } catch (err) {
                log.error(err.message, ' for ', dbPath);
            }
        }

        var runTaskOnSolve = confSettings.get('runTaskOnSolve');
        if(runTaskOnSolve &&
            (!disabledEventsCache[OCID] || !isEventDisabled(disabledEventsCache[OCID].intervals)) &&
            param.solvedTaskID && !dontRunTask) {
            task.runTask({
                userName: systemUser,
                taskID: param.solvedTaskID,
                variables: param.$variables,
            },function(err) {
                if(err) log.error(err.message, ' for ', dbPath);
            });
        }

        // 0 save solved event to history database too
        callback(null, newEventID ? 1 : 0);
    }
}

eventGenerator.removeCounters = function(OCIDs, callback) {
    OCIDs.forEach(OCID => {
        if(!eventsCache[OCID]) return;

        log.info('Remove OCID: ', OCID, ' from event-generator collector for ', dbPath);
        try {
            onSolvedEvent(db, OCID, Date.now());
        } catch (err) {
            log.error(err.message, ' for ', dbPath);
        }
    });
    if(typeof callback == 'function') callback();
};

eventGenerator.destroy = function(callback) {
    log.warn('Destroying collector event-generator for ', dbPath);
    eventsCache = {};
    try {
        db.close();
    } catch (err) {
        log.error('Can\'t close database: ', err.message, ' for ', dbPath);
    }
    if(typeof callback == 'function') callback();
    setTimeout(process.exit, 100);
};

function isOtherEventInProgress(param, _callback) {
    if(isEventProcessed || !isInitializing) {
        if(param.action) {
            collectorHighPriorityActionsQueue.push({
                param: param,
                callback: _callback
            });
        } else {
            collectorActionsQueue.push({
                param: param,
                callback: _callback
            });
        }

        if((collectorActionsQueue.length > 100 &&
                Math.round(collectorActionsQueue.length / 10) === collectorActionsQueue.length / 10) ||
            (collectorHighPriorityActionsQueue.length > 10 &&
                Math.round(collectorHighPriorityActionsQueue.length / 10) === collectorHighPriorityActionsQueue.length / 10)
        ) {
            log.warn('Events actions queue: ',
                collectorHighPriorityActionsQueue.length, '; write events queue: ', collectorActionsQueue.length,
                (prevEventNum ? '; processing speed: ' +
                    Math.round((eventNum - prevEventNum) / (Date.now() - prevErrorTime) / 1000 ) + ' events/sec.' : ''),
                '; last event processed: ', (Date.now() - isEventProcessed), 'ms',
                (Date.now() - isEventProcessed > 5000 ? '; last event params: ' + processedEventsParam : ''),
                ' for ', dbPath
            );
            prevEventNum = eventNum;
            prevErrorTime = Date.now();
        } else {
            prevEventNum = prevErrorTime = 0;
        }
        return true;
    }

    isEventProcessed = Date.now();
    processedEventsParam = JSON.stringify(param);
    return false;
}


/*
check is event disabled or enabled now
   intervals: <from>-<to>;<from>-<to>;<from>-<to>

   return true (event is disabled) or false (event is enabled)
 */
function isEventDisabled(intervalsStr, startTime, endTime) {
    if(!intervalsStr) return true;
    if(!startTime) startTime = Date.now();
    if(!endTime) endTime = Date.now();

    var eventsTimeFrom = startTime - (new Date(new Date(startTime).setHours(0,0,0,0))).getTime();
    var eventTimeTo = endTime - (new Date(new Date(endTime).setHours(0,0,0,0))).getTime();
    var intervals = intervalsStr.split(';');

    for(var i = 0; i < intervals.length; i++) {
        var fromTo = intervals[i].split('-');
        if(eventsTimeFrom > Number(fromTo[0]) && eventTimeTo < Number(fromTo[1])) return true;
    }
    return false;
}

/*
    enable: {
        events: [{
                OCID: OCID
            }, {
            .....
            }]
    }
    callback(err) or nothing
 */
function enableEvents(db, enable) {
    log.info('Enable events: ', enable, ' for ' + dbPath);

    enable.events.forEach( function(event) {
        var OCID = event.OCID;
        // make it at first for immediately enable events when function called without callback
        if (disabledEventsCache[OCID]) delete disabledEventsCache[OCID];
        else {
            log.error('Can\'t enable event for OCID: ' + OCID +
                ': event not exist in the list of disabled events for ', dbPath);
        }
        try {
            db.prepare('DELETE FROM disabledEvents WHERE OCID=?').run(OCID);
        } catch (err) {
            throw(new Error('Can\'t enable event for OCID ' + OCID + ': ' +
                JSON.stringify(disabledEventsCache[OCID]) + ': ' + err.message));
        }
    });
}

function onEvent(db, OCID, objectID, counterID, objectName, counterName, parentOCID, importance, eventDescription,
                 eventTimestamp, dataTimestamp, pronunciation) {
    var eventID = eventsCache[OCID];
    if(eventID && dataTimestamp) { // dataTimestamp - check for run not from eventEditor
        repeatEventsCache[eventID] = {
            eventID: eventID,
            data: eventDescription || null,
            timestamp: eventTimestamp,
            pronunciation: pronunciation
        };
        // return here for clear events queue
        return;
    }

    var queryParameters = {
        OCID: OCID,
        objectID: objectID,
        counterID: counterID,
        objectName: objectName,
        counterName: counterName,
        parentOCID: parentOCID || null,
        importance: importance || 0,
        startTime: dataTimestamp,
        endTime: dataTimestamp ? null : 0, // for eventEditor
        data: eventDescription,
        timestamp: eventTimestamp,
        pronunciation: pronunciation
    };

    try {
        var info = db.prepare('INSERT INTO events (OCID, objectID, counterID, objectName, counterName, parentOCID, ' +
            'importance, startTime, endTime, initData, data, timestamp, pronunciation) ' +
            'VALUES ($OCID, $objectID, $counterID, $objectName, $counterName, $parentOCID, ' +
            '$importance, $startTime, $endTime, $data, $data, $timestamp, $pronunciation)').run(queryParameters);
    } catch (err) {
        throw(new Error('Can\'t add event with OCID: ' + OCID + ' into events table event database: ' +
            err.message + ' data: ' + JSON.stringify(queryParameters)));
    }
    // dont save eventID to the eventsCache when event generated by eventsEditor (dataTimestamp = 0)
    if(dataTimestamp) eventsCache[OCID] = info.lastInsertRowid;

    return info.lastInsertRowid; // return new event ID
}

function onSolvedEvent(db, OCID, timestamp) {
    var eventID = eventsCache[OCID];
    if(!eventID) {
        //log.debug('Can\'t add event end time for OCID: ' + OCID + ' into events table: Opened event with current OCID does not exist');
        // it's not an error. it can be when previous state of trigger is unknown, and new state is false
        // do nothing
        return;
    }

    delete eventsCache[OCID];
    try {
        db.prepare('UPDATE events set endTime=$endTime WHERE id=$eventID').run({
            endTime: timestamp,
            eventID: eventID,
        });
    } catch(err) {
        throw(new Error('Can\'t add event end time (' + timestamp + ') with eventID ' + eventID +
            ', OCID: ' + OCID + ' into events table event database: ' + err.message));
    }
}

function saveRepeatedEventsToCache() {
    if (!Object.keys(repeatEventsCache).length) return;

    var savedEventsCnt = 0;
    for (var eventID in repeatEventsCache) {
        var item = repeatEventsCache[eventID];

        delete (repeatEventsCache[eventID]);
        try {
            db.prepare('UPDATE events set data=$data, timestamp=$timestamp, pronunciation=$pronunciation WHERE id=$eventID')
                .run(item);
            ++savedEventsCnt;
        } catch (err) {
            log.error('Can\'t update cached event data with eventID ' + item.eventID +
                ' data: ' + item.data + ', timestamp: ' + (new Date(item.timestamp)).toLocaleString() +
                ' into events table event database: ' + err.message + ' for ' + dbPath);
        }

    }

    if (savedEventsCnt > 2) log.info('Adding ', savedEventsCnt, ' cached repeated events to events table for ', dbPath);
}
