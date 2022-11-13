/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../../lib/log')(module);
const taskServer = require('../../../serverTask/taskServerClient');
const initDB = require('./initDB');
const Conf = require('../../../lib/conf');
const conf = new Conf('config/common.json');
const confCollectors = new Conf('config/collectors.json');
const confSettings = new Conf(confCollectors.get('dir') + '/event-generator/settings.json');
const eventActions = require('./eventsActions');
const setShift = require('../../../lib/utils/setShift');

var eventGenerator = {};
module.exports = eventGenerator;

const systemUser = conf.get('systemUser') || 'system';
var isEventProcessedOrNotInitialized = Date.now();
var db,
    dbPath,
    eventsCache = new Map(),
    repeatEventsCache = new Map(),
    disabledEventsCache = new Map(),
    collectorHighPriorityActionsQueue = new Set(),
    collectorActionsQueue = new Set(),
    eventNum = 0,
    prevEventNum = 0,
    prevErrorTime = 0,
    processedEventParam = 'You can not view this message';

eventGenerator.init = function (_dbPath, callback) {
    dbPath = _dbPath;
    var cache = initDB.initDB(dbPath);

    db = cache.db;
    eventsCache = cache.eventsCache;
    disabledEventsCache = cache.disabledEventsCache;
    eventActions.init(cache, enableEvents, onSolvedEvent, onEvent);
    var saveRepeatEventsCacheInterval = confSettings.get('saveRepeatEventsCacheInterval') * 1000 || 15000;
    setInterval(saveRepeatedEventsToCache, saveRepeatEventsCacheInterval);
    isEventProcessedOrNotInitialized = 0;
    processQueue();
    log.info('Events processor thread complete initializing for ', dbPath);
    callback();
}

eventGenerator.isEventDisabled = isEventDisabled; // for ajax

eventGenerator.get = eventGenerator.getOnce = function (param, callback) {
    param.$dataTimestamp = Date.now();

    if(isEventProcessedOrNotInitialized) return addToQueue(param, callback);

    isEventProcessedOrNotInitialized = param.$dataTimestamp;
    processedEventParam = JSON.stringify(param);
    ++eventNum;
    eventGeneratorGet(param, function(err, result) {
        if (typeof callback === 'function') callback(err, result);
        else if (err) log.error(err.message, ' for ', dbPath);

        isEventProcessedOrNotInitialized = 0;
        if (!collectorHighPriorityActionsQueue.size || !collectorActionsQueue.size) {
            return;
        }

        /*
        setTimeout for
        PID: 87724, D:\ALEPIZ\collectors\event-generator\lib\eventGenerator.js
            Stack: RangeError: Maximum call stack size exceeded
            ...
         */
        setTimeout(processQueue, 0).unref();
    });
}

function processQueue() {
    if(isEventProcessedOrNotInitialized && Date.now() - isEventProcessedOrNotInitialized < 60000) return;

    var collectorAction = collectorHighPriorityActionsQueue.size ?
        setShift(collectorHighPriorityActionsQueue) : setShift(collectorActionsQueue);
    if (!collectorAction) return;

    eventGenerator.get(collectorAction.param, function (err, result) {
        if (typeof collectorAction.callback === 'function') collectorAction.callback(err, result);
        else if (err) log.error(err.message);
    });
}

