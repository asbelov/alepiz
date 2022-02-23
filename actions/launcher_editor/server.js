/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var log = require('../../lib/log')(module);
var help = require('../../lib/help');
var rmTree = require('../../lib/utils/rmTree');
var Conf = require('../../lib/conf');
const confLaunchers = new Conf('config/launchers.json');


module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var ID = args.newLauncher;
    if(!ID) {
        if(!args.ID) return callback(new Error('Launcher name is not set'));
        else ID = args.ID;
    }

    if(!args.launcherEditor) return callback(new Error('Launcher ' + ID + ' content is empty'));
    
    var launcherDir = path.join(__dirname, '..', '..', confLaunchers.get('dir'), ID);
    if(!args.ID) {
        try {
            fs.mkdirSync(launcherDir);
        } catch (e) {
            return callback(new Error('Can\'t create dir ' + launcherDir + ' for a new launcher ' + ID + ': ' + e.message));
        }
    } else {

        if(args.deleteLauncher) {
            try {
                rmTree.sync(launcherDir);
            } catch (e) {
                return callback(new Error('Can\'t delete launcher ' + args.ID + '(' + launcherDir + '): ' + e.message));
            }
            log.warn('Successfully delete launcher ', args.ID);
            return callback();
        }

        if(args.ID !== ID) {
            log.warn('Rename launcher from ', args.ID, ' to ', ID);

            var oldLauncherDir = path.join(__dirname, '..', '..', confLaunchers.get('dir'), args.ID);
            if(fs.existsSync(launcherDir)) {
                log.error('Can\'t rename ', oldLauncherDir, ' to ', launcherDir, ': ', launcherDir , ' already exist');
                ID = args.ID;
            } else {
                try {
                    fs.renameSync(oldLauncherDir, launcherDir);
                } catch (e) {
                    log.error('Can\'t rename ', oldLauncherDir, ' to ', launcherDir, ': ', e.message);
                    ID = args.ID;
                }
            }
        }

        if(!fs.existsSync(launcherDir)) {
            return callback(new Error('Directory ' + launcherDir + ' for a launcher ' + ID + ' not exist'));
        }
    }

    var launcherFile = path.join(launcherDir, confLaunchers.get('fileName'));
    
    fs.writeFile(launcherFile, args.launcherEditor, 'utf8', function (err) {
        if(err) log.error('Can\'t write file ', launcherFile, ': ', err.message);
        else log.info('Save file ', launcherFile, ' complete');
        
        help.save(launcherDir, null, args.lang, args.helpEditor, 'pug', function (err) {
            if(err) callback(err);

            log.info('Launcher ',ID,' saved successfully');
            callback(null, ID);
        });
    });
};
