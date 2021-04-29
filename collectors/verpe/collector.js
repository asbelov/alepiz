/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-2-22 0:19:05
*/

var log = require('../../lib/log')(module);
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var collector = {};
module.exports = collector;
/*
 * 
 * C:\Windows>C:\Users\asbel\verPE.exe explorer.exe HelpPane.exe hh.exe IsUninstall.exe notepad.exe keyId.bat regedit.exe
 * 10.0.19041.610 (WinBuild.160101.0800)|explorer.exe
 * 10.0.19041.860 (WinBuild.160101.0800)|HelpPane.exe
 * 10.0.19041.1 (WinBuild.160101.0800)|hh.exe
 * 5.10.130.0|IsUninstall.exe
 * 10.0.19041.860 (WinBuild.160101.0800)|notepad.exe
 * |keyId.bat
 * 10.0.19041.1 (WinBuild.160101.0800)|regedit.exe
 * 
 * C:\Users\asbel\>verPE.exe C:\Windows\regedit.exe
 * 10.0.19041.860 (WinBuild.160101.0800)|C:\Windows\regedit.exe
*/

collector.get = function(param, callback) {

    /* insert collector code here */
    
    var verPE_exe = path.join(__dirname, 'verPE.exe');
    var timeout = param.timeout || 1000;
    var callbackAlreadyRunning = false, startTime = Date.now();

    if(!verPE_exe || !fs.existsSync(verPE_exe)) {
        return callback(new Error('Can\'t find verPE.exe: ' + verPE_exe));
    }
    
    if(!param.files) {
        return callback(new Error('No files listed to get file version'));
    }
    var files = param.files.split(',').map(file => file.trim());

    if(Number(timeout) !== parseInt(String(timeout), 10)) {
        return callback(new Error('Set unexpected timeout : ' + timeout));
    } else timeout = Number(timeout);

    // one time I got exception when call cp.spawn()
    var proc;
    try {
        proc = cp.spawn(verPE_exe, files, {
            windowsHide: true,
            timeout: timeout
        });
    } catch (e) {
        callbackAlreadyRunning = true;
        return callback(new Error('Internal error while running ' + verPE_exe + ' ' + files.join(' ') + ': ' + e.message));
    }

    if(!proc || typeof proc.on !== 'function') {
        callbackAlreadyRunning = true;
        return callback(new Error('Unexpected error occurred while running ' + verPE_exe + ' ' + files.join(' ')));
    }

    proc.on('error', function(err) {
        var errMsg = 'Error while running ' + verPE_exe + ' ' + files.join(' ') + ': ' + err.message;
        if(callbackAlreadyRunning) return log.error(errMsg);
        callbackAlreadyRunning = true;
        return callback(new Error(errMsg));
    });

    var stderrStr = '', stdoutStr = '';
    proc.stdout.on('data', function(data) {
        stdoutStr += data.toString();
    });

    proc.stderr.on('data', function(data) {
        var str = data.toString();
        //log.debug('!!!', str.replace(/\n/gm, '\\n'));
        if(str.indexOf('\n') === -1) stderrStr += str;
        else {
            while(true) {
                var arr = str.split('\n');
                stderrStr += arr[0];
                log.warn('[', verPE_exe, ' ', files.join(' '), ']: ', stderrStr);
                stderrStr = '';
                arr.shift();
                str = arr.join('\n');
                if(str.indexOf('\n') === -1) break;
            }
            stderrStr = str;
        }
    });

    proc.on('exit', function(code) {
        log.debug(verPE_exe, ' exit with code: ', code, '; execution time: ', Date.now() - startTime, 'ms');
        if(!callbackAlreadyRunning) {
            if(typeof stdoutStr !== 'string') return callback();
            
            // .slice(0, -1) used for remove last element "" from array
            var result = stdoutStr.split('\r\n').slice(0, -1);
            
            //return only file version
            if(!param.returnVersionAndFilename) result = result.map(v => v.split('|')[0]);
            
            // return only first result (not an array)
            if(param.returnFirstResult) result = result[0];

            return callback(null, result);
        }
    });
};
