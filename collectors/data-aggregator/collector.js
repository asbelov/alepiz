/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-3-22 15:46:56
*/

var async = require('async');
var log = require('../../lib/log')(module);
var objectDB = require('../../models_db/objectsDB');
var counterDB = require('../../models_db/countersDB');
var history = require('../../models_history/history');

var collector = {};
module.exports = collector;

var func = {};

collector.get = function(param, callback) {

    if(!param.objectNamesLike || !param.counterName || typeof func[param.func] !== 'function') {
        return callback(new Error('Object or counter name or function is not specify or error: ' + JSON.stringify(param)));
    }

    var objectsNames = param.objectNamesLike.split(',').map(obj => obj.trim());

    // select * from objects
    objectDB.getObjectsLikeNames(objectsNames, function(err, rowsObjects) {
        if(err) return callback(new Error('Can\'t get objects like ' + param.objectNamesLike + ': ' + err.message +
            '; ' + JSON.stringify(param)));

        if(!rowsObjects.length) {
            log.info('Objects not found for SQL like "', param.objectNamesLike, '": ', param);
            return callback();
        }

        // select name, id from counters
        param.counterName = param.counterName.trim();
        counterDB.getCountersIDsByNames([param.counterName], function (err, rowsCounter) {
            if(err) return callback(new Error('Can\'t get counter ' + param.counterName + ': ' + err.message +
                '; ' + JSON.stringify(param)));

            if(rowsCounter.length !== 1 || !rowsCounter[0].id) {
                log.info('Counter ', param.counterName, ' not found: ', param);
                return callback();
            }
            
            var counterID = rowsCounter[0].id;

            var OCIDs = [];
            async.eachSeries(rowsObjects, function (rowObject, callback) {
                counterDB.getObjectCounterID(rowObject.id, counterID, function (err, rowOCIDs) {
                    if(err) return callback(new Error('Can\'t get OCID for objectID ' + rowObject.id +
                        ', counterID: ' + counterID +': ' + err.message + '; ' + JSON.stringify(param)));

                    if(!rowOCIDs || !rowOCIDs.id) {
                        log.debug('Counter ', param.counterName, ' is not linked to object ', rowObject.name, ': ', param, '; ', rowOCIDs);
                        return callback();
                    }

                    OCIDs.push(rowOCIDs.id);
                    callback();
                })
            }, function () {
                // records: {id1: {err:..., timestamp:..., data:...}, id2: {err:.., timestamp:..., data:..}, ....}
                history.getLastValues(OCIDs, function (err, records) {
                    if(err) return callback(new Error('Can\'t get last values for OCIDs ' + OCIDs.join(', ') +
                        ': ' + err.message + '; ' + JSON.stringify(param)));

                    if(!Object.keys(records).length) {
                        log.debug('History values are not found for ', param.counterName, ' and ', rowsObjects, '; OCIDs: ', OCIDs);
                        return callback();
                    }

                    callback(null, func[param.func](records));
                });
            });
        });
    });
};

func.sum = function (records) {
    var res = 0;

    for(var id in records) {
        var data = Number(records[id].data);
        if(!isNaN(data)) res += data;
    }

    return res;
}

func.avg = function (records) {
    var res = null;

    for(var id in records) {
        var data = Number(records[id].data);
        if(isNaN(data)) continue;

        if(res === null) res = data;
        else res = (res + data) / 2;
    }

    return res;
}

func.min = function (records) {
    var res = null;

    for(var id in records) {
        var data = Number(records[id].data);
        if(isNaN(data)) continue;

        if(res === null || res > data) res = data;
    }

    return res;
}

func.max = function (records) {
    var res = null;

    for(var id in records) {
        var data = Number(records[id].data);
        if(isNaN(data)) continue;

        if(res === null || res < data) res = data;
    }

    return res;
}