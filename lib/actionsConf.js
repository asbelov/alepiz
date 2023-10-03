/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 23.04.2015.
 */
var log = require('../lib/log')(module);
var fs = require('fs');
var path = require('path');
var async = require('async');
var rightsWrapper = require('../rightsWrappers/actions');
const actionClient = require("../serverActions/actionClient");
const webServerCacheExpirationTime = require('../serverWeb/webServerCacheExpirationTime');
const Conf = require('../lib/conf');
const confActions = new Conf('config/actions.json');


var actions = {};
module.exports = actions;

var actionConf = {};
var actionsLayoutForUser = new Map();

/**
 * Returned actions layout with an actions properties, according user rights and selected objects
 * @param {string} user username
 * @param {string} objectsJSONStr a stringified array with objects like "[{id: name: }, ...]"
 * @param {function(Error)|function(null, actionsLayout: Object)} callback where actionsLayout is an
 * objects like
 * {<actionGroupName1>: {<actionID1>:<actionConf1>, <actionID2>:<actionConf2>}, <actionGroupName2>:{...}, ...}
 * where actionGroupName is a name of action group, actionID is a action directory name and actionConfX is a
 * action configuration from config.json file
 */
actions.getConfigurationForAll = function (user, objectsJSONStr, callback) {
    try {
        var objects = JSON.parse(objectsJSONStr);
    }
    catch (err) {
        objects = [];
    }

    // getting actionsLayout from cache with update period 60000 ms
    getActionsLayout(user, function (err, actionsLayout) {
        if(err) return callback(err);

        async.eachOf(actionsLayout, function(notUsed, group, callback) {

            var actionsInGroup = 0;
            async.eachOf(actionsLayout[group], function(notUsed, actionID, callback) {

                // getting rights from cache with update period 60000 ms
                rightsWrapper.checkActionRights(user, actionID, 'ajax', function (err, rights) {
                    if(err) {
                        // don't print lot of permission warnings to the log like
                        // Action ".." don't showing while no one objects are selected according to
                        //  showWhenNoObjectsSelected parameter
                        log.debug(err.message);
                        return callback();
                    }

                    // getting actionCfg from cache with update period 60000 ms
                    actions.getConfiguration(actionID, function(err, actionCfg) {
                        if(err || typeof(actionCfg) !== 'object' || !Object.keys(actionCfg).length) {
                            log.debug(err.message);
                            return callback();
                        }

                        // getting objectProperties from cache with update period 300000 ms
                        //log.debug('Check action "',actionID,'" for compatibility with objects ', objectsJSONStr);
                        rightsWrapper.checkForObjectsCompatibility(actionCfg, objects, function(err) {
                            if (err) {
                                log.debug(err.message);
                                return callback();
                            }

                            actionCfg.group = group;
                            actionCfg.rights = rights;
                            //log.debug('Checking for action "', actionCfg.actionID, '" is passed. Action configuration: ', actionCfg);
                            actionsLayout[group][actionID] = actionCfg;
                            callback(null, actionCfg);
                            ++actionsInGroup;
                        });
                    });
                });
            }, function () {
                if(actionsInGroup === 0) delete(actionsLayout[group]);
                callback();
            });
        }, function () {
            callback(null, actionsLayout);
        });
    });
};

/**
 * Return actions layout
 @param {string} username username
 @param {function(Error)|function(null, Object)} callback callback(Error, actionLayout)
 */
