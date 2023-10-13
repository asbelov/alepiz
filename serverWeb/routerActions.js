/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const express = require('express');
const path = require('path');
const async = require('async');
const prepareUser = require('../lib/utils/prepareUser');
const rightsWrapper = require('../rightsWrappers/actions');
const actions = require('../lib/actionsConf');
const browserLog = require('../serverAudit/browserLog'); // used for delete messages counter for session
const unique = require('../lib/utils/unique');
const actionClient = require('../serverActions/actionClient');

const Conf = require('../lib/conf');
const confActions = new Conf('config/actions.json');


var router = express.Router();
module.exports = router;

var actionsForUpdate = new Map(); // {<actionLink>: {updateAjax: true|false, updateServer: true|false}, ...}


// Initializing action, load and save user action configuration
router.post('/'+confActions.get('dir')+'/:action',
    function(req, res, next) {

    browserLog.deleteSession(module.sessionID);
    delete module.sessionID;

    var actionID = req.params.action;
    var username = prepareUser(req.session.username);
    var func = req.body.func;
    actions.getConfiguration(actionID, function(err, actionCfg) {
        if (err && actionID  !== '__AlepizMainMenuConfiguration' && actionID  !== '__AlepizMainMenuCustomization') {
            log.error('Error while getting action configuration for "', actionID, '", user: ', username,
                ': ', err.message, ': param: ', req.body);
            return next(err);
        }
        if(func === 'setActionConfig' || func === 'getActionConfig') {
            log.debug((func === 'setActionConfig' ? 'Save' : 'Load'),  ' action configuration for ', actionID,
                '; user: ', username, '; configuration: ', req.body.config);
            actionClient.actionConfig(username, func, actionID, req.body.config, function (err, row) {
                if (err) {
                    log.error('Can\'t ', func, ' for user: "', username, '", action: "', actionID, '": ', err.message,
                        ': ', req.body);
                    return next(err);
                }

                var configStr = row && row.config ? row.config : '';
                if(configStr) {
                    try {
                        var config = JSON.parse(configStr)
                    } catch (e) {
                        config = configStr;
                    }

                    log.debug('Load configuration ', config);
                } else config = {};

                //console.log('get:', configStr, config)
                res.json(config);
            });

            return;
        }

        var sessionID = unique.createHash(JSON.stringify(req.params) + unique.createID());
        module.sessionID = sessionID;
        log.debug('Creating a new session for user: ', username, ',  action: ', actionCfg.name,
            ', sessionID: ', sessionID);

        try {
            var objects = JSON.parse(req.body.o);
        }
        catch (err) {
            objects = [];
        }
        async.parallel([
            // get action configuration and check for objects compatibility
            function(callback){
                rightsWrapper.checkForObjectsCompatibility(actionCfg, objects, callback);
            },
            // check user rights for view this action
            function(callback){
                rightsWrapper.checkActionRights(username, actionID, 'ajax', callback);
            }
        ], function(err){
            if(err) {
                log.info('Checking rights for action "', actionID, '" result: ', err.message);
                return next(err);
            }

            var result = {};
            result.action = actionCfg;
            result.objects = objects;

            var actionLink = result.action.link;
            result.action.link += '_' + String(sessionID);
            result.action.sessionID = sessionID;

            var actionHomePage = path.join(__dirname, '..', actionLink, result.action.homePage);

            if(req.body.actionUpdate === '1') {
                actionsForUpdate.set(actionID, {
                    ajax: true,
                    server: true
                });
            }

            log.info('Display a new action ', result.action.name,
                (req.body.actionUpdate === '1' ? ' with reload' : '' ), ' for objects: ', result.objects);

            res.render(actionHomePage, result, function(err, html) {
                if(err) {
                    log.error('Can\'t render action html page "', actionHomePage, '": ', err.message);
                    return next(err);
                }

                res.json({
                    html: html,
                    params: result.action
                });
            })
        });
    });
});

// sending static files from action's static dir
router.all('/' + confActions.get('dir') + '/:action_sessionID/' + confActions.get('staticDir') + '/*',
    function(req, res) {

    var actionID = req.params.action_sessionID.replace(/^(.+)_\d+$/, '$1');
    var sessionID = Number(req.params.action_sessionID.replace(/^.+_(\d+)$/, '$1'));
    var staticDir = confActions.get('staticDir');
    var staticFile = req.params[0];

    if(!sessionID) {
        log.error('Invalid sessionID for action ',actionID,' for sending static file ', staticDir, '/', staticFile);
        res.send();
    }

    var username = prepareUser(req.session.username);
    module.sessionID = sessionID;

    actions.getConfiguration(actionID, function(err, cfg){
        if(err){
            log.error('Can\'t get action configuration for ', actionID, ' for sending static file: ', err.message);
            return res.send();
        }

        if(cfg.staticDir && staticDir === cfg.staticDir){
            rightsWrapper.checkActionRights(username, actionID, 'ajax',
                function(err/*, rights */) {
                if(err) {
                    log.error('Can\'t check user rights for ', actionID, ' for sending static file: ', err.message);
                    return res.send();
                }
                var fullPathToStaticFile = path.join(__dirname, '..', confActions.get('dir'), actionID,
                    staticDir, staticFile);
                log.debug('Sending static file ', fullPathToStaticFile);
                return res.sendFile(fullPathToStaticFile);
            });
        } else res.send();
    });
});


