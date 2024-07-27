/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const express = require('express');
const fs = require('fs');
const usersDB = require('../models_db/usersDB');
const prepareUser = require('../lib/utils/prepareUser');
const toHuman = require('../lib/utils/toHuman');
const fromHuman = require('../lib/utils/fromHuman');
const onFinished = require('./onFinished');
const Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');

toHuman.getUnits();

var router = express.Router();
module.exports = router;

/**
 * Used for download files.
 * Set restrictions for download in the webServer.json downloadFileRestrictions
 */
router.get('/downloadFile/', function (req, res, next) {
    var fileName = req.query.filename;
    var username = prepareUser(req.session.username);
    var startTime = Date.now();

    checkRestrictions(fileName, username, function (err, downloadFileName, fileSize) {
        if(err) {
            log.error(err.message);
            return next(err);
        }

        try {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': 'attachment; filename=' + downloadFileName,
            });
            var fReadStream = fs.createReadStream(fileName);
            fReadStream.pipe(res);

            fReadStream.on('close', () => {
                log.info('User ', username, ' finished downloading file ', fileName, ' (', downloadFileName, '), size: ',
                    toHuman(fileSize, 'Bytes'), ' time: ',
                    toHuman(Date.now() - startTime, 'Time'));
            });

            onFinished (res, function () {
                fReadStream.destroy();
            });

        } catch(e) {
            err = new Error('Can\'t send file ' + fileName + ' (' + downloadFileName + '); size: ' + fileSize +
                ': ' + e.message);
            next(err)
        }
    });
});

/**
 * Check restrictions for file for download
 * @param {string} fileName download file name
 * @param {string} username username
 * @param {function(Error)|function(null, string, number)} callback
 *      callback(err, downloadFileName, stat.size)
 */
function checkRestrictions(fileName, username, callback) {
    /**
     * restrictions for download from the webServer.json downloadFileRestrictions
     * @type {Array<{
     *     maxSize: string,
     *     roles: Array<string>,
     *     regExp: string,
     *     fileNameRoles: Array<{
     *         src: string,
     *         dest: string
     *     }>
     * }>}
     */
    var fileRestrictions = confWebServer.get('downloadFileRestrictions');
    var globalMaxSize = confWebServer.get('downloadWebServerMaxSize');

    if(!Array.isArray(fileRestrictions) || !fileRestrictions.length) {
        return callback(new Error('Restriction for download file is not set in the webServer.json ' +
            'downloadFileRestrictions'));
    }

    // get file size
    fs.stat(fileName, function (err, stat) {
        if (err) {
            return callback(new Error('Can\'t stat file ' + fileName + ' for download: ' + err.message));
        }

        usersDB.getUsersInformation(username, function (err, userInfo) {
            if (err) {
                return callback(new Error('Can\'t get information for user ' + username + ': ' + err.message));
            }
            if (!Array.isArray(userInfo) || !userInfo.length) {
                return callback(new Error('User ' + username + ' not found in the database'));
            }

            var downloadFileName = fileName;
            var error = new Error('User ' + username + ' is not allowed to download ' + fileName +
                ' according webServer.json downloadFileRestrictions: unknown error: ' +
                JSON.stringify(fileRestrictions, null, 4));

            if (!fileRestrictions.some(restriction => {
                // check user roles
                var userRole;
                if (Array.isArray(restriction.roles) && restriction.roles.length && !userInfo.some(row => {
                    return restriction.roles.some(restrictRoleName => {
                        if(restrictRoleName.toLowerCase() === row.roleName.toLowerCase()) {
                            userRole = row.roleName;
                            return true;
                        }
                    });
                })) {
                    error = new Error('User ' + username + ' is not allowed to download ' + fileName +
                        ' according webServer.json downloadFileRestrictions:roles ' + restriction.roles.join(', '));
                    return;
                }

                log.debug('User ', username, ' is allowed to download ', fileName, ' according user role: ',
                    restriction.roles.join(', '), '; user role: ', userRole);

                // check fileName
                try {
                    var re = new RegExp(restriction.regExp, 'gi');
                } catch (e) {
                    error = new Error('User ' + username + ': can\'t compile regExp ' +
                        restriction.regExp + ' for process file ' + fileName + ' restrictions: ' + e.message);
                    return;
                }

                if (re.test(fileName)) {
                    log.debug('User ', username, ' is allowed to download ', fileName,
                        ' according filename restriction: ', re);

                    if (Array.isArray(restriction.fileNameRoles)) {
                        restriction.fileNameRoles.forEach(filenameRole => {
                            try {
                                var re = new RegExp(filenameRole.src, 'gi');
                                downloadFileName = downloadFileName.replace(re, filenameRole.dest);
                            } catch (e) {
                                log.error('User ' + username + ', download filename: ' + fileName +
                                    ': can\'t compile regExp ', filenameRole,
                                    ' for process role for create file name for download file: ', e.message);
                            }
                        });
                    }

                    // check file size
                    var maxSize = restriction.maxSize || globalMaxSize || '1Gb';

                    if (fromHuman(maxSize) < stat.size) {
                        error = new Error('User ' + username + ': size of the file ' + fileName + ' (' +
                            toHuman(stat.size, 'Bytes') + ') is greater than maxSize or ' +
                            'global downloadWebServerMaxSize setting (' +
                            maxSize + ') in the webServer.json downloadFileRestrictions');
                        return;
                    }

                    log.debug('User ', username, ' is allowed to download ', fileName,
                        ' according maxSize: (', maxSize, ') settings. File size: ',
                        toHuman(stat.size, 'Bytes'));

                    return true;
                } else {
                    error = new Error('User ' + username + ' is not allowed to download ' + fileName +
                        ' according filename restriction: ' + re);
                }
            })) {
                return callback(error);
            }

            log.debug('Send the file ', downloadFileName, '; size: ', stat.size);
            callback(null, downloadFileName, stat.size);
        });
    });
}