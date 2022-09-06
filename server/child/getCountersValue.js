/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../../lib/log')(module);

const async = require('async');
const calc = require('../../lib/calc');
const variablesReplace = require('../../lib/utils/variablesReplace');
const initCache = require('./initCache');
//const profiling = require('../lib/profiling');

const history = require('../../models_history/history');
const debugCounters = require('../../serverDebug/debugCounters');
const taskServer = require('../../serverTask/taskServerClient');

const thread = require('../../lib/threads');
const getVars = require('./getVars');
const connectingCollectors = require('./connectingCollectors');

const serverName = thread.workerData[0];
const childID = thread.workerData[1];
var childThread;
var cacheAndCollectorsInitialized = false;
var messageCache = new Set();
var collectorsObj = {};

var cache = {
    countersObjects: {},
    objectsProperties: new Map(),
    variablesExpressions: new Map(),
    variablesHistory: new Map(),
};

// init history and debugCounters communication
history.connect(childID, function () {
    debugCounters.connect(function () {
        childThread = new thread.child({
            module: 'getCountersValue-' + serverName,
            onMessage: processMessage,
            onStop: destroyCollectors,
            onDestroy: destroyCollectors,
        });
    });
});

//profiling.init(60);

function processMessage(message, callback) {
    //log.debug('Child ' + process.pid + ' receive message', message);

    if (!message) {
        if (typeof callback === 'function') {
            log.info('Receiving empty message with callback');
            callback();
        } else log.info('Receiving empty message without callback');
        return;
    }

    // init cache
    if (message.countersObjects || message.variablesHistory || message.variablesExpressions || message.objectsProperties) {
        cache = initCache(message, cache);

        calc.initCache({
            countersObjects: cache.countersObjects,
            objectsProperties: cache.objectsProperties,
        });

        connectingCollectors(function (err, _collectors) {
            if (err) {
                destroyCollectors(function() {
                    log.error('Can\'t init collectors: ' + err.message);
                });
                return;
            }
            if (_collectors) collectorsObj = _collectors;

            // cache initializing. processing cached messages
            if (!cacheAndCollectorsInitialized) {
                cacheAndCollectorsInitialized = true;
                messageCache.forEach(processMessage);
                messageCache.clear();
            }
        });

        return;
    }

    // we can't process messages while cache is not initializing. Push messages in message cache
    if (!cacheAndCollectorsInitialized) {
        messageCache.add(message);
        return;
    }


    if ('OCID' in message) {
        //profiling.start('Full cycle', message);
        getVariablesAndCheckUpdateEvents(message);
        return;
    }

    if ('result' in message) {
        processCollectorResult(message.err, message.result, message.parameters, message.collectorName);
        return;
    }

    // message: { removeCounters: [<OCID1>, OCID2, ...] }
    if (message.removeCounters && message.removeCounters.length) {
        var OCIDs = message.removeCounters; // array of OCIDs

        async.eachOf(collectorsObj, function (collector, name, callback) {
            if (typeof collector.removeCounters !== 'function') return callback();

            log.debug('Collector ', name, ' has a removeCounters method, executing removeCounters for OCIDs: ', OCIDs);
            collector.removeCounters(OCIDs, function (err) {
                if (err) return log.error('Error executing ', name, '.removeCounters method for OCIDs ', OCIDs, ': ', err.message);
                callback();
                //log.debug('Counters with OCID ', OCIDs, ' are removed for collector ', name);
            });
        }, function () {
            if (typeof callback === 'function') callback();
        });
        return;
    }

    if (message.throttlingPause) {
        async.eachOf(collectorsObj, function (collector, name, callback) {
            if (typeof collector.throttlingPause !== 'function') return callback();

            log.debug('Collector ', name, ' has a throttlingPause method, executing throttlingPause ', message.throttlingPause);
            collector.throttlingPause(message.throttlingPause, function (err) {
                if (err) return log.error('Error executing ', name, '. message.throttlingPause method: ', err.message);
                callback();
            });
        }, function () {
            if (typeof callback === 'function') callback();
        });
        return;
    }

    log.warn('Receiving unknown message ', message);
}

