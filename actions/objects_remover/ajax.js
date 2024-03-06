/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var objectListCreate = require('../../serverWeb/objectListCreate');
var prepareUser = require('../../lib/utils/prepareUser');
var async = require('async');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getChildObjects') {

        /*
         Get filter objects using objects interactions rules and get objects parameters

         objects: comma separated string with objects names, which used as objects interactions rules for filter
         user: user name
         callback(err, objects), where
         objects: [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
        */
        try {
            var objects = JSON.parse(args.objects);
        } catch (err) {
            return callback(new Error('Can\'t parse string with JSON object: ' + args.objects));
        }

        if(!objects || typeof(objects) !== 'object' || !objects.length)  return callback(null, []);

        getObjectsTree(prepareUser(args.username), objects, 0, args.maxObjectsCnt,
            function(err, objectsArrayWithDuplicates) {
            if(err) return callback(err);

            // remove duplicates from objects array
            var objects = {};
            objectsArrayWithDuplicates.forEach(function(object) {
                objects[object.name] = object.id;
            });

            var objectsArray = [];
            Object.keys(objects).forEach(function(name) {
                objectsArray.push({
                    id: objects[name],
                    name: name
                })
            });

            callback(null, objectsArray);
        });

        return;
    }

    return callback(new Error('Ajax function is not set or unknown function "'+args.func+'"'));
};

function getObjectsTree(user, objects, depth, maxObjectsCnt, callback) {
    if(depth > 20) return callback(null, objects);

    var newObjects = [];
    // use async each because objectListCreate.filter return objects, which interact for all objects
    // in first function parameter. But we need to get all child objects for each object in objects
    async.eachSeries(objects, function(object, callback) {

        if(maxObjectsCnt && objects.length >= maxObjectsCnt) return callback();

        objectListCreate.filterObjectsByInteractions([object.name], user, function(err, rows) {
            if(err) return callback(err);
            if(!rows.length) return callback();

            rows.forEach(function(row) {
                newObjects.push({
                    id: row.id,
                    name: row.name
                });
            });
            callback();
        });
    }, function(err) {
        if(err) return callback(err);

        Array.prototype.push.apply(objects, newObjects);

        if((!maxObjectsCnt || objects.length < maxObjectsCnt) && newObjects.length) {
            getObjectsTree(user, newObjects, ++depth, maxObjectsCnt, function(err, subObjects) {
                if(err) return callback(err);

                Array.prototype.push.apply(objects, subObjects);
                callback(null, objects);
            });
            return;
        }
        callback(null, objects);
    });
}