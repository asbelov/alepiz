/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var path = require('path');
var fs = require('fs');
var async = require('async');
var log = require('../lib/log')(module);
var express = require('express');
var conf = require('../lib/conf');
var help = require('../lib/help');

var router = express.Router();
module.exports = router;

var errorFile = path.join(__dirname, '..', 'views', 'help_error.pug');

/* GET home page. */
router.get('/', function(req, res) {
    var dir = path.join(__dirname, '..');

    renderHelp(dir, req, res);
});

/* GET home page. */
router.get('/:page', function(req, res) {
    var dir = path.join(__dirname, '..');

    if(req.params.page === 'download') req.params[0] = '/help/download.pug';
    else req.params[0] = req.params.page;
    renderHelp(dir, req, res);
});

router.get('/help/*', function(req, res) {
    var dir = path.join(__dirname, '..', 'views');

    if(req.params[0].indexOf('contents') === 0) {
        getTableOfContents(req, res, function (err, result) {
            renderHelp(dir, req, res, result);
        });
    } else renderHelp(dir, req, res);
});

// Initializing action
router.post('/:action', function(req, res) {
    var actionID = req.params.action;

    if(!actionID) {
        log.error('Action is not set');
        return res.json({
            err: 'Action is not set',
        });
    }

    // first letter in uppercase
    actionID = actionID.charAt(0).toUpperCase() + actionID.slice(1);

    try {
        var action = require('../lib/action' + actionID);
    } catch (e) {
        log.error('Can\'t attach action ', actionID, ': ', e.message);
        return res.json({
            err: 'Unknown action ' + actionID,
        });
    }

    action(req.body, function (err, result) {
        if(err) log.error('Error in ', actionID, ': ',  err.message);
        res.json({
            err: err && err.message,
            result: result
        });
    });
});

router.get('/actions/:actionDir/help/*', function(req, res) {
    var actionID = req.params.actionDir;
    //console.log('!!!!!', actionID, helpDir, req.params);
    var actionDir = path.join(__dirname, '..', conf.get('actions:dir'), actionID);

    renderHelp(actionDir, req, res);
});

router.get('/collectors/:collectorDir/help/*', function(req, res) {
    var collectorID = req.params.collectorDir;
    //console.log('!!!!!', collectorID, helpDir, req.params);
    var collectorDir = path.join(__dirname, '..', conf.get('collectors:dir'), collectorID);

    renderHelp(collectorDir, req, res);
});

router.get('/launchers/:launcherDir/help/*', function(req, res) {
    var launcherID = req.params.launcherDir;
    //console.log('!!!!!', launcherID, helpDir, req.params);
    var launcherDir = path.join(__dirname, '..', conf.get('launchers:dir'), launcherID);

    renderHelp(launcherDir, req, res);
});

router.get('/communication/:communicationDir/help/*', function(req, res) {
    var mediaID = req.params.communicationDir;
    //console.log('!!!!!', communicationDir, helpDir, req.params);
    var communicationDir = path.join(__dirname, '..', conf.get('communicationMedia:dir'), mediaID);

    renderHelp(communicationDir, req, res);
});

function getTableOfContents(req, res, callback) {

    try {
        var commonDir = path.join(__dirname, '..', 'views');
        var actionsDir = path.join(__dirname, '..', conf.get('actions:dir'));
        var collectorsDir = path.join(__dirname, '..', conf.get('collectors:dir'));
        var launchersDir = path.join(__dirname, '..', conf.get('launchers:dir'));
        var communicationDir = path.join(__dirname, '..', conf.get('communicationMedia:dir'));
    } catch(e) {
        log.error('Can\'t make path to help section: ', e.message);
    }

    async.parallel({
        common: function(callback) {
            async.series([
                function(callback) {
                    getContentsFromDir(commonDir, 'overview.pug', req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, 'install.pug', req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, null, req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, 'develop.pug', req, callback);
                }
            ], callback);
        },
        lessons: function(callback) {
            async.series([
                function(callback) {
                    getContentsFromDir(commonDir, 'lesson1.pug', req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, 'lesson2.pug', req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, 'lesson3.pug', req, callback);
                },
                function(callback) {
                    getContentsFromDir(commonDir, 'lessonVariables.pug', req, callback);
                }
            ], callback);
        },
        actions: function(callback) {
            getHelpTitles(actionsDir, req, callback);
        },
        collectors: function (callback) {
            getHelpTitles(collectorsDir, req, callback);
        },
        launchers: function (callback) {
            getHelpTitles(launchersDir, req, callback);
        },
        medias: function (callback) {
            getHelpTitles(communicationDir, req, callback);
        }
    }, function (err, result) {
        if(err) {
            log.error('Error getting table of contents: ', err.message);
            if(typeof callback === 'function') return callback(err);
            return res.render(errorFile);
        }
        if(typeof callback === 'function') return callback(null, result);
        res.json(result);
    });
}