function getActionsLayout(username, callback) {
    var savedActionsLayout = actionsLayoutForUser.get(username);
    if(savedActionsLayout && savedActionsLayout.timestamp > Date.now() - webServerCacheExpirationTime()) {
        var actionsLayout = savedActionsLayout.data;
        var returnedActionLayout = {};
        for (var group in actionsLayout) {
            returnedActionLayout[group] = {};
            for (var actionID in actionsLayout[group]) {
                returnedActionLayout[group][actionID] = {};
            }
        }
        return callback(null, returnedActionLayout);
    }

    var commonActionsLayout = confActions.get('layout');
    if(!commonActionsLayout || typeof commonActionsLayout !== 'object') {
        return callback(new Error('Error occurred, while get action menu layout from configuration from ' +
            'config/actions.json'));
    }

    // the layout of username actions is stored in the DB table actionsConfig and where actionName field is __actionsLayout
    actionClient.actionConfig(username, 'getActionConfig', '__AlepizMainMenuCustomization', null, function (err, row) {

        if (err) {
            return callback(new Error('Can\'t get custom action layout for username: ' + username + ' from DB: ' + err.message));
        }

        try {
            var actionsLayout = JSON.parse(row.config).actionsLayout;
        } catch (e) {
            actionsLayout = {};
        }

        // get action list from common action layout
        var actionList = {};
        for (group in actionsLayout) {
            for (actionID in actionsLayout[group]) {
                actionList[actionID] = true;
            }
        }

        // merge username action layout with common action layout
        for (group in commonActionsLayout) {
            for (actionID in commonActionsLayout[group]) {
                if (!actionList[actionID]) {
                    if (!actionsLayout[group]) actionsLayout[group] = {};
                    actionsLayout[group][actionID] = {};
                }
            }
        }

        actionsLayoutForUser.set(username, {
            timestamp: Date.now,
            data: actionsLayout,
        });
        var returnedActionLayout = {};
        for (group in actionsLayout) {
            returnedActionLayout[group] = {};
            for (actionID in actionsLayout[group]) {
                returnedActionLayout[group][actionID] = {};
            }
        }
        return callback(null, returnedActionLayout);

    });
}

/**
 * Action configuration object
 * @typedef {Object} actionCfg
 * @property {string} name
 * @property {string} description
 * @property {string} icon
 * @property {string} homePage
 * @property {string} launcher
 * @property {Object} launcherPrms
 * @property {string} ajaxServer
 * @property {Boolean} runActionInline
 * @property {Boolean} startAjaxAsThread
 * @property {Boolean} notInQueue
 * @property {string} staticDir
 * @property {'POST'|'GET'} execMethod
 * @property {string} onChangeObjectMenuEvent
 * @property {string} callbackBeforeExec
 * @property {string} callbackAfterExec
 * @property {string} cleanInputIDs
 * @property {number} timeout
 * @property {Boolean} noObjectsRequired
 * @property {Boolean} showWhenNoObjectsSelected
 * @property {string} dontShowForObjectsWithProperties
 * @property {string} showOnlyForObjectsWithProperties
 * @property {string} dontShowForObjects
 * @property {string} showOnlyForObjects
 * @property {string} dontShowForObjectsInGroups
 * @property {string} showOnlyForObjectsInGroups
 * @property {Boolean} canAddParametersToAction
 * @property {string} descriptionTemplate
 * @property {string} descriptionTemplateHTML
 * @property {Boolean} applyToOwnObjects
 * @property {Boolean} runActionOnRemoteServers
 * @property {Boolean} returnActionResult
 * @property {Boolean} runAjaxOnRemoteServers
 * @property {number} slowAjaxTime
 * @property {number} slowServerTime
 * @property {Boolean} swapActionControlBtn
 * @property {Object} parameters
 */

/**
 * Return configuration for specific action from action config.json
 * @param {string} actionID - action dir name
 * @param {function(Error)|function(null, actionCfg)} callback - callback(err, actionCfg), where actionCfg -
 *  parsed action config.json file plus cfg.actionID and cfg.link - relative path to action dir for using in the HTML page
 */
actions.getConfiguration = function (actionID, callback) {
    if(!actionID) return callback(new Error('Action ID not defined'));

    var actionsDir = confActions.get('dir');
    if(!actionConf[actionID]) {
        var actionConfigPath = path.join(__dirname, '..', actionsDir, actionID, 'config.json');

        if (!fs.existsSync(actionConfigPath)) {
            return callback(new Error('Can\'t get configuration for action "' + actionID + '" from file "' +
                actionConfigPath + '": file not exist'));
        }

        try {
            actionConf[actionID] = new Conf(actionConfigPath, webServerCacheExpirationTime());
        } catch (err) {
            return callback(new Error('Can\'t get configuration for action "' + actionID + '" from file "' +
                actionConfigPath + '": ' + err.message));
        }
    }

    var actionCfg = actionConf[actionID].get();
    // Add actionCfg.link to action configuration
    actionCfg.link = path.join('/', actionsDir, actionID).replace(/\\/g, '/');
    actionCfg.actionID = actionID;
    return callback(null, JSON.parse(JSON.stringify(actionCfg)));
};

