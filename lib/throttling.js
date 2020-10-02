/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@mail.ru>
 */

//var log = require('../lib/log')(module);

var throttling = {}
module.exports = throttling;

var objects = {};
var throttlingModeDefaultValues  = {
    enabled: true,
    maxSkippingValues: 10,
    maxTimeInterval: 180000, // 3 min
    deviation: 5, // mathematical deviation for throttling not more 5%
};
var throttlingPause = 0;

throttling.init = function (id, param, collector) {

    var myThrottlingMode = {
        enabled: throttlingModeDefaultValues.enabled,
        maxSkippingValues: throttlingModeDefaultValues.maxSkippingValues,
        maxTimeInterval: throttlingModeDefaultValues.maxTimeInterval,
        deviation: throttlingModeDefaultValues.deviation,
        skippingValues: objects[id] ? objects[id].skippingValues : 0,
        savedParam: getThrottlingParam(param),
    };

    if(objects[id]) { // reinitializing when param were changed
        myThrottlingMode.prevValue = objects[id].prevValue;
        myThrottlingMode.prevTimestamp = objects[id].prevTimestamp;
    }

    if(Number(param.throttlingMaxSkippingValues) === parseInt(String(param.throttlingMaxSkippingValues), 10)) {
        myThrottlingMode.maxSkippingValues = Number(param.throttlingMaxSkippingValues);
    }
    if(Number(param.throttlingMaxTimeInterval) === parseInt(String(param.throttlingMaxTimeInterval), 10)) {
        myThrottlingMode.maxTimeInterval = Number(param.throttlingMaxTimeInterval);
    }
    if(Number(param.throttlingDeviation) === parseInt(String(param.throttlingDeviation), 10) &&
        Number(param.throttlingDeviation) < 100) {
        myThrottlingMode.deviation = Number(param.throttlingDeviation);
    }
    if(myThrottlingMode.maxSkippingValues === 0 || myThrottlingMode.maxTimeInterval === 0) {
        myThrottlingMode.enabled = false;
    }

    objects[id] = myThrottlingMode;

    if(typeof collector === 'object') {
        collector.throttlingPause = function (_throttlingPause) {
            _throttlingPause = Number(_throttlingPause);
            if (_throttlingPause !== parseInt(String(_throttlingPause), 10) || _throttlingPause < 1000) return;
            throttlingPause = Date.now() + _throttlingPause;
        }
    }
}

throttling.check = function (id, value, param, collector) {
    if(param && (!objects[id] || getThrottlingParam(param) !== objects[id].savedParam)) {
        throttling.init(id, param, collector);
    }

    if(objects[id] && objects[id].enabled && objects[id].prevValue !== undefined && Date.now() > throttlingPause) {
        var numValue = Number(value),
            numPrevValue = Number(objects[id].prevValue),
            throttlingMode = objects[id],
            isPrevAndLastValuesEqual = objects[id].prevValue === value;

        throttlingPause = 0;
        // check for deviation if type of current and prev values are numeric and prev !== 0
        if(!isPrevAndLastValuesEqual &&
            !isNaN(parseFloat(String(numValue))) && isFinite(numValue) &&
            numPrevValue !== 0 && throttlingMode.deviation !== 0 &&
            !isNaN(parseFloat(String(numPrevValue))) && isFinite(numPrevValue)
        ) isPrevAndLastValuesEqual = Math.abs(numValue - numPrevValue) * 100 / numPrevValue < throttlingMode.deviation;

        if(isPrevAndLastValuesEqual &&
            objects[id].skippingValues < throttlingMode.maxSkippingValues &&
            Date.now() - objects[id].prevTimestamp < throttlingMode.maxTimeInterval
        ) {
            objects[id].skippingValues++;
            //log.debug('throttling: skip ', value, ' for ', id, '; params: ', objects[id]);
            return false;
        }
    }
    //if(id && id.indexOf('service.info') !== -1) console.log(id, value, typeof(value), objects[id].prevValue, typeof(objects[id].prevValue), objects[id], Date.now() - throttlingPause)
    //log.debug('throttling: add ', value, ' for ', id, '; params: ', objects[id]);
    objects[id].prevValue = value;
    objects[id].prevTimestamp = Date.now();
    objects[id].skippingValues = 0;

    return true;
}

throttling.remove = function (IDs, callback) {
    if(typeof IDs === 'function') {
        objects = {};
        return IDs();
    }

    if(!IDs)  objects = {};
    else if(Array.isArray(IDs)) {
        IDs.forEach(function (id) {
            delete objects[id];
        });
    }
    if(typeof callback === 'function') callback()
}

function getThrottlingParam(param) {
    return param.throttlingMaxSkippingValues + ':' + param.throttlingMaxTimeInterval + ':' + param.throttlingDeviation;
}
