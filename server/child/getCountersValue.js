/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../../lib/log')(module);

const async = require('async');
const {threadId} = require('worker_threads');
const fromHuman = require('../../lib/utils/fromHuman');
const calc = require('../../lib/calc');
const variablesReplace = require('../../lib/utils/variablesReplace');
const initCache = require('./initCache');
//const profiling = require('../lib/profiling');

const history = require('../../models_history/history');
const debugCounters = require('../../serverDebug/debugCounters');
const taskServer = require('../../serverTask/taskServerClient');

const thread = require('../../lib/threads');
const getVars = require('./getVarsNew');
const connectingCollectors = require('./connectingCollectors');

const serverName = thread.workerData[0];
const childID = thread.workerData[1];
var childProc;
var cacheInitialized = false;
var messageCache = [];
var collectorsObj = {};
/**
 *
 * @type {{variablesDBCache: Map<any, any>, countersObjects: {}}}
 *
 * @example
 * countersObjects: {
 *          counters: {Map},
 *          objects: {Map},
 *          objectName2OCID: {Map}
 *     },
 *     // for historical variables
 *     variablesDBCache: Map(): key - counterID, value - Map() { <variableName>: {
 *          id: {number},
 *          objectID: {number},
 *          name: {string},
 *          value: {string},
 *          description: {string},
 *          mode: {number}
 *     }, ...},
 *     // for expression
 *     variablesDBCache: Map(): key - counterID, value - Map() {<variableName>: {
 *          id: {number},
 *          name: {string},
 *          counterID: {number},
 *          expression: {string},
 *          description: {string},
 *          variableOrder: {number}
 *     }, ... },
 *     objectsPropertiesDBCache: Map(): key - objectID, value - Map() {<variableName>: {
 *          id: {number},
 *          name: {string},
 *          counterID: {number},
 *          objectID: {number},
 *          parentCounterName: {string},
 *          function: {string},
 *          functionParameters: {string},
 *          objectName: {string},
 *          description: {string},
 *          variableOrder: {number}
 *     }, ... }
 */
var cache = {
    countersObjects: {},
    objectsPropertiesDBCache: new Map(),
    variablesDBCache: new Map(),
};

// init history and debugCounters communication
history.connect(childID, function () {
    debugCounters.connect(function () {
        childProc = new thread.child({
            module: 'getCountersValue-' + serverName,
            onMessage: processMessage,
            onStop: destroyCollectors,
            onDestroy: destroyCollectors,
        });
    });
});

//profiling.init(60);

