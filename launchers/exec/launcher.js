/*
 * Copyright (C) 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var fs = require('fs');
var cp = require('child_process');


module.exports = function(prms, args, callback){
    var executable = prms.executable;
    var timeout = prms.timeout || 0;
    var callbackAlreadyRunning = false, startTime = Date.now();

    if(!executable || !fs.existsSync(executable)) {
        return callback(new Error('[exec]: can\'t find executable: ' + executable));
    }

    if(Number(timeout) !== parseInt(String(timeout), 10)) {
        return callback(new Error('[exec]: set unexpected timeout : ' + timeout));
    } else timeout = Number(timeout);

    log.debug('[exec]: starting ', executable);

    // one time I got exception when call cp.spawn()
    var proc;
    try {
        proc = cp.spawn(executable, prms.args, {
            windowsHide: true,
            timeout: timeout
        });
    } catch (e) {
        callbackAlreadyRunning = true;
        return callback(new Error('[exec] internal error while running ' + executable + ': ' + e.message));
    }

    if(!proc || typeof proc.on !== 'function') {
        callbackAlreadyRunning = true;
        return callback(new Error('[exec] unexpected error occurred while running ' + executable));
    }

    proc.on('error', function(err) {
        var errMsg = '[exec] error while running ' + executable + ': ' + err.message;
        if(callbackAlreadyRunning) return log.error(errMsg);
        callbackAlreadyRunning = true;
        return callback(new Error(errMsg));
    });

    var stderrStr = '', stdoutStr = '';
    proc.stdout.on('data', function(data) {
        var str = data.toString();
        //log.debug('!!', str.replace(/\n/gm, '\\n'));
        if(str.indexOf('\n') === -1) stdoutStr += str;
        else {
            while(true) {
                var arr = str.split('\n');
                stdoutStr += arr[0];
                log.info('[exec] ', executable, ': ', stdoutStr);
                stdoutStr = '';
                arr.shift();
                str = arr.join('\n');
                if(str.indexOf('\n') === -1) break;
            }
            stdoutStr = str;
        }
    });

    proc.stderr.on('data', function(data) {
        var str = data.toString();
        //log.debug('!!!', str.replace(/\n/gm, '\\n'));
        if(str.indexOf('\n') === -1) stderrStr += str;
        else {
            while(true) {
                var arr = str.split('\n');
                stderrStr += arr[0];
                log.error('[exec] ', executable, ': ', stderrStr);
                stderrStr = '';
                arr.shift();
                str = arr.join('\n');
                if(str.indexOf('\n') === -1) break;
            }
            stderrStr = str;
        }
    });

    proc.on('exit', function(code) {
        log.info('[exec] ', executable, ' exit with code: ', code, '; execution time: ', Date.now() - startTime, 'ms');
        if(!callbackAlreadyRunning) callback();
    });
};
