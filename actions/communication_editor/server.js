/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var log = require('../../lib/log')(module);
var help = require('../../lib/help');
var rmTree = require('../../lib/utils/rmTree');
var conf = require('../../lib/conf');
conf.file('config/conf.json');


module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var mediaID = args.newMedia;
    if(!mediaID) {
        if(!args.ID) return callback(new Error('Media name is not set'));
        else mediaID = args.ID;
    }

    if(!args.mediaEditor) return callback(new Error('Media ' + mediaID + ' content is empty'));
    
    var mediaDir = path.join(__dirname, '..', '..', conf.get('communicationMedia:dir'), mediaID);
    if(!args.ID) {
        try {
            fs.mkdirSync(mediaDir);
        } catch (e) {
            return callback(new Error('Can\'t create dir ' + mediaDir + ' for a new media ' + mediaID + ': ' + e.message));
        }
    } else {

        if(args.deleteMedia) {
            try {
                rmTree.sync(mediaDir);
            } catch (e) {
                return callback(new Error('Can\'t delete media ' + args.ID + '(' + mediaDir + '): ' + e.message));
            }

            userDB.deleteCommunicationMedia(mediaID, function (err) {
                if(err) {
                    return callback(new Error('Can\'t delete communication media ' + mediaID + ' from database: ' +
                        err.message));
                }
                log.warn('Successfully delete media ', args.ID);
                return callback();
            });
        }

        if(args.ID !== mediaID) {
            log.warn('Rename media from ', args.ID, ' to ', mediaID);

            var oldMediaDir = path.join(__dirname, '..', '..', conf.get('communicationMedia:dir'), args.ID);
            if(fs.existsSync(mediaDir)) {
                log.error('Can\'t rename ', oldMediaDir, ' to ', mediaDir, ': ', mediaDir , ' already exist');
                mediaID = args.ID;
            } else {
                try {
                    fs.renameSync(oldMediaDir, mediaDir);
                } catch (e) {
                    log.error('Can\'t rename ', oldMediaDir, ' to ', mediaDir, ': ', e.message);
                    mediaID = args.ID;
                }
            }
        }

        if(!fs.existsSync(mediaDir)) {
            return callback(new Error('Directory ' + mediaDir + ' for a media ' + mediaID + ' not exist'));
        }
    }

    var mediaFile = path.join(mediaDir, conf.get('communicationMedia:server'));
    var confFile = path.join(mediaDir, conf.get('communicationMedia:configuration'));
    
    fs.writeFile(mediaFile, args.mediaEditor, 'utf8', function (err) {
        if(err) log.error('Can\'t write file ', mediaFile, ': ', err.message);
        else log.info('Save file ', mediaFile, ' complete');

        fs.writeFile(confFile, args.confEditor, 'utf8', function (err) {
            if (err) log.error('Can\'t write file ', confFile, ': ', err.message);
            else log.info('Save file ', confFile, ' complete');

            help.save(mediaDir, null, args.lang, args.helpEditor, 'pug', function (err) {
                if (err) callback(err);

                log.info('Media ', mediaID, ' saved successfully');
                callback(null, mediaID);
            });
        });
    });
};
