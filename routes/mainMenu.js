/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 11.05.2015.
 */
var log = require('../lib/log')(module);
var express = require('express');
var router = express.Router();
var objectFilterDB = require('../models_db/objectsFilterDB');
var rightsObjectsDB = require('../rightsWrappers/objectsDB');
var actions = require('./../lib/actionsConf');
var objectsFilter = require('./objectsFilter');
var user = require('../lib/user');
var prepareUser = require('../lib/utils/prepareUser');
const Conf = require("../lib/conf");
const confActions = new Conf('config/actions.json');
const confInterface = new Conf('config/interface.json');
const confNavBarLinks = new Conf('config/navBarLinks.json');
const confObjectGroups = new Conf('config/objectGroups.json');

module.exports = router;

var maxResultsCnt = 3000;

router.post('/mainMenu', function(req, res/*, next*/) {
    var functionName = req.body.f;

    if(functionName === 'getActions') {
        actions.getConfigurationForAll(prepareUser(req.session.username), req.body.o, sendBackResult);
    } else if(functionName === 'getDefaultInterfaceConfiguration') {
        getDefaultInterfaceConfiguration(sendBackResult);
    } else if(functionName === 'login') {
        user.login(req.body.user, req.body.pass, req.body.newPass, req.session, sendBackResult);
    } else if(functionName === 'logout') {
        user.logout(req.session, sendBackResult);
    } else if(functionName === 'getCurrentUserName') {
        user.getFullName(req.session, sendBackResult);
    } else if(functionName === 'filterObjectsByInteractions') {
        filterObjectsByInteractions(req.body.name, req.session.username, req.body.filterNames,
            req.body.filterExpression, sendBackResult);
    } else if(functionName === 'getObjectsFiltersConfig') {
        objectsFilter.getObjectsFilterConfig(req.session.username, sendBackResult);
    } else if(functionName === 'getObjectsByName') {
        getObjectsByNames(req.body.name, req.session.username, req.body.filterNames,
            req.body.filterExpression, sendBackResult);
    } else if(functionName === 'searchObjects') {
        searchObjects(req.body.searchStr, req.session.username, req.body.filterNames,
            req.body.filterExpression, sendBackResult);
    } else if(functionName === 'getLogRecords') {
        log.getAuditData(req.body.lastID, req.session.username, req.body.sessionIDs, sendBackResult);
    } else if(functionName === 'getObjectsByID') {
        getObjectsByIDs(req.body.IDs, req.session.username, req.body.filterNames,
            req.body.filterExpression, sendBackResult);
    } else sendBackResult(new Error('Unknown function "'+functionName+'"'));

    function sendBackResult(err, result) {
        if(err) {
            log.error(err.message);
            return res.send();
        }
        if(!result) result = [];
        else if(result.length > maxResultsCnt) {
            log.warn('Found too many objects (' + result.length+ ') for ' + functionName + ', limit: ', maxResultsCnt,
                '. Sending back empty result');
            result = [];
        } else log.debug('Send result: ', result);
        res.json(result);
    }
});

function getDefaultInterfaceConfiguration(callback) {
    var interfaceDefault = confInterface.get() || {};
    interfaceDefault.navbarLinks = confNavBarLinks.get('navbarLinks') || [];
    interfaceDefault.objectGroups = confObjectGroups.get('objectGroups') || [];
    interfaceDefault.actionDir = confActions.get('dir');

    callback(null, interfaceDefault);
}


