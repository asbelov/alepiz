/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 12.02.2017.
 */

var log = require('../../lib/log')(module);
var fs = require('fs');
var path = require('path');
var async = require('async');
var objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');
var actionConf = require('../../lib/actionsConf');
var recode = require('../../lib/recode');

module.exports = function(args, callback) {
    var func = args.function;

    if (!func) return callback(new Error('Ajax function is not set'));

    if(func === 'getFilesList') return getFilesList(args, callback);
    if(func === 'getFilePart' || func === 'getFileSize') return getFilePart(args, callback);

    return callback(new Error('Incorrect ajax function "' + args.function + '"'));
};


function getFilesList(args, callback) {
    log.info('Starting ajax for getting file list: ', args);

    if(!args.IDs) return callback('Objects IDs are not set');

    actionConf.getConfiguration(args.actionID, function(err, config) {
        if(err) return callback(err);

        var options = config.options;
        log.debug('Options: ', options);

        var skipDirs = options.skipDirs ? options.skipDirs.toUpperCase() : '';
        var order = options.order ? options.order.toUpperCase().split(/[\s\t]*[,;][\s\t]*/) : null;
        var recursion = options.recursion || 2;

        if(options.filterFiles) {
            try {
                var filterFilesRE = new RegExp(options.filterFiles, 'ig');
            } catch (e) {
                return callback(new Error('Can\'t make regExp from filterFiles option: ' + filterFiles + ': ' + e.message));
            }
        } else filterFilesRE = null;

        var filePath = options.filePath || 'FILE_PATH';

        objectsPropertiesDB.getProperties(args.username, args.IDs, function(err, properties) {
            if(err) return callback(err);

            var services = {};
            properties.forEach(function (property) {
                var objectID = property.objectID;
                if(objectID) {
                    if (Number(property.mode) === 0 && (property.name === 'HOST' || property.name ==='SERVICE_PATH' || property.name === filePath || property.name ==='RECURSION_FOR_FILES')) {
                        if(!services[objectID]) services[objectID] = {files: []};
                        services[objectID][property.name] = property.value;
                    }
                }
            });
            async.each(Object.keys(services), function (objectID, callback) {
                if(!services[objectID].HOST || (!services[objectID].SERVICE_PATH && !services[objectID][filePath])) return callback();

                if(services[objectID][filePath]) {
                    var dir = getUNC( services[objectID][filePath], services[objectID].HOST );
                } else {
                    dir = getUNC(getPath( services[objectID].SERVICE_PATH ), services[objectID].HOST );
                }
                var myRecursion = Number(services[objectID].RECURSION_FOR_FILES) || recursion;

                log.debug('Properties for ', objectID, ': ', services[objectID]);

                getFiles(dir, skipDirs, filterFilesRE, myRecursion, '', function(err, _files) {
                    if(err) return callback(err);

                    log.debug('files in ', dir ,' for ', objectID,': ', _files);
                    services[objectID].files = sortFiles(_files, order) || [];
                    services[objectID].UNC = dir;
                    callback();
                });
            }, function (err) {
                if(err) return callback(err.message);

                var result = '';
                for(var objectID in services) {
                    result = services[objectID].files.map(function (file) {
                        return objectID + ':' + services[objectID].UNC + ':' + file;
                    }).join('\n');
                }

                callback(null, result);
            });
        });
    });
}

function sortFiles(files, order) {

    if(!order) return files;

    // searching files with digits in names.
    var numericNames = 0;
    files.forEach(function (file) {
        if(/\d\d$/.test(file)) ++numericNames;
    });
    //if count of files with digits in its names more, then 66%, then sorting descending
    //else sorting files acceding
    //(may be file names contain a date and try to show files with the names with last dates at first)
    if(numericNames * 1.5 > files.length) files = files.sort().reverse();
    else files = files.sort();
    var sortedFiles = [];
    order.forEach(function (template) {

        for(var i = 0; i < files.length;) {
            if(files[i].toUpperCase().indexOf(template) !== -1) {
                sortedFiles.push(files[i]);
                files.splice(i, 1);
            } else i++
        }
    });

    Array.prototype.push.apply(sortedFiles, files);
    return sortedFiles;
}

