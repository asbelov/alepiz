/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const async = require("async");
const collectors = require("../lib/collectors");
const log = require('../lib/log')(module);

var serverMain = {
    init: init,
    getCountersValues: getCountersValues,
    processCounterMessage: processCounterMessage,
    processCounterResult: processCounterResult,
};

module.exports = serverMain;
var childrenProcesses,
    processedObjects,
    updateEventsStatus,
    processedID = 1,
    activeCollectors = {},
    separateCollectors = {},
    runCollectorSeparately = {};


function init(params, callback) {
    childrenProcesses = params.childrenProcesses;
    processedObjects = params.processedObjects;
    updateEventsStatus = params.updateEventsStatus;

    collectors.get(null, function (err, collectorsObj) {
        if (err) throw(err);

        for (var name in collectorsObj) {
            if (collectorsObj[name].active) activeCollectors[name] = true;
            else if (collectorsObj[name].separate) separateCollectors[name] = true;
            else if (collectorsObj[name].runCollectorSeparately) runCollectorSeparately[name] = true;
        }

        callback();
    });
}

// message = {err, result, parameters, collectorName}
function processCounterResult (message) {
    var objectCounterID = message.parameters.$id;
    if(!processedObjects.has(objectCounterID)) {
        processedObjects.set(objectCounterID, {
            active: true,
        });
    }

    processedObjects.get(objectCounterID)[processedID] = true;

    message.processedID = processedID++;
    childrenProcesses.send(message);
}


function processCounterMessage(message, cfg) {

    if(message.variables.UPDATE_EVENT_STATE !== undefined) {
        var updateEventKey = message.parentOCID + '-' + message.objectCounterID;
        updateEventsStatus.set(updateEventKey, message.variables.UPDATE_EVENT_STATE);
    }

    var objectCounterID = Number(message.objectCounterID),
        processedObj = processedObjects.get(objectCounterID);

    // may be
    if (!processedObj) {

        if(!message.collector || !activeCollectors[message.collector]) {
            log.warn('Can\'t processing data from passive collector ', message.collector, ' with unreachable OCID for ',
                message.variables.OBJECT_NAME, '(', message.variables.COUNTER_NAME, '), unreachable OCID: ',
                objectCounterID, ', message: ', message);
            return;
        }

        log.info('Returned data with unreachable OCID ', objectCounterID,' for active collector ', message.collector,
            ": ", message.variables.OBJECT_NAME, '(', message.variables.COUNTER_NAME, ') message: ', message);

        processedObjects.set(objectCounterID, { active: true });
        processedObj = processedObjects.get(objectCounterID);
        processedObj[message.processedID] = true;
    }

    if(!processedObj[message.processedID]) {
        log.warn('Returned data with unreachable processID for ',  message.variables.OBJECT_NAME,
            '(', message.variables.COUNTER_NAME, '): processID: ', message.processedID, ' current processID: ',
            processedID, ', OCID: ', objectCounterID, ', message: ', message);

        if(!processedObj.active) return;

        if(typeof processedObj !== 'object' ||
            Object.keys(processedObj).length === 2) {
            processedObjects.set(objectCounterID, { active: true });
            processedObj = processedObjects.get(objectCounterID);
        }

        processedObj[message.processedID] = true;
    }

    if(!processedObj.active) {
        delete processedObj[message.processedID];
        if (Object.keys(processedObj).length === 1) delete processedObjects.delete(objectCounterID);
    }

    /*
    var values = Array.isArray(message.value) ? message.value : [message.value];

    // properties: [{parentObjectName:.., parentCounter:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
    //     objectName:.., counterName:..., expression:..., mode: <0|1|2|3|4>, groupID, taskCondition, ...}, {...}...]
    //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
    //     2 - update once when expression set to true, then once, when expression set to false
    var properties = message.properties;

    log.debug('Received value[s] ', values, ' from OCID ', objectCounterID, ' getting values for counters depended on ',
        message);
    values.forEach(function (value) {
        if(typeof value === 'object') value = JSON.stringify(value);

        // add parentOCID and add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:%
        // variable
        properties.forEach(function(property) {
            property.parentObjectValue = value;
            property.parentOCID = objectCounterID;
        });

        getCountersValues(properties, message.variables);
    });
     */

    // closure for save message variable
    (function (message) {
        var values = Array.isArray(message.value) ? message.value : [message.value];

        // properties: [{parentObjectName:.., parentCounter:.., OCID: <objectsCountersID>, collector:<collectorID> , counterID:.., objectID:..,
        //     objectName:.., counterName:..., expression:..., mode: <0|1|2|3|4>, groupID, taskCondition, ...}, {...}...]
        //     mode 0 - update each time, when expression set to true, 1 - update once when expression change to true,
        //     2 - update once when expression set to true, then once, when expression set to false
        var properties = message.properties;

        log.debug('Received value[s] ', values, ' from OCID ', objectCounterID, ' getting values for depended counters ',
            message);
        async.eachLimit(values, cfg.returnedValuesProcessedLimit || 1000, function (value, callback) {
            if (typeof value === 'object') value = JSON.stringify(value);

            // add parentOCID and add value, returned from parent counter, for initialize predefined %:PARENT_VALUE:%
            // variable
            properties.forEach(function (property) {
                property.parentObjectValue = value;
                property.parentOCID = objectCounterID;
            });

            getCountersValues(properties, message.variables);

            setTimeout(callback, cfg.sleepTimeAfterValueProcessed || 0);
        }, function () {});
    })(message);
}

