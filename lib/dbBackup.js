/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../lib/log')(module);
var async = require('async');
var threads = require('../lib/threads');
var Conf = require('../lib/conf');
const confDBBackup = new Conf('config/dbBackup.json');

var cfg = confDBBackup.get();

var errorMessagesForSkip = [
    'Error: object name reserved for internal use: sqlite_',
    'SQL: [CREATE TABLE sqlite_',
    'Error 1: no such table: sqlite_',
];

if(threads.isMainThread) initServer();
else runServerProcess(); //standalone process

//if(module.parent) initServer();
//else runServerProcess(); //standalone process

function initServer() {
    var dbBackup = {};
    module.exports = dbBackup;

    dbBackup.stop = function(callback) {callback()};
    dbBackup.start = function (callback) {
        if(!cfg || cfg.disable) {
            log.warn('Backup not configured or disabled. Don\'t starting backup server');
            return callback();
        }

        new threads.parent({
            childrenNumber: 1,
            childProcessExecutable: __filename,
            restartAfterErrorTimeout: 0, // was 2000
            killTimeout: 1000,
            module: 'dbBackup',
        }, function (err, backupServerProcess) {
            if (err) return callback(new Error('Can\'t initializing backup server: ' + err.message));

            log.info('Starting DB backup process');

            backupServerProcess.start(function (err) {
                if (err) return callback(new Error('Can\'t run backup server: ' + err.message));

                dbBackup.stop = backupServerProcess.stop;
                callback();
            });
        });
    }
}

