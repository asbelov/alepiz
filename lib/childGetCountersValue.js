/*
/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../lib/log')(module);
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');

var conf = require('../lib/conf');
conf.file('config/conf.json');

var path = require('path');
var async = require('async');
var collectors = require('../lib/collectors');
var activeCollector = require('../lib/activeCollector');
var calc = require('../lib/calc');
//var profiling = require('../lib/profiling');

var history = require('../models_history/history');
var dynamicLog = require('../lib/dynamicLog');

var serverID = Number(process.argv[2]);
var childID = Number(process.argv[3]);
var isConnectingToCollectors = 0;
var maxAttemptsToResolveVariables = 20;
var messageListenerAlreadyStarted = false;

// executing from lib/server.js. used for getting values from counters

if(messageListenerAlreadyStarted) return log.error('Trying to initialize this child process more then one time. Exiting');
messageListenerAlreadyStarted = true;

// init history communication
log.debug('Connecting to the history server...');
history.connect(childID, function () {
    dynamicLog.connect(startMessageListener);
});

//profiling.init(60);

function startMessageListener() {

    var cacheInitialized = false;
    var messageCache = [];
    var cfg = conf.get('servers')[serverID];
    var collectorsObj = {};
    var countersObjects = {}; // {counters: new Map(), objects: new Map(), objectName2OCID: new Map()}
    var variablesDBCache = new Map();
    var variablesExpressionsDBCache = new Map();
    var objectsPropertiesDBCache = new Map();
    var historyFunctionList = new Set(); // to check if the function name exists
    var updateEventsMode = {
        '0': 'Update each time when expression value is true',
        '1': 'Update once when expression value is changed to true',
        '2': 'Update once when expression value is changed to true and once when changed to false',
        '3': 'Update each time when expression value is changed to true and once when changed to false'
    };

    history.getFunctionList().forEach(function (func) {
        historyFunctionList.add(func.name);
    });

    cfg.serverPort = cfg.serverPortChildrenIPC;
    cfg.id  = 'getCountersValues-'+childID;
    cfg.separateStorageByProcess = false;
    var reconnectInProgress = false;
    var childProc, clientIPC = new IPC.client(cfg, function(err, message, isConnected) {
        if(err) log.error(err.message);
        if(message) processMessage(message);
        if(isConnected && !reconnectInProgress) {
            reconnectInProgress = true;
            childProc = new proc.child({
                module: 'getCountersValue',
                onMessage: processMessage,
                onStop: destroyCollectors,
                onDisconnect: function() {  // exit on disconnect from parent (then server will be restarted)
                    log.exit('Child ' + process.pid + ' was disconnected from parent unexpectedly. Exiting');
                    log.disconnect(function () { process.exit(2) });
                },
            });
        }
    });



    setInterval(sendProcessInfo, 30000);

    function sendProcessInfo() {
        try { global.gc(); } catch (e) {}
        var sendMessageToServer = cfg.useProcIPCForChild ? childProc : clientIPC;
        sendMessageToServer.send({
            pid: process.pid,
            memUsage: Math.round(process.memoryUsage().rss / 1048576), // mem usage in Mb
        });
    }


    function processMessage(message, callback) {
        log.debug('Child ' + process.pid + ' receive message', message);

        if (message.countersObjects || message.variables || message.variablesExpressions || message.objectsProperties) { // init cache
            if(message.countersObjects) {
                // trying to clear memory
                if(countersObjects.counters && typeof countersObjects.counters.clear === 'function') {
                    countersObjects.counters.clear();
                }
                if(countersObjects.objects && typeof countersObjects.objects.clear === 'function') {
                    countersObjects.objects.clear();
                }
                if(countersObjects.objectName2OCID && typeof countersObjects.objectName2OCID.clear === 'function') {
                    countersObjects.objectName2OCID.clear();
                }

                countersObjects = convertCountersObjectsToMap(message.countersObjects);
            }
            if(message.variables) {
                if(typeof variablesDBCache.clear === 'function') variablesDBCache.clear();
                for(var id in message.variables) {
                    variablesDBCache.set(Number(id), message.variables[id]);
                }
            }
            if(message.variablesExpressions) {
                if(typeof variablesExpressionsDBCache.clear === 'function') variablesExpressionsDBCache.clear();
                for(id in message.variablesExpressions) {
                    variablesExpressionsDBCache.set(Number(id), message.variablesExpressions[id]);
                }
            }

            if(message.fullUpdate && message.objectsProperties) {
                if(typeof objectsPropertiesDBCache.clear === 'function') objectsPropertiesDBCache.clear();
                for(id in message.objectsProperties) {
                    objectsPropertiesDBCache.set(Number(id), message.objectsProperties[id]);
                }
            } else mergeCache(message.objectsProperties, objectsPropertiesDBCache);
            /*
            mergeCache(message.variables, variablesDBCache);
            mergeCache(message.variablesExpressions, variablesExpressionsDBCache);
            mergeCache(message.objectsProperties, objectsPropertiesDBCache);
             */

            // cache initializing. processing cached messages
            if(!cacheInitialized) {
                sendProcessInfo();
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

        // we can't processing messages while cache is not initializing. Push messages in message cache
        if(!cacheInitialized) messageCache.push(message);

        if ('processedID' in message && 'property' in message) {
            //profiling.start('Full cycle', message.processedID);

            connectingCollectors(function (err, _collectors) {
                if (err) return log.error('Can\'t init collectors: ' + err.message);
                if(_collectors) collectorsObj = _collectors;
                getVariablesAndCheckUpdateEvents(message);
            });

            //if(typeof callback === 'function') callback();
            return;
        }

        // message: { removeCounters: [<OCID1>, OCID2, ...] }
        if(message.removeCounters && message.removeCounters.length) {
            var OCIDs = message.removeCounters; // array of OCIDs

            async.each(Object.keys(collectorsObj), function (name, callback) {
                if (typeof collectorsObj[name].removeCounters !== 'function') return callback();

                log.debug('Collector ', name, ' has a removeCounters method, executing removeCounters for OCIDs: ', OCIDs);
                collectorsObj[name].removeCounters(OCIDs, function (err) {
                    if (err) return log.error('Error executing ', name, '.removeCounters method for  OCIDs ', OCIDs, ': ', err.message);
                    callback();
                    //log.debug('Counters with OCID ', OCIDs, ' are removed for collector ', name);
                });
            }, function () {
                if(typeof callback === 'function') callback();
            });
        }

        if(message.throttlingPause) {
            async.eachOf(collectorsObj, function (collector, name, callback) {
                if (typeof collector.throttlingPause !== 'function') return callback();

                log.debug('Collector ', name, ' has a throttlingPause method, executing throttlingPause ', message.throttlingPause);
                collector.throttlingPause( message.throttlingPause, function (err) {
                    if (err) return log.error('Error executing ', name, '. message.throttlingPause method: ', err.message);
                    callback();
                });
            }, function () {
                if(typeof callback === 'function') callback();
            });
        }
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
        if(!src) return;
        for(var key in src) {
            dst.set(Number(key) === parseInt(String(key), 10) ? Number(key) : key, src[key]);
        }
    }

    function convertCountersObjectsToMap(countersObjectsObj) {
        var objects = new Map(), counters = new Map(), objectName2OCID = new Map();

        // objects[id] = name
        for(var id in countersObjectsObj.objects) {
            objects.set(Number(id), countersObjectsObj.objects[id]);
        }

        // countersObjectsObj.counters[id].objectsID[objectID] = OCID
        for(id in countersObjectsObj.counters) {
            var counterObj = countersObjectsObj.counters[id];
            var objectsIDs = new Map();
            for(var objectID in counterObj.objectsIDs) {
                objectsIDs.set(Number(objectID), Number(counterObj.objectsIDs[objectID]));
            }

            // countersObjectsObj.counters[id].dependedUpdateEvents[counterID] = {counterID:, expression:, mode:, objectFilter:, parentObjectID:}
            var dependedUpdateEvents = new Map();
            for(var counterID in counterObj.dependedUpdateEvents) {
                dependedUpdateEvents.set(Number(counterID), counterObj.dependedUpdateEvents[counterID]);
            }

            counterObj.objectsIDs = objectsIDs;
            counterObj.dependedUpdateEvents = dependedUpdateEvents;
            counters.set(Number(id), counterObj);
        }

        // objectName2OCID[objectNameInUpperCase][row.counterID] = OCID;
        for(var objectName in countersObjectsObj.objectName2OCID) {
            counterObj = countersObjectsObj.objectName2OCID[objectName];
            var object = new Map();
            for(counterID in counterObj) {
                object.set(Number(counterID), Number(counterObj[counterID])); // obj[counterID] is OCID
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

        var counterParameters = message.counterParameters ? message.counterParameters : [],
            property = message.property,
            parentVariables = message.parentVariables,
            updateEventState = message.updateEventState;

        if (!collectorsObj[property.collector] || typeof collectorsObj[property.collector].get !== 'function') {
            log.options('Collector "', property.collector, '" undefined or object "get" is not a function (',
                collectorsObj[property.collector] || ('collectors list: ' + Object.keys(collectorsObj).join(', ')),
                '), objectCounterID: ', property.OCID, ': ', counterParameters, {
                    filenames: ['counters/' + property.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
                });

            if(!Object.keys(collectorsObj).length) {
                log.exit('Collectors cache is unexpected empty. Exiting');
                destroyCollectors(function () {
                    log.disconnect(function () { process.exit(2) });
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
        getVariablesValues(property, parentVariables, updateEventState, function(err, updateEventNewState, variables, variablesDebugInfo) {
            //profiling.stop('1. get variables values', message.processedID);
            //profiling.start('2. prepare to get counter value', message.processedID);

            var objectCounterID = property.OCID;

            if(err || updateEventNewState) {
                if(err) log.options(err.message, {
                    filenames: ['counters/' + property.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
                });

                if(property.debug && variablesDebugInfo) {
                    dynamicLog.add('v', objectCounterID, variablesDebugInfo);
                }
                return;
            }

            if(variables && Object.keys(variables).length) {

                if(variablesDebugInfo.UPDATE_EVENT_STATE &&
                    variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables &&
                    variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length) {

                    for(var i = 0; i < variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables.length; i++) {
                        // checking for %:?<name>:%
                        if(variablesDebugInfo.UPDATE_EVENT_STATE.unresolvedVariables[i].charAt(2) !== '?') {
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

                            if(property.debug) dynamicLog.add('v', objectCounterID, variablesDebugInfo);
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
                    $variables: variables
                };
                // replace variables in counter parameters
                // check parameters for unresolved variable and convert parameters from array
                var counter = property.collector + '(' + counterParameters.map(function(p){ return p.value; }).join(', ') + ')';
                for (i = 0; i < counterParameters.length; i++) {
                    var parameter = counterParameters[i];

                    if(parameter.value && typeof parameter.value === 'string') {
                        var res = calc.variablesReplace(parameter.value, variables);
                        if(res) {
                            var expression = parameter.value; // save old value

                            parameter.value = typeof res.value === 'string' ? calc.convertToNumeric(res.value) : res.value;

                            if(property.debug) {
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
                                if(property.debug) dynamicLog.add('v', objectCounterID, variablesDebugInfo);
                                return;
                            }
                        }
                    }
                    preparedCollectorParameters[parameter.name] = parameter.value;
                }

                if(variablesDebugInfo.UPDATE_EVENT_STATE && variablesDebugInfo.UPDATE_EVENT_STATE.important) var important = true;
                if(property.debug) dynamicLog.add('v', objectCounterID, variablesDebugInfo, important);
            }

            getValue({
                parentOCID: property.parentOCID,
                objectCounterID: objectCounterID,
                processedID: message.processedID,
                collector: property.collector,
                collectorParameters: preparedCollectorParameters,
                active: message.active,
                objectName: property.objectName,
                counterID: property.counterID,
                objectID: property.objectID,
                groupID: property.groupID,
                taskCondition: property.taskCondition,
            });
        });
    }

    // catch it at lib/server.js
    function getValue(message){

        var returnedMessage = {
            parentOCID: Number(message.parentOCID) ? Number(message.parentOCID) : undefined,
            objectCounterID: Number(message.objectCounterID),
            processedID: message.processedID,
            pid:  process.pid,
            groupID: message.groupID,
            taskCondition: message.taskCondition,
            variables: message.collectorParameters.$variables,
            collector: message.collector,
        };

        if(!message.collector || !collectorsObj[message.collector]) {
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

        var collector = collectorsObj[message.collector].get;

        //log.debug('Try to get value for ', message.collectorParameters.$variables.OBJECT_NAME , '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', message);

        //try to catch errors in collector code
        //profiling.stop('2. prepare to get counter value', message.processedID);
        //profiling.start('2. get counter value', message.processedID);
        try {
            collector(message.collectorParameters, function(err, result) {
                log.options('Receiving value from OCID ', message.objectCounterID, ': ',
                    message.collectorParameters.$variables.OBJECT_NAME ,
                    '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', result, '; err: ',
                    (err && err.stack ? err.stack : err), ', task condition: ', message.taskCondition,
                    ', collector: ', message.collector, '(', message.collectorParameters, ')', {
                        filenames: ['counters/' + message.counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'D'
                    });

                //if(Number(message.objectCounterID) === 3428) log.warn('Getting record ', result, ': ', message);

                if(collectorsObj[message.collector].active || collectorsObj[message.collector].separate) var preparedResult = result;
                else preparedResult = history.add(message.objectCounterID, result);

                if (!preparedResult || preparedResult.value === undefined || preparedResult.value === null) {
                    if(err) {
                        log.options('Collector ', message.collector, ' return error and result ', result, ' for OCID: ',
                            message.objectCounterID, ': ',
                            message.collectorParameters.$variables.OBJECT_NAME,
                            '(', message.collectorParameters.$variables.COUNTER_NAME, '): ',
                            err.stack ? err.stack : err, '; Parameters: ', message.collectorParameters, {
                                filenames: ['counters/' + message.counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'E'
                            });
                    } // else return nothing, skip it
                    return;
                } else if(err) {
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
                // properties: [{parentObjectName:.., parentCollector:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
                //     objectName:.., expression:..., mode: <0|1|2>}, {...}...]
                //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
                //     2 - update once when expression set to true, then once, when expression set to false
                var properties = getCountersForDependedCounters(message.counterID, message.objectID, message.collectorParameters.$variables);
                if (!properties || !properties.length) {
                    return log.options('Received value[s] ', preparedResult.value, ' from: ',  message.collectorParameters.$variables.OBJECT_NAME ,
                        '(', message.collectorParameters.$variables.COUNTER_NAME, '), depended counters not found', {
                            filenames: ['counters/' + message.counterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'D'
                        });
                }

                returnedMessage.properties = properties;
                returnedMessage.timestamp = preparedResult.timestamp;
                returnedMessage.value = preparedResult.value;

                //profiling.stop('3. get depended counters', message.processedID);
                //profiling.start('4. send data to server', message.processedID);

                // catch it at lib/server.js
                var sendMessageToServer = cfg.useProcIPCForChild ? childProc : clientIPC;
                sendMessageToServer.send(returnedMessage);

                //profiling.stop('Full cycle', returnedMessage.processedID);
                //profiling.stop('4. send data to server', message.processedID);
            });
        } catch(err) {
            log.options('Error in collector code "', message.collectorParameters, '" for OCID ', message.objectCounterID,
                ': ',  message.collectorParameters.$variables.OBJECT_NAME ,
                '(', message.collectorParameters.$variables.COUNTER_NAME, '): ', err.message, {
                    filenames: ['counters/' + message.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
                });
        }
    }

    function getCountersForDependedCounters(parentCounterID, parentObjectID, variables) {
        if(!countersObjects.counters) return;

        var parentCounter = countersObjects.counters.get(Number(parentCounterID));
        if(!parentCounter || !parentCounter.dependedUpdateEvents.size) return;

        var properties = [], updateEvents = parentCounter.dependedUpdateEvents;
        for(var [counterID, updateEvent] of updateEvents) {
            var counter = countersObjects.counters.get(counterID);
            if(!counter || (updateEvent.parentObjectID && Number(updateEvent.parentObjectID) !== Number(parentObjectID))) continue;

            if(updateEvent.objectFilter) {
                var res = calc.variablesReplace(updateEvent.objectFilter, variables);
                if(res) {
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

            var objectsIDs = updateEvent.parentObjectID ? counter.objectsIDs : new Map([ [Number(parentObjectID), 0] ]);
            for(var objectID of objectsIDs.keys()) {
                var objectName = countersObjects.objects.get(objectID);
                if(!objectName || !counter.objectsIDs.has(objectID) || (objectFilter && !objectFilterRE.test(objectName))) continue;

                properties.push({
                    parentObjectName: countersObjects.objects.get(Number(parentObjectID)),
                    parentCounter : parentCounter.counterName,
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

        // !!! Don't set variables = parentVariables . It will be a reference.
        // Need to save parentVariables unchanged after add new values to variables
        if(typeof parentVariables === 'object') {
            for (var name in parentVariables) variables[name] = parentVariables[name];
        }

        // add static data about current and parent objects to variables list
        variables.PARENT_OBJECT_NAME = property.parentObjectName === undefined ? '' : property.parentObjectName;
        variables.PARENT_COUNTER_NAME = property.parentCounter  === undefined ? '' : property.parentCounter ;
        variables.OBJECT_NAME = objectName === undefined ? '' : objectName;
        variables.PARENT_VALUE = property.parentObjectValue === undefined ? '' : property.parentObjectValue;
        variables.COUNTER_NAME = counterName === undefined ? '' : counterName;

        // clone cache content to a new data for save cached content
        var data = JSON.parse(JSON.stringify( {
            variables: variablesDBCache.get(counterID) || [],
            expressions: variablesExpressionsDBCache.get(counterID) || [],
            properties: objectsPropertiesDBCache.get(objectID) || [],
        }));

        if(property.parentOCID && property.expression) {
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
            This redefine value of UPDATE_EVENT_STATE from counter
         */
        if(data.properties && data.properties.length && (
            (data.expressions && data.expressions.length) ||
            (data.variables && data.variables.length)
        )) {

            data.properties.forEach(function (property) {
                if(!property.name) return;
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
            updateEventNewState;

        // loop for  resolve variables in expressions and from history functions
        async.doWhilst(function (callback) {
            newVariables = [];

            // resolve variables from history functions
            async.parallel([function (callback) {

                if (!data.variables.length) return callback();
                async.each(data.variables, function (variable, callback) {
                    // if this variable was calculated at previous loop
                    if(!variable.name) return callback();

                    /* I don't understand this condition
                    if(!property.parentOCID) {
                        return callback(new Error('Variable ' + variable.name + ' for objectID ' + objectID +
                            ' and counterID ' + counterID + ': ' +
                            objectName + '(' + counterName + ') did not have an object to counter relation objectCounterID'));
                    }
                     */

                    var res = calc.variablesReplace(variable.functionParameters, variables);
                    if(res) {
                        log.options('Replacing variables in func parameters ', objectName,
                            '(', counterName, '): ', variable.name, ' = ', variable.function,
                            '(', variable.functionParameters, ' => ', res.value, '); ', variables, {
                                filenames: ['counters/' + counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'D'
                            });
                        variable.functionParameters = res.value;

                        if(res.unresolvedVariables.length) return callback();
                    }

                    // historyFunctionList = new Set()
                    if(!variable.function || !historyFunctionList.has(variable.function)) {
                        return callback(new Error('Unknown history function: "' + variable.function +
                            '" for get data for variable ' + variable.name + ', ' +
                            objectName + '(' + counterName + ')'));
                    }

                    var funcParameters = [];
                    if(variable.functionParameters)
                        if(typeof(variable.functionParameters) === 'string') {
                            funcParameters = variable.functionParameters.split(/[ ]*,[ ]*/).map(function (parameter) {
                                // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing parameter
                                var hasExclamation = false;
                                if(String(parameter).charAt(0) === '!') {
                                    parameter = parameter.slice(1);
                                    hasExclamation = true;
                                }
                                return hasExclamation ? '!' + String(calc.convertToNumeric(parameter)) : calc.convertToNumeric(parameter);
                            });
                        } else funcParameters.push(variable.functionParameters);

                    // calculate and add objectCounterID as first parameter for history function
                    if(variable.objectVariable) { // objectVariable is right, not objectName
                        res = calc.variablesReplace(variable.objectVariable, variables);
                        if(res) {
                            if(res.unresolvedVariables.length) return callback();
                            var variableObjectName = res.value.toUpperCase();
                        } else variableObjectName = variable.objectVariable.toUpperCase();

                        var OCID = countersObjects.objectName2OCID.has(variableObjectName) ?
                            countersObjects.objectName2OCID.get(variableObjectName).get(Number(variable.parentCounterID)) : null;
                        if(!OCID) return callback();
                    } else {
                        if(variable.OCID) {
                            variableObjectName = variable.objectName;
                            OCID = variable.OCID;
                        } else {
                            variableObjectName = property.objectName;
                            OCID = countersObjects.counters.has(Number(variable.parentCounterID)) ?
                                countersObjects.counters.get(Number(variable.parentCounterID)).objectsIDs.get(Number(objectID)) : null;
                            if(!OCID) {
                                log.options('CounterID: ', variable.parentCounterID, ' is not linked to the objectID: ',
                                    objectID, ' for getting historical data for variable: ', variableObjectName,
                                    '(', variable.parentCounterName + '): ', variable.name, ' = ', variable.function,
                                    '(`', funcParameters.join('`, `'), '`)', {
                                        filenames: ['counters/' + counterID, 'counters.log'],
                                        emptyLabel: true,
                                        noPID: true,
                                        level: 'D'
                                    });
                                return callback();
                            }
                        }
                    }

                    // add callback function as last parameter to history function
                    log.options('Processing history variable: ', variableObjectName,
                        '(', variable.parentCounterName + '): ', variable.name, ' = ', variable.function,
                        '(`', funcParameters.join('`, `'), '`), OCID:', OCID, ' variable: ', variable, {
                            filenames: ['counters/' + counterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'D'
                        });
                    funcParameters.unshift(OCID);
                    funcParameters.push(function(err, result) {
                        if (err) return callback(err);

                        if(result !== undefined && result !== null) {
                            variables[variable.name] = result ? result.data : result;
                            newVariables.push(variable.name);
                        }

                        funcParameters.pop(); // remove callback for debugging
                        log.options('History variable value for ', objectName,
                            '(', counterName, '): ', variableObjectName + '(' + variable.parentCounterName + '): ',
                            variable.name, ': ', variable.function, '(', funcParameters.join(', '), ') = ', result, {
                                filenames: ['counters/' + counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'D'
                            });

                        funcParameters.shift();
                        if(property.debug) {
                            var initVariables = {};
                            for(var name in variables) { initVariables[name] = variables[name]; }
                            variablesDebugInfo[variable.name] = {
                                timestamp: Date.now(),
                                name: variable.name,
                                expression: variableObjectName + '(' + variable.parentCounterName + '): ' + variable.function + '(' + funcParameters.join(', ') + ')',
                                variables: initVariables,
                                functionDebug: result ? result.records : undefined,
                                result: result ? result.data : result
                            };
                        }
                        variable.name = null;
                        callback();
                    });

                    // send array as a function parameters, i.e. func.apply(this, [prm1, prm2, prm3, ...]) = func(prm1, prm2, prm3, ...)
                    // funcParameters = [objectCounterID, prm1, prm2, prm3,..., callback]; callback(err, result), where result = [{data:<data>, }]
                    history[variable.function].apply(this, funcParameters);

                }, callback)

                // resolve variables from objects properties
            }, function (callback) {

                if (!data.properties.length) return callback();

                async.each(data.properties, function (property, callback) {
                    // if this property was calculated at previous loop
                    if(!property.name) return callback();

                    var name = property.name.toUpperCase();
                    log.options('Variable name for object properties: ', name, {
                        filenames: ['counters/' + counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'D'
                    });
                    if(property.mode === 3) { // it an expression, calculate it
                        calc(property.value, variables, counterID,
                            function (err, result, functionDebug, unresolvedVariables, initVariables) {
                            if (!unresolvedVariables && err) return callback(err);

                            for(var i = 0, hasUnresolved = false; unresolvedVariables && i < unresolvedVariables.length; i++) {
                                if(unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                                    hasUnresolved = true;
                                    break;
                                }
                            }

                            if(!hasUnresolved) {
                                variables[name] = result;
                                // if all variables are resolved, then don\'t try to recalculate this expression
                                if(!unresolvedVariables && result !== null) {
                                    newVariables.push(name);
                                    //property.name = null;
                                }
                            }

                            if(property.debug) {
                                variablesDebugInfo[name] = {
                                    timestamp: Date.now(),
                                    name: name,
                                    expression: property.value,
                                    variables: initVariables,
                                    result: result,
                                    functionDebug: functionDebug,
                                    unresolvedVariables: unresolvedVariables
                                };
                            }

                            callback();
                        });
                    } else { // it is not an expression, just replacing variables with values

                        var res = calc.variablesReplace(property.value, variables);
                        if(!res || (res && !res.unresolvedVariables.length)) {
                            // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing value
                            variables[name] = calc.convertToNumeric((res ? res.value : property.value));
                            newVariables.push(name);
                            //property.name = null
                        }
                        log.options('Replacing variables ', objectName, '(', counterName, '): result: ', name, ' = ',
                            (res ? res.value : property.value), ' unresolved variables: ',
                            (res && res.unresolvedVariables.length ? res.unresolvedVariables : 'none') ,
                            ' variables: ', variables, {
                                filenames: ['counters/' + counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'D'
                            });

                        if(property.debug) {
                            variablesDebugInfo[name] = {
                                timestamp: Date.now(),
                                name: name,
                                expression: property.value,
                                result: variables[name],
                                variables: variables,
                                unresolvedVariables: res && res.unresolvedVariables.length ? res.unresolvedVariables : undefined
                            };
                        }

                        callback();
                    }
                }, callback)

                // resolve variables from expression
            }, function (callback) {

                if (!data.expressions.length) return callback();

                async.each(data.expressions, function (variable, callback) {
                    var variableName = variable.name;

                    // if this variable was calculated at previous loop
                    if(!variableName) return callback();

                    log.options('Processing variable for expression: ', variableName, ' = ', variable.expression, {
                        filenames: ['counters/' + counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'D'
                    });
                    calc(variable.expression, variables, counterID,
                        function (err, result, functionDebug, unresolvedVariables, initVariables) {
                        if (!unresolvedVariables && err) return callback(err);

                        if(property.debug || variableName === 'UPDATE_EVENT_STATE') {
                            variablesDebugInfo[variable.name] = {
                                timestamp: Date.now(),
                                name: variable.name,
                                expression: variable.expression,
                                variables: initVariables,
                                functionDebug: functionDebug,
                                unresolvedVariables: unresolvedVariables,
                                result: result,
                            };
                        }

                        for(var i = 0, hasUnresolved = false; unresolvedVariables && i < unresolvedVariables.length; i++) {
                            if(unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                                hasUnresolved = true;
                                break;
                            }
                        }

                        if(hasUnresolved) return callback();

                        // if all variables are resolved, then don\'t try to recalculate this expression
                        if(!unresolvedVariables && result !== null) {
                            //variable.name = null;
                            newVariables.push(variableName);
                        }
                        variables[variableName] = result;

                        if(variableName !== 'UPDATE_EVENT_STATE') return callback();

                        updateEventNewState = null;

                        // if variableName == 'UPDATE_EVENT_STATE'

                        // checking for update event state is changed
                        // !updateEventState !== !result for boolean compare
                        if (updateEventState === undefined || !updateEventState !== !result) {

                            variables.UPDATE_EVENT_TIMESTAMP = Date.now();
                            // result can be an undefined when counter has not update event expression
                            variables.UPDATE_EVENT_STATE = result === undefined ? true : !!result;

                            /*
                            property.mode:
                            0: Update each time when expression value is true
                            1: Update once when expression value is changed to true
                            2: Update once when expression value is changed to true and once when changed to false
                            3: Update each time when expression value is true and once when changed to false
                            4: Update once when expression value is changed to false
                            */
                            // it's not an error. don\'t use new Error() in callback()

                            // here update event status is changed to true or false
                            if(property.mode === 1 && !result ) {
                                if(!hasUnresolved) updateEventNewState = 'Update event state was changed to false';
                                return callback();
                            }
                            if(property.mode === 4 && result) {
                                if(!hasUnresolved) updateEventNewState = 'Update event state was changed to true';
                                return callback();
                            }

                        } else {  // here update event status is not changed
                            if(property.mode === 1 || property.mode === 2 || (property.mode === 3 && !result) || property.mode === 4) {
                                if(!hasUnresolved) updateEventNewState = 'Update event state was not changed';
                                return callback();
                            }
                        }

                        // here update event status may be changed or not changed
                        if(property.mode === 0 && !result) {
                            if(!hasUnresolved) updateEventNewState = 'Update event state was changed or not changed and now it is false';
                            return callback();
                        }

                        callback();
                    });
                }, callback)

            }], callback)
        }, function() {
            //return (newVariables.length && ++attempts < maxAttemptsToResolveVariables);

            // break variables calculation when no new variables are resolved
            if(!newVariables.length) return false;

            if(++attempts >= maxAttemptsToResolveVariables) {
                log.options('Attempts: ', attempts,': ', objectName, '(', counterName,
                    '): new\\prev unresolved variables: ', newVariables ,'\\', prevNewVariables,
                    '; variables : ', variables, '; source data from DB: ', data, {
                        filenames: ['counters/' + counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'W'
                    });
                return false;
            }

            if(newVariables.length === prevNewVariables.length) {
                // compare previous and current variables names
                for(var i = 0; i < newVariables.length; i++) {
                    if(prevNewVariables.indexOf(newVariables[i]) === -1) {
                        prevNewVariables = newVariables.slice(); //copy newVariables to prevNewVariables
                        return true; // find different variables names. continue to calculate variables
                    }
                }
                // previous and current variables names are equal
                // break variables calculation
                return false;
            }

            prevNewVariables = newVariables.slice(); //copy newVariables to prevNewVariables
            return true; // continue to calculate variables

        }, function(err) {
            if(err) {
                return callback(new Error('Error while calculating variables values for ' +
                    objectName + '(' + counterName + '): ' + err.message));
            }

            log.options('Attempts: ', attempts,': ', objectName, '(', counterName,'): new\\prev variables: ',
                newVariables ,'\\', prevNewVariables,'; variables : ', variables, ' for data for DB: ', data, {
                    filenames: ['counters/' + counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'D'
                });

            if (variablesDebugInfo.UPDATE_EVENT_STATE) {
                if (updateEventNewState) variablesDebugInfo.UPDATE_EVENT_STATE.result += ' (' + updateEventNewState + ')';
                else variablesDebugInfo.UPDATE_EVENT_STATE.important = true;
                variablesDebugInfo.UPDATE_EVENT_STATE.result += '. Calculation cycles: ' + attempts;
                variablesDebugInfo.UPDATE_EVENT_STATE.name = 'Update event. Mode: ' + updateEventsMode[property.mode]
            }

            if(property.parentOCID && property.expression) {
                if (variables.UPDATE_EVENT_STATE === undefined) return callback(null, updateEventNewState, variables, variablesDebugInfo);
                else {
                    var sendMessageToServer = cfg.useProcIPCForChildUpdateEvent ? childProc : clientIPC;
                    sendMessageToServer.send({
                        updateEventKey: property.parentOCID + '-' + property.OCID,
                        updateEventState: variables.UPDATE_EVENT_STATE, // don't replace to !!result
                    });
                    callback(null, updateEventNewState, variables, variablesDebugInfo);
                    return;
                }
            }
            callback(null, updateEventNewState, variables, variablesDebugInfo);
        });
    }

    function connectingCollectors(callback) {

        // already connected
        if(isConnectingToCollectors === 2) return callback();
        // connection in progress
        if(isConnectingToCollectors === 1) return setTimeout(connectingCollectors, 1000, callback);

        isConnectingToCollectors = 1;
        collectors.get(null, function(err, collectorsObj) {
            if (err) {
                isConnectingToCollectors = 0;
                destroyCollectors(function() {
                    callback(new Error('Can\'t get collectors: ' + err.nessage));
                })
            }

            log.debug('Collectors: ', collectorsObj);
            var callbackAlreadyCalled = {};

            async.each(Object.keys(collectorsObj), function (name, callback) {

                if(collectorsObj[name].active || collectorsObj[name].separate) {
                    activeCollector.connect(name, function(err, collector) {
                        // don't use return callback because error can occurred several times
                        if(err) return log.error('Can\'t connect to collector ', name, ': ', err.message);

                        for(var key in collector) {
                            collectorsObj[name][key] = collector[key];
                        }

                        // don't call callback again when reconnect to collector
                        if(!callbackAlreadyCalled[name]) {
                            callbackAlreadyCalled[name] = true;
                            callback();
                        }
                        log.debug('Connected to ', (collectorsObj[name].active ? 'active' : 'separate'), ' collector: ', name, ': OK');
                    });
                    return;
                }

                var collectorPath = path.join(__dirname, '..', conf.get('collectors:dir'), name, 'collector');

                // empty require cache for collector
                if (require.cache[require.resolve(collectorPath)]) delete require.cache[require.resolve(collectorPath)];

                try {
                    var collector = require(collectorPath);
                    for(var key in collector) {
                        collectorsObj[name][key] = collector[key];
                    }
                    log.debug('Attaching passive collector ', name, ': OK');
                } catch (err) {
                    log.error('Error attaching to passive collector ' + name + ': ' + err.message);
                }
                callback();
            }, function (err) {
                if(err) {
                    isConnectingToCollectors = 0;
                    destroyCollectors(function() {
                        callback(new Error('Can\'t get collectors: ' + err.nessage));
                    })
                }
                isConnectingToCollectors = 2;
                callback(err, collectorsObj);
            });
        });
    }
}
