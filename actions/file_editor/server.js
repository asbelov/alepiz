/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = require('../../lib/log')(module);
var ajax = require('../log_viewer/ajax');
var fs = require('fs');
var path = require('path');

module.exports = function(args, callback) {
    log.info('Starting action server "', args.actionName, '" with parameters', args);

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

        for(var i = 0; i < files.length; i++) {
            var filePath = files[i].split('\r')[1];
            var fileName = files[i].split('\r')[2];
            if(!filePath || !fileName) continue;

            //log.info(fileToSave, '.indexOf(', fileName.toUpperCase(), ') = ', fileToSave.indexOf(fileName.toUpperCase()), '(', fileToSave.length - fileName.length, ') : ', fileToSave,' .indexOf(', filePath.toUpperCase(), ') = ', fileToSave.indexOf(filePath.toUpperCase()))
            if(fileToSave.indexOf(fileName.toUpperCase()) === fileToSave.length - fileName.length) {
                if(fileToSave.indexOf(filePath.toUpperCase()) !== 0)
                    log.warn('Directory with config files was changed from ' + filePath + '\\... to ' + fileToSave);

                var fileNameToSave = fileToSave.slice(fileToSave.length - fileName.length);
                var newFilePath = path.join(filePath, fileNameToSave);

                return bcpFile(args, filePath, fileName, function(err) {
                    if (err) return callback(new Error(err));
                    log.info('Saving file to ' + newFilePath);
                    saveFile(newFilePath, args.editorResult, callback);
                });
            }
        }

        return callback(new Error('Can\'t find file ' + fileToSave + ' for saving in the list of service files: ' + files.join(';')));
    });
};

function saveFile(filePath, content, callback) {
    if(content === undefined) return callback(new Error('Content for file ' + filePath + ' is undefined'));

    fs.writeFile(filePath, content, function (err) {
        if(err) return callback(new Error('Can\'t write file ' + filePath + ': ' + err.message));

        if(!content.length) {
            log.warn('Saving zero size file ', filePath);
            return callback();
        }

        fs.stat(filePath, function(err, stats) {
            if (err) return callback(new Error('Can\'t get file size for file ' + filePath + ': ' + err.message));
            if(stats.size === 0) {
                log.warn('After saving file ' , filePath, ' has zero size but mast be a ', content.length,
                    'bytes. Try to save again');
                setTimeout(saveFile, 100, filePath, content, callback);
                return;
            }
            log.info('Save file ', filePath, ' complete');
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
                        bcpPath = bcpPath.replace(/%:YYYY:%/, date.getFullYear());
                        break;
                    }
                case "%:MM:%":
                    {
                        let MM = ("0" + date.getMonth()).slice(-2);
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

    let bcpFilePath = path.join(filePath, bcpPath, fileName);
    bcpPath = path.join(filePath, bcpPath);
    filePath = path.join(filePath, fileName);

    fs.mkdir(bcpPath, function(err) {
        if (err) return callback(new Error(err));
        fs.copyFile(filePath, bcpFilePath, function(err) {
            if (err) return callback(new Error(err));
            log.info('Backup file created: ' + bcpPath);
            callback();
        });
    });
}