// running ajax or server script for view action or for executing action
// :mode can be: server|ajax|makeTask
router.all('/'+confActions.get('dir')+'/:action_sessionID/:mode',
    function(req, res, next) {

    var actionID = req.params.action_sessionID.replace(/^(.+)_\d+$/, '$1');
    if(!actionID) {
        log.error('Trying to execute action but action ID is not defined');
        return next();
    }

    if(req.method !== 'GET' && req.method !== 'POST') {
        log.error('Trying to execute action "', actionID, '" with unsupported method ', req.method,
            '. Support only GET and POST methods');
        return next();
    }

    var sessionID = Number(req.params.action_sessionID.replace(/^.+_(\d+)$/, '$1'));
    if(!sessionID) {
        if(req.params.mode.toLowerCase() !== 'help') {
            log.error('Trying to execute action "', actionID, '" with undefined session ID');
        }
        return next();
    }

    var username = prepareUser(req.session.username);
    var executionMode = req.params.mode;
    module.sessionID = sessionID;

    if(executionMode !== 'server' && executionMode !== 'ajax' && executionMode !== 'makeTask') {
        log.error('Unknown execution mode for action "', actionID, '": ', executionMode);
        return next();
    }

    // for getting action name for run a new actionClient.addSessionID() and get runAjaxOnRemoteServers
    actions.getConfiguration(actionID, function(err, actionCfg) {
        if (err) {
            log.error('Error while getting action configuration for "', actionID, '": ', err.message);
            return next(err);
        }


        var args = req.method === 'POST' ? req.body : req.query;

        // for ajax run action directly from webServer without actionClient->actionServer IPC
        // but action server connected to history and server and make too many connections
        // and when webServer is restarted, we receive an errors in log from IPC system
        //var actionProcessor = executionMode === 'ajax' ? actionServer : actionClient;
        actionClient.runAction({
            actionID: actionID,
            executionMode: executionMode,
            user: username,
            args: args,
            notInQueue: true, // run the action started by the user without a queue
            // default value of actionCfg.runActionOnRemoteServers is true.
            // if actionCfg.runActionOnRemoteServers === false, then do not run action on remote server
            runActionOnRemoteServers: actionCfg.runActionOnRemoteServers === undefined ||
                Boolean(actionCfg.runActionOnRemoteServers) !== false,
            // when runActionOnRemoteServers set to true by default actions running from browser
            // does not return the action result.
            // If you want get action result (f.e. to callbackAfterExec(result, callback)) set
            // the returnActionResult parameter to true. default false
            returnActionResult: actionCfg.returnActionResult || confActions.get('returnActionResult'),
            // if true, then data will be an array of all results returned from the current and remote servers
            runAjaxOnRemoteServers: actionCfg.runAjaxOnRemoteServers,
            slowAjaxTime: actionCfg.slowAjaxTime,
            slowServerTime: actionCfg.slowServerTime,
            sessionID: sessionID,
            updateAction: actionsForUpdate.has(actionID) ? actionsForUpdate.get(actionID)[executionMode] : false
        }, function(err, data) {
            if(actionsForUpdate.has(actionID)) actionsForUpdate.get(actionID)[executionMode] = false;

            if(executionMode === 'ajax') {
                if(!data) data = {actionError: ''};
                if(err) {
                    log.error('Error in action "', actionID, '": ', err.message);
                    data.actionError = err.message;
                }

                log.debug('Sending back for action "',actionID,'", mode: ajax: ', data,
                    ': ', (Buffer.isBuffer(data) ? '(buffer)' : typeof data));
                if(typeof data === 'string') return res.send(data);
                else if(typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {

                    res.set({
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': 'attachment' +
                            (data.fileName ? ('; filename="' + data.fileName + '"') : ''),
                    });
                    res.write(Buffer.from(data.data), 'binary');
                    res.end();
                    return;
                } return res.json(data);
            }

            // when action is finished, clear old and create new session ID
            var oldSessionID = sessionID;
            sessionID = unique.createHash(JSON.stringify(req.params) + unique.createID());
            module.sessionID = sessionID;

            browserLog.deleteSession(oldSessionID);

            var returnedObj = {
                actionName: actionCfg.name,
                sessionID: sessionID,
                result: data,
                actionError: err && err.message,
            };

            log.debug('Sending back for action ', actionID, ', mode: ', executionMode, ': ', returnedObj);
            res.json(returnedObj);

            if(executionMode === 'server') {
                log.info('Complete executing action ', actionID, ' with result: ', returnedObj,
                    '; username: ', username, '; sessions: ', oldSessionID, '=>', sessionID);
            } else if(executionMode === 'makeTask') {
                log.info('Complete adding action ', actionID, ' to the task ',
                    '; username: ', username, '; sessions: ', oldSessionID, '=>', sessionID);
            }
        });
    });
});