function getUNC(_path, server) {
    if(/^[a-z]:/i.test(_path)) _path = _path.replace(/^([a-z]):\\(.+)$/i, '\\\\' + server + '\\' + '$1$\\$2');
    return _path;
}

function getPath(_path) {
    if(process.platform === 'win32') {
        var quote = _path.charAt(0);
        if (quote === '"' || quote === "'") var re = /^['"]([^'"]+\\)[^\\]+?['"].*?$/;
        else re = /^(.+\\)[^\\]+\.exe.*?$/i;

        return _path.trim().replace(re, '$1');

    } else return path.dirname(_path);
}

function getFiles(dir, skipDirs, filterFilesRE, recursion, subDir, callback) {
    if(recursion < 0) return callback();

    fs.readdir(path.join(dir, subDir), {withFileTypes: true}, function (err, filesObjArray) {
        if(err) return callback(new Error('Can\'t read dir ' + dir + ': ' + err.message));
        var files = [];
        async.each(filesObjArray, function(file, callback) {
            if(skipDirs && skipDirs.indexOf(file.name.toUpperCase()) !== -1) return callback();
            if(file.isDirectory()) {
                getFiles(dir, skipDirs, filterFilesRE, recursion-1, path.join(subDir, file.name), function(err, _files) {
                    if(err) return callback(err);
                    if(_files) Array.prototype.push.apply(files, _files);
                    callback();
                });
                return;
            }
            if(!filterFilesRE || filterFilesRE.test(file.name)) {
                filterFilesRE.lastIndex = 0;
                files.push(path.join(subDir, file.name));
            }
            callback();

        }, function(err) {
            if(err) return callback(err.message);

            callback(null, files);
        });
    });
}

function getFilePart(args, callback) {

    fs.stat(args.fileName, function(err, stats) {
        if(err) return callback(new Error('Can\'t get file size for file ' + args.fileName + ': ' + err.message));

        var fileSize = stats.size;
        if (args.function === 'getFileSize') return callback(null, fileSize);

        var direction = Number(args.direction) || 0;
        var filePos = Number(args.filePos) || 0;
        var loadSize = Number(args.loadSize) || fileSize, initLoadSize = loadSize;
        if(filePos !== parseInt(String(filePos), 10)) return callback(new Error('Incorrect file position ' + args.filePos));
        if(loadSize !== parseInt(String(loadSize), 10) || !loadSize)
            return callback(new Error('Incorrect load size ' + args.loadSize));

        fs.open(args.fileName, 'r', function(err, fd) {
            if(err) return callback(new Error('Can\'t open file' + args.fileName + ': ' + err.message));

            var buffer = Buffer.alloc(loadSize),
                continueSearching = true,
                prevFilePos = filePos;

            if(args.search) {
                try {
                    var searchRE = new RegExp(args.search || '', 'gmi');
                } catch (e) {
                    return callback(new Error('Error in search regExp /' + args.search + '/gmi: ' + e.message));
                }
            } else searchRE = null;
            async.whilst(function() {
                return continueSearching;
            }, function(callback) {
                fs.read(fd, buffer, 0, loadSize, filePos, function(err, bytesRead , buffer) {
                    if(err) return callback(new Error('Can\'t read from file' + args.fileName + ': ' + err.message));

                    var text = args.codePage ? recode.decode(buffer, args.codePage) : buffer.toString();
                    var searchRes = searchRE ? searchRE.test(text) : true;
                    prevFilePos = filePos;
                    filePos = direction >= 0 ? filePos + loadSize : filePos - loadSize;
                    if(filePos < 0) {
                        filePos = 0;
                        loadSize = filePos;
                    }
                    if(searchRes || bytesRead !== initLoadSize) {
                        continueSearching = false;
                        fs.close(fd, function(err) {
                            if(err) return callback(new Error('Can\'t close file' + args.fileName + ': ' + err.message));

                            return callback(null, String(prevFilePos) + '\n' + String(prevFilePos + bytesRead) + '\n' + text);
                            /*
                            return callback(null, {
                                begin: prevFilePos,
                                end: prevFilePos + bytesRead,
                                text: text,
                                searchRes: searchRes,
                                fileSize: fileSize
                            });

                             */
                        });
                    } else callback();
                });
            }, callback); // callback(err, text)
        });
    });
}