/**
 * Return action description, according settings in a descriptionTemplate and variables values
 * @param {string} descriptionTemplate string with a description template
 * @param {Array<{name: string, value: string}>} variables an array with variables
 * @param {function(null, description:string)} callback callback(null, description),
 * where description is a string with an action description
 * @example
 *  descriptionTemplate can contain:
 *     strings
 *     variables like %:varName:%, which will be replaced to variable value
 *     conditions like %[ %:varName:% [<logical operator> <value>] %?% <string for true> %|% <string for false> ]%
 *
 *     %:varName:%, which will be replaced to variable value
 *     <logical operator>: one of "=" (string equal <value>), "~" (string contain <value>).
 *          all compares are case-insensitive without <logical value> variable checked for exists
 *     <value> - string or\and variable
 *     <string for true> and <string for false> can contain another conditions
 */
actions.makeActionDescription = function (descriptionTemplate, variables, callback) {
    if(!descriptionTemplate) return callback(null, '');

    if(!variables || !variables.length) return callback(null, descriptionTemplate);

    // replace all variables to it's values
    var variablesObj = {};
    variables.forEach(function(variable) {
        if(variable.name === undefined || variable.name === '') return;
        if(variable.value === undefined) variable.value = '';

        variablesObj[variable.name] = variable.value;
        try {
            var re = new RegExp('%:' + variable.name + ':%', 'gi');
        } catch(err){
            log.error('Error while replacing variable %:', variable.name, ':% to it\'s value: can\'t create regExp with variable name: ', err.message);
            return;
        }

        // parse 'o' parameter and set string with comma separated objects names to variable.value
        if(variable.name === 'o') {
            try {
                var objects = JSON.parse(variable.value);
                if(!objects || !objects.length) {
                    log.debug('Can\'t create description for parameter: Parameter o = "', variable.value,
                        '" is empty. Description template: ', descriptionTemplate, '; variables: ', variables);
                    return;
                }
                var value = objects.map(function(obj){ return obj.name }).join(', ');
            } catch (err) {
                value = variable.value; // object 'o' is variable
            }

        } else value = variable.value;

        descriptionTemplate = descriptionTemplate.replace(re, value);
    });

    // searching all conditions positions in the descriptionTemplate string from the end and replacing it to condition value
    while(true) {
        var conditionBeginPos = descriptionTemplate.lastIndexOf('{{');
        if(conditionBeginPos === -1) break;
        var conditionEndPos = descriptionTemplate.indexOf('}}', conditionBeginPos+2);
        if(conditionEndPos === -1) break;

        // substring() return substring from position in a first argument to position in a second argument, but not include second argument position
        var condition = descriptionTemplate.substring(conditionBeginPos + 2, conditionEndPos);
        var conditionValue = processingDescriptionTemplatesCondition(condition);
        if(conditionValue === undefined) conditionValue = processRepeatedVariables(condition, variablesObj);

        if(conditionValue === undefined) {
            log.error('Error in condition or condition with repeating "', condition,
                '" in description template for action');
            conditionValue = '';
        }

        descriptionTemplate = descriptionTemplate.substring(0, conditionBeginPos) + conditionValue +
            descriptionTemplate.substring(conditionEndPos+2);
    }

    callback(null, descriptionTemplate);
};

/**
 * Processing the condition and return result of condition for description template
 * @param {string} condition <condition> %?% <string for true> %|% <string for false>
 * @returns {string|void}
 * @example
 * <condition> - <string1> [<= or ~> <string2>]
 *     <string for true> - string, returned if result of condition is true
 *     <string for false> - string, returned if result of condition is false
 *  */
