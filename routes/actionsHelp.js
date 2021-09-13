/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@mail.ru>
 */


var path = require('path');
var fs = require('fs');
var log = require('../lib/log')(module);
var express = require('express');
var conf = require('../lib/conf');
var help = require('../lib/help');

var router = express.Router();
module.exports = router;

var errorFile = path.join(__dirname, '..', 'views', 'help_error.pug');

router.all('/' + conf.get('actions:link') + '/:actionDir/' + conf.get('actions:helpDir') + '/*', function(req, res, next) {
    var actionID = req.params.actionDir;
    var helpFile = req.params[0];

    //console.log('!!!!!', actionID, helpDir, req.params);
    var actionDir = path.join(__dirname, '..', conf.get('actions:link'), actionID);

    help.getLanguages(actionDir, helpFile, function(err, languages, files) {
        if(err) return res.render(errorFile);

        // req.acceptsLanguages is working good with array of languages
        var lang = languages.length ? req.acceptsLanguages(languages) : null;

        var fullPathToHelpFile = help.getHelpFilePath(actionDir, helpFile, lang) || files[0];

        var extension = path.extname(fullPathToHelpFile).toLowerCase().substring(1);
        if(extension === 'pug' || extension === 'html'  || extension === 'htm' || extension === 'css'  || extension === 'txt') {
            res.render(fullPathToHelpFile);
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
    });
});
