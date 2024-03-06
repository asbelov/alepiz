/*
 * Copyright (C) 2017. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.02.2017.
 */

const log = require('../../lib/log')(module);
const fs = require('fs');
const path = require('path');
const async = require('async');
const objectsPropertiesDB = require('../../rightsWrappers/objectsPropertiesDB');
const actionConf = require('../../lib/actionsConf');
const recode = require('../../lib/recode');

module.exports = function(args, callback) {
    var func = args.function;

    if (!func) return callback(new Error('Ajax function is not set'));

    if(func === 'getFilesList') return getFilesList(args, callback);
    if(func === 'getFilePart' || func === 'getFileSize') return getFilePart(args, callback);

    return callback(new Error('Incorrect ajax function "' + args.function + '"'));
};


function getFilesList(args, callback) {
    log.debug('Starting ajax for getting file list: ', args);

    if(!args.IDs) return callback(new Error('Objects IDs are not set'));

    actionConf.getConfiguration(args.actionID, function(err, config) {
        if(err) return callback(err);

        /**
         *
         * @type {{
         *  skipDirs: string,
         *  order: string,
         *  recursion: number,
         *  filePath: string,
         *  filterFiles: string,
         *  }}
         */
        var options = config.options;
        log.debug('Options: ', options);

        var skipDirs = options.skipDirs ? options.skipDirs.toUpperCase() : '';
        var order = options.order ? options.order.toUpperCase().split(/[\s\t]*[,;][\s\t]*/) : null;
        var recursion = options.recursion || 2;

        if(options.filterFiles) {
            try {
                var filterFilesRE = new RegExp(options.filterFiles, 'ig');
            } catch (e) {
                return callback(new Error('Can\'t make regExp from filterFiles option: ' + options.filterFiles +
                    ': ' + e.message));
            }
        } else filterFilesRE = null;

        var filePath = options.filePath || 'FILE_PATH';

        objectsPropertiesDB.getProperties(args.username, args.IDs, function(err, properties) {
            if(err) return callback(err);

            var services = {};
            properties.forEach(function (property) {
                var objectID = property.objectID;
                if(objectID) {
                    if (Number(property.mode) === 0 &&
                        (property.name === 'HOST' || property.name ==='SERVICE_PATH' || property.name === filePath ||
                            property.name ==='RECURSION_FOR_FILES')
                    ) {
                        if(!services[objectID]) services[objectID] = {files: []};
                        services[objectID][property.name] = property.value;
                    }
                }
            });
            async.each(Object.keys(services), function (objectID, callback) {
                /**
                 * @type {{
                 *     SERVICE_PATH: string,
                 *     RECURSION_FOR_FILES: string,
                 *     files: Array<string>,
                 *     UNC: string,
                 *     HOST: string
                 * }}
                 */
                var service = services[objectID];

                if(!service.HOST || (!service.SERVICE_PATH && !service[filePath])) return callback();

                if(service[filePath]) {
                    var dir = getUNC( service[filePath], service.HOST );
                } else {
                    dir = getUNC(getPath( service.SERVICE_PATH ), service.HOST );
                }
                var myRecursion = Number(service.RECURSION_FOR_FILES) || recursion;

                log.debug('Properties for ', objectID, ': ', service);

                getFiles(dir, skipDirs, filterFilesRE, myRecursion, '', function(err, _files) {
                    if(err) return callback(err);

                    log.debug('files in ', dir ,' for ', objectID,': ', _files);
                    service.files = sortFiles(_files, order) || [];
                    service.UNC = dir;
                    callback();
                });
            }, function (err) {
                if(err) return callback(err);

                var result = '';
                for(var objectID in services) {
                    result = services[objectID].files.map(function (file) {
                        return objectID + '\r' + services[objectID].UNC + '\r' + file;
                    }).join('\n');
                }

                callback(null, result);
            });
        });
    });
}

/**
 * Sort files
 * @param {Array<string>} files file list
 * @param {Array<string>} order order for sort files (this file names will be placed at the first position)
 * @return {Array<string>} sorted file list
 */
