/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const thread = require('../lib/threads');
const objectListCreate = require('./objectListCreate');
const objectListFilter = require('./objectListFilter');

var objectListThread = new thread.child({
    module: 'objectListWebServer',
    onMessage: processMessage,
});

objectListCreate.initCacheThread(objectListThread);
objectListFilter.initCacheThread(objectListThread);

/**
 * Process server message
 * @param {Object} message
 * @param {function} callback
 */
function processMessage(message, callback) {
    if(message.func === 'filterObjectsByInteractions') {
        return objectListCreate.filterObjectsByInteractions(message.parentObjectsNames, message.username, callback);
    }

    if(message.func === 'searchObjects') {
        return objectListCreate.searchObjects(message.searchStr, message.username, callback);
    }

    if(message.func === 'getObjectsByNames') {
        return objectListCreate.getObjectsByNames(message.objectsNames, message.username, callback);
    }

    if(message.func === 'getObjectsByIDs') {
        return objectListCreate.getObjectsByIDs(message.objectIDs, message.username, callback);
    }

    if(message.func === 'applyFilterToObjects') {
        return objectListFilter.applyFilterToObjects(message.filterNamesStr, message.filterExpression,
            message.objects, callback);
    }

    if(message.operation === 'renameObjects') {
        objectListCreate.renameObjectsInCache(message.objects);
    } else if(message.operation === 'addObjects') {
        objectListCreate.addNewObjectsToCache(message.newObjectsNames, message.newDescription,
            message.newOrder, (message.disabled ? 1 : 0), message.color, message.createdTimestamp);
    } else if(message.operation === 'updateObjects') {
        objectListCreate.updateObjectsInCache(message.objectIDs, message.updateData);
    } else if(message.operation === 'deleteObjects') {
        objectListCreate.deleteObjectsFromCache(message.objectIDs);
    } else if(message.operation === 'insertInteractions') {
        objectListCreate.insertInteractionsToCache(message.interactions);
    } else if(message.operation === 'deleteInteractions') {
        objectListCreate.deleteInteractionFromCache(message.interactions);
    }
}