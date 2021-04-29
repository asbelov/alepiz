/*
* Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-10-2 2:33:37
*/

var path = require('path');
//var log = require('../../lib/log')(module);
var sqlite = require('../../lib/sqlite');
var db = require('../../lib/db');
var objectsDB = require('../../models_db/objectsDB');
var countersDB = require('../../models_db/countersDB');
var conf = require('../../lib/conf');
conf.file('config/conf.json');

var collector = {};
module.exports = collector;
/*
    get data and return it to server

    param - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $counterID: <counterID>,
        $objectID: <objectID>,
        $parentID: <parentObjectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $counterID - counter ID,
    $objectID - object ID
    $parentID - parent objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

var eventDB;
var cache = {};

collector.get = function(param, callback) {

    init(param, function(err) {
        if(err) return callback(err);
        
        getCounterID(param.$id, param.counterName, function(err, countersIDs) {
            if(err) return callback(new Error(err + ' for ' + JSON.stringify(param)));

            if(!eventDB) return callback(); // collector was destroyed
            eventDB.all('SELECT * FROM events WHERE endTime IS NULL AND counterID IN (' + 
                        (new Array(countersIDs.length)).fill('?').join(',') + ')', countersIDs, 
                        function(err, eventsRows) {
                if(err) return callback('Can\'t get data from events table for counter: ' + 
                                        param.counterName + '(' + countersIDs.join(',') + '): ' + err );

                if(!eventsRows.length) return callback(null, 0);

                getObjectID(param.$id, param.objectName, function(err, objectID) {
                    if(err) return callback(new Error(err + ' for ' + JSON.stringify(param)));

                    getObjectsIDsFromGroup(param.$id, objectID, function(err, objectsIDs) {
                        if(err) return callback(new Error(err + ' for ' + JSON.stringify(param)));

                        if(!objectsIDs.length) return callback();

                        var foundEventsNum = 0, copyObjectsIDs = objectsIDs.slice();
                        eventsRows.forEach(function(eventRow) {
                            var pos = copyObjectsIDs.indexOf(eventRow.objectID);
                            if(pos !== -1) {
                                ++foundEventsNum;
                                copyObjectsIDs[pos] = null;
                            }
                        });
                        //log.info('Events found: ', eventsRows.length, ', objects in group: ', objectsIDs.length)
                        callback(null, Math.round(foundEventsNum * 100 / objectsIDs.length));
                    });
                });
            });
        });
    });
};

/*
    destroy objects when reinitializing collector
    destroy function is not required and can be skipping

    callback(err);
*/
collector.destroy = function(callback) {
    cache = {};
    if(!eventDB) return callback();

    eventDB.close(function(err) {
        eventDB = null;
        db.close(function() {
            callback(err);
        });
    });
};

/*
    remove counters with objectCounterIDs (OCIDs) when remove object
    removeCounters is not required and can be skipping

    OCIDs - array of objectsCountersIDs
    callback(err);

    objectCounterID of specific counter you can get from $id parameter
    from the counter parameters, sending to collector.get(param, callback) function
*/
collector.removeCounters = function(OCIDs, callback) {
    OCIDs.forEach(function(id) {
        delete cache[id];
    });
    callback();
};

function init(param, callback) {
    if(eventDB) return callback();

    var dbPath = path.join(__dirname, '..', '..',
		conf.get('collectors:event-generator:dbPath'),
        conf.get('collectors:event-generator:dbFile'));

    sqlite.init(dbPath, function (err, _eventDB) {
        if (err) return callback(new Error('Can\'t initialise event database ' + dbPath + ': ' + err));
        
        eventDB = _eventDB;
        
        setTimeout(function() {
            for(var id in cache) {
                if(Date.now() - cache[id].timestamp > 900000) delete cache[id]; 
            }
        }, 60000);
        callback();
    });
}

function getCounterID(id, counterName, callback) {
    if(!counterName) return callback(new Error('Counter name or counterID is not set'));
    if(Number(counterName) === parseInt(String(counterName), 10)) {
        if(!Number(counterName)) return callback(new Error('Set incorrect counterID: ' + counterName));
        return callback(null, Number(counterName));
    }
    
    if(cache[id] && cache[id].counters && cache[id].counters[counterName.toLowerCase()]) {
        return callback(null, cache[id].counters[counterName.toLowerCase()]);
    }
        
    countersDB.getCountersIDsByNames([counterName], function(err, rows) {
        if(err) return callback(new Error('Can\'t get counter ID for counter ' + counterName + ': ' + err));
        if(!rows[0]) return callback(new Error('Can\'t get counter ID for counter ' + counterName + ': no such counter'));
        
        if(!cache[id]) cache[id] = {timestamp: Date.now(), counters: {}};
        else if(!cache[id].counters) cache[id].counters = {};
        cache[id].counters[counterName.toLowerCase()] = rows.map(row => row.id);
        return callback(null, cache[id].counters[counterName.toLowerCase()]);
    });
}

function getObjectID(id, objectName, callback) {
    if(!objectName) return callback(new Error('Object name or objectID is not set'));
    if(Number(objectName) === parseInt(String(objectName), 10)) {
        if(!Number(objectName)) return callback(new Error('Set incorrect objectID: ' + objectName));
        return callback(null, Number(objectName));
    }
    if(cache[id] && cache[id].objects && cache[id].objects[objectName]) {
        return callback(null, cache[id].objects[objectName]);
    }
    
    objectsDB.getObjectsByNames([objectName], function(err, rows) {
        if(err) return callback(new Error('Can\'t get object ID for object ' + objectName + ': ' + err));
        if(!rows[0]) return callback(new Error('Can\'t get object ID for object ' + objectName + ': no such object'));
        
        if(!cache[id]) cache[id] = {timestamp: Date.now(), objects: {}};
        else if(!cache[id].objects) cache[id].objects = {};
        cache[id].objects[objectName.toLowerCase()] = rows[0].id;
        return callback(null, rows[0].id);
    });
}

function getObjectsIDsFromGroup(id, objectID, callback) {
    if(!objectID) return callback(new Error('Incorrect group object ID (' + objectID + ') for getting objects from group'));
    if(cache[id] && cache[id].group && cache[id].group[objectID]) return callback(null, cache[id].group[objectID]);
    
    objectsDB.getInteractions([objectID], function(err, rows) {
        if(err) return callback(new Error('Can\'t get objects from group with objectID: ' + objectID + ': ' + err));
        if(!rows.length) return callback(new Error('There are no objects in the group with objectID ' + objectID));
        
        var objectsIDs = [];
        rows.forEach(function(row) {
            if(row.type === 0 && row.id1 === objectID) objectsIDs.push(row.id2);
        });
        
        if(!cache[id]) cache[id] = {timestamp: Date.now(), group: {}};
        else if(!cache[id].group) cache[id].group = {};
        cache[id].group[objectID] = objectsIDs;
        return callback(null, objectsIDs);
    });
}