function sortFiles(files, order) {

    if(!order) return files;

    // searching files with digits in names.
    var numericNames = 0;
    files.forEach(function (file) {
        if(/\d\d$/.test(file)) ++numericNames;
    });

    files = files.sort((a, b) => {
        var path_a = a.split(path.sep);
        var path_b = b.split(path.sep);
        if (path_a.length !== path_b.length) return path_a.length - path_b.length;
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    //if count of files with digits in its names more, then 66%, then sorting descending
    //else sorting files acceding
    //(may be file names contain a date and try to show files with the names with last dates at first)
    if(numericNames * 1.5 > files.length) files = files.reverse();
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

/**
 * Convert WINDOWS local path like DISK:\\DIR1\\DIR2 to the WINDOWS UNC path \\\\SERVER\\$DISK\\DIR1\DIR2
 * @param {string} localPath WINDOWS local path
 * @param {string} server server name
 * @return {string} WINDOWS UNC path
 */
function getUNC(localPath, server) {
    if(/^[a-z]:/i.test(localPath)) {
        localPath = localPath.replace(/^([a-z]):\\(.+)$/i, '\\\\' + server + '\\' + '$1$\\$2');
    }
    return localPath;
}

/**
 * Get path to the file ( ...\\DIR\\file.exe => ...\\DIR or "...\\DIR\\file" => ...\\DIR)
 * @param {string} _path path to the file with file name
 * @return {string} path to the file without file name
 */
function getPath(_path) {
    if(process.platform === 'win32') {
        var quote = _path.charAt(0);
        if (quote === '"' || quote === "'") var re = /^['"]([^'"]+\\)[^\\]+?['"].*?$/;
        else re = /^(.+\\)[^\\]+\.exe.*?$/i;

        return _path.trim().replace(re, '$1');

    } else return path.dirname(_path);
}

/**
 * Get list of the directory
 * @param {string} dir directory name
 * @param {string} skipDirs comma separated dirs which will be skipped
 * @param {RegExp} filterFilesRE return files which match to this RegExp
 * @param {number} recursion find files with specific dir recursion
 * @param {string} subDir subDir used for recursion
 * @param {function(Error)|function(null, Array<string>)} callback callback(err, fileList)
 */
function getFiles(dir, skipDirs, filterFilesRE, recursion, subDir, callback) {
    if(recursion < 0) return callback();

    fs.readdir(path.join(dir, subDir), {withFileTypes: true},
        function (err, filesObjArray) {

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
            if(err) return callback(err);

            callback(null, files);
        });
    });
}

/**
 * Get part of the file
 * @param {Object} args arguments
 * @param {"getFilePart"|"getFileSize"} args.function
 * @param {string} args.fileName sile name
 * @param {"0"|"1"} args.direction read file 0 forward, 1 backward
 * @param {string} args.filePos read file position
 * @param {string} args.loadSize read file load size
 * @param {string} args.search regExp for search data in the file
 * @param {string} args.codePage file code page
 * @param {function(null, string)|function(Error)} callback callback(err, text)
 */
function getFilePart(args, callback) {

    fs.stat(args.fileName, function(err, stats) {
        //if(err) return callback(new Error('Can\'t get file size for file ' + args.fileName + ': ' + err.message));
        if(err) return callback(null, '');

        var fileSize = stats.size;
        if (args.function === 'getFileSize') return callback(null, fileSize);

        var direction = Number(args.direction) || 0;
        var filePos = Number(args.filePos) || 0;
        var loadSize = Number(args.loadSize) || fileSize, initLoadSize = loadSize;
        if(filePos !== parseInt(String(filePos), 10)) {
            return callback(new Error('Incorrect file position ' + args.filePos));
        }
        if(loadSize !== parseInt(String(loadSize), 10) || !loadSize)
            return callback(new Error('Incorrect load size ' + args.loadSize));

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
            fs.open(args.fileName, 'r', function(err, fd) {
                if (err) return callback(new Error('Can\'t open file ' + args.fileName + ': ' + err.message));

                fs.read(fd, buffer, 0, loadSize, filePos, function (err, bytesRead, buffer) {
                    fs.close(fd, function(errClose) {
                        if (err && errClose) {
                            return callback(new Error('Can\'t read file ' + args.fileName + ': ' + err.message +
                                '; args: loadSize: ' + loadSize + '; filePos: ' + filePos +
                                '; Can\'t close file : ' + errClose.message));
                        }
                        if (err) {
                            return callback(new Error('Can\'t read from file' + args.fileName + ': ' + err.message +
                                '; args: loadSize: ' + loadSize + '; filePos: ' + filePos));
                        }
                        if (errClose) {
                            return callback(new Error('Can\'t close file ' + args.fileName + ': ' + errClose.message));
                        }

                        var text = args.codePage ? recode.decode(buffer, args.codePage) : buffer.toString();
                        var searchRes = searchRE ? searchRE.test(text) : true;
                        prevFilePos = filePos;
                        filePos = direction >= 0 ? filePos + loadSize : filePos - loadSize;
                        if (filePos < 0) {
                            filePos = 0;
                            loadSize = filePos;
                        }
                        if (searchRes || bytesRead !== initLoadSize) {
                            continueSearching = false;
                            return callback(null, String(prevFilePos) + '\n' + String(prevFilePos + bytesRead) +
                                '\n' + text);
                        } else callback();
                    });
                });
            });
        }, function (err, text) {

            if(err) {
                return callback(new Error('Error: ' + err.message), text);
            }

            return callback(null, text);
        });
    });
}