/** Get filter objects using objects interactions rules and get objects parameters
 * @param {string} objectsNamesStr - comma separated string with objects names, which used as objects interactions
 *   rules for filter
 * @param {string} user - username
 * @param {Array|String} filterNames - array of object filter names
 * @param {string} filterExpression - filters logical expression like "%:filter1:% && %:filter2:% || %:filter3:%"
 * @param {function(Error)|function(null, Array): void} callback - called when done. Return error or array of
 * objects like [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function filterObjectsByInteractions(objectsNamesStr, user, filterNames,
                                     filterExpression, callback) {
    if(!objectsNamesStr || typeof(objectsNamesStr) !== 'string')  var objectsNames = [];
    else objectsNames = objectsNamesStr.split(',');

    user = prepareUser(user);
    objectFilterDB.filterObjectsByInteractions(objectsNames, user, function(err, objects) {
        if(err) return callback(err);
        objectsFilter.applyFilterToObjects(filterNames, filterExpression, objects, callback);
    });
}

/** Get object list from DB using search string with logical operators and wildcards
 *
 * @param {string} initSearchStr - search string. Wildcards: "*" - one or more characters, "_" - one character.
 * logical operators "&" - logical AND, "|" or line break - logical OR
 * @param {string} user - username
 * @param {Array|String} filterNames - array of object filter names
 * @param {string} filterExpression - filters logical expression like "%:filter1:% && %:filter2:% || %:filter3:%"
 * @param {function(Error)|function(null, Array): void} callback - called when done. Return error or array of
 * objects like [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function searchObjects(initSearchStr, user, filterNames,
                       filterExpression, callback) {
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
        // replace spaces around and '|', '\r', '\n' characters to '*|*'
        replace(/\s*[|\r\n]+\s*/g, '*|*').
        // replace spaces around and '&' characters to '*&*'
        replace(/\s*&+\s*/g, '*&*').
        // replace '|&' or '&|' to '&', don't ask why
        replace(/[&|]\**[&|]/, '*&*').
        // replace '%' to '\\%'
        replace('%', '\\%').
        // replace '*' characters to '%'
        replace(/\*+/g, '%').
        // remove forward and backward spaces characters
        replace(/^\s+/, '').replace(/\s+$/, '').
        // remove patterns smaller than 6 characters between logical operators
        replace(/[&|].{0,5}([&|])/g, '$1').
        // remove search patterns smaller than 5 characters at the forward
        replace(/^.{0,4}[&|]/, '').
        // remove patterns smaller than 5 characters at the backward
        replace(/[&|].{0,4}$/, '')+'%';

    log.debug('Run search: "', initSearchStr, '" -> "', searchStr, '": length: ', searchStr.length);

    user = prepareUser(user);
    objectFilterDB.searchObjects(searchStr, user, function(err, objects) {
        if(err) return callback(err);
        objectsFilter.applyFilterToObjects(filterNames, filterExpression, objects, callback);
    });
}

/** Get object list by object names
 *
 * @param {string} objectsNamesStr - comma separated string with objects names
 * @param {string} user - username for check objects rights
 * @param {Array|String} filterNames - array of object filter names
 * @param {string} filterExpression - filters logical expression like "%:filter1:% && %:filter2:% || %:filter3:%"
 * @param {function(Error)|function(null, objects: Array)} callback - return Error or array of
 * objects like [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function getObjectsByNames(objectsNamesStr, user, filterNames,
                           filterExpression, callback) {
    if(!objectsNamesStr || typeof(objectsNamesStr) !== 'string') return callback(null, []);

    objectFilterDB.getObjectsByNames(objectsNamesStr.split(','), prepareUser(user),
        function(err, objects) {
        if(err) return callback(err);
        objectsFilter.applyFilterToObjects(filterNames, filterExpression, objects, callback);
    });
}

/** Get object list by object IDs
 *
 * @param {Array} objectIDs - array of object IDs
 * @param {string} user - username for check objects rights
 * @param {Array|String} filterNames - array of object filter names
 * @param {string} filterExpression - filters logical expression like "%:filter1:% && %:filter2:% || %:filter3:%"
 * @param {function(Error)|function(null, objects: Array)} callback - return Error or array of
 * objects like [{name: ..., id: ..., description: ..., sortPosition:...}, {...}, ...]
 */
function getObjectsByIDs(objectIDs, user, filterNames, filterExpression, callback) {
    rightsObjectsDB.getObjectsByIDs(prepareUser(user), objectIDs, function(err, objects) {
        if(err) return callback(err);
        objectsFilter.applyFilterToObjects(filterNames, filterExpression, objects, callback);
    });
}