/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var objectDB = require('../../rightsWrappers/objectsPropertiesDB');
var transactionDB = require('../../models_db/modifiers/transaction');
var server = require('../../server/counterProcessor');

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    if(!args.o) return callback(new Error('Objects are not selected'));

    var objects;
    try {
        objects = JSON.parse(args.o); // [{"id": "XX", "name": "name1"}, {..}, ...]
    } catch(err) {
        return callback(new Error('Can\'t parse JSON string with a objects parameters "' + args.o + '": ' + err.message));
    }

    var objectsIDs = [], objectNames = [];
    objects.forEach(function(obj) {
        if(obj.id) var id = parseInt(obj.id, 10);
        if(id === Number(obj.id) && id > 0) {
            objectsIDs.push(id);
            objectNames.push(obj.name);
        }
    });

    if(!objectsIDs.length || objectsIDs.length !== objects.length) return callback(new Error('Incorrect objects IDs ' + args.o));

    /*
    propertiesObj = {
        <idx1> : {name:.., mode:.., val:.., description:..},
        <idx2> : {name:.., mode:.., val:.., description:..},
        <idxN> : {name:.., mode:.., val:.., description:..}
    }
    idxN - any IDs, can be a numbers
     */
    var propertiesObj = {};
    for(var attr in args) {
        if(!args.hasOwnProperty(attr)) continue;
        if(!/^property\d+(name|mode|value|description)$/.test(attr)) continue;

        var propertyParameters = attr.replace(/^property(\d+)(.+)$/, '$1,$2').split(',');
        var propIdx = Number(propertyParameters[0]); // idx
        var propPrm = propertyParameters[1]; // (name|mode|value|description)

        if(propertiesObj[propIdx] === undefined) propertiesObj[propIdx] = {};
        propertiesObj[propIdx][propPrm] = args[attr];
    }

    /*
    properties: [{name:.., mode:.., val:.., description:..}, ...]
     */
    var properties = Object.keys(propertiesObj).filter(function(key) {
            var prop = propertiesObj[key];
            if(prop.description === undefined) prop.description = '';
            if(prop.mode !== undefined) prop.mode = Number(prop.mode);
            return prop.name && prop.value !== undefined && [0,1,2,3].indexOf(prop.mode) !== -1
        }).map(function (key) {
            return propertiesObj[key];
        });

    log.debug('Properties for objects ', objectNames, ': ', properties);

    // use transaction because saveObjectsProperties has several functions for make changes in DB for save properties
    transactionDB.begin(function(err) {
        if(err) return callback(new Error('Can\'t start transaction for update properties ' +
            JSON.stringify(properties) + ' for objects ' +  objectNames.join(', ') + ': ' + err.message));

        var isDeleteNotListedProperties = args.deleteOtherProperties && Number(args.deleteOtherProperties) !== 0;
        objectDB.saveObjectsProperties(args.username, objectsIDs, properties, isDeleteNotListedProperties,
            function(err, updatedObjectsIDs, changesInProperties) {
            if(err) return transactionDB.rollback(err, callback);

            transactionDB.end(function(err) {
                if(err) return callback(err);

                if(updatedObjectsIDs.length) {

                    // add sugar to the log
                    var filteredChangesInProperties = {};
                    for(var key in changesInProperties) {
                        if(typeof changesInProperties[key] === 'object' && Object.keys(changesInProperties[key]).length)
                            filteredChangesInProperties[key] = changesInProperties[key];
                    }
                    var objectNames = [];
                    objects.forEach(obj => {
                        if(Number(updatedObjectsIDs.indexOf(obj.id)) !== -1) objectNames.push(obj.name);
                    });

                    log.info('Objects: ', objectNames.join(', '), ', properties: ', filteredChangesInProperties);
                    server.sendMsg({
                        update: {
                            topObjects: true,
                            objectsProperties: true,
                        },
                        updateObjectsIDs: updatedObjectsIDs
                    });
                } // send message for updating collected initial data for objects
                //else log.debug('New properties are equal to existing and updating is not required for objects: ', objectNames, ' prop:', properties);

                callback(null, objectsIDs.join(','));
            });
        });
    });
};