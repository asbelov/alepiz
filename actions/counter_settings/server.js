/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
 * Created on Sat Aug 22 2015 17:41:39 GMT+0600 (RTZ 5 (зима))
 */
var log = require('../../lib/log')(module);
var counterSaveDB = require('../../rightsWrappers/counterSaveDB');

module.exports = function(args, callback) {
    log.debug('Starting action \"'+args.actionName+'\" with parameters', args);

    if(args.deleteCounter){
        if(!Number(args.counterID) || Number(args.counterID) !== parseInt(args.counterID, 10))
            return callback(new Error('Invalid counter ID for delete counter: ' + args.counterID + ' (' + args.name + ')'));

        counterSaveDB.deleteCounter(args.username, args.counterID, args.name, function(err){
            if(err) return callback(err);

            log.info('Counter ', args.counterID ,'(' + args.name + ') was deleted');
            callback();
        });
        return;
    }

    if(!args.linkedObjectsIDs) return callback(new Error('Linked objects are not selected'));
    try {
        var linkedObjectsIDs = JSON.parse(args.linkedObjectsIDs).map(function (object) {
            return Number(object.id);
        });
    } catch (e) {
        return callback(new Error('Can\'t parse JSON string for getting linked objects IDs: ' + e.message));
    }

    var collectorParameters = {};
    var preparedVariables = {};
    var preparedUpdateEvents = {};
    var variablesOrder = args.variablesOrder ? args.variablesOrder.split(',').map(n => Number(n)) : [];
    var updateEventsOrder = args.updateEventsOrder ? args.updateEventsOrder.split(',').map(n => Number(n)) : [];
    for(var inputID in args) {
        if(!args.hasOwnProperty(inputID)) continue;

        if(inputID.toLowerCase().indexOf('collectorParameter_'.toLowerCase()) === 0) {
            var name = inputID.substring(String('collectorParameter_'.toLowerCase()).length);
            collectorParameters[name] = args[inputID];
            continue;
        }

        // updateEvent_2_counterID or updateEvent_2_objectID
        var num = Number(inputID.replace(/^updateEvent_(\d+)_.+$/i, '$1'));
        if(num) {
            if(!preparedUpdateEvents[num]) {
                preparedUpdateEvents[num] = {
                    updateEventOrder: updateEventsOrder.indexOf(num),
                };
            }
            preparedUpdateEvents[num][inputID.substring(String('updateEvent_' + String(num) + '_').length)] = args[inputID];
            continue;
        }

        num = Number(inputID.replace(/^variable_(\d+)_.+$/i, '$1'));
        if(num){
            if(!preparedVariables[num]) {
                preparedVariables[num] = {
                    variableOrder: variablesOrder.indexOf(num),
                };
            }
            preparedVariables[num][inputID.substring(String('variable_' + String(num) + '_').length)] = args[inputID];
        }
    }

    log.debug('Collector parameters: ', collectorParameters);
    var updateEvents = [];
    // checking update events and creating update events array
    for(var eventNum in preparedUpdateEvents) {
        if(!preparedUpdateEvents.hasOwnProperty(eventNum)) continue;

        var updateEvent = preparedUpdateEvents[eventNum];

        if(updateEvent.objectID) {

            updateEvent.mode = Number(updateEvent.mode);

            if(updateEvent.mode !== 0 && updateEvent.mode !== 1 && updateEvent.mode !== 2 &&
                updateEvent.mode !== 3  && updateEvent.mode !== 4) {
                return callback(new Error('Update event for counter ' + args.counterID +
                    ' incorrect: mode is not 0 or 1 or 2 or 3 or 4 (' + updateEvent.mode + ')'));
            }

            updateEvent.objectID = Number(updateEvent.objectID);

            if(updateEvent.objectID !== parseInt(updateEvent.objectID, 10))
                return callback(new Error('Update event for counter ' + args.counterID +
                    ' incorrect: object ID is not an integer (' + updateEvent.objectID + ')'));

            if(updateEvent.objectID === 0) updateEvent.objectID = null;
        } else updateEvent.objectID = null;

        if(updateEvent.counterID) {
            /*
            if(Number(args.counterID) === updateEvent.counterID)
                return callback(new Error('Update event for counter ' + args.counterID + ' incorrect: counter ID ('+
                    args.counterID + ') is equal to update event counterID (' + updateEvent.counterID + ')'));
            */

            var updateEventOrder =
                updateEvent.updateEventOrder === parseInt(String(updateEvent.updateEventOrder), 10) &&
                updateEvent.updateEventOrder >= 0 ? updateEvent.updateEventOrder : null;

            if(Number(updateEvent.counterID) === parseInt(updateEvent.counterID, 10)) {
                updateEvents.push({
                    counterID: Number(updateEvent.counterID),
                    objectID: updateEvent.objectID,
                    expression: updateEvent.expression ? updateEvent.expression : null,
                    mode: updateEvent.mode,
                    objectFilter: updateEvent.objectID && updateEvent.objectFilter ? updateEvent.objectFilter : null,
                    description: updateEvent.description || null,
                    updateEventOrder: updateEventOrder,
                });
            } else return callback(new Error('Update event for counter ' + args.counterID +
                ' incorrect: counter ID is not an integer (' + updateEvent.counterID +')'));
        } else return callback(new Error('Update event for counter ' + args.counterID +
            ' incorrect: counter ID is not set for update event: "' + JSON.stringify(updateEvent) + '"'));
    }

    log.debug('Update events: ', updateEvents);

    var variables = {};
    for(num in preparedVariables) {
        if (!preparedVariables.hasOwnProperty(num)) continue;

        if(!preparedVariables[num].name) return callback(new Error('One of variable names is not set: ' +
            JSON.stringify(preparedVariables[num])));

        // convert to upper case, remove "%:", ":%" and spaces from begin and end of variable name
        name = preparedVariables[num].name.toUpperCase().replace(/^%:(.+):%$/, '$1').replace(/^ *(.+?) *$/, '$1');

        if (variables[name]) return callback(new Error('Some variables has an equal names: ' + name));

        variables[name] = {};

        variables[name].variableOrder = preparedVariables[num].variableOrder ===
            parseInt(String(preparedVariables[num].variableOrder), 10) &&
            preparedVariables[num].variableOrder >= 0 ? preparedVariables[num].variableOrder : null;

        variables[name].description = preparedVariables[num].description || null;

        // variable with expression
        if (preparedVariables[num].expression !== undefined) {

            if(preparedVariables[num].expression === '') return callback(new Error('Expression for variable "'+name+'" is not set'));
            variables[name].expression = preparedVariables[num].expression;

        } else {

            if (!preparedVariables[num].parentCounterName) return callback(new Error('Counter for variable "'+name+'" is not set'));
            variables[name].parentCounterName = preparedVariables[num].parentCounterName.toUpperCase();

            if (preparedVariables[num].objectID) variables[name].objectID = Number(preparedVariables[num].objectID);
            else if (preparedVariables[num].objectVariable) variables[name].objectName = preparedVariables[num].objectVariable.trim();

            if (!preparedVariables[num].function) return callback(new Error('Function for variable "'+name+'" is not set'));
            variables[name].function = preparedVariables[num].function;

            if (preparedVariables[num].function_parameters)
                variables[name].functionParameters = preparedVariables[num].function_parameters !== undefined ? preparedVariables[num].function_parameters : '';
        }
    }
    log.debug('Variables: ', variables);

    var counterData = {
        initObjectsIDs: linkedObjectsIDs,
        counter: {
            name: args.name,
            collectorID: args.collectorID,
            groupID: args.groupID,
            unitID: args.unitID,
            keepHistory: args.keepHistory,
            keepTrends: args.keepTrends,
            sourceMultiplier: args.sourceMultiplier,
            objectID: args.objectID,
            counterID: args.counterID,
            description: (args.description ? args.description : null),
            disabled: (args.disabled ? 1 : 0),
            debug: (args.debug ? 1 : 0),
            taskCondition: (args.taskCondition ? 1 : 0),
            updateVariablesRef: args.updateVariablesRef, //= oldCounterName: update variables references when counter name is changed
            timestamp: args.timestamp,
        },
        counterParameters: collectorParameters,
        updateEvents: updateEvents,
        variables: variables,
        sessionID: args.sessionID,
    };

    if(args.exportCounter && args.counterID) {
        log.info('Counter with ID ', args.counterID, '(' + args.name + ') was exported successfully: ', args, collectorParameters, updateEvents, variables);
        counterData.exportCounter = true;
        return callback(null, counterData);
    }

    counterSaveDB.saveCounter(args.username, counterData, function(err, counterID) {
        if(err) return callback(err);

        log.info('Counter with ID ', counterID, '(' + args.name + ') was ', (args.counterID ? ' updated' : ' added'), ' successfully: ', args, collectorParameters, updateEvents, variables);

        // set counterID for new counter
        counterData.counter.counterID = counterID;
        callback(null, counterData);
    });
};