function runServerProcess() {
    var cp = require('child_process');
    var path = require('path');
    var fs = require('fs');

    var backupInProgress = 0;

    if(!cfg || cfg.disable) {
        log.warn('Backup not configured or disabled. Try again after 3min');
        var t = setTimeout(runServerProcess, 180000);
        t.unref();
        initBackupThread();
    } else {
        async.eachOfSeries(cfg, function (backupCfg, backupID, callback) {
            if (typeof backupCfg !== 'object') return callback();

            if (!backupCfg || backupCfg.disable) {
                log.warn('[', backupID, ']: backup for ', backupID, ' not configured or disabled');
                return;
            }

            log.info('[', backupID, ']: initializing backup system');
            runBackupEveryHour(backupID);

            doBackup(backupID, function (err) {
                if(err) log.error(err.message);
                log.info('The scheduled database backup process has been started');
                callback();
            });
        }, function () {
            initBackupThread();
        });
    }

    function initBackupThread() {
        new threads.child({
            module: 'dbBackup',
            onDisconnect: destroy,
            onDestroy: destroy,
            onStop: destroy,
        });
    }

    function destroy() {
        log.exit('Backup server was stopped or destroyed or client was disconnected. Closing DB and exiting');
        log.disconnect(function () { /* process.exit(2) */ });
    }

    function runBackupEveryHour(id) {
        // Calculate amount of time until the next hour
        var nextTime = 3610000 - Date.now() % 3600000;
        log.debug('[', id, ']: milliseconds left to run backup: ', nextTime);
        var t = setTimeout(function () {
            doBackup(id);
            runBackupEveryHour(id);
        }, nextTime);
        t.unref();
    }

    function doBackup(id, callback) {

        if(backupInProgress) {
            return log.error('[' + id + ']: backup already running at ' +
                (new Date(backupInProgress)).toLocaleString());
        }
        backupInProgress = Date.now();

        var myCallback = function(err) {
            backupInProgress = 0;

            if(typeof callback === 'function') {
                callback(err);
                callback = null;
            } else if(err) log.error(err.message);
        };

        confDBBackup.reload();
        var cfg = confDBBackup.get();

        if(!cfg || !cfg[id] || cfg.disable || cfg[id].disable) {
            return myCallback(new Error('[' + id + ']: backup for not configured or disabled'));
        }

        var date = new Date(Date.now() + 900000);
        var prefix = String(date.getHours());
        if(prefix === '0') {
            prefix = 'dw' + String(date.getDay());
        } else {
            if (prefix.length === 1) prefix = 'h0' + prefix;
            else prefix = 'h' + prefix;
        }

        var sqlitePath = path.join(__dirname, '..', cfg.sqlite);
        var dbPathSrc = path.join(__dirname, '..', cfg[id].dbPath, cfg[id].dbFile);
        var backupPath = path.isAbsolute(cfg[id].backupPath) ? cfg[id].backupPath : path.join(__dirname, '..', cfg[id].backupPath);
        var dbPathDst = path.join(backupPath, prefix + '_' + cfg[id].dbFile);
        var timeout = cfg[id].timeout || 0;

        if(!fs.existsSync(sqlitePath)) {
            return myCallback(new Error('[' + id + ']: can\'t find sqlite executable: ' + sqlitePath));
        }

        if(Number(timeout) !== parseInt(String(timeout), 10)) {
            return myCallback(new Error('[' + id + ']: set unexpected timeout : ' + timeout));
        } else timeout = Number(timeout);

        if(!fs.existsSync(dbPathSrc) || !fs.existsSync(backupPath)) {
            return myCallback(new Error('[' + id + ']: database (' + dbPathSrc + ') or backup path (' + backupPath + ') is not found'));
        }

        log.info('[', id, ']: starting backup for: ', dbPathSrc, ' to ', dbPathDst);

        // one time I got exception when call cp.spawn()
        try {
            var sqlite = cp.spawn(sqlitePath, [dbPathSrc], {
                windowsHide: true,
                timeout: timeout
            });
        } catch (e) {
            return myCallback(new Error('[' + id + '] internal error while running ' + sqlitePath + ' ' + dbPathSrc + ': ' + e.message));
        }

        if(!sqlite || typeof sqlite.on !== 'function') {
            return myCallback(new Error('[' + id + '] unexpected error occurred while running ' + sqlitePath + ' ' + dbPathSrc));
        }

        sqlite.on('error', (err) => {
            return myCallback(new Error('[' + id + '] error while running ' + sqlitePath + ' ' + dbPathSrc + ': ' + err.message));
        });

        var stderrStr = '', stdoutStr = '';
        sqlite.stdout.on('data', (data) => {
            var str = data.toString();
            //log.debug('!!', str.replace(/\n/gm, '\\n'));
            if(str.indexOf('\n') === -1) stdoutStr += str;
            else {
                while(true) {
                    var arr = str.split('\n');
                    stdoutStr += arr[0];
                    log.info('[', id, '] sqlite: ', stdoutStr);
                    stdoutStr = '';
                    arr.shift();
                    str = arr.join('\n');
                    if(str.indexOf('\n') === -1) break;
                }
                stdoutStr = str;
            }
        });

        sqlite.stderr.on('data', (data) => {
            var str = data.toString();
            //log.debug('!!!', str.replace(/\n/gm, '\\n'));
            if(str.indexOf('\n') === -1) stderrStr += str;
            else {
                while(true) {
                    var arr = str.split('\n');
                    stderrStr += arr[0];
                    for(var i = 0, skipThisErr = false; i < errorMessagesForSkip.length; i++) {
                        if(stderrStr.indexOf(errorMessagesForSkip[i]) !== -1) {
                            skipThisErr = true;
                            break;
                        }
                    }
                    if(!skipThisErr) log.error('[', id, '] sqlite: ', stderrStr);
                    stderrStr = '';
                    arr.shift();
                    str = arr.join('\n');
                    if(str.indexOf('\n') === -1) break;
                }
                stderrStr = str;
            }
        });

        sqlite.on('exit', (code) => {
            log.info('[', id, ']: ', sqlitePath, ' exit with code: ', code);
            myCallback();
        });

        if(fs.existsSync(dbPathDst)) {
            try{
                fs.unlinkSync(dbPathDst);
            } catch (e) {
                log.error('Can\'t delete previous backup file ', dbPathDst, ': ', e.message);
            }
        }

        sqlite.stdin.write('PRAGMA temp_store_directory = "' + backupPath + '";\n');
        sqlite.stdin.write('.clone "' + dbPathDst.replace(/\\/g, '/') + '"\n');
        sqlite.stdin.write('.quit\n');
    }
}