/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-1-24 0:54:27
*/
var async = require('async');
var log = require('../../lib/log')(module);
var objectsPropertiesDB = require('../../models_db/objectsPropertiesDB');
var objectsDB = require('../../rightsWrappers/objectsDB');
var countersDB = require('../../models_db/countersDB');
var history = require('../../models_history/history');
var calc = require('../../lib/calc');

var cfg = {};

module.exports = getData;

/*

callback(err, obj),
obj = [{<objectName>: { name: <name>, value: <value>, }}, ...]
 */
function getData(args, callback) {
    log.info('Starting ajax ', __filename, ' with parameters', args);

    if(args.func !== 'getProperties') {
        return callback(new Error('Ajax function is not set or unknown function "' + args.func + '"'));
    }

    cfg = args.actionCfg;
    if(!cfg.properties) return callback(new Error('Properties are not set in the action configuration'));

    try {
        var objects = JSON.parse(args.objects);
    } catch (e) {
        return callback(new Error('Can\'t parse parameters objects: ' + String(args.objects) + ': ' + e.message));
    }

    if(!objects.length) return callback();

    history.connect('actionInformation', function() {


        // SELECT * FROM objects WHERE id=? and check for user rights ti the objects
        objectsDB.getObjectsByIDs(args.username, objects.map(o => o.id), function (err, objectsRows) {
            if (err && (!objectsRows || !objectsRows.length)) return callback(err);

            var result = {},
                objectsID2Name = {},
                objectsIDs = objectsRows.map(function (row) {
                    result[row.name] = {};
                    objectsID2Name[row.id] = row.name;
                    return row.id;
                });

            // SELECT * FROM objectsProperties WHERE objectID IN (..) = [{id, objectID, name, value, description, mode}, ..]
            objectsPropertiesDB.getProperties(objectsIDs, function (err, rows) {
                if (err) {
                    return callback(new Error('Can\'t get objects properties :' + err.message + '(' + args.objects + ')'));
                }

                var props2TableHeads = new Map(),
                    counters2TableHeads = new Map(),
                    countersNames = new Set(),
                    tableHeads = new Map(),
                    historyFunctions = new Set(history.getFunctionList().map(f => f.name)); // to check if the function name exists

                for (var name in cfg.properties) {
                    var prop = cfg.properties[name];
                    if (prop.property) {
                        props2TableHeads.set(prop.property, name);
                    } else if (prop.counter) {
                        if (prop.history_function) { // prop.history_function f.e. 'min(300)'
                            // .trim() - remove spaces
                            // .slice(0, -1) - remove last ')'
                            // .split('(')) - split to function name and function parameters
                            var arr = prop.history_function.trim().slice(0, -1).split('(');
                            var functionName = arr.shift().trim();
                            if (!historyFunctions.has(functionName)) {
                                log.warn('Incorrect history function ', prop.history_function, ' for ', prop.counter, ' in action configuration. Skip it');
                                continue;
                            }
                            // join('('): if parameters contained "(" characters, they will be separated.
                            // split function parameters from string to array
                            var param = arr.join('(').split(/[ ]*,[ ]*/).map(function (parameter) {
                                // try to convert Gb, Mb, Kb, B or date\time to numeric or return existing parameter
                                var hasExclamation = false;
                                if (String(parameter).charAt(0) === '!') {
                                    parameter = parameter.slice(1);
                                    hasExclamation = true;
                                }
                                return hasExclamation ? '!' + String(calc.convertToNumeric(parameter)) : calc.convertToNumeric(parameter);
                            });
                        }
                        if (!counters2TableHeads.has(prop.counter)) counters2TableHeads.set(prop.counter, []);
                        var functionsArr = counters2TableHeads.get(prop.counter);

                        functionsArr.push({
                            tableHead: name,
                            name: functionName || 'last',
                            param: param || [],
                            axisY: prop.axisY,
                        });

                        countersNames.add(prop.counter);
                    }
                    tableHeads.set(name, false);
                }

                rows.forEach(function (row) {
                    var tableHead = props2TableHeads.get(row.name), objectName = objectsID2Name[row.objectID];
                    if (!tableHead) return;
                    result[objectName][tableHead] = {
                        rawResult: row.value,
                        result: resultProcessing(cfg.properties[tableHead], row.value)
                    };
                    tableHeads.set(tableHead, true);
                });

                if (!countersNames.size) {
                    callback(null, {
                        result: result,
                        tableHeads: getTableHeadsArr(tableHeads),
                    });
                    return;
                }

                // SELECT name, id FROM counters WHERE name IN (...)
                countersDB.getCountersIDsByNames(Array.from(countersNames.keys()), function (err, rows) {
                    if (err) {
                        return callback(new Error('Can\'t get counters information: ' + err.message +
                            ' for counters: ' + countersNames.join(', ')));
                    }

                    var countersIDs2Names = new Map(rows.map(row => [row.id, row.name]));

                    if (!countersIDs2Names.size) {
                        callback(null, {
                            result: result,
                            tableHeads: getTableHeadsArr(tableHeads),
                        });
                        return;
                    }

                    // SELECT * FROM objectsCounters WHERE objectsCounters.objectID IN (..)
                    countersDB.getCountersForObjects(objectsIDs, function (err, rows) {
                        if (err) {
                            return callback(new Error('Can\'t get OCIDs: ' + err.message +
                                ' for objects: ' + args.objects));
                        }

                        var historyItems = [];
                        rows.forEach(function (row) {
                            var counterName = countersIDs2Names.get(row.counterID)
                            if (objectsIDs.indexOf(row.objectID) === -1 || !counterName) return;

                            var functions = counters2TableHeads.get(counterName);
                            if (!functions) return;
                            //console.log('!!!functions: ', functions, counters2TableHeads);
                            functions.forEach(function (func) {
                                historyItems.push({
                                    OCID: row.id,
                                    objectName: objectsID2Name[row.objectID],
                                    func: func.name,
                                    param: func.param,
                                    tableHead: func.tableHead,
                                    axisY: func.axisY,
                                });
                            })
                        });

                        if (!historyItems.length) {
                            callback(null, {
                                result: result,
                                tableHeads: getTableHeadsArr(tableHeads),
                            });
                            return;
                        }

                        async.each(historyItems, function (item, callback) {
                            var funcParameters = item.param.slice();
                            funcParameters.unshift(item.OCID);

                            // closure for save item
                            (function (_item) {
                                funcParameters.push(function (err, res) {
                                    if (err) {
                                        log.warn('Can\'t get history data for ', _item, ': ', err.message);
                                        return callback();
                                    }

                                    result[_item.objectName][_item.tableHead] = {
                                        OCID: _item.OCID,
                                        axisY: _item.axisY,
                                        rawResult: res.data,
                                        result: resultProcessing(cfg.properties[_item.tableHead], res.data)
                                    };
                                    tableHeads.set(_item.tableHead, true);
                                    callback();
                                });
                            })(item);

                            history[item.func].apply(this, funcParameters);
                        }, function () {
                            callback(null, {
                                result: result,
                                tableHeads: getTableHeadsArr(tableHeads),
                            });
                        });
                    });
                })
            });
        });
    });
}

function getTableHeadsArr(tableHeads) {
    var tableHeadsArr = [];
    tableHeads.forEach(function (val, key) { if(val) tableHeadsArr.push(key)});
    return tableHeadsArr;
}

function resultProcessing(cfg, result) {
    if(typeof cfg.replaceRE === 'object') {
        try {
            var re = new RegExp(cfg.replaceRE.regExp, cfg.replaceRE.flags || '');
        } catch (e) {
            log.warn('Error in replaceRE '+ JSON.stringify(cfg.replaceRE) + ': ' + e.message);
            return result;
        }
        result = String(result).replace(re, cfg.replaceRE.replaceTo || '');
    }

    if(cfg.multiplier && Number(result) === parseFloat(String(result))) result = Number(result) * Number(cfg.multiplier)

    if(typeof cfg.valueMap === 'object') {
        var new_result = cfg.valueMap[result];
        if(new_result !== undefined) result = new_result;
    }

    if(cfg.toHuman) {
        result = calc.convertToHuman(result, cfg.toHuman);
    }

    return result;
}