function destroyCollectors(callback) {
    log.warn('Destroying child with PID: ', process.pid);

    // destroy collectors, with 'destroy' function
    async.eachOf(collectorsObj, function (collector, name, callback) {

        // don\'t destroy active and separate collectors. it destroyed from server
        if (collector.active || collector.separate ||
            !collector.destroy || typeof collector.destroy !== 'function') return callback();

        log.debug('Collector ', name, ' has a destroy method, destroying collector: ', collector);
        collector.destroy(function (err) {
            if (err) log.warn('Error destroying collector ', name, ': ', err.message);
            else log.warn('Collector ', name, ' was destroyed');

            callback();
        });
    }, callback); // error is not returned
}
// dont return without sending execution result to the parent
function sendCompleteExecutionResult(param) {
    childThread.send({
        parentOCID: param.parentOCID,
        OCID: param.OCID,
        updateEventState: param.updateEventState,
    });
}

function getVariablesAndCheckUpdateEvents(message) {

    var counterParameters = [],
        updateEventState = message.updateEventState;

    try {
        var countersObjects = cache.countersObjects;
        var parentOCIDObj = countersObjects.OCIDs.get(message.parentOCID);
        var OCIDObj = countersObjects.OCIDs.get(message.OCID);
        var objectID = OCIDObj.objectID;
        var counterID = OCIDObj.counterID;
        var counter = countersObjects.counters.get(counterID);
    } catch (e) {
        log.error('Can\'t get counter data: ', e.message, ', msg: ', message);
        return sendCompleteExecutionResult({
            parentOCID: message.parentOCID,
            OCID: message.OCID,
        });
    }

    // make full independent copy of counter parameters for make possible to modifying it in the future
    if (cache.countersObjects && cache.countersObjects.counters &&
        cache.countersObjects.counters.has(counterID) &&
        Array.isArray(cache.countersObjects.counters.get(counterID).counterParams)
    ) {
        cache.countersObjects.counters.get(counterID).counterParams.forEach(function (param) {
            counterParameters.push({
                name: param.name,
                value: param.value,
            });
        });
    }

    if (!collectorsObj[message.collector] || typeof collectorsObj[message.collector].get !== 'function') {
        log.options('Collector "', message.collector, '" undefined or object "get" is not a function (',
            collectorsObj[message.collector] || ('collectors list: ' + Object.keys(collectorsObj).join(', ')),
            '), objectCounterID: ', message.OCID, ': ', counterParameters, {
                filenames: ['counters/' + message.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });

        if (!Object.keys(collectorsObj).length) {
            log.exit('Collectors cache is unexpected empty. Exiting');
            destroyCollectors(function () {
                log.disconnect(function () {
                    process.exit(2)
                });
            });
        }
        return sendCompleteExecutionResult({
            parentOCID: message.parentOCID,
            OCID: message.OCID,
        });
    }

    var param = {
        removeCounter: message.removeCounter,
        parentVariables: message.parentVariables,
        prevUpdateEventState: updateEventState,
        parentObjectValue: message.parentObjectValue,
        countersObjects: countersObjects,
        variablesDebugInfo: {},
        //updateEventExpression: counter.updateEventExpression,
        //updateEventMode: counter.updateEventMode,
        updateEventExpression: message.updateEventExpression,
        updateEventMode: message.updateEventMode,
        OCID: message.OCID,
        parentOCID: message.parentOCID,
        parentObjectName:  parentOCIDObj ? countersObjects.objects.get(parentOCIDObj.objectID) : undefined,
        parentCounterName: parentOCIDObj ? countersObjects.counters.get(parentOCIDObj.counterID).counterName : undefined,
        objectName: countersObjects.objects.get(objectID),
        counterName: counter.counterName,
        objectID: objectID,
        counterID: counterID,
        collector: counter.collector,
        taskCondition: counter.taskCondition,
        debug: counter.debug,
        cache: {
            variablesHistory: cache.variablesHistory.get(counterID) || new Map(),
            variablesExpressions: cache.variablesExpressions.get(counterID) || new Map(),
            objectsProperties: cache.objectsProperties.get(objectID) || new Map(),
        },
    };

    //profiling.start('1. get variables values', message);
    //log.info(cache.variablesHistory.get(Number(counter.counterID)))
    //log.info(cache.variablesExpressions.get(Number(counter.counterID)))
    //log.info(cache.objectsProperties.get(Number(counter.objectID)))
    /*
    message = {
        parentVariables
        updateEventState
        parentObjectValue
        OCID
        parentOCID
        updateEventExpression
        updateEventMode
        removeCounter
    }
     */
    getVars(param, function (err, noNeedToCalculateCounter, variables, variablesDebugInfo, preparedCollectorParameters) {

        if (param.debug) {
            debugCounters.add('v', param.OCID, variablesDebugInfo,
                variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important);
        }

        param.updateEventState = variables.UPDATE_EVENT_STATE;
        //profiling.stop('1. get variables values', message);
        //profiling.start('2. prepare to get counter value', message);

        // send UPDATE_EVENT_STATE anyway if previous updateEventState is not equal to new updateEventState,
        // because after the child may have nothing to send to the server
        /*
        if (param.parentOCID && param.updateEventExpression &&
            updateEventState !== variables.UPDATE_EVENT_STATE &&
            variables.UPDATE_EVENT_STATE !== undefined) {
        //if (param.parentOCID && param.updateEventExpression && variables.UPDATE_EVENT_STATE !== undefined) {
            childThread.send({
                parentOCID: param.parentOCID,
                OCID: param.OCID,
                updateEventState: variables.UPDATE_EVENT_STATE,
            });
            //if(counterID === 211 || counterID === 257) log.warn(param.counterName, ' send: updateEventState: ', updateEventState ,'=>', variables.UPDATE_EVENT_STATE, ': ', noNeedToCalculateCounter, ': ', param.parentOCID, '-', param.OCID, ': ', param.updateEventExpression);
        }
        */
        //if(counterID === 211 || counterID === 257) log.warn(param.counterName, ': updateEventState: ', updateEventState ,'=>', variables.UPDATE_EVENT_STATE, ': ', noNeedToCalculateCounter, ': ', param.parentOCID, '-', param.OCID, ': ', param.updateEventExpression);
        if (err) {
            log.options(err.message, {
                filenames: ['counters/' + param.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'I'
            });
            return sendCompleteExecutionResult(param);
        }
        if(noNeedToCalculateCounter) return sendCompleteExecutionResult(param);

        if (variables && Object.keys(variables).length) {

            if (variablesDebugInfo.UPDATE_EVENT_STATE &&
                variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables &&
                variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length) {

                for (var i = 0; i < variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length; i++) {
                    // checking for %:?<name>:%
                    if (variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables[i].charAt(2) !== '?') {
                        log.options('Skip update event with unresolved variables for ',
                            param.objectName, '(', param.counterName, '): ', param.updateEventExpression,
                            ', unresolved variables: ',
                            variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.join(', '),
                            ', OCID: ', param.OCID, {
                                filenames: ['counters/' + param.counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'I'
                            });

                        return sendCompleteExecutionResult(param);
                    }
                }
            }
        }

        param.collectorParameters = preparedCollectorParameters;
        getValue(param);
    });
}

function getValue(param) {
    if (!param.collector || !collectorsObj[param.collector]) {
        log.options('Try to get value for an unknown collector for ',
            param.objectName,
            '(', param.counterName, '): collector: "', param.collector,
            '"; param: ', param, {
                filenames: ['counters/' + param.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
        return sendCompleteExecutionResult(param);
    }

    //log.debug('Try to get value for ', param.objectName , '(', param.counterName, '): ', param);

    //Try to catch errors in collector code
    //profiling.stop('2. prepare to get counter value', param);
    //profiling.start('2. get counter value', param);
    try {
        if (param.removeCounter && collectorsObj[param.collector] &&
            typeof collectorsObj[param.collector].removeCounters === 'function') {
            //log.info(param.removeCounter, ' now processed but required for update. Removing...');
            collectorsObj[param.collector].removeCounters([param.OCID], function (err) {
                if (err) {
                    log.error('Error executing removeCounter method for ', param.counterName ,
                        '(', param.objectName, ', collector:', param.collector, '): ', err.message);
                }

                //log.info('Getting data for ', param.removeCounter, ' after removing...');
                collectorsObj[param.collector].get(param.collectorParameters, function (err, result) {
                    processCollectorResult(err, result, param, param.collector);
                });
            });
        } else {
            collectorsObj[param.collector].get(param.collectorParameters, function (err, result) {
                processCollectorResult(err, result, param, param.collector);
            });
        }
    } catch (err) {
        log.options('Error in collector code ', param.collector, ' ', param.collectorParameters, ' for OCID ',
            param.OCID,
            ': ', param.objectName,
            '(', param.counterName, '): ', err.stack, {
                filenames: ['counters/' + param.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
        return sendCompleteExecutionResult(param);
    }
}

/**
 * Process collector result
 * @param {Error} err - collector error
 * @param {{value: number|string|boolean|undefined|null, timestamp: number}|?number|string|boolean|undefined} result - collector result
 * @param {Object} param - initial parameters for get collector result
 * @param {string} collectorName collector name
 */
function processCollectorResult(err, result, param, collectorName) {
    if (!param.collector) {
        try {
            param = {
                parentOCID: param.$parentID,
                OCID: param.$id,
                collector: collectorName,
                collectorParameters: param,
                counterName: param.$variables.COUNTER_NAME,
                objectName: param.$variables.OBJECT_NAME,
                counterID: param.$counterID,
                objectID: param.$objectID,
                updateEventState: param.updateEventState,
            }
        } catch (err) {
            log.error('Can\'t init param: ' + err.message + '; ' + JSON.stringify(param))
            return sendCompleteExecutionResult(param);
        }
    }

    /*
    if(!param.collector || !collectorsObj[param.collector]) {
        console.log('err, result, param, collectorName: ',
            err, '; ', result, '; ', param, '; ', collectorName, '; ', Object.keys(collectorsObj))
    }
    */


    /*
    log.options('Receiving value from OCID ', param.OCID, ': ',
        param.objectName,
        '(', param.counterName, '): ', result, '; err: ',
        (err && err.stack ? err.stack : err), ', task condition: ', param.taskCondition,
        ', collector: ', param.collector, '(', param.collectorParameters, ')', {
            filenames: ['counters/' + param.counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });
     */

    //if(Number(param.OCID) === 3428) log.warn('Getting record ', result, ': ', param);

    // result was saved to the history in activeCollector.js for active and separate collectors
    // for decrees number of transfers of result value
    var preparedResult = collectorsObj[param.collector].active || collectorsObj[param.collector].separate ?
        result : history.add(param.OCID, result);

    if (param.taskCondition) {
        taskServer.checkCondition(param.OCID, preparedResult, param.objectName, param.counterName);
    }

    if (!preparedResult || preparedResult.value === undefined || preparedResult.value === null) {
        if (err) {
            log.options('Collector ', param.collector, ' return error and result ', result, ' for OCID: ',
                param.OCID, ': ',
                param.objectName,
                '(', param.counterName, '): ',
                (err.stack || JSON.stringify(err)), '; Parameters: ', param.collectorParameters, {
                    filenames: ['counters/' + param.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
                });
        } // else return nothing, skip it
        return sendCompleteExecutionResult(param);
    } else if (err) {
        log.options('Collector ', param.collector, ' return error for OCID: ', param.OCID, ': ',
            param.objectName,
            '(', param.counterName,
            '); result: ', result, '; Error: ', err.message,
            '; Parameters: ', param.collectorParameters, {
                filenames: ['counters/' + param.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'W'
            });
    }

    //profiling.stop('2. get counter value', param);
    //profiling.start('3. get depended counters', param);
    // dependedCounters: [{parentObjectName:.., parentCollector:.., OCID: <objectsCountersID>, collector:<collectorID>,
    //     counterID:.., objectID:..,
    //     objectName:.., expression:..., mode: <0|1|2>}, {...}...]
    //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
    //     2 - update once when expression set to true, then once, when expression set to false
    var dependedCounters = getCountersForDependedCounters(param.counterID, param.objectID, param.OCID,
        param.collectorParameters.$variables);

    if (!dependedCounters || !dependedCounters.length) {
        // send process ID to server


        /*
        log.options('Received value[s] ', preparedResult.value, ' from: ',
            param.objectName,
            '(', param.counterName, '), depended on counters not found', {
                filenames: ['counters/' + param.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
        });
         */
        return sendCompleteExecutionResult(param);
    }

    /*
    message = {
        parentVariables
        updateEventState
        parentObjectValue
        OCID
        parentOCID
        updateEventExpression
        updateEventMode
        removeCounter
    }
     */
/*
    // !!!!!
    // Need to get previous updateEventState from the server. Here you can only get updateEventState of the parent counter
    // and checking that the collection for this OCID is no longer running or it does not have a parameter runCollectorSeparately

    if(dependedCounters.length === 1 && (!Array.isArray(preparedResult.value) || preparedResult.value.length === 1)) {
        var parentValue = Array.isArray(preparedResult.value) ? preparedResult.value[0] : preparedResult.value;

        // can be received from collector JavaScript
        if (typeof parentValue === 'object') parentValue = JSON.stringify(parentValue);
        else if(parentValue instanceof Set) parentValue = JSON.stringify(Array.from(parentValue));
        else if(parentValue instanceof Map) parentValue = JSON.stringify(Object.fromEntries(parentValue));

        var message = dependedCounters[0];
        message.updateEventState = ???
        message.parentVariables = param.collectorParameters.$variables;
        message.parentObjectValue = parentValue;
if(param.OCID === 155273) log.warn(param.counterName, ' recalculate: updateEventState: ', param.collectorParameters.$variables.UPDATE_EVENT_STATE);
        return getVariablesAndCheckUpdateEvents(message);
    }
 */

    var returnedMessage = {
        parentOCID: param.parentOCID ? param.parentOCID : undefined,
        OCID: param.OCID,
        variables: param.collectorParameters.$variables,
        dependedCounters: dependedCounters,
        value: preparedResult.value,
        updateEventState: param.updateEventState,
    };

    //profiling.stop('3. get depended counters', param);
    //profiling.start('4. send data to server', param);

    childThread.send(returnedMessage);

    //profiling.stop('Full cycle', returnedMessage);
    //profiling.stop('4. send data to server', param);
}


function getCountersForDependedCounters(parentCounterID, parentObjectID, parentOCID, variables) {
    if (!cache.countersObjects.counters) return;

    var parentCounter = cache.countersObjects.counters.get(parentCounterID);
    if (!parentCounter || !parentCounter.dependedUpdateEvents.size) return;

    var dependedCounters = [], updateEvents = parentCounter.dependedUpdateEvents;
    for (var [counterID, updateEvent] of updateEvents) {
        var counter = cache.countersObjects.counters.get(counterID);
        if (!counter || (updateEvent.parentObjectID && updateEvent.parentObjectID !== parentObjectID)) continue;

        if (updateEvent.objectFilter) {
            var res = variablesReplace(updateEvent.objectFilter, variables);
            if (res) {
                if (res.unresolvedVariables.length) {
                    log.options(variables.OBJECT_NAME, '(', variables.COUNTER_NAME,
                        '): object filter "', updateEvent.objectFilter,
                        '" in update event contain an unresolved variables: ', res.unresolvedVariables, {
                            filenames: ['counters/' + parentCounterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'W'
                        });
                    continue;
                }
                var objectFilter = res.value;
            } else objectFilter = updateEvent.objectFilter;

            try {
                var objectFilterRE = new RegExp(objectFilter, 'i');
            } catch (e) {
                log.options(variables.OBJECT_NAME, '(', variables.COUNTER_NAME,
                    '): object filter "', updateEvent.objectFilter,
                    '" in update event is not a regular expression: ', e.message, {
                        filenames: ['counters/' + parentCounterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'W'
                    });
                continue;
            }
        }

        var objectsIDs = updateEvent.parentObjectID ? counter.objectsIDs : new Map([[parentObjectID, 0]]);
        for (var objectID of objectsIDs.keys()) {
            var objectName = cache.countersObjects.objects.get(objectID);
            if (!objectName || !counter.objectsIDs.has(objectID) || (objectFilter && !objectFilterRE.test(objectName))) continue;

            dependedCounters.push({
                parentOCID: parentOCID,
                OCID: counter.objectsIDs.get(objectID),
                collector: counter.collector, // required for check for runCollectorSeparately
                updateEventExpression: updateEvent.expression,
                updateEventMode: updateEvent.mode,
            });
        }
    }
    //log.warn('Returned props: ', dependedCounters, ': ', cache.countersObjects.counters.get(Number(parentCounterID)));
    return dependedCounters;
}