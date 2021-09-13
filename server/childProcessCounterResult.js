/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var calc = require("../lib/calc");

module.exports = function (err, counter, param, variables, result, cache, history, callback) {
    var errPrefix = counter.objectName + '(' + counter.counterName + '): ' + counter.collector + '(' +
        (param ? param.join(', ') : '') + '): ';

    //if(Number(counter.objectCounterID) === 3428) log.warn('Getting record ', result, ': ', counter);

    // result was saved to the history in activeCollector.js for active and separate
    // for decrees number of transfers of result value
    var preparedResult = history.add(counter.objectCounterID, result);

    if (!preparedResult || preparedResult.value === undefined || preparedResult.value === null) {
        if(err) {
            callback(new Error('collector return error and result ' + result + (err.stack ? err.stack : JSON.stringify(err))));
        } // else return nothing, skip it
        return;
    } else if(err) {
        log.options(errPrefix + 'collector return result: ', result, '; Error: ', err.message, {
            filenames: ['counters/' + counter.counterID, 'counters.log'],
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
    getDependedOCIDs(counter, variables, cache, function (err, dependedOCIDs) {
        if(err) return callback(err);
        if(!dependedOCIDs) return;

        var returnedMessage = [
            dependedOCIDs,
            variables,
            counter.prevUpdateEventExpressionResult,
            counter.OCID,
            preparedResult.value,
        ]

        //profiling.stop('3. get depended counters', message.processedID);
        //profiling.start('4. send data to server', message.processedID);

        // catch it at server.js
        callback(null, returnedMessage);

        //profiling.stop('Full cycle', returnedMessage.processedID);
        //profiling.stop('4. send data to server', message.processedID);
    });


    function getDependedOCIDs(parentCounter, variables, cache, callback) {
        if(!cache.counters) return callback();

        var parentCounterID = parentCounter.counterID,
            parentObjectID = parentCounter.objectID;
        var errPrefix = parentCounter.objectName + '(' + parentCounter.counterName + '): ';

        parentCounter = cache.counters.get(parentCounterID);
        if(!parentCounter || !parentCounter.dependedUpdateEvents.size) return;

        var dependedOCIDs = [], updateEvents = parentCounter.dependedUpdateEvents;
        for(var [dependedCounterID, updateEvent] of updateEvents) {
            var dependedCounter = cache.counters.get(dependedCounterID);
            if(!dependedCounter || (updateEvent.parentObjectID && updateEvent.parentObjectID !== parentObjectID)) continue;

            var objectFilterRE = null;
            if(updateEvent.objectFilter) {
                var res = calc.variablesReplace(updateEvent.objectFilter, variables);
                if(res) {
                    if (res.unresolvedVariables.length) {
                        log.options(errPrefix, 'object filter "', updateEvent.objectFilter,
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
                    objectFilterRE = new RegExp(objectFilter, 'i');
                } catch (e) {
                    log.options(errPrefix, 'object filter "', updateEvent.objectFilter,
                        '" in update event is not a regular expression: ', e.message, {
                            filenames: ['counters/' + parentCounterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'W'
                        });
                    continue;
                }
            }

            var objectsIDs = updateEvent.parentObjectID ? dependedCounter.objectsIDs : new Map([ [Number(parentObjectID), 0] ]);
            for(var objectID of objectsIDs.keys()) {
                var objectName = cache.objects.get(objectID);
                if (!objectName || !dependedCounter.objectsIDs.has(objectID) || (objectFilterRE && !objectFilterRE.test(objectName))) continue;

                dependedOCIDs.push(dependedCounter.objectsIDs.get(objectID));
            }
        }
        //log.warn('Returned props: ', dependedOCIDs, ': ', countersObjects.counters.get(Number(parentCounterID)));
        return callback(null, dependedOCIDs);
    }
}
