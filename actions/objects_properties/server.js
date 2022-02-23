/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var log = require('../../lib/log')(module);
var objectDB = require('../../rightsWrappers/objectsPropertiesDB');
var transactionDB = require('../../models_db/transaction');
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

    var objectsIDs = objects.map(function(obj) {
        if(obj.id) return Number(obj.id);
        else return 0;
    }).filter(function(id) {
        return (id && id === parseInt(id, 10)); // return only integer IDs > 0
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

    log.debug('Properties for objects ', objectsIDs, ': ', properties);

    // use transaction because saveObjectsProperties has several functions for make changes in DB for save properties
    transactionDB.begin(function(err) {
        if(err) return callback(new Error('Can\'t start transaction for update properties ' +
            JSON.stringify(properties) + ' for objectsIDs ' +  objectsIDs.join(', ') + ': ' + err.message));

        var isDeleteNotListedProperties = args.deleteOtherProperties && Number(args.deleteOtherProperties) !== 0;
        objectDB.saveObjectsProperties(args.username, objectsIDs, properties, isDeleteNotListedProperties, function(err, updatedObjectsIDs, properties) {
            if(err) return transactionDB.rollback(err, callback);

            transactionDB.end(function(err) {
                if(err) return callback(err);

                if(updatedObjectsIDs.length) {
                    log.info('Changes in properties: ', properties);
                    server.sendMsg({
                        update: {
                            topObjects: true,
                            objectsProperties: true,
                        },
                        updateObjectsIDs: updatedObjectsIDs
                    });
                } // send message for updating collected initial data for objects
                else log.debug('New properties are equal to existing and updating is not required for objects: ', objectsIDs, ' prop:', properties);

                callback(null, objectsIDs.join(','));
            });
        });
    });
};

