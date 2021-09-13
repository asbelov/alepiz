/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var threads = require('../lib/threads');
var CalcVars = require('./childVariables');
const IPC = require("../lib/IPC");
const proc = require("../lib/proc");
var history = require("../models_history/history");
const passiveCollectors = require('./childPassiveCollectors');
var ProcessCounterResult = require('./childProcessCounterResult');

var childThread;
var cache = {};
var collectors = {};

startChildThread();

function startChildThread() {
    passiveCollectors.connect(function (err, _collectors) {
        if(err) return log.error(err.message);

        collectors = _collectors;

        history.connect('childCalcVariables', function () {
            // to check if the function name exists;
            history.historyFunctionList = new Set(history.getFunctionList().map(f => f.name));

            childThread = new threads.child({
                module: 'getCountersValue',
                onMessage: processMessage,
                onStop: destroyCollectors,
            });
        });
    });
}

function processMessage(message, callback) {
    if(!message) {
        log.info('Receiving empty message');
        if(typeof callback === 'function') callback();
        return;
    }

    if(message.c) processNewCounter(message.c);

}

function processNewCounter(counterData) {

    var counter = {
        OCID: counterData[0],
        parentVariables: counterData[1],
        prevUpdateEventExpressionResult: counterData[2],
        parentOCID: counterData[3],
        parentValue: counterData[4],
    };


    var variablesDebugInfo = [];
    new CalcVars(counter, variablesDebugInfo, cache, history, function(err, counter, param, variables) {
        var errPrefix = counter.objectName + '(' + counter.counterName + '): ';

        if(err) return log.error(errPrefix, 'calc variables: ', err.message);
        if(!counter) return; // updateEvent is not true

        var collectorName = counter.collector;
        var Collector = collectors[collectorName] ? collectors[collectorName].get : null;
        if(!Collector || typeof Collector !== 'function') {
            return log.options(errPrefix, 'unknown collector "', collectorName, '" or collector.get is not a function', {
                filenames: ['counters/' + counter.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'E'
            });
        }

        try {
            new Collector(param, function (err, result, counter, variables) {
                if (err) {
                    return log.options(errPrefix, 'collector ', collectorName, '(', (param ? param.join(', ') : ''),
                        ') return error: ', err.message, {
                        filenames: ['counters/' + counter.counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'E'
                    });
                }

                log.options(errPrefix, 'receiving value: ', result, '; err: ',
                    (err && err.stack ? err.stack : err), {
                    filenames: ['counters/' + counter.counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'D'
                });

                new ProcessCounterResult(err, counter, param, variables, result, cache, history, function(err, returnedMessage) {
                    if(err) {
                        return log.options(errPrefix, err.message, {
                            filenames: ['counters/' + counter.counterID, 'counters.log'],
                            emptyLabel: true,
                            noPID: true,
                            level: 'E'
                        });
                    }

                    childThread.send(returnedMessage);
                });
            });
        } catch (e) {
            return log.options(errPrefix, 'collector ', collectorName, '(', (param ? param.join(', ') : ''),
                ') crushed: ', e.message, {
                filenames: ['counters/' + counter.counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
        }
        // calc objectFilter and get depended OCIDs and send to server for distribution data by children
    });
}