function eventGeneratorGet(param, callback) {

    if(param.action) {
        if(param.action === 'eventEditor') eventActions.eventEditor(db, param);
        else eventActions.dashboard(db, param);
        return callback();
    }

    const OCID = Number(param.$id);

    if(OCID !== parseInt(String(OCID), 10) || !OCID ||
        Number(param.$counterID) !== parseInt(String(param.$counterID), 10) || !Number(param.$counterID) ||
        typeof param.$variables !== 'object' || !param.$variables.OBJECT_NAME || !param.$variables.COUNTER_NAME) {
        return callback(new Error('Some parameters are not correct: ' + JSON.stringify(param)));
    }

    var eventTimestamp = param.$variables.UPDATE_EVENT_TIMESTAMP || param.$dataTimestamp;

    // param.$variables.UPDATE_EVENT_STATE === undefined when we have not an update event expression
    if(param.$variables.UPDATE_EVENT_STATE === 1 || param.$variables.UPDATE_EVENT_STATE === undefined) {
        // !!!don't touch this horror
        if(disabledEventsCache.has(OCID)) {
            if(disabledEventsCache.get(OCID).disableUntil < Date.now()) {
                enableEvents(db, {events: [{OCID: OCID}]});
            }
            else {
                if(isEventDisabled(disabledEventsCache.get(OCID).intervals)) {
                    if(!eventsCache.has(OCID)) {
                        log.info('Disabled event occurred: ', param.$variables.OBJECT_NAME,
                            '(', param.$variables.COUNTER_NAME, '): importance: ',
                            param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(),
                            ', parentOCID: ', param.$parentID,
                            ', OCID: ', OCID, ', disabled: ', disabledEventsCache.get(OCID), ' for ', dbPath);
                    }
                    return callback();
                }
            }
        }

        if(!eventsCache.has(OCID)) {
            log.info('Event occurred: ', param.$variables.OBJECT_NAME, '(', param.$variables.COUNTER_NAME, '): importance: ',
                param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', param.$parentID,
                ', OCID: ', OCID, ' for ', dbPath);
        }

        var newEventID = onEvent(db, OCID, param.$objectID, param.$counterID, param.$variables.OBJECT_NAME,
            param.$variables.COUNTER_NAME, param.$parentID, param.importance, param.eventDescription,
            eventTimestamp, param.$dataTimestamp, param.pronunciation);

        var runTaskOnProblem = confSettings.get('runTaskOnProblem');
        if(Number(param.problemTaskID) && runTaskOnProblem) {
            taskServer.runTask({
                userName: systemUser,
                taskID: param.problemTaskID,
                variables: param.$variables,
                runTaskFrom: 'eventGenerator'
            },function(err) {
                if(err) log.error(err.message, ' for ', dbPath);
            });
        }
/*
// !!! moved to collector.js
        if(Number(param.eventDuration) === parseInt(String(param.eventDuration), 10)) {
            param.eventDuration = Number(param.eventDuration);

            setTimeout(function(newEventID, param, callback) {
            /// ??? solveEvent(param, eventTimestamp)
                callback(solveEvent(param, eventTimestamp), newEventID ? 1 : undefined);
                param.$variables.UPDATE_EVENT_STATE = 0;
                eventGenerator.get(param, callback);
                }, (!param.eventDuration || param.eventDuration < 1 ? 0 : param.eventDuration * 1000),
                newEventID, param, callback);
            return;
        }
*/
        // save new event to history database too
        if(newEventID) callback(null, 1);
        else callback();
    } else if(param.$variables.UPDATE_EVENT_STATE === 0) {
        callback(solveEvent(param, eventTimestamp), 0);
    } else {
        callback(new Error('Can\'t generate event: incorrect variable value for UPDATE_EVENT_STATE (' +
            param.$variables.UPDATE_EVENT_STATE + ') can be "1|0|undefined" for ' +
            param.$variables.OBJECT_NAME + '->' + param.$variables.PARENT_OBJECT_NAME + ': parent counter "' +
            (param.$variables.PARENT_COUNTER_NAME  || 'Undefined parent counter: ' +
                param.$variables.PARENT_COUNTER_NAME) + '" value: ' + param.$variables.PARENT_VALUE));
    }
}

function solveEvent(param, eventTimestamp) {
    const OCID = Number(param.$id);
    if(eventsCache.has(OCID)) {
        log.info('Event solved: ', param.$variables.OBJECT_NAME, '(', param.$variables.COUNTER_NAME, '): importance: ',
            param.importance, ', time: ', new Date(eventTimestamp).toLocaleString(), ', parentOCID: ', param.$parentID,
            ', OCID: ', OCID, ' for ', dbPath);
    } else var dontRunTask = true;

    onSolvedEvent(db, OCID, eventTimestamp);

    if(disabledEventsCache.has(OCID) && disabledEventsCache.get(OCID).disableUntil < Date.now()) {
        enableEvents(db, {events: [{OCID: OCID}]});
    }

    var runTaskOnSolve = confSettings.get('runTaskOnSolve');
    if(runTaskOnSolve &&
        (!disabledEventsCache.has(OCID) || !isEventDisabled(disabledEventsCache.get(OCID).intervals)) &&
        Number(param.solvedTaskID) && !dontRunTask) {
        taskServer.runTask({
            userName: systemUser,
            taskID: param.solvedTaskID,
            variables: param.$variables,
            runTaskFrom: 'eventGenerator',
        },function(err) {
            if(err) log.error(err.message, ' for ', dbPath);
        });
    }

    // 0 save solved event to history database too
    return null;
}


eventGenerator.removeCounters = function(OCIDs, callback) {
    OCIDs.forEach(OCID => {
        if(!eventsCache.has(Number(OCID))) return;

        log.info('Remove OCID: ', OCID, ' from event-generator collector for ', dbPath);
        onSolvedEvent(db, OCID, Date.now());
    });
    if(typeof callback == 'function') callback();
};

eventGenerator.destroy = function(callback) {
    log.warn('Destroying collector event-generator for ', dbPath);
    eventsCache.clear();
    try {
        db.close();
    } catch (err) {
        log.error('Can\'t close database: ', err.message, ' for ', dbPath);
    }
    if(typeof callback == 'function') callback();
    setTimeout(process.exit, 100);
};

