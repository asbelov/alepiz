/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../../lib/log')(module);

const async = require('async');
const calc = require('../../lib/calc');
const variablesReplace = require('../../lib/utils/variablesReplace');
const initCache = require('./initCache');
//const profiling = require('../lib/profiling');
const history = require('../../serverHistory/historyClient');
const debugCounters = require('../../serverDebug/debugCounters');
const taskServer = require('../../serverTask/taskServerClient');
const thread = require('../../lib/threads');
const getVars = require('./getVars');
const connectingCollectors = require('./connectingCollectors');
const Conf = require("../../lib/conf");

const confServer = new Conf('config/server.json');

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
        taskServer.connect(childID, function(err) {
            if(err) log.error('Can\'t connect to the task server: ', err.message);
            childThread = new thread.child({
                module: 'getCountersValue-' + serverName,
                onMessage: processMessage,
                onStop: destroyCollectors,
                onDestroy: destroyCollectors,
            });
        });
    });
}, confServer.get('dontConnectToRemoteHistoryInstances'));

//profiling.init(60);

function processMessage(message, callback) {
    //log.debug('Child ' + process.pid + ' receive message', message);

    if (!message) {
        if (typeof callback === 'function') {
            log.warn('Receiving empty message with callback');
            callback();
        } else log.warn('Receiving empty message without callback');
        return;
    }

    // init or update cache
    if (message.countersObjects || message.variablesHistory || message.variablesExpressions || message.objectsProperties) {
        cache = initCache(message, cache);

        calc.initCache({
            countersObjects: cache.countersObjects,
            objectsProperties: cache.objectsProperties,
        });

        if(cacheAndCollectorsInitialized) return;

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
                if(messageCache.size) {
                    log.info('Processing ', messageCache.size, ' messages, which received before cache initialization');
                    messageCache.forEach(processMessage);
                    messageCache.clear();
                }
            }
        });

        return;
    }

    // We can't process messages until the cache is initialized. Adding message to the message cache
    if (!cacheAndCollectorsInitialized) {
        messageCache.add(message);
        return;
    }

    // received request to calculate counter for OCID (if present message.removeCounters, then update counters first)
    if ('OCID' in message) {
        //profiling.start('Full cycle', message);
        getVariablesAndCheckUpdateEvents(message);
        return;
    }

    // received result from parent active collector
    if ('result' in message) {
        processCollectorResult(message.err, message.result, message.parameters, message.collectorName);
        return;
    }

    // received request for remove counters without calculation
    // message: { removeCounters: [<OCID1>, OCID2, ...] }
    if (message.removeCounters && message.removeCounters.length) {
        var OCIDs = message.removeCounters; // array of OCIDs

        async.eachOf(collectorsObj, function (collector, name, callback) {
            if (typeof collector.removeCounters !== 'function') return callback();

            log.debug('Collector ', name, ' has a removeCounters method, executing removeCounters for OCIDs: ', OCIDs);
            collector.removeCounters(OCIDs, function (err) {
                if (err) {
                    return log.error('Error executing ', name, '.removeCounters method for OCIDs ', OCIDs, ': ', err.message);
                }
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

            log.debug('Collector ', name, ' has a throttlingPause method, executing throttlingPause ',
                message.throttlingPause);
            collector.throttlingPause(message.throttlingPause, function (err) {
                if (err) {
                    return log.error('Error executing ', name, '. message.throttlingPause method: ', err.message);
                }
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
/**
 * Send execution result to the parent on error or interrupt counter calculation.
 * Dont call return without sending execution result to the parent
 *
 * @param {Object} param object with parentOCID and OCID
 * @param {number} param.parentOCID parent OCID
 * @param {number} param.OCID OCID
 */
function sendCompleteExecutionResult(param) {
    childThread.send({
        parentOCID: param.parentOCID,
        OCID: param.OCID,
    });
}

/**
 * Starting counter calculation
 *
 * @param {Object} message message from another active collector
 * @param {0|1} message.updateEventState update event state
 * @param {number} message.parentOCID parent OCID
 * @param {number} message.OCID OCID
 * @param {string} message.collector collector name
 * @param {number} message.counterID counter ID
 * @param {Array} message.removeCounter Array of the OCIDs for remove
 * @param {Object} message.parentVariables Object with variables from parent counter like
 * {<variableName1>: <variableValue1>, ....}
 * @param {number|string} message.parentObjectValue value from parent counter
 * @param {string} message.updateEventExpression update event expression
 * @param {number} message.updateEventMode update event mode
 */
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
        log.error('Can\'t get cached counter data: ', e.message, ', for counter: ', message);
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
                filenames: ['counters/' + message.counterID, 'counters'],
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
        debug: counter.debug,
        countersObjects: {}, // will set letter after print debug info
        cache: {
            variablesHistory: cache.variablesHistory.get(counterID) || new Map(),
            variablesExpressions: cache.variablesExpressions.get(counterID) || new Map(),
            objectsProperties: cache.objectsProperties.get(objectID) || new Map(),
            alepizInstance: cache.alepizInstance || {},
        },
    };

    //profiling.start('1. get variables values', message);

    log.debug('getVariablesAndCheckUpdateEvents for OCID ', param.OCID, ' counter parameters: ', param, {
        expr: '%:RECEIVED_OCID:% == %:OCID:%',
        vars: {
            "RECEIVED_OCID": param.OCID
        }
    });

    param.countersObjects = countersObjects;
    getVars(param,function (err, noNeedToCalculateCounter, variables, variablesDebugInfo, preparedCollectorParameters) {

        if (param.debug) {
            debugCounters.add('v', param.OCID, variablesDebugInfo,
                variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important);
        }

        //profiling.stop('1. get variables values', message);
        //profiling.start('2. prepare to get counter value', message);

        // send UPDATE_EVENT_STATE anyway if previous updateEventState is not equal to new updateEventState,
        // because after the child may have nothing to send to the server
        // was if (param.parentOCID && param.updateEventExpression && variables.UPDATE_EVENT_STATE !== undefined) {
        if (param.parentOCID && param.updateEventExpression &&
            updateEventState !== variables.UPDATE_EVENT_STATE &&
            variables.UPDATE_EVENT_STATE !== undefined) {
            childThread.send({
                parentOCID: param.parentOCID,
                OCID: param.OCID,
                updateEventState: variables.UPDATE_EVENT_STATE,
            });

            log.debug('getVariablesAndCheckUpdateEvents for OCID ', param.OCID,
                '\n send: updateEventState: ', updateEventState ,'=>', variables.UPDATE_EVENT_STATE,
                ',\n noNeedToCalculateCounter: ',  noNeedToCalculateCounter,
                ',\n parentOCID-OCID: ', param.parentOCID, '-', param.OCID,
                ',\n updateEventExpression: ', param.updateEventExpression,
                ',\n vars: ', variables,
                ',\n variablesDebugInfo: ', variablesDebugInfo,
                ',\n preparedCollectorParameters: ', preparedCollectorParameters, {
                    expr: '%:RECEIVED_OCID:% == %:OCID:%',
                    vars: {
                        "RECEIVED_OCID": param.OCID
                    }
                });
        }

        if (err) {
            log.options(err.message, ',\n variablesDebugInfo: ', variablesDebugInfo, {
                filenames: ['counters/' + param.counterID, 'counters'],
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
                                filenames: ['counters/' + param.counterID, 'counters'],
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
                filenames: ['counters/' + param.counterID, 'counters'],
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

            log.debug('getValue for OCID ', param.OCID, ': ', param.removeCounter,
                ' now processed but required for update. Removing...', {
                    expr: '%:RECEIVED_OCID:% == %:OCID:%',
                    vars: {
                        "RECEIVED_OCID": param.OCID
                    }
                });

            collectorsObj[param.collector].removeCounters([param.OCID], function (err) {
                if (err) {
                    log.error('Error executing removeCounter method for ', param.counterName ,
                        '(', param.objectName, ', collector:', param.collector, '): ', err.message);
                }

                log.debug('getValue for OCID ', param.OCID, 'Getting data for ', param.removeCounter,
                    ' after removing...', {
                        expr: '%:RECEIVED_OCID:% == %:OCID:%',
                        vars: {
                            "RECEIVED_OCID": param.OCID
                        }
                    });

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
                filenames: ['counters/' + param.counterID, 'counters'],
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
            }
        } catch (err) {
            log.error('Can\'t init param: ' + err.message + '; ' + JSON.stringify(param))
            return sendCompleteExecutionResult(param);
        }
    }

    var taskCondition = cache.countersObjects.counters.get(param.counterID) &&
        cache.countersObjects.counters.get(param.counterID).taskCondition;

    // result was saved to the history in activeCollector.js for active and separate collectors
    // for decrees number of transfers of result value
    var preparedResult = collectorsObj[param.collector].active || collectorsObj[param.collector].separate ?
        result : history.add(param.OCID, result);

    log.debug('processCollectorResult for OCID ', param.OCID, ' return ', result, '(', preparedResult, '); param: ', param,
        '; taskCondition: ', taskCondition, '; err: ', err, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": param.OCID
            }
        });

    if (taskCondition && preparedResult) {
        taskServer.checkCondition(param.OCID, param.objectName, param.counterName);
    }

    if (!preparedResult || preparedResult.value === undefined || preparedResult.value === null) {
        if (err) {
            log.options('Collector ', param.collector, ' return error and result ', result, ' for OCID: ',
                param.OCID, ': ',
                param.objectName,
                '(', param.counterName, '): ',
                (err.stack || JSON.stringify(err)), '; Parameters: ', param.collectorParameters, {
                    filenames: ['counters/' + param.counterID, 'counters'],
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
                filenames: ['counters/' + param.counterID, 'counters'],
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

    if (!dependedCounters || !dependedCounters.size) {
        // send process ID to server

        log.debug('processCollectorResult for OCID ', param.OCID, ' no dependent counters found', {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": param.OCID
            }
        });

        return sendCompleteExecutionResult(param);
    }

    var returnedMessage = {
        parentOCID: param.parentOCID ? param.parentOCID : undefined,
        OCID: param.OCID,
        variables: param.collectorParameters.$variables,
        value: preparedResult.value,
        dependedCounters: dependedCounters,
    };

    log.debug('processCollectorResult for OCID ', param.OCID, ' dependent counters found, return to parent: ',
        returnedMessage, {
            expr: '%:RECEIVED_OCID:% == %:OCID:%',
            vars: {
                "RECEIVED_OCID": param.OCID
            }
        });

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

    var dependedCounters = new Set(), updateEvents = parentCounter.dependedUpdateEvents;
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
                            filenames: ['counters/' + parentCounterID, 'counters'],
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
                        filenames: ['counters/' + parentCounterID, 'counters'],
                        level: 'W'
                    });
                continue;
            }
        }

        var objectsIDs = updateEvent.parentObjectID ? counter.objectsIDs : new Map([[parentObjectID, 0]]);
        for (var objectID of objectsIDs.keys()) {
            var objectName = cache.countersObjects.objects.get(objectID);
            if (!objectName || !counter.objectsIDs.has(objectID) || (objectFilter && !objectFilterRE.test(objectName))) {
                continue;
            }

            dependedCounters.add({
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