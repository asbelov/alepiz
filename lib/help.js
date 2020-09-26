/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var fs = require('fs');
var path = require('path');
var log = require('../lib/log')(module);

var help = {};
module.exports = help;

var defaultLang = 'en';
var defaultPage = 'index';
var extensions = ['pug', 'html', 'htm', 'txt'];
var helpDir = 'help';

help.save = function (dir, page, lang, text, ext, callback) {

    var helpFileName = (page || defaultPage) + (lang ? '.' + lang : '') + '.' + (ext || extensions[0]);
    var helpPath = path.join(dir, helpDir);
    var helpFile = path.join(helpPath, helpFileName);

    if (!fs.existsSync(helpPath)) {
        log.info('Creating ', helpPath, ' directory and saving ', helpFile);
        fs.mkdir(helpPath, function(err) {
            if(err) return callback(new Error('Can\'t make help dir ' + helpPath + ': ' + err.message));

            fs.writeFile(helpFile, text, 'utf8', function (err) {
                if(err) return callback('Can\'t write help file to ' + helpFile + ': ' + err.message);
                callback();
            });
        });
    } else {
        log.info('Saving ', helpFile);
        fs.writeFile(helpFile, text, 'utf8', function (err) {
            if(err) return callback('Can\'t write help file to ' + helpFile + ': ' + err.message);
            callback();
        });
    }
};

help.getHelpContent = function (dir, page, lang, callback) {
    help.getHelpFilePath(dir, page, lang, function(err, helpFile) {
        if(err) return callback(err);

        if(!helpFile) return callback(null, null, null, path.join(dir, helpDir));

        fs.readFile(helpFile, 'utf8', function (err, text) {
            if(err) return callback(new Error('Can\'t get help file ' + helpFile + ': ' + err.message));
            callback(null, text, path.basename(helpFile), path.join(dir, helpDir));
        });
    });
};

help.getHelpFilePath = function(dir, page, lang, callback) {

    var my_extensions = extensions;
    if(!page) page = defaultPage;
    else {
        var arr = page.split('.');
        if(arr.length) { // file has extension
            my_extensions = [arr.pop()];
            page = arr.join('.');
        }
    }

    for(var i = 0; i < my_extensions.length; i++) {
        var ext = '.' + my_extensions[i];

        var helpFile = path.join(dir, helpDir, page + (lang ? '.' + lang : '') + ext);
        if (fs.existsSync(helpFile)) return callback(null, helpFile);

        helpFile = path.join(dir, helpDir, page + ext);
        if (fs.existsSync(helpFile)) return callback(null, helpFile);

        helpFile = path.join(dir, helpDir, page + '.' + defaultLang + ext);
        if (fs.existsSync(helpFile)) return callback(null, helpFile);
    }

    help.getLanguages(dir, page, function (err, languages, files) {
        if(err) return callback(err);
        if(!files.length) return callback(new Error('Can\'t find help pages for ' + dir + '; page: ' + page));

        callback(null, path.join(dir, helpDir, files[0]));
    })

    log.warn('Can\'t get help file path in ', dir, ' for page: ', page, '; lang: ', lang);
};

help.getLanguages = function (dir, page, callback) {

    var my_extensions = extensions;
    if(!page) page = defaultPage;
    else {
        page = page.toLowerCase();
        var arr = page.split('.');
        if(arr.length) { // file has extension
            my_extensions = [arr.pop()];
            page = arr.join('.');
        }
    }
    var helpPath = path.join(dir, helpDir);

    fs.readdir(helpPath, function (err, initFiles) {
        if(err) return callback(new Error('Can\'t read help dir ' + helpPath + ': ' + err.message));

        var languages = [], files = [];
        initFiles.forEach(function (file) {

            try {
                var stat = fs.lstatSync(path.join(helpPath, file));
            } catch (e) {
                log.warn('Can\'t stat file ', file , ' for get languages in ', helpPath, ': ', e.message);
                return;
            }
            if(!stat.isFile()) return;

            var fileName = file.toLowerCase();

            for(var i = 0; i < my_extensions.length; i++) {
                var ext = '.' + my_extensions[i];
                if (fileName === page + ext) {
                    languages.push(defaultLang);
                    files.push(file);
                    break;
                }
                else {
                    // 0123456789; file.length = 10; page.length = 3
                    // inx.ru.pug
                    if (fileName.indexOf(page + '.') === 0 && fileName.indexOf(ext) === fileName.length - ext.length) {
                        // use file instead fileName for save case of fileName
                        languages.push(file.substring(page.length + 1, fileName.length - ext.length));
                        files.push(file);
                        break;
                    }
                }
            }
        });
        callback(null, languages, files);
    });
};