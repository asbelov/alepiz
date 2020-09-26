/**
 * Created by asbel on 27.04.2020
 */

var fs = require('fs');
var path = require('path');
var async = require('async');
var log = require('../../lib/log')(module);
var conf = require('../../lib/conf');
conf.file('config/conf.json');
var help = require('../../lib/help');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    conf.reload();
    if(args.func === 'getActions') return getActions(args.username, callback);

    if(args.func === 'getFiles') return getFiles(args.ID, callback);

    if(!args.name) return callback(new Error('Action name is not specified for getting help data'));
    var dir = path.join(__dirname, '..', '..', conf.get('actions:dir'), args.name);

    if(args.func === 'getHelpLanguages') {
        return help.getLanguages(dir, null, function(err, languages) {
            callback(null, languages);
        });
    }

    if(args.func === 'getHelpContent') help.getHelpContent(dir, null, args.lang, callback);
};

function getActions(user, callback) {

    var actionsDir = path.join(__dirname, '..', '..', conf.get('actions:dir'));

    fs.readdir(actionsDir, function (err, actionsIDs) {
        if(err) return callback(new Error('Can\'t get actions list from ' + actionsDir + ': ' + err.message));

        var actions = [];
        async.each(actionsIDs, function (actionID, callback) {
            var configPath = path.join(actionsDir, actionID, 'config.json');

            if(!fs.existsSync(configPath)) return callback();
            fs.readFile(configPath, 'utf8', function (err, actionCfgStr) {
                if(err) return callback();

                var actionCfg;
                try {
                    actionCfg = JSON.parse(actionCfgStr);
                } catch (e) {
                    log.warn('Can\'t parse action configuration from ', configPath, ': ', e.message);
                    return callback();
                }
                actionCfg.id = actionID;
                actions.push(actionCfg);
                callback();
            });
        }, function () {
            callback(null, {
                actions: actions,
                layout: conf.get('actions:layout'),
            });
        });
    });
}

function getFiles(actionID, callback) {

    var actionDir = path.join(__dirname, '..', '..', conf.get('actions:dir'), actionID);
    var configPath = path.join(actionDir, 'config.json');

    fs.readFile(configPath, 'utf8', function (err, actionCfgStr) {
        if (err) return callback(new Error('Can\'t read action configuration from ' + configPath + ': ' + err.message));

        try {
            var actionCfg = JSON.parse(actionCfgStr);
        } catch (e) {
            return callback(new Error('Can\'t parse action configuration from ' + configPath + ': ' + e.message));
        }

        var files = {
            homePage: {
                file: actionCfg.homePage + '.pug',
                content: '',
            },
            ajax: {
                file: actionCfg.ajaxServer,
                content: '',
            },
            server: {
                file: actionCfg.launcherPrms ? actionCfg.launcherPrms.javaScript : null,
                content: '',
            },
            client: {
                file: actionCfg.staticDir ? path.join(actionCfg.staticDir, 'client.js') : null,
                content: '',
            },
        };

        async.eachOf(files, function (value, key, callback) {
            if(!value.file) return callback()

            var filePath = path.join(actionDir, value.file);
            fs.readFile(filePath, 'utf8', function (err, fileContent) {
                if(err) log.warn('Can\'t read file ', filePath, ': ', err.message);

                files[key].content = fileContent || '';
                callback();
            });
        }, function () {
            files.conf = {
                file: 'config.json',
                content: actionCfgStr,
            }
            callback(null, files);
        });
    });
}