function processMessage(message, callback) {
    log.debug('Child ' + process.pid + ' receive message', message);

    if (!message) {
        if (typeof callback === 'function') {
            log.info('Receiving empty message with callback');
            callback();
        } else log.info('Receiving empty message without callback');
        return;
    }

    // init cache
    if (message.countersObjects || message.variables || message.variablesExpressions || message.objectsProperties) {
        cache = initCache(message, cache);

        calc.initCache({
            countersObjects: cache.countersObjects,
            objectsProperties: cache.objectsPropertiesDBCache,
        });

        // cache initializing. processing cached messages
        if (!cacheInitialized) {
            childProc.send({
                tid: threadId,
            });
            cacheInitialized = true;
            messageCache.forEach(processMessage);
            messageCache = [];
        }

        return;
    }

    // we can't process messages while cache is not initializing. Push messages in message cache
    if (!cacheInitialized) {
        messageCache.push(message);
        return;
    }

    if ('result' in message) {
        connectingCollectors(function (err, _collectors) {
            if (err) {
                destroyCollectors(function() {
                    log.error('Can\'t init collectors: ' + err.message);
                });
                return;
            }
            if (_collectors) collectorsObj = _collectors;
            processCollectorResult(message.err, message.result, message.parameters, message.collectorName, message.processedID);
        });

        return
    }

    if ('processedID' in message && 'property' in message) {
        //profiling.start('Full cycle', message.processedID);

        connectingCollectors(function (err, _collectors) {
            if (err) {
                destroyCollectors(function() {
                    log.error('Can\'t init collectors: ' + err.message);
                });
                return;
            }
            if (_collectors) collectorsObj = _collectors;
            getVariablesAndCheckUpdateEvents(message);
        });

        //if(typeof callback === 'function') callback();
        return;
    }

    // message: { removeCounters: [<OCID1>, OCID2, ...] }
    if (message.removeCounters && message.removeCounters.length) {
        var OCIDs = message.removeCounters; // array of OCIDs

        async.each(Object.keys(collectorsObj), function (name, callback) {
            if (typeof collectorsObj[name].removeCounters !== 'function') return callback();

            log.debug('Collector ', name, ' has a removeCounters method, executing removeCounters for OCIDs: ', OCIDs);
            collectorsObj[name].removeCounters(OCIDs, function (err) {
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
    async.each(Object.keys(collectorsObj), function (name, callback) {

        // don\'t destroy active and separate collectors. it destroyed from server
        if (collectorsObj[name].active || collectorsObj[name].separate ||
            !collectorsObj[name].destroy || typeof collectorsObj[name].destroy !== 'function') return callback();

        log.debug('Collector ', name, ' has a destroy method, destroying collector: ', collectorsObj[name]);
        collectorsObj[name].destroy(function (err) {
            if (err) log.warn('Error destroying collector ', name, ': ', err.message);
            else log.warn('Collector ', name, ' was destroyed');

            callback();
        });
    }, callback); // error is not returned
}

function getVariablesAndCheckUpdateEvents(message) {

    var property = message.property,
        counterParameters = [],
        parentVariables = message.parentVariables,
        updateEventState = message.updateEventState;

    // make full independent copy of counter parameters for make possible to modifying it in the future
    if (cache.countersObjects && cache.countersObjects.counters &&
        cache.countersObjects.counters.has(Number(property.counterID)) &&
        Array.isArray(cache.countersObjects.counters.get(Number(property.counterID)).counterParams)
    ) {
        cache.countersObjects.counters.get(Number(property.counterID)).counterParams.forEach(function (param) {
            counterParameters.push({
                name: param.name,
                value: param.value,
            });
        });
    }

    if (!collectorsObj[property.collector] || typeof collectorsObj[property.collector].get !== 'function') {
        log.options('Collector "', property.collector, '" undefined or object "get" is not a function (',
            collectorsObj[property.collector] || ('collectors list: ' + Object.keys(collectorsObj).join(', ')),
            '), objectCounterID: ', property.OCID, ': ', counterParameters, {
                filenames: ['counters/' + property.counterID, 'counters.log'],
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
        return;
    }

    //profiling.start('1. get variables values', message.processedID);
    //log.info(cache.variablesDBCache.get(Number(property.counterID)))
    //log.info(cache.objectsPropertiesDBCache.get(Number(property.objectID)))
    getVars({
        parentVariables: parentVariables,
        parentObjectName: property.parentObjectName,
        parentCounter: property.parentCounter,
        objectName: property.objectName,
        objectID: Number(property.objectID),
        counterName: property.counterName,
        counterID: Number(property.counterID),
        objectCounterID: property.OCID,
        parentObjectValue: property.parentObjectValue,
        parentOCID: property.parentOCID,
        updateEventExpression: property.expression,
        prevUpdateEventState: updateEventState,
        updateEventMode: property.mode,
        countersObjects: cache.countersObjects,
        cache: {
            variables: cache.variablesDBCache.get(Number(property.counterID)) || new Map(),
            properties: cache.objectsPropertiesDBCache.get(Number(property.objectID)) || new Map(),
        },
        variablesDebugInfo: {},
        taskCondition: property.taskCondition,
        collector: property.collector,
    }, function (err, noNeedToCalculateCounter, variables, variablesDebugInfo, preparedCollectorParameters) {

        var objectCounterID = property.OCID;

        if (property.debug) {
            debugCounters.add('v', objectCounterID, variablesDebugInfo,
                variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important);
        }
        //profiling.stop('1. get variables values', message.processedID);
        //profiling.start('2. prepare to get counter value', message.processedID);

        // send UPDATE_EVENT_STATE anyway if previous updateEventState is not equal to new updateEventState,
        // because after the child may have nothing to send to the server
        if (variables && property.parentOCID && property.expression &&
            updateEventState !== variables.UPDATE_EVENT_STATE &&
            variables.UPDATE_EVENT_STATE !== undefined) {
//        if (property.parentOCID && property.expression && variables.UPDATE_EVENT_STATE !== undefined) {
            childProc.send({
                updateEventKey: property.parentOCID + '-' + property.OCID,
                updateEventState: variables.UPDATE_EVENT_STATE,
            });
        }

        if (err) {
            log.options(err.message, {
                filenames: ['counters/' + property.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'I'
            });
            return;
        }
        if(noNeedToCalculateCounter) return

        if (variables && Object.keys(variables).length) {

            if (variablesDebugInfo.UPDATE_EVENT_STATE &&
                variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables &&
                variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length) {

                for (var i = 0; i < variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length; i++) {
                    // checking for %:?<name>:%
                    if (variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables[i].charAt(2) !== '?') {
                        log.options('Skip update event with unresolved variables for ',
                            property.objectName, '(', property.counterName, '): ', property.expression,
                            ', unresolved variables: ',
                            variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.join(', '),
                            ', OCID: ', property.OCID, {
                                filenames: ['counters/' + property.counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'I'
                            });

                        return;
                    }
                }
            }


            //if (variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important) var important = true;
        }

        getValue({
            parentOCID: preparedCollectorParameters.$parentID,
            objectCounterID: preparedCollectorParameters.$id,
            processedID: message.processedID,
            collector: property.collector,
            collectorParameters: preparedCollectorParameters,
            objectName: preparedCollectorParameters.$variables.OBJECT_NAME,
            counterName: preparedCollectorParameters.$variables.COUNTER_NAME,
            counterID: preparedCollectorParameters.$counterID,
            objectID: preparedCollectorParameters.$objectID,
            groupID: property.groupID,
            taskCondition: property.taskCondition,
            removeCounter: property.removeCounter,
        });
    });
}

// catch it at lib/server.js
function getValue(message) {
    if (!message.collector || !collectorsObj[message.collector]) {
        return log.options('Try to get value for unknown collector for ',
            message.collectorParameters.$variables.OBJECT_NAME,
            '(', message.collectorParameters.$variables.COUNTER_NAME, '): collector: "', message.collector,
            '"; message: ', message, {
                filenames: ['counters/' + message.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
    }

    //log.debug('Try to get value for ', message.collectorParameters.$variables.OBJECT_NAME , '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', message);

    //try to catch errors in collector code
    //profiling.stop('2. prepare to get counter value', message.processedID);
    //profiling.start('2. get counter value', message.processedID);
    try {
        if (message.removeCounter && collectorsObj[message.collector] &&
            typeof collectorsObj[message.collector].removeCounters === 'function') {
            //log.info(message.removeCounter, ' now processed but required for update. Removing...');
            collectorsObj[message.collector].removeCounters([message.objectCounterID], function (err) {
                if (err) {
                    log.error('Error executing ', message.collector, ' removeCounters method for ',
                        message.removeCounter, '(OCID:', message.objectCounterID, '): ', err.message);
                }

                //log.info('Getting data for ', message.removeCounter, ' after removing...');
                collectorsObj[message.collector].get(message.collectorParameters, function (err, result) {
                    processCollectorResult(err, result, message, message.collector);
                });
            });
        } else {
            collectorsObj[message.collector].get(message.collectorParameters, function (err, result) {
                processCollectorResult(err, result, message, message.collector);
            });
        }
    } catch (err) {
        log.options('Error in collector code ', message.collector, ' ', message.collectorParameters, ' for OCID ',
            message.objectCounterID,
            ': ', message.collectorParameters.$variables.OBJECT_NAME,
            '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', err.stack, {
                filenames: ['counters/' + message.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
    }
}

function processCollectorResult(err, result, message, collectorName, processedID) {
    if (!message.collector) {
        try {
            message = {
                parentOCID: message.$parentID,
                objectCounterID: message.$id,
                processedID: processedID,
                collector: collectorName,
                collectorParameters: message,
                objectName: message.$variables.OBJECT_NAME,
                counterID: message.$counterID,
                objectID: message.$objectID,
            }
        } catch (err) {
            throw(new Error('Can\'t init message: ' + err.message + '; ' + JSON.stringify(message)))
        }
    }

    /*
    if(!message.collector || !collectorsObj[message.collector]) {
        console.log('err, result, message, collectorName: ',
            err, '; ', result, '; ', message, '; ', collectorName, '; ', Object.keys(collectorsObj))
    }
    */


    log.options('Receiving value from OCID ', message.objectCounterID, ': ',
        message.collectorParameters.$variables.OBJECT_NAME,
        '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', result, '; err: ',
        (err && err.stack ? err.stack : err), ', task condition: ', message.taskCondition,
        ', collector: ', message.collector, '(', message.collectorParameters, ')', {
            filenames: ['counters/' + message.counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });

    //if(Number(message.objectCounterID) === 3428) log.warn('Getting record ', result, ': ', message);

    // result was saved to the history in activeCollector.js for active and separate
    // for decrees number of transfers of result value
    if (collectorsObj[message.collector].active || collectorsObj[message.collector].separate) {
        var preparedResult = result;
    } else preparedResult = history.add(message.objectCounterID, result);

    if (message.taskCondition) {
        taskServer.checkCondition(message.objectCounterID, preparedResult, message.objectName, message.counterName);
    }

    if (!preparedResult || preparedResult.value === undefined || preparedResult.value === null) {
        if (err) {
            log.options('Collector ', message.collector, ' return error and result ', result, ' for OCID: ',
                message.objectCounterID, ': ',
                message.collectorParameters.$variables.OBJECT_NAME,
                '(', message.collectorParameters.$variables.COUNTER_NAME, '): ',
                (err.stack || JSON.stringify(err)), '; Parameters: ', message.collectorParameters, {
                    filenames: ['counters/' + message.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
                });
        } // else return nothing, skip it
        return;
    } else if (err) {
        log.options('Collector ', message.collector, ' return error for OCID: ', message.objectCounterID, ': ',
            message.collectorParameters.$variables.OBJECT_NAME,
            '(', message.collectorParameters.$variables.COUNTER_NAME,
            '); result: ', result, '; Error: ', err.message,
            '; Parameters: ', message.collectorParameters, {
                filenames: ['counters/' + message.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'W'
            });
    }

    //profiling.stop('2. get counter value', message.processedID);
    //profiling.start('3. get depended counters', message.processedID);
    // properties: [{parentObjectName:.., parentCollector:.., OCID: <objectsCountersID>, collector:<collectorID>,
    //     counterID:.., objectID:..,
    //     objectName:.., expression:..., mode: <0|1|2>}, {...}...]
    //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
    //     2 - update once when expression set to true, then once, when expression set to false
    var properties = getCountersForDependedCounters(message.counterID, message.objectID,
        message.collectorParameters.$variables);

    if (!properties || !properties.length) {
        log.options('Received value[s] ', preparedResult.value, ' from: ',
            message.collectorParameters.$variables.OBJECT_NAME,
            '(', message.collectorParameters.$variables.COUNTER_NAME, '), depended on counters not found', {
                filenames: ['counters/' + message.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
        });
        return;
    }

    var returnedMessage = {
        parentOCID: Number(message.parentOCID) ? Number(message.parentOCID) : undefined,
        objectCounterID: Number(message.objectCounterID),
        processedID: message.processedID,
        pid: process.pid,
        groupID: message.groupID,
        taskCondition: message.taskCondition,
        variables: message.collectorParameters.$variables,
        collector: message.collector,
        properties: properties,
        timestamp: preparedResult.timestamp,
        value: preparedResult.value,
    };

    //profiling.stop('3. get depended counters', message.processedID);
    //profiling.start('4. send data to server', message.processedID);

    childProc.send(returnedMessage);

    //profiling.stop('Full cycle', returnedMessage.processedID);
    //profiling.stop('4. send data to server', message.processedID);
}


function getCountersForDependedCounters(parentCounterID, parentObjectID, variables) {
    if (!cache.countersObjects.counters) return;

    var parentCounter = cache.countersObjects.counters.get(Number(parentCounterID));
    if (!parentCounter || !parentCounter.dependedUpdateEvents.size) return;

    var properties = [], updateEvents = parentCounter.dependedUpdateEvents;
    for (var [counterID, updateEvent] of updateEvents) {
        var counter = cache.countersObjects.counters.get(counterID);
        if (!counter || (updateEvent.parentObjectID && Number(updateEvent.parentObjectID) !== Number(parentObjectID))) continue;

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

        var objectsIDs = updateEvent.parentObjectID ? counter.objectsIDs : new Map([[Number(parentObjectID), 0]]);
        for (var objectID of objectsIDs.keys()) {
            var objectName = cache.countersObjects.objects.get(objectID);
            if (!objectName || !counter.objectsIDs.has(objectID) || (objectFilter && !objectFilterRE.test(objectName))) continue;

            properties.push({
                parentObjectName: cache.countersObjects.objects.get(Number(parentObjectID)),
                parentCounter: parentCounter.counterName,
                OCID: counter.objectsIDs.get(objectID),
                collector: counter.collector,
                counterID: counterID,
                counterName: counter.counterName,
                objectID: objectID,
                objectName: objectName,
                expression: updateEvent.expression,
                mode: updateEvent.mode,
                debug: counter.debug,
                taskCondition: counter.taskCondition,
                groupID: counter.groupID,
            });
        }
    }
    //log.warn('Returned props: ', properties, ': ', cache.countersObjects.counters.get(Number(parentCounterID)));
    return properties;
}