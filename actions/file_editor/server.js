/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
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
    }, function(err, result) {
        if(err) return callback(err);
        if(typeof result !== 'string' || !result ) return callback(new Error('Can\'t find files for service'));

        var files = result.split('\n');

        for(var i = 0; i < files.length; i++) {
            var filePath = files[i].split(':')[1];
            var fileName = files[i].split(':')[2];
            if(!filePath || !fileName) continue;

            // d:\service\conf.ini = 19; \conf.ini = 9;
            if(fileToSave.indexOf(fileName.toUpperCase()) === fileToSave.length - fileName.length - 1) {
                if(fileToSave.indexOf(filePath.toUpperCase()) !== 0)
                    log.warn('Directory with config files was changed from ' + filePath + '\\... to ' + fileToSave);

                var fileNameToSave = fileToSave.slice(fileToSave.length - fileName.length - 1);
                var newFilePath = path.join(filePath, fileNameToSave);

                log.info('Saving file ' + newFilePath);

                return saveFile(newFilePath, callback);
            }
        }

        return callback(new Error('Can\'t find file ' + fileToSave + ' for saving in the list of service files'));
    });
};

function saveFile(filePath, callback) {

    callback()
}
