/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const _log = require('../../lib/log');
const ajax = require('../log_viewer/ajax');
const fs = require('fs');
const async = require('async');
const path = require('path');
const iconv = require('iconv-lite');

/**
 * Creates a backup copy and saves a new file after making changes in the editor
 * @param {Object} args
 * @param {string} args.actionID action ID
 * @param {Object} args.actionCfg action parameters
 * @param {string} args.actionName action name
 * @param {string} args.username username
 * @param {string} args.codePage text code page
 * @param {string} args.selectService service name where the file was changed
 * @param {string} args.selectFile file name for saving changes
 * @param {string} args.editorResult changes in diff format
 * @param {string} args.bcpFilePath Backup file path
 * @param {function(Error)|function(null, string)} callback callback(err, fileNameForSave)
 */

module.exports = function(args, callback) {
    var log = _log({
        sessionID: args.actionCfg.launcherPrms.sessionID,
        filename: __filename,
    });

    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    if(!args.selectService) return callback(new Error('Service not selected'));
    if(!args.selectFile) return callback(new Error('File not selected'));
    var fileToSave = args.selectFile.toUpperCase();

    ajax({
        function: 'getFilesList',
        IDs: args.selectService,
        filePath: 'CONFIG_FILE_PATH',
        username: args.username,
        actionID: args.actionID
    }, function(err, result) { // objectID + '\r' + services[objectID].UNC + '\r' + file;
        if(err) return callback(err);
        if(typeof result !== 'string' || !result ) return callback(new Error('Can\'t find files for service'));

        var files = result.split('\n');

        async.each(files, function (file, callback) {

            var filePath = file.split('\r')[1];
            var fileName = file.split('\r')[2];
            if (!filePath || !fileName) return callback();

            log.debug(fileToSave, '.indexOf(', fileName.toUpperCase(), ') = ',
                fileToSave.indexOf(fileName.toUpperCase()), '(', fileToSave.length - fileName.length, ') : ',
                fileToSave,' .indexOf(', filePath.toUpperCase(), ') = ', fileToSave.indexOf(filePath.toUpperCase()))

            if (fileToSave.indexOf(fileName.toUpperCase()) !== fileToSave.length - fileName.length) return callback();

            if (fileToSave.indexOf(filePath.toUpperCase()) !== 0) {
                log.warn('The directory with the configuration file has been changed from ', filePath, '\\... to ',
                    fileToSave);
            }

            var fileNameToSave = fileToSave.slice(fileToSave.length - fileName.length);
            var newFilePath = path.join(filePath, fileNameToSave);

            bcpFile(args, filePath, fileName, function (err) {
                if (err) return callback(err);
                log.info('Saving file to ', newFilePath);
                saveFile(newFilePath, args.editorResult, args.codePage, callback);
            });
        }, function (err) {
            if(err) {
                return callback(new Error('Can\'t save file ' + fileToSave + ': ' + err.message +
                    '; list of service files: ' + files.join(';')));
            }
            callback(null, fileToSave)
        })
    });


    function saveFile(filePath, content, codePage, callback) {
        if(content === undefined) return callback(new Error('Content for file ' + filePath + ' is undefined'));

        var outData = iconv.encode(content, codePage);
        fs.writeFile(filePath, outData, function (err) {
            if(err) return callback(new Error('Can\'t write file ' + filePath + ': ' + err.message));

            if(!content.length) {
                log.warn('Saving a zero-size file ', filePath);
                return callback();
            }

            fs.stat(filePath, function(err, stats) {
                if (err) return callback(new Error('Can\'t get file size for the file ' + filePath + ': ' + err.message));
                if(stats.size === 0) {
                    log.warn('After saving file ' , filePath, ' has zero size but mast be a ', content.length,
                        'bytes. Try to save again');
                    setTimeout(saveFile, 300, filePath, content, codePage, callback);
                    return;
                }
                log.info('The file ', filePath, ' was saved successfully. File size is ', stats.size, ' bytes' );
                callback();
            });
        });
    }

    function bcpFile(args, filePath, fileName, callback) {
        let bcpPath = args.actionCfg.options.bcpFilePath,
            vars = bcpPath.match(/%:.+?:%/g),
            date = new Date();

        if (vars) {
            vars.forEach(variable => {
                switch (variable) {
                    case "%:YYYY:%":
                    {
                        bcpPath = bcpPath.replace(/%:YYYY:%/, String(date.getFullYear()));
                        break;
                    }
                    case "%:MM:%":
                    {
                        let MM = ("0" + (date.getMonth() + 1)).slice(-2);
                        bcpPath = bcpPath.replace("%:MM:%", MM);
                        break;
                    }
                    case "%:dd:%":
                    {
                        let dd = ("0" + date.getDate()).slice(-2);
                        bcpPath = bcpPath.replace("%:dd:%", dd);
                        break;
                    }
                    case "%:HH:%":
                    {
                        let HH = ("0" + date.getHours()).slice(-2);
                        bcpPath = bcpPath.replace("%:HH:%", HH);
                        break;
                    }
                    case "%:mm:%":
                    {
                        let mm = ("0" + date.getMinutes()).slice(-2);
                        bcpPath = bcpPath.replace("%:mm:%", mm);
                        break;
                    }
                    case "%:ss:%":
                    {
                        let ss = ("0" + date.getSeconds()).slice(-2);
                        bcpPath = bcpPath.replace("%:ss:%", ss);
                        break;
                    }
                }
            });
        }

        let subDir = path.dirname(fileName),
            bcpFilePath = path.join(filePath, bcpPath, fileName);
        bcpPath = path.join(filePath, bcpPath, subDir);
        filePath = path.join(filePath, fileName);

        fs.mkdir(bcpPath, { recursive: true }, function(err) {
            if (err) return callback(err);
            fs.copyFile(filePath, bcpFilePath, function(err) {
                if (err) return callback(err);
                log.info('Backup file has been created: ', bcpPath);
                setTimeout(callback, 500);
            });
        });
    }
};
