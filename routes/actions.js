/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var express = require('express');
var path = require('path');
var async = require('async');
var log = require('../lib/log')(module);
var conf = require('../lib/conf');
var prepareUser = require('../lib/utils/prepareUser');
var rightsWrapper = require('../rightsWrappers/actions');
var actions = require('../lib/actionsConf');
var browserLog = require('../lib/browserLog'); // used for delete messages counter for session

var userDB = require('../models_db/usersDB');

var actionClient = require('../lib/actionClient');
//var actionServer = require('../lib/actionServer');

var router = express.Router();
module.exports = router;

var actionsForUpdate = {}; // {<actionLink>: {updateAjax: true|false, updateServer: true|false}, ...}


// Initialising action
router.post('/'+conf.get('actions:dir')+'/:action', function(req, res, next) {

    module.sessionID = undefined;
    var actionID = req.params.action;
    var user = prepareUser(req.session.username);

    actions.getConfiguration(actionID, function(err, actionCfg) {
        if (err) {
            log.error('Error while getting action configuration for "', actionID, '": ', err.message);
            return next(err);
        }

        actionClient.getSessionID({
            user: user,
            actionID: actionID,
            actionName: actionCfg.name
        }, function (err, sessionID) {
            if (err) {
                log.error('Can\'t create sessionID for user: "', user, '", action: "', actionID, '": ', err.message);
                return next(err);
            }

            module.sessionID = sessionID;
            log.debug('Creating new session for user: "', user, '",  action: "', actionCfg.name, '", sessionID: ', sessionID);

            async.parallel([
                function(callback){
                    if (!'o' in req.body) return callback(new Error('Error in parameter specification for initialising action: parameter "o" is not present'));
                    try{
                        var objects = JSON.parse(req.body.o);
                    } catch(err){
                        return callback(new Error('Error while parse JSON objects "o" parameter for initialising action'));
                    }
                    return callback(null, objects)
                },
                // get action configuration and check for objects compatibility
                function(callback){
                    rightsWrapper.checkForObjectsCompatibility(actionCfg, req.body.o, callback);
                },
                // check user rights for view this action
                function(callback){
                    rightsWrapper.checkActionRights(user, actionID, 'ajax', callback);
                }
                //data[0] - objects list [{id: ID1. name: name1}, ....]
            ], function(err, data){
                if(err){
                    log.error('Error while initialisation action "', actionID, '": ', err.message);
                    return next(err);
                }

                var result = {};
                result.action = actionCfg;
                result.objects = data[0];

                var actionLink = result.action.link;
                result.action.link += '_' + String(sessionID);
                result.action.sessionID = sessionID;

                log.info('Init a new action ' + (req.body.actionUpdate === '1' ? 'with full reload' : '' ) + '. Parameters: ', result);

                var actionHomePage = path.join(__dirname, '..', actionLink, result.action.homePage);

                if(req.body.actionUpdate === '1') {
                    actionsForUpdate[actionID] = {
                        ajax: true,
                        server: true
                    }
                }

                //res.render(actionHomePage, result);
                res.render(actionHomePage, result, function(err, html) {
                    if(err) {
                        log.error('Can\'t render action html page "', actionHomePage, '": ', err.message);
                        return next(err);
                    }
                    //res.send(html);

                    res.json({
                        html: html,
                        params: result.action
                    });
                })
            });
        });
    });
});