function addToQueue(param, callback) {

    if(param.action) {
        collectorHighPriorityActionsQueue.add({
            param: param,
            callback: callback
        });
    } else {
        collectorActionsQueue.add({
            param: param,
            callback: callback
        });
    }

    var eventProcessingToSlow = Date.now() - isEventProcessedOrNotInitialized >
        ((confSettings.get('maxEventProcessingTime') || 30000) * 1000);

    if((collectorActionsQueue.size > 100 &&
            Math.round(collectorActionsQueue.size / 10) === collectorActionsQueue.size / 10) ||
        (collectorHighPriorityActionsQueue.size > 10 &&
            Math.round(collectorHighPriorityActionsQueue.size / 10) === collectorHighPriorityActionsQueue.size / 10) ||
        eventProcessingToSlow
    ) {
        log.warn((eventProcessingToSlow ? 'Event processing is slow. ' : ''),
            'Events actions queue: ',
            collectorHighPriorityActionsQueue.size, '; write events queue: ', collectorActionsQueue.size,
            (prevEventNum ? '; processing speed: ' +
                Math.round((eventNum - prevEventNum) / (Date.now() - prevErrorTime) / 1000 ) + ' events/sec.' : ''),
            '; last event processed: ', (Date.now() - isEventProcessedOrNotInitialized), 'ms',
            (Date.now() - isEventProcessedOrNotInitialized > 5000 ? '; last event params: ' + processedEventParam : ''),
            ' for ', dbPath
        );
        if(eventProcessingToSlow) isEventProcessedOrNotInitialized = 0;
        prevEventNum = eventNum;
        prevErrorTime = Date.now();

    } else {
        prevEventNum = prevErrorTime = 0;
    }
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
        var OCID = Number(event.OCID);
        // make it at first for immediately enable events when function called without callback
        if (disabledEventsCache.has(OCID)) disabledEventsCache.delete(OCID);
        else {
            log.error('Can\'t enable event for OCID: ' + OCID +
                ': event not exist in the list of disabled events for ', dbPath);
        }
        try {
            db.prepare('DELETE FROM disabledEvents WHERE OCID=?').run(OCID);
        } catch (err) {
            return log.warn('Can\'t enable event for OCID ' + OCID + ': ',
                disabledEventsCache.get(OCID), ': ' + err.message);
        }
    });
}

function onEvent(db, OCID, objectID, counterID, objectName, counterName, parentOCID, importance, eventDescription,
                 eventTimestamp, dataTimestamp, pronunciation) {
    OCID = Number(OCID)
    var eventID = eventsCache.get(OCID);
    if(eventID && dataTimestamp) { // dataTimestamp - check for run not from eventEditor
        repeatEventsCache.set(eventID, {
            eventID: eventID,
            data: eventDescription || null,
            timestamp: eventTimestamp,
            pronunciation: pronunciation
        });
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
        return log.warn('Can\'t add event with OCID: ' + OCID + ' into events table event database: ' +
            err.message + ' data: ', queryParameter);
    }
    // do not save eventID to the eventsCache when event generated by eventsEditor (dataTimestamp = 0)
    if(dataTimestamp) eventsCache.set(OCID, Number(info.lastInsertRowid));

    return info.lastInsertRowid; // return new event ID
}

function onSolvedEvent(db, OCID, timestamp) {
    OCID = Number(OCID)
    var eventID = eventsCache.get(OCID);
    if(!eventID) {
        //log.debug('Can\'t add event end time for OCID: ' + OCID + ' into events table: Opened event with current OCID does not exist');
        // it's not an error. it can be when previous state of trigger is unknown, and new state is false
        // do nothing
        return;
    }

    eventsCache.delete(OCID);
    try {
        db.prepare('UPDATE events set endTime=$endTime WHERE id=$eventID').run({
            endTime: timestamp,
            eventID: eventID,
        });
    } catch(err) {
        return log.warn('Can\'t add event end time (' + timestamp + ') with eventID ' + eventID +
            ', OCID: ' + OCID + ' into events table event database: ' + err.message);
    }
}

function saveRepeatedEventsToCache() {
    if (!repeatEventsCache.size) return;

    var savedEventsCnt = 0;
    repeatEventsCache.forEach((item, eventID) => {
        repeatEventsCache.delete(eventID);

        try {
            db.prepare('UPDATE events set data=$data, timestamp=$timestamp, pronunciation=$pronunciation WHERE id=$eventID')
                .run(item);
            ++savedEventsCnt;
        } catch (err) {
            log.error('Can\'t update cached event data with eventID ' + item.eventID +
                ' data: ' + item.data + ', timestamp: ' + (new Date(item.timestamp)).toLocaleString() +
                ' into events table event database: ' + err.message + ' for ' + dbPath);
        }
    });

    if (savedEventsCnt > 2) log.info('Adding ', savedEventsCnt, ' cached repeated events to events table for ', dbPath);
}