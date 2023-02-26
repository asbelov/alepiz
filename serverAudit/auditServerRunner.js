/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const thread = require("../lib/threads");
const path = require("path");
const async = require('async');
const auditDB = require('./auditDB')

var auditServerRunner = {
    stop: function(callback) {
        callback()
    },
    insertRecord: function (messageObj) {},
};

module.exports = auditServerRunner;

auditServerRunner.start = function (callback) {

    auditDB.getAuditDbPaths(function (err, dbPaths) {
        if(err) return callback(err);

        var auditServerThreads = [];
        async.each(dbPaths, function (dbPath, callback) {
            new thread.parent({
                childrenNumber: 1,
                childProcessExecutable: path.join(__dirname, 'auditServer.js'),
                args: [dbPath],
                restartAfterErrorTimeout: 0,
                killTimeout: 3000,
                module: 'auditServer',
                simpleLog: true,
            }, function(err, auditServerThread) {
                if(err) return callback(new Error('Can\'t initializing auditServer process: ' + err.message));

                auditServerThread.start(function (err) {
                    if(err) return callback(new Error('Can\'t run auditServer process: ' + err.message));

                    auditServerThreads.push(auditServerThread);
                    callback();
                });
            });

        }, function (err) {
            if(err) return callback(err);

            auditServerRunner.stop = function (callback) {
                async.each(auditServerThreads, function (auditServerThread, callback) {
                    auditServerThread.stop(callback);
                }, callback);
            };

            callback(null, auditServerThreads);
        });
    });
};

