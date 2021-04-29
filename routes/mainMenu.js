/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.05.2015.
 */
var express = require('express');
var router = express.Router();
var log = require('../lib/log')(module);
var ObjectFilterDB = require('../models_db/objectsFilterDB');
var rightsObjectsDB = require('../rightsWrappers/objectsDB');
var actions = require('./../lib/actionsConf');
var user = require('../lib/user');
var logRecords = require('../lib/logRecords');
var prepareUser = require('../lib/utils/prepareUser');

module.exports = router;

var maxResultsCnt = 3000;

router.post('/mainMenu', function(req, res, next) {
    var functionName = req.body.f;

    if(functionName === 'getActions') actions.getConfigurationForAll(prepareUser(req.session.username), req.body.o, sendBackResult);
    else if(functionName === 'login') user.login(req.body.user, req.body.pass, req.body.newPass, req.session, sendBackResult);
    else if(functionName === 'logout') user.logout(req.session, sendBackResult);
    else if(functionName === 'getCurrentUserName') user.getFullName(req.session, sendBackResult);
    else if(functionName === 'filterObjects') filterObjects(req.body.name, req.session.username, sendBackResult);
    else if(functionName === 'getObjects') getObjectsByNames(req.body.name, req.session.username, sendBackResult);
    else if(functionName === 'searchObjects') searchObjects(req.body.searchStr, req.session.username, sendBackResult);
    else if(functionName === 'getLogRecords') logRecords.getRecords(req.session.username, req.body.lastID, req.body.sessionsIDs, sendBackResult);
    else if(functionName === 'getObjectsByID') rightsObjectsDB.getObjectsByIDs(req.session.username, req.body.IDs, sendBackResult);
    else sendBackResult(new Error('Unknown function "'+functionName+'"'));

    function sendBackResult(err, result) {
        if(err) {
            log.error(err.message);
            return res.send();
        }
        if(!result) result = [];
        else if(result.length > maxResultsCnt) {
            log.warn('Found too many objects (' + result.length+ ') for ' + functionName + ', limit: ', maxResultsCnt, '. Sending back empty result');
            result = [];
        } else log.debug('Send result: ', result);
        res.json(result);
    }
});

/*
 Get filter objects using objects interactions rules and get objects parameters

 objectsNamesStr: comma separated string with objects names, which used as objects interactions rules for filter
 user: user name
 callback(err, objects), where
 objects: [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function filterObjects(objectsNamesStr, user, callback) {
    if(!objectsNamesStr || typeof(objectsNamesStr) !== 'string')  var objectsNames = [];
    else objectsNames = objectsNamesStr.split(',');

    user = prepareUser(user);
    ObjectFilterDB.filterObjects(objectsNames, user, callback);
}

function searchObjects(initSearchStr, user, callback) {
    if(!initSearchStr || initSearchStr.length < 2) return callback();

    // prepare search string to <pattern1><logical operator><pattern2><logical operator>,
    // '%' - any characters, '_' - any character
    // and make some corrections
    // f.e. string
    // "| object & server*
    //  ser_er*object & sml && ob_ect**server"
    // will be converted to
    // "%object%&%server%|%ser_er%object%&%ob_ect%server%"

    // !!!! don't touch it or save it before touching !!!!
    var searchStr = '%'+initSearchStr.
            replace(/\s*[|\r\n]+\s*/g, '*|*').// replace spaces around and '|', '\r', '\n' characters to '*|*'
            replace(/\s*&+\s*/g, '*&*'). // replace spaces around and '&' characters to '*&*'
            replace(/[&|]\**[&|]/, '*&*').// replace '|&' or '&|' to '&', don't ask why
            replace('%', '\\%'). // replace '%' to '\\%'
            replace(/\*+/g, '%'). // replace '*' characters to '%'
            replace(/^\s+/, '').replace(/\s+$/, ''). // remove forward and backward spaces characters
            replace(/[&|].{0,5}([&|])/g, '$1'). // remove patterns smaller then 6 characters between logical operators
            replace(/^.{0,4}[&|]/, ''). // remove search patterns smaller then 5 characters at the forward
            replace(/[&|].{0,4}$/, '')+'%'; // remove patterns smaller then 5 characters at the backward

    log.debug('Run search: "', initSearchStr, '" -> "', searchStr, '": length: ', searchStr.length);

    user = prepareUser(user);
    ObjectFilterDB.searchObjects(searchStr, user, callback);
}

/*
Get objects parameters by objects name

objectsNamesStr: comma separated string with objects names
user: user name
callback(err, objects), where
objects: [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function getObjectsByNames(objectsNamesStr, user, callback) {
    if(!objectsNamesStr || typeof(objectsNamesStr) !== 'string') return callback(null, []);

    ObjectFilterDB.getObjectsByNames(objectsNamesStr.split(','), prepareUser(user), callback);
}