function processingDescriptionTemplatesCondition(condition) {

    if(!condition) return '';

    var conditionDividerPos = condition.indexOf('??');
    if(conditionDividerPos === -1) return;

    var resultDividerPos = condition.indexOf('::', conditionDividerPos + 2);
    if(resultDividerPos === -1) return;

    var operatorPos = condition.lastIndexOf('==', conditionDividerPos);
    if(operatorPos === -1 ) operatorPos = condition.lastIndexOf('~~', conditionDividerPos);


    var isTrueResult = false;
    if(operatorPos !== -1) {
        var variable = condition.substring(0, operatorPos).trim().toLocaleLowerCase();
        var value = condition.substring(operatorPos + 2, conditionDividerPos).trim().toLocaleLowerCase();

        if(condition[operatorPos] === '=') {
            if(variable === value) isTrueResult = true;
        } else {
            if(variable.indexOf(value) !== -1) isTrueResult = true;
        }
    } else {
        variable = condition.substring(0, conditionDividerPos).trim();
        if(variable !== '') isTrueResult = true;
    }

    if(isTrueResult) return condition.substring(conditionDividerPos+2, resultDividerPos);
    else return condition.substring(resultDividerPos + 2);
}

/**
 * Replace variables with index in variable name {{str}}: str - <condition>::<joinString>::errStr
 * @param {string} str string with variables
 * @param {Array<{name: string, value: string}>} variables an array with variables
 * @returns {string|void} string where variable names replaced by this values
 * @example
 * {{str}}: str - <condition>::<joinString>::errStr
 * var variables = {"variable11name0": "qqq", "variable@@@name1": "www", "another11name0": "111", "another$$$name1": "222"};
 * var str = "string with %:variable*name*:% and %:another*name*:%:: OR ::UNDEFINED";
 * var res = processRepeatedVariables(str, variables);
 * console.log(res);
 * res:
 * "string with qqq and 111 OR string with www and UNDEFINED OR string with UNDEFINED and 222"
 */
function processRepeatedVariables(str, variables) {

    var arrStr = str.split('::');
    if(arrStr.length !== 3) return;

    var condition = arrStr[0];
    var joinString = arrStr[1];
    var errString = arrStr[2];

    var execArray, variablesTemplatesObj = {}, variableTemplates = [], varRE = /%:(.+?):%/g;
    while((execArray = varRE.exec(condition)) !== null) {
        var variableTemplate = execArray[1].toUpperCase();
        if(variableTemplate.indexOf('*') === -1) continue;

        variableTemplates.push(variableTemplate);
        var reStr = escapeRegExp(variableTemplate.replace(/\*/g, '%:!ASTERISK!:%')).replace(/%:!ASTERISK!:%/g, '(.*?)');
        try {
            var re = new RegExp(reStr, 'i');
        } catch (e) {
            log.error('Error while create regExp from in condition ' + condition + '(' + variableTemplate + '): ' + e.message)
            continue;
        }
        for(var name in variables) {

            var variableResult = re.exec(name);
            if(variableResult !== null) {
                var keyArr = [];
                for(var i in variableResult) {
                    if(i !== '0' && Number(i) === parseInt(String(i), 10)) keyArr.push(variableResult[i]);
                }
                var key = keyArr.join('*');

                if(!variablesTemplatesObj[key]) variablesTemplatesObj[key] = {};
                if(!variablesTemplatesObj[key][variableTemplate]) variablesTemplatesObj[key][variableTemplate] = {};
                variablesTemplatesObj[key][variableTemplate] = variables[name];
            }
        }
    }

    var result = {};
    variableTemplates.forEach(function (variableTemplate) {
        for(var key in variablesTemplatesObj) {
            if(!result[key]) result[key] = condition;

            var re = new RegExp('%:' + escapeRegExp(variableTemplate) + ':%', 'gi');
            if(variablesTemplatesObj[key][variableTemplate]) {
                result[key] = result[key].replace(re, variablesTemplatesObj[key][variableTemplate]);
            } else result[key] = result[key].replace(re, escapeRegExp(errString));
        }
    });
    return Object.values(result).join(joinString);
}

/**
 * escape special regExp characters
 * @param string regExp string
 * @returns {string} string with escaped regExp characters
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}