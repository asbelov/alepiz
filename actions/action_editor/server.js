/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var async = require('async');
var log = require('../../lib/log')(module);
var help = require('../../lib/help');
var rmTree = require('../../lib/utils/rmTree');
var Conf = require('../../lib/conf');
const confActions = new Conf('config/actions.json');


module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    confActions.reload();

    var ID = args.newActionID;
    if(!ID) {
        if(!args.ID) return callback(new Error('Action ID is not set'));
        else ID = args.ID;
    }

    var actionDir = path.join(__dirname, '..', '..', confActions.get('dir'), ID);
    if(!args.ID) {
        try {
            fs.mkdirSync(actionDir);
        } catch (e) {
            return callback(new Error('Can\'t create dir ' + actionDir + ' for a new action ' + ID + ': ' + e.message));
        }
    } else {

        if(args.deleteAction) {
            try {
                rmTree.sync(actionDir);
            } catch (e) {
                return callback(new Error('Can\'t delete action ' + args.ID + '(' + actionDir + '): ' + e.message));
            }
            saveConf(null, args.actionsGroup, args.ID);
            log.warn('Successfully delete action ', args.ID);
            return callback();
        }

        if(args.ID !== ID) {
            log.warn('Rename action from ', args.ID, ' to ', ID);

            var oldActionDir = path.join(__dirname, '..', '..', confActions.get('dir'), args.ID);
            if(fs.existsSync(actionDir)) {
                log.error('Can\'t rename ', oldActionDir, ' to ', actionDir, ': ', actionDir , ' already exist');
                ID = args.ID;
            } else {
                try {
                    fs.renameSync(oldActionDir, actionDir);
                } catch (e) {
                    log.error('Can\'t rename ', oldActionDir, ' to ', actionDir, ': ', e.message);
                    ID = args.ID;
                }
            }
        }

        if(!fs.existsSync(actionDir)) {
            return callback(new Error('Directory ' + actionDir + ' for a action ' + ID + ' not exist'));
        }
    }

    try {
        var actionCfg = JSON.parse(args.confEditorParent);
    } catch (e) {
        return callback(new Error('Can\'t parse action ' + ID + ' configuration: ' + e.message));
    }

    var files = {
        conf: {
            file: 'config.json',
            content: args.confEditorParent,
        },
        homePage: {
            file: actionCfg.homePage + '.pug',
            content: args.indexPugEditorParent,
        },
        ajax: {
            file: actionCfg.ajaxServer,
            content: args.ajaxJSEditorParent,
        },
        server: {
            file: actionCfg.launcherPrms ? actionCfg.launcherPrms.javaScript : null,
            content: args.serverJSEditorParent,
        },
        client: {
            file: actionCfg.staticDir ? path.join(actionCfg.staticDir, 'client.js') : null,
            content: args.clientJSEditorParent,
        },
    };

    // create static dir for client
    if(files.client.file) {
        var staticDir = path.join(actionDir, actionCfg.staticDir);
        if(!fs.existsSync(staticDir)) {
            try {
                fs.mkdirSync(staticDir);
            } catch (e) {
                log.error('Can\'t create ', staticDir, ': ', e.message);
            }
        }
    }

    async.eachOf(files, function (value, key, callback) {
        if(!value.file || !value.content) return callback();

        var filePath = path.join(actionDir, value.file);
        fs.writeFile(filePath, value.content, 'utf8', function (err) {
            if(err) log.error('Can\'t write file ', filePath, ': ', err.message);
            else log.info('Save file ', filePath, ' complete');

            callback();
        });
    }, function () {

        help.save(actionDir, null, args.lang, args.helpEditor, 'pug', function (err) {
            if(err) callback(err);

            log.info('Action ',ID,' saved successfully');
            saveConf(ID, args.newActionGroup || args.actionsGroup, args.ID);
            callback(null, ID);
        });
    });
};

function saveConf(ID, newGroup, oldID) {
    var cfg = confActions.get();
    var actionsLayout = cfg.actions.layout;
    if(ID && actionsLayout[newGroup] && actionsLayout[newGroup][ID]) return;

    // remove actionID from old group
    if(ID && !oldID) oldID = ID;
    for(var group in actionsLayout) {
        if(actionsLayout[group][oldID]) {
            delete actionsLayout[group][oldID];
            if(!Object.keys(actionsLayout[group]).length) delete actionsLayout[group];
            break;
        }
    }

    if(newGroup) {
        // add new group
        if (!actionsLayout[newGroup]) actionsLayout[newGroup] = {};
        // add action ID in group
        if (ID) actionsLayout[newGroup][ID] = {};
    }

    //console.log('Param:', ID, newGroup, oldID, '!!!New layout:', actionsLayout);

    cfg.actions.layout = actionsLayout;

    var errMessage = confActions.save(cfg);
    if(errMessage) log.error(errMessage);
}