/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
const log = require('../../lib/log')(module);

const async = require('async');
const {threadId} = require('worker_threads');
const calc = require('../../lib/calc');
//const profiling = require('../lib/profiling');

const history = require('../../models_history/history');
const debugCounters = require('../../serverDebug/debugCounters');
const taskServer = require('../../serverTask/taskServerClient');

const thread = require('../../lib/threads');
const getVarsFromHistory = require('./getVarFromHistory');
const getVarsFromProperties = require('./getVarsFromProperties');
const getVarsFromExpressions = require('./getVarsFromExpressions');
const connectingCollectors = require('./connectingCollectors');

const serverName = thread.workerData[0];
const childID = thread.workerData[1];
const maxAttemptsToResolveVariables = 20;
var childProc;
var cacheInitialized = false;
var messageCache = [];
var collectorsObj = {};
var countersObjects = {}; // {counters: new Map(), objects: new Map(), objectName2OCID: new Map()}
var variablesDBCache = new Map();
var variablesExpressionsDBCache = new Map();
var objectsPropertiesDBCache = new Map();
const updateEventsMode = {
    '0': 'Update each time when expression value is true',
    '1': 'Update once when expression value is changed to true',
    '2': 'Update once when expression value is changed to true and once when changed to false',
    '3': 'Update each time when expression value is changed to true and once when changed to false'
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

    if (message.countersObjects || message.variables || message.variablesExpressions || message.objectsProperties) { // init cache
        if (message.countersObjects) {
            // trying to clear memory
            if (countersObjects.counters && typeof countersObjects.counters.clear === 'function') {
                countersObjects.counters.clear();
            }
            if (countersObjects.objects && typeof countersObjects.objects.clear === 'function') {
                countersObjects.objects.clear();
            }
            if (countersObjects.objectName2OCID && typeof countersObjects.objectName2OCID.clear === 'function') {
                countersObjects.objectName2OCID.clear();
            }

            countersObjects = convertCountersObjectsToMap(message.countersObjects);
        }
        if (message.variables) {
            if (typeof variablesDBCache.clear === 'function') variablesDBCache.clear();
            for (var id in message.variables) {
                variablesDBCache.set(Number(id), message.variables[id]);
            }
        }
        if (message.variablesExpressions) {
            if (typeof variablesExpressionsDBCache.clear === 'function') variablesExpressionsDBCache.clear();
            for (id in message.variablesExpressions) {
                variablesExpressionsDBCache.set(Number(id), message.variablesExpressions[id]);
            }
        }

        if (message.fullUpdate && message.objectsProperties) {
            if (typeof objectsPropertiesDBCache.clear === 'function') objectsPropertiesDBCache.clear();
            for (id in message.objectsProperties) {
                objectsPropertiesDBCache.set(Number(id), message.objectsProperties[id]);
            }
        } else mergeCache(message.objectsProperties, objectsPropertiesDBCache);
        /*
        mergeCache(message.variables, variablesDBCache);
        mergeCache(message.variablesExpressions, variablesExpressionsDBCache);
        mergeCache(message.objectsProperties, objectsPropertiesDBCache);
         */

        calc.initCache({
            countersObjects: countersObjects,
            objectsProperties: objectsPropertiesDBCache,
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

        log.debug('Received cache data:',
            (message.variables ? ' history for counters: ' + variablesDBCache.size : ''),
            (message.variablesExpressions ? ' expressions for counters: ' + variablesExpressionsDBCache.size : ''),
            (message.objectsProperties ? ' properties for objects: ' + Object.keys(message.objectsProperties).length
                + '(now ' + objectsPropertiesDBCache.size + ')' : ''),
            (message.countersObjects ? ' objects: ' + countersObjects.objects.size +
                ', counters: ' + countersObjects.counters.size +
                ', objectName2OCID: ' + countersObjects.objectName2OCID.size : ''));

        //if(typeof callback === 'function') callback();
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

function mergeCache(src, dst) {
    if (!src) return;
    for (var key in src) {
        dst.set(Number(key) === parseInt(String(key), 10) ? Number(key) : key, src[key]);
    }
}

function convertCountersObjectsToMap(countersObjectsObj) {
    var objects = new Map(), counters = new Map(), objectName2OCID = new Map();

    // objects[id] = name
    for (var id in countersObjectsObj.objects) {
        objects.set(Number(id), countersObjectsObj.objects[id]);
    }

    // countersObjectsObj.counters[id].objectsID[objectID] = OCID
    for (id in countersObjectsObj.counters) {
        var counterObj = countersObjectsObj.counters[id];
        var objectsIDs = new Map();
        for (var objectID in counterObj.objectsIDs) {
            objectsIDs.set(Number(objectID), Number(counterObj.objectsIDs[objectID]));
        }

        // countersObjectsObj.counters[id].dependedUpdateEvents[counterID] = {counterID:, expression:, mode:, objectFilter:, parentObjectID:}
        var dependedUpdateEvents = new Map();
        for (var counterID in counterObj.dependedUpdateEvents) {
            dependedUpdateEvents.set(Number(counterID), counterObj.dependedUpdateEvents[counterID]);
        }

        counterObj.objectsIDs = objectsIDs;
        counterObj.dependedUpdateEvents = dependedUpdateEvents;
        counters.set(Number(id), counterObj);
    }

    // objectName2OCID[objectNameInUpperCase][row.counterID] = OCID;
    for (var objectName in countersObjectsObj.objectName2OCID) {
        counterObj = countersObjectsObj.objectName2OCID[objectName];
        var object = new Map();
        for (counterID in counterObj) {
            if (counterID === 'objectID') object.set('objectID', Number(counterObj[counterID]));
            else object.set(Number(counterID), Number(counterObj[counterID])); // counterObj[counterID] is OCID
        }
        objectName2OCID.set(objectName, object);
    }
    return {
        counters: counters,
        objects: objects,
        objectName2OCID: objectName2OCID,
    }
}

function getVariablesAndCheckUpdateEvents(message) {

    var property = message.property,
        counterParameters = [],
        parentVariables = message.parentVariables,
        updateEventState = message.updateEventState;

    // make full independent copy of counter parameters for make possible to modifying it in the future
    if (countersObjects && countersObjects.counters &&
        countersObjects.counters.has(Number(property.counterID)) &&
        Array.isArray(countersObjects.counters.get(Number(property.counterID)).counterParams)
    ) {
        countersObjects.counters.get(Number(property.counterID)).counterParams.forEach(function (param) {
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

    // debugInfo: {
    //      functionDebug: [{name: name, parameters: [], result: result}, {}, ... ]
    //      unresolvedVariables: [var1, var2, ....],
    //      attempts: <attemptsCnt for calculate update event>
    // }
    //profiling.start('1. get variables values', message.processedID);
    getVariablesValues(property, parentVariables, updateEventState, function (err, noNeedToCalculateCounter, variables, variablesDebugInfo) {
        //profiling.stop('1. get variables values', message.processedID);
        //profiling.start('2. prepare to get counter value', message.processedID);

        var objectCounterID = property.OCID;

        if (err || noNeedToCalculateCounter) {
            if (err) log.options(err.message, {
                filenames: ['counters/' + property.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });

            if (property.debug && variablesDebugInfo) {
                debugCounters.add('v', objectCounterID, variablesDebugInfo);
            }
            return;
        }

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

                        if (property.debug) debugCounters.add('v', objectCounterID, variablesDebugInfo);
                        return;
                    }
                }
            }

            // [{name: <pName1>, value: pValue1}, {name: pName2, value: pValue2}...] to  object
            // {pName1: pValue1, pName2: pValue2, ...}
            var preparedCollectorParameters = {
                $id: objectCounterID,
                $counterID: property.counterID,
                $objectID: property.objectID,
                $parentID: property.parentOCID,
                $variables: variables,
                $taskCondition: property.taskCondition,
            };
            // replace variables in counter parameters
            // check parameters for unresolved variable and convert parameters from array
            var counter = property.collector + '(' + counterParameters.map(function (p) {
                return p.value;
            }).join(', ') + ')';
            for (i = 0; i < counterParameters.length; i++) {
                var parameter = counterParameters[i];

                if (parameter.value && typeof parameter.value === 'string') {
                    var res = calc.variablesReplace(parameter.value, variables);
                    if (res) {
                        var expression = parameter.value; // save old value

                        parameter.value = typeof res.value === 'string' ? calc.convertToNumeric(res.value) : res.value;

                        if (property.debug) {
                            variablesDebugInfo[expression + ' [' + counter + ']'] = {
                                timestamp: Date.now(),
                                name: expression + ' [' + counter + ']',
                                expression: expression,
                                variables: variables,
                                result: parameter.value,
                                unresolvedVariables: res.unresolvedVariables
                            };
                        }

                        if (res.unresolvedVariables.length) {
                            log.options('Unresolved variables in counter parameters: ',
                                property.objectName, '(', property.counterName, '): ', property.collector,
                                ', Unresolved parameter: ', parameter,
                                ', variables: ', variables, ', parameters: ', counterParameters, ', OCID: ',
                                property.OCID, {
                                    filenames: ['counters/' + property.counterID, 'counters.log'],
                                    emptyLabel: true,
                                    noPID: true,
                                    level: 'E'
                                });
                            if (property.debug) debugCounters.add('v', objectCounterID, variablesDebugInfo);
                            return;
                        }
                    }
                }
                preparedCollectorParameters[parameter.name] = parameter.value;
            }

            if (variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important) var important = true;
            if (property.debug) debugCounters.add('v', objectCounterID, variablesDebugInfo, important);
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
    if (!countersObjects.counters) return;

    var parentCounter = countersObjects.counters.get(Number(parentCounterID));
    if (!parentCounter || !parentCounter.dependedUpdateEvents.size) return;

    var properties = [], updateEvents = parentCounter.dependedUpdateEvents;
    for (var [counterID, updateEvent] of updateEvents) {
        var counter = countersObjects.counters.get(counterID);
        if (!counter || (updateEvent.parentObjectID && Number(updateEvent.parentObjectID) !== Number(parentObjectID))) continue;

        if (updateEvent.objectFilter) {
            var res = calc.variablesReplace(updateEvent.objectFilter, variables);
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
            var objectName = countersObjects.objects.get(objectID);
            if (!objectName || !counter.objectsIDs.has(objectID) || (objectFilter && !objectFilterRE.test(objectName))) continue;

            properties.push({
                parentObjectName: countersObjects.objects.get(Number(parentObjectID)),
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
    //log.warn('Returned props: ', properties, ': ', countersObjects.counters.get(Number(parentCounterID)));
    return properties;
}


/*
get variables values
property - { OCID:.., objectID:.., counterID:.., counterName:..., parentObjectName:..., parentCounter :.., collector:..., objectName:...., parentObjectValue:... }
parentVariables - variables from parent counters {name1: val1, name2: val2, ...}. Can be undefined
callback(err, variables)
variables - {name1: val1, name2: val2, ...} - variables list with values
*/
function getVariablesValues(property, parentVariables, updateEventState, callback) {

    var objectID = property.objectID;
    var counterID = Number(property.counterID);
    var objectName = property.objectName;
    var counterName = property.counterName;
    var variablesDebugInfo = {};


    // !!! Don't set variables = parentVariables for save parent variables
    var variables = {};

    // !!! Don't set variables = parentVariables. It will be a reference.
    // Need to save parentVariables unchanged after add new values to variables
    if (typeof parentVariables === 'object') {
        for (var name in parentVariables) variables[name] = parentVariables[name];
    }

    // add static data about current and parent objects to variables list
    variables.PARENT_OBJECT_NAME = property.parentObjectName === undefined ? '' : property.parentObjectName;
    variables.PARENT_COUNTER_NAME = property.parentCounter === undefined ? '' : property.parentCounter;
    variables.OBJECT_NAME = objectName === undefined ? '' : objectName;
    variables.PARENT_VALUE = property.parentObjectValue === undefined ? '' : property.parentObjectValue;
    variables.COUNTER_NAME = counterName === undefined ? '' : counterName;

    // clone cache content to a new data for save cached content
    var data = JSON.parse(JSON.stringify({
        variables: variablesDBCache.get(counterID) || [],
        expressions: variablesExpressionsDBCache.get(counterID) || [],
        properties: objectsPropertiesDBCache.get(objectID) || [],
    }));

    if (property.parentOCID && property.expression) {
        // add 'UPDATE_EVENT_STATE' as first element of array for calculate it at first
        data.expressions.unshift({
            id: 0,
            name: 'UPDATE_EVENT_STATE',
            counterID: counterID,
            expression: property.expression
        });
    }
    /*
        Searching for equal counters variables and object properties
        If finding equal counter variable and object property then use value of object property
        Used for redefine variables from counter
        You can use this also for making hack with UPDATE_EVENT_STATE - define it as object property.
        This redefines value of UPDATE_EVENT_STATE from counter
     */
    if (data.properties && data.properties.length && (
        (data.expressions && data.expressions.length) ||
        (data.variables && data.variables.length)
    )) {

        data.properties.forEach(function (property) {
            if (!property.name) return;
            var propertyName = property.name.toUpperCase();

            for (var i = 0; data.expressions && i < data.expressions.length; i++) {
                if (data.expressions[i] && data.expressions[i].name && propertyName === data.expressions[i].name.toUpperCase()) {
                    data.expressions[i].name = null;
                    break;
                }
            }

            for (i = 0; data.variables && i < data.variables.length; i++) {
                if (data.variables[i] && data.variables[i].name && propertyName === data.variables[i].name.toUpperCase()) {
                    data.variables[i].name = null;
                    break;
                }
            }
        });
    }

    log.options('Variables data from DB for: ', objectName, '(', counterName, '): ', data,
        '; init variables: ', variables, {
            filenames: ['counters/' + counterID, 'counters.log'],
            emptyLabel: true,
            noPID: true,
            level: 'D'
        });

    var newVariables = [],
        prevNewVariables = [],
        attempts = 1,
        whyNotNeedToCalculateCounter;

    // loop for resolve variables in expressions and from history functions
    async.doWhilst(function (callback) {
        newVariables = [];

        async.parallel([ function (callback) {
            getVarsFromHistory(data.variables, variables, property, countersObjects, variablesDebugInfo, newVariables, callback);
        }, function (callback)  {
            getVarsFromProperties(data.properties, variables, property, variablesDebugInfo, newVariables, callback)
        }, function (callback) {
            getVarsFromExpressions(data.expressions, variables, property, updateEventState, variablesDebugInfo,
                newVariables, function (err, _whyNotNeedToCalculateCounter) {
                    whyNotNeedToCalculateCounter = _whyNotNeedToCalculateCounter;
                    callback(err);
                });
        }], callback)
    }, function () {
        //return (newVariables.length && ++attempts < maxAttemptsToResolveVariables);

        // stop variable calculation if no new variables are calculated
        if (!newVariables.length) return false;

        // stop the calculation of variables if the number of calculation attempts is more than maxAttemptsToResolveVariables
        if (++attempts >= maxAttemptsToResolveVariables) {
            var unresolvedVariables = newVariables.filter(newVariable => prevNewVariables.indexOf(newVariable) === -1);
            log.options('Attempts: ', attempts, ': ', objectName, '(', counterName,
                '): new - prev vars: ', unresolvedVariables,
                '; vars : ', variables,
                '; new: ', newVariables, '; prev: ', prevNewVariables,
                '; source data from DB: ', data, {
                    filenames: ['counters/' + counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'W'
                });
            return false;
        }

        if (newVariables.length === prevNewVariables.length) {
            // compare previous and current variables names
            for (var i = 0; i < newVariables.length; i++) {
                if (prevNewVariables.indexOf(newVariables[i]) === -1) {
                    // copy array of newVariables to prevNewVariables
                    prevNewVariables = newVariables.slice();

                    // find different variables names. continue calculating variables
                    return true;
                }
            }
            // stop variables calculation if previous and current variable names are equal
            return false;
        }

        // copy array of newVariables to prevNewVariables
        prevNewVariables = newVariables.slice();
        return true; // continue calculating variables

    }, function (err) {
        if (err) {
            return callback(new Error('Error while calculating variables values for ' +
                objectName + '(' + counterName + '): ' + err.message));
        }

        log.options('Attempts: ', attempts, ': ', objectName, '(', counterName, '): new\\prev variables: ',
            newVariables, '\\', prevNewVariables, '; variables : ', variables, ' for data for DB: ', data, {
                filenames: ['counters/' + counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
            });

        if (variablesDebugInfo.UPDATE_EVENT_STATE) {
            if (whyNotNeedToCalculateCounter) variablesDebugInfo.UPDATE_EVENT_STATE.result += ' (' + whyNotNeedToCalculateCounter + ')';
            else variablesDebugInfo.UPDATE_EVENT_STATE.important = true;
            variablesDebugInfo.UPDATE_EVENT_STATE.result += '. Calculation cycles: ' + attempts;
            variablesDebugInfo.UPDATE_EVENT_STATE.name = 'Update event. Mode: ' + updateEventsMode[property.mode]
        }

        /*
        if(property.parentOCID && property.expression) {
            if (variables.UPDATE_EVENT_STATE === undefined) return callback(null, whyNotNeedToCalculateCounter, variables, variablesDebugInfo);
            else {
                childProc.send({
                    updateEventKey: property.parentOCID + '-' + property.OCID,
                    updateEventState: variables.UPDATE_EVENT_STATE, // don't replace to !!result
                });
                callback(null, whyNotNeedToCalculateCounter, variables, variablesDebugInfo);
                return;
            }
        }
        */

        // send UPDATE_EVENT_STATE anyway if previous updateEventState is not equal to new updateEventState,
        // because after the child may have nothing to send to the server
        if (property.parentOCID && property.expression &&
            updateEventState !== variables.UPDATE_EVENT_STATE &&
            variables.UPDATE_EVENT_STATE !== undefined) {
        //if (property.parentOCID && property.expression && variables.UPDATE_EVENT_STATE !== undefined) {
            childProc.send({
                updateEventKey: property.parentOCID + '-' + property.OCID,
                updateEventState: variables.UPDATE_EVENT_STATE, // don't replace to !!result
            });
        }
        callback(null, whyNotNeedToCalculateCounter, variables, variablesDebugInfo);
    });
}