// sending static files from action's static dir
router.all('/' + conf.get('actions:dir') + '/:action_sessionID/' + conf.get('actions:staticDir') + '/*', function(req, res){

    var actionID = req.params.action_sessionID.replace(/^(.+)_\d+$/, '$1');
    var sessionID = Number(req.params.action_sessionID.replace(/^.+_(\d+)$/, '$1'));
    var staticDir = conf.get('actions:staticDir');
    var staticFile = req.params[0];

    if(!sessionID) {
        log.error('Invalid sessionID for action ',actionID,' for sending static file ', staticDir, '/', staticFile);
        res.send();
    }

    module.sessionID = sessionID;
    actions.getConfiguration(actionID, function(err, cfg){
        if(err){
            log.error('Can\'t get action configuration for ', actionID, ' for sending static file: ', err.message);
            return res.send();
        }

        if(cfg.staticDir && staticDir === cfg.staticDir){
            rightsWrapper.checkActionRights(req.session.username, actionID, 'ajax', function(err, right){
                if(err){
                    log.error('Can\'t check user rights for ', actionID, ' for sending static file: ', err.message);
                    return res.send();
                }
                var fullPathToStaticFile = path.join(__dirname, '..', conf.get('actions:dir'), actionID, staticDir, staticFile);
                log.debug('Sending static file ', fullPathToStaticFile);
                return res.sendFile(fullPathToStaticFile);
            });
        } else res.send();
    });
});


// running ajax or server script for view action or for executing action
// :mode can be: server|ajax|makeTask
router.all('/'+conf.get('actions:dir')+'/:action_sessionID/:mode', function(req, res, next){


    var actionID = req.params.action_sessionID.replace(/^(.+)_\d+$/, '$1');
    var sessionID = Number(req.params.action_sessionID.replace(/^.+_(\d+)$/, '$1'));

    if(!sessionID) {
        if(req.params.mode.toLowerCase() !== 'help') {
            log.error('Trying to executing action "', actionID, '" with undefined session ID');
        }
        return next();
    }

    module.sessionID = sessionID;

    if(!actionID) {
        log.error('Trying to executing action but action ID is not defined');
        return next();
    }

    var executionMode = req.params.mode;
    if(executionMode !== 'server' && executionMode !== 'ajax' && executionMode !== 'makeTask') {
        log.error('Unknown execution mode for action "', actionID, '": ', executionMode);
        return next();
    }

    var user = prepareUser(req.session.username);

    userDB.getID(user, function(err) {
        if(err) {
            log.error(err.message);
            return next(err);
        }

        // for ajax run action directly from webServer without actionClient->actionServer IPC
        // but action server connected to history and server and make too many connections
        // and when webServer is restarted, we receive an errors in log from IPC system
        //var actionProcessor = executionMode === 'ajax' ? actionServer : actionClient;
        //actionProcessor.runAction({
        actionClient.runAction({
            actionID: actionID,
            executionMode: executionMode,
            user: user,
            args: req.body,
            sessionID: sessionID,
            updateAction: actionsForUpdate[actionID] ? actionsForUpdate[actionID][executionMode] : false
        }, function(err, data){
            if(err) log.error('Error in action "', actionID, '": ', err.message);

            if(actionsForUpdate[actionID]) actionsForUpdate[actionID][executionMode] = false;
            if(!data) data = {};

            if(executionMode === 'ajax') {
                log.debug('Sending back for action "',actionID,'", mode: ajax: ', data);
                if(typeof data === 'string') return res.send(data);
                return res.json(data);
            }

            // when action is finished, clear old and create new session ID
            browserLog.deleteSession(sessionID);

                // only for getting action name for run a new actionClient.getSessionID()
                actions.getConfiguration(actionID, function(err, actionCfg) {
                    if (err) {
                        log.error('Error while getting action configuration for "', actionID, '": ', err.message);
                        return next(err);
                    }

                    actionClient.getSessionID({
                        user: user,
                        actionID: actionID,
                        actionName: actionCfg.name
                    }, function (err, sessionID) {
                        if (err) {
                            log.error('Can\'t create sessionID for user: "', user, '", action: "', actionID, '": ', err.message);
                            return next(err);
                        }

                        data.sessionID = sessionID;
                        if(executionMode === 'server') log.info('Complete executing action ', actionID, ' with result: ', data);
                        else if(executionMode === 'makeTask') log.info('Completed saving action ', actionID);

                        log.debug('Sending back for action "',actionID,'", mode: ', executionMode, ': ', data);
                        res.json(data);

                        module.sessionID = sessionID;
                        log.debug('New sessionID for user: "', user, '",  action: "', actionCfg.name, '": ', sessionID);
                    });
            });
        });
    });
});