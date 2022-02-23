/*
 * Copyright (C) 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);
var path = require('path');
var cp = require('child_process');

/*
param = {
    executable: path to executable
    timeout: timeout, while waiting for end of execution
    cwd - working dir
    stdinData: if set, then write stdinData to the stdin of the executable
    dontLogStdout: if set, then did not log stdout
    dontLogStderr: if set then did not log stderr
    returnStdout: if set, then return stdout in callback
    returnStderr: if set, then return stdout in callback
    returnCode: if set, then return exit code in callback
    env: <object> Environment key-value pairs. Default process.env

    args:
        programArgs - array or stringified array of command line arguments
        cwd - working dir
        stdinData: if set, then write stdinData to the stdin of the executable
}
 */
module.exports = function(param, args, callback) {
    var executable = param.executable;
    var workingDir = param.cwd || args.cwd || '';
    var timeout = param.timeout || 0;
    var stdinData = param.stdinData || args.stdinData;
    var callbackAlreadyRunning = false,
        startTime = Date.now();
    var initProgramArgs = param.programArgs || args.programArgs || [];

    if (!path.isAbsolute(workingDir)) workingDir = path.join(__dirname, '..', '..', workingDir);

    if (Number(timeout) !== parseInt(String(timeout), 10)) {
        return callback(new Error('[exec]: set unexpected timeout : ' + timeout));
    } else timeout = Number(timeout);

    if (initProgramArgs) {
        if (typeof initProgramArgs === 'string') {
            try {
                var programArgs = JSON.parse(initProgramArgs);
            } catch (e) {
                return callback(new Error('[exec]: can\'t parse arguments ' + initProgramArgs + ' as JSON: ' + e.message))
            }
        } else programArgs = initProgramArgs;

        if (!Array.isArray(programArgs)) {
            return callback(new Error('[exec]: Arguments ' + initProgramArgs + ' is not an array or stringified JSON array'))
        }
    } else programArgs = [];

    log.info('[exec]: starting ', executable, ' ', programArgs.join(' '));

    // one time I got exception when call cp.spawn()
    var proc;
    try {
        proc = cp.spawn(executable, programArgs, {
            cwd: workingDir || path.join(__dirname, '..', '..'),
            windowsHide: true,
            timeout: timeout,
            env: param.env && typeof param.env === 'object' && Object.keys(param.env).length ? param.env : process.env,
        });
    } catch (e) {
        callbackAlreadyRunning = true;
        return callback(new Error('[exec] internal error while running ' + executable + ': ' + e.message));
    }

    if (!proc || typeof proc.on !== 'function' ||
        (stdinData && (!proc.stdin || typeof proc.stdin.write !== 'function'))) {
        callbackAlreadyRunning = true;
        return callback(new Error('[exec] unexpected error occurred while running ' + executable));
    }

    if (stdinData) proc.stdin.write(stdinData);

    proc.on('error', function(err) {
        var errMsg = '[exec] error while running ' + executable + ': ' + err.message;
        if (callbackAlreadyRunning) return log.error(errMsg);
        callbackAlreadyRunning = true;
        return callback(new Error(errMsg));
    });

    var stderrStr = '',
        stdoutStr = '',
        fullStdout = '',
        fullStderr = '';
    proc.stdout.on('data', function(data) {
        var str = data.toString();
        fullStdout += str;
        //log.debug('!!', str.replace(/\n/gm, '\\n'));
        if (str.indexOf('\n') === -1) stdoutStr += str;
        else {
            while (true) {
                var arr = str.split('\n');
                stdoutStr += arr[0];
                if (!param.dontLogStdout && stdoutStr.trim()) log.info('[exec] ', executable, ': ', stdoutStr);
                stdoutStr = '';
                arr.shift();
                str = arr.join('\n');
                if (str.indexOf('\n') === -1) break;
            }
            stdoutStr = str;
        }
    });

    proc.stderr.on('data', function(data) {
        var str = data.toString();
        fullStderr += str;
        //log.debug('!!!', str.replace(/\n/gm, '\\n'));
        if (str.indexOf('\n') === -1) stderrStr += str;
        else {
            while (true) {
                var arr = str.split('\n');
                stderrStr += arr[0];
                if (!param.dontLogStderr && stderrStr.trim()) log.error('[exec] ', executable, ': ', stderrStr);
                stderrStr = '';
                arr.shift();
                str = arr.join('\n');
                if (str.indexOf('\n') === -1) break;
            }
            stderrStr = str;
        }
    });

    proc.on('exit', function(code) {
        log.info('[exec] ', executable, ': exit with code: ', code, '; execution time: ',
            Date.now() - startTime, 'ms; dir: ', workingDir, '; args: ', args);
        var result = {};
        if (!callbackAlreadyRunning) {
            if (param.returnStdout) result.stdout = fullStdout;
            if (param.returnCode) result.exitCode = code;
            if (param.returnStderr) result.stderr = fullStderr;
            callback(null, result);
        }
    });
};