function getHelpTitles(commonDir, req, callback) {

    fs.readdir(commonDir, function (err, files) {
        if(err) return callback(new Error('Can\'t read directory ' + commonDir + ' for create table of contents: ' + err.message));

        var contents = [];
        async.each(files, function (file, callback) {
            fs.lstat(path.join(commonDir, file), function (err, stat) {
                if(err) {
                    log.warn('Can\'t stat file ', file , ' for get titles in ', commonDir, ': ', err.message);
                    return callback()
                }
                if(!stat.isDirectory()) return callback();

                var dir = path.join(commonDir, file);
                getContentsFromDir(dir, null, req, function(err, content) {
                    if(err) return callback(err);
                    if(content) contents.push(content);
                    callback();
                });
            });
        }, function (err) {
            callback(err, contents.sort(function (a, b) {
                if(a.title > b.title) return 1;
                if(a.title < b.title) return -1;
                return 0;
            }));
        });
    });
}

function getContentsFromDir(dir, helpFile, req, callback) {
    help.getLanguages(dir, helpFile, function(err, languages) {
        if (err) {
            log.info('Help is not available for ', dir, ': ', err.message);
            return callback();
        }

        // req.acceptsLanguages is working good with array of languages
        var lang = languages.length ? req.acceptsLanguages(languages) : null;
        if(lang === false && languages.length) lang = languages[0];

        help.getHelpContent(dir, helpFile, lang, function (err, fileContent, helpFile, pathToHelp) {
            if(err) {
                log.warn(err.message);
                return callback();
            }

            if(!fileContent) {
                log.warn('Can\'t get help content for ', dir, ', page: ', helpFile, '; lang: ', lang);
                return callback();
            }

            var fullPathToHelpFile = path.join(pathToHelp, helpFile);

            var content = null;
            var title = fileContent.split(/[\r\n]/).join('<').replace(/.+?title ([^<]+).+/mi, '$1');
            if(title) {
                content = {
                    subDir: path.basename(dir),
                    helpDir: path.basename(path.dirname(fullPathToHelpFile)),
                    file: path.basename(fullPathToHelpFile),
                    title: title,
                };
            }

            callback(null, content);
        });
    });
}

function renderHelp(dir, req, res, param) {
    var helpFile = req.params[0];

    help.getLanguages(dir, helpFile, function(err, languages) {
        if(err) {
            log.error('Error getting languages for help from ', dir, '; helpFile: ', helpFile, ': ', err.message);
            return res.render(errorFile);
        }

        // req.acceptsLanguages is working good with array of languages
        var lang = languages.length ? req.acceptsLanguages(languages) : null;
        if(lang === false && languages.length) lang = languages[0];

        help.getHelpFilePath(dir, helpFile, lang, function (err, fullPathToHelpFile) {
            if(err || !fullPathToHelpFile) {
                log.error('Error calculating help file name from ', dir, '; helpFile: ', helpFile, err);
                return res.render(errorFile);
            }

            var extension = path.extname(fullPathToHelpFile).toLowerCase().substring(1);
            if(extension === 'pug' || extension === 'html'  || extension === 'htm' || extension === 'css'  || extension === 'txt') {
                res.render(fullPathToHelpFile, param);
            } else {
                var contentType;
                switch(extension){
                    case "jpg":
                        contentType = 'image/jpg';
                        break;
                    case "png":
                        contentType = 'image/png';
                        break;
                    case "gif":
                        contentType = 'image/gif';
                        break;
                }
                res.sendFile(fullPathToHelpFile, {headers: {'Content-Type':  contentType}});
            }
        })
    });
}