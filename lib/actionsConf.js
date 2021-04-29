/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 23.04.2015.
 */
var fs = require('fs');
var path = require('path');
var conf = require('../lib/conf');
var log = require('../lib/log')(module);
var async = require('async');
var rightsWrapper = require('../rightsWrappers/actions');
conf.file('config/conf.json');

var actions = {};
module.exports = actions;

/*
    Returned actions list with a actions properties, according user rights and selected objects

    user - user name
    objectsJSONStr - string with JSON, which must contain "name" property, f.e. "[{name: objectName1}, {name: objectName2}, ...]"
    callback(err, actionsLayout)
 */
actions.getConfigurationForAll = function (user, objectsJSONStr, callback) {

    // clone object, because we will change it after
    conf.reload(); // reload configuration
    var actionsLayout = JSON.parse(JSON.stringify(conf.get('actions:layout')));
    if(!actionsLayout) return callback(new Error('Error occurred,while get menu layout from configuration'));

    var checkActionsRights = [];
    for(var group in actionsLayout){
        if(!actionsLayout.hasOwnProperty(group)) continue;

        var actionsInGroup = 0;

        for(var actionID in actionsLayout[group]){
            if(!actionsLayout[group].hasOwnProperty(actionID) || !actionID) continue;

            (function(actionID, group) {
                checkActionsRights.push(
                    function(callback){
                        async.parallel([
                            function(callback){
                                //log.debug('Check action "',actionID,'" for user rights for ', user);
                                rightsWrapper.checkActionRights(user, actionID, 'ajax', callback);
                            },

                            function(callback){
                                async.waterfall([
                                    function(callback){
                                        actions.getConfiguration(actionID, callback);
                                    },
                                    function(cfg, callback){
                                        //log.debug('Check action "',actionID,'" for compatibility with objects ', objectsJSONStr);
                                        rightsWrapper.checkForObjectsCompatibility(cfg, objectsJSONStr, function(err) {
                                            if (err) return callback(err);
                                            callback(null, cfg);
                                        });
                                    }
                                ], callback); // callback(err, cfg)
                            }
                        ], function(err, result){
                            if(err) {
                                log.info(err.message);
                                return callback();
                            }

                            var cfg = result[1];
                            cfg.group = group;
                            cfg.rights = result[0];

                            //log.debug('Checking for action "', cfg.actionID, '" is passed. Action configuration: ', cfg);
                            return callback(null, cfg);
                        })
                    }
                );
            })(actionID, group);
            ++actionsInGroup;
        }
        if(actionsInGroup === 0) delete(actionsLayout[group]);
    }

    async.parallel(checkActionsRights , function(err, results){
        if(err) return callback(new Error('Can\'t get configuration for all actions: '+ err.message));

        results.forEach(function(cfg){
            if(typeof(cfg) !== 'object' || !Object.keys(cfg).length) return;
            for (var key in cfg) {
                if (cfg.hasOwnProperty(key)) {
                    actionsLayout[cfg.group][cfg.actionID][key] = cfg[key];
                }
            }
        });
        callback(null, actionsLayout);
    });
};

/*
 Return configuration for specific action

 actionID - action ID (directory name for action)
 callback(err, cfg) cfg - action configuration from action configuration file plus cfg.link - path to action and cfg.actionID - action ID
 */

actions.getConfiguration = function (actionID, callback){
    if(!actionID) return callback(new Error('Action ID not defined'));

    var actionConfigPath = path.join(conf.get('actions:dir'), actionID, 'config.json');

    fs.readFile(actionConfigPath, 'utf8', function(err, fileBody) {
        if (err) return callback(new Error('Can\'t read configuration for action "'+actionID+'" from file "' + actionConfigPath + '": ' + err.message));
        try {
            var cfg = JSON.parse(fileBody);
        } catch (err) {
            return callback(new Error('Can\'t get configuration for action "'+actionID+'" from file "' + actionConfigPath + '": ' + err.message));
        }
        if(typeof(cfg) !== 'object')
            return callback(new Error('Error in configuration for action "'+actionID+'" from file "' + actionConfigPath + '": ' + err.message));

        // Add cfg.link to action configuration
        cfg.link = path.join('/', conf.get('actions:dir'), actionID).replace(/\\/g, '/');
        cfg.actionID = actionID;
        callback(null, cfg);
    });
};

/*
    return action description, according settings in a descriptionTemplate and variables values

    descriptionTemplate - string with a description template
    variables - [{name: varName1, val: varValue1}, ...]
    callback(err, description), where description is a string with a action description

    descriptionTemplate can contain:
    strings
    variables in format %:varName:%, which will be replaced to variable value
    conditions in format %[ %:varName:% [<logical operator> <value>] %?% <string for true> %|% <string for false> ]%

    %:varName:%, which will be replaced to variable value
    <logical operator>: one of "=" (string equal <value>), "~" (string contain <value>). all compares are case insensitive
        without <logical value> variable checked for exists
    <value> - string or\and variable
    <string for true> and <string for false> can contain another conditions
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
                    log.warn('Can\'t create description for parameter: Parameter o = "', variable.value,
                        '" is empty. Description template: ', descriptionTemplate, '; variables: ', variables);
                    return
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

/*
    processing condition and return result of condition for description template

    condition - <condition> %?% <string for true> %|% <string for false>

    <condition> - <string1> [<= or ~> <string2>]
    <string for true> - string, returned if result of condition is true
    <string for false> - string, returned if result of condition is false
 */
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

/*
Replace variables with index in variable name

{{str}}: str - <condition>::<joinString>::errStr
var variables = {"variable11name0": "qqq", "variable@@@name1": "www", "another11name0": "111", "another$$$name1": "222"};
var str = "string with %:variable*name*:% and %:another*name*:%:: OR ::UNDEFINED";
var res = processRepeatedVariables(str, variables);
console.log(res);
res:
"string with qqq and 111 OR string with www and UNDEFINED OR string with UNDEFINED and 222"
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
            log.error('Error while create regExp from in condition ' + condition + '(' + variableTemplate + '): ' + err.message)
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

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
