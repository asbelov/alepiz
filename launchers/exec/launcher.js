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
        startTime = Date.now(),
        exitTimer;
    var initProgramArgs = param.programArgs || args.programArgs || [];
    var host = param.host ? param.host : "127.0.0.1";

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

    log.info('[exec]: starting on ', host, ': ', executable, ' ', programArgs.join(' '));
    if (host !== '127.0.0.1') {
        programArgs = [`Invoke-Command -ComputerName ${host} {${executable} ${programArgs.join(' ')}}`];
        executable = "powershell.exe";
    }

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

    var lastPartOfStderr = '',
        lastPartOfStdout = '',
        fullStdout = '',
        fullStderr = '';
    proc.stdout.on('data', function(data) {
        var str = data.toString();
        fullStdout += str;
        //log.warn('!!', str.replace(/\n/gm, '\\n'));
        if (param.dontLogStdout) return;
        if (str.indexOf('\n') !== -1) {
            var arr = str.split('\n');
            arr[0] = lastPartOfStdout + arr[0];
            lastPartOfStdout = arr.pop();
            arr.forEach(str => {
                if (str.trim()) log.info('[exec] ', executable, ': ', str);
            });
        } else lastPartOfStdout += str;
    });

    proc.stderr.on('data', function(data) {
        var str = data.toString();
        fullStderr += str;
        //log.warn('!!!', str.replace(/\n/gm, '\\n'));
        if (param.dontLogStderr) return;
        if (str.indexOf('\n') !== -1) {
            var arr = str.split('\n');
            arr[0] = lastPartOfStderr + arr[0];
            lastPartOfStderr = arr.pop();
            arr.forEach(str => {
                if (str.trim()) log.error('[exec] ', executable, ': ', str);
            });
        } else lastPartOfStderr += str;
    });

    /*
     The 'close' event is emitted after a process has ended and the stdio streams of a child process have been closed.
     This is distinct from the 'exit' event, since multiple processes might share the same stdio streams.
     The 'close' event will always emit after 'exit' was already emitted, or 'error' if the child failed to spawn.
     */
    proc.on('close', function(code) {
        clearTimeout(exitTimer);
        finishing(code);
    });

    // when stdout was not closed but process was exiting
    proc.on('exit', function(code) {
        var timeLeft = timeout - (Date.now() - startTime);
        exitTimer = setTimeout(function() {
            log.warn('[exec] ', executable, ': stdout was not closet. exiting by timeout');
            finishing(code);
        }, timeLeft < 0 ? 0 : timeLeft);
        exitTimer.unref();
    });

    function finishing(code) {
        // print the last part of stdout and stderr, which does not contain '\n'
        // and therefore was not printed before
        if (!param.dontLogStdout && lastPartOfStdout.trim()) {
            log.info('[exec] ', executable, ': ', lastPartOfStdout);
            lastPartOfStdout = '';
        }
        if (!param.dontLogStderr && lastPartOfStderr.trim()) {
            log.error('[exec] ', executable, ': ', lastPartOfStderr);
            lastPartOfStderr = '';
        }

        if (!callbackAlreadyRunning) {
            callbackAlreadyRunning = true;
            var result = {};
            if (param.returnStdout) result.stdout = fullStdout;
            if (param.returnCode) result.exitCode = code;
            if (param.returnStderr) result.stderr = fullStderr;

            log.info('[exec] ', executable, ': exit with code: ', code, '; execution time: ',
                Date.now() - startTime, 'ms; dir: ', workingDir, '; args: ', args);
            callback(null, result);
        }
    }
};