/*
 get values for specific counters

 properties - [{OCID: <objectCounterID>, collector: <collectorName>, counterID: <counterID>, objectID: <objectID>}, ....]
 parentVariables - variables from parent object {name1: val1, name2: val2, ....}. can be skipped
 */
function getCountersValues(properties, parentVariables, forceToGetValueAgain) {

    if(typeof parentVariables === 'object' && !Object.keys(parentVariables).length) parentVariables = undefined;

    // I don\'t known why, but sometimes data from properties object is replaced by data from other object
    // here we save properties object to filteredProperties
    var filteredProperties = [];
    var activeCounters = [];
    properties.forEach(function (property) {
        var savingProperty = {};
        if(processedObjects.has(Number(property.OCID))) {
            if (processedObjects.get(Number(property.OCID)).active) {
                if (forceToGetValueAgain) {
                    savingProperty.removeCounter = property.counterName + '(' + property.objectName + ')';
                    activeCounters.push(savingProperty.removeCounter);
                } else {
                    log.debug('Counter ', property.counterName, '(', property.objectName,
                        ') is processed to receive data by active collector "', property.collector,
                        '". Skipping add same counter.');
                    return;
                }
            }
            if (runCollectorSeparately[property.collector]) {
                log.debug('Skipping getting value ', property.collector,
                    ', because another collector is running and "runCollectorSeparately" option is set');
                return;
            }
        }

        for(var key in property) {
            savingProperty[key] = property[key];
        }

        filteredProperties.push(savingProperty);
    });


    // they will be removed letter in childGetCountersValue.js getValue()
    if(activeCounters.length) {
        log.info('Counters with an active collector will be removed and updated: ', activeCounters);
    }

    filteredProperties.forEach(function (property) {
        getCounterValue(property, parentVariables);
    });
}

function getCounterValue(property, parentVariables) {

    var objectCounterID = Number(property.OCID);
    var collector = property.collector;
    var isActive = !!activeCollectors[collector]; // convert to boolean

    if(!processedObjects.has(objectCounterID)) {
        processedObjects.set(objectCounterID, {
            active: isActive
        });
    }

    processedObjects.get(objectCounterID)[processedID] = true;

    var key = property.parentOCID + '-' + property.OCID;
    var message = {
        processedID: processedID++,
        property: property,
        parentVariables: parentVariables,
        updateEventState: updateEventsStatus.get(key),
        active: isActive //|| !!separateCollectors[collector]
    };

    childrenProcesses.send(message);
}
