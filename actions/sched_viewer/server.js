/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);

module.exports = function(args, callback) {
    log.info('Starting action server "', args.actionName, '" with parameters', args);

    /* Enter your server code here */
    if(!args.o) return callback(new Error('Objects are not selected'));

    var selectedObjects;
    try {
        selectedObjects = JSON.parse(args.o); // [{"id": "XX", "name": "name1"}, {..}, ...]
    } catch(err) {
        return callback(new Error('Can\'t parse JSON string with a objects parameters "' + args.o + '": ' + err.message));
    }

    var selectedObjectsIDs = selectedObjects.map(function(obj) {
        if(obj.id) return Number(obj.id);
        else return 0;
    }).filter(function(id) {
        return (id && id === parseInt(id, 10)); // return only integer IDs > 0
    });

    if(!selectedObjectsIDs.length || selectedObjectsIDs.length !== selectedObjects.length) {
        return callback(new Error('Incorrect objects IDs ' + args.o));
    }

    var objectsIDsFromObjectSelector = args.objectsIDs ? args.objectsIDs.split(',') : []; // "id1,id2,id3,..."

    if(selectedObjectsIDs.length !== objectsIDsFromObjectSelector.length) {
        log.warn('Selected objects number in system menu (', selectedObjectsIDs.length,
            ') are not equal to objects number in objectSelector element (', objectsIDsFromObjectSelector.length, ')');
    }

    log.info('Selected objects IDs: ', selectedObjectsIDs, '; objects from objectSelector: ', args.objectsIDs);
    callback(null, selectedObjectsIDs);
};

