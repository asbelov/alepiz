/*
 * Copyright Р’В© 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const _log = require('../../lib/log');
const path = require('path');
const cp = require('child_process');
const iconv = require('iconv-lite');

/**
 *
 * @param {Object} param launcher parameters from config.json launcherParam
 * @param {number} param.sessionID sessionID for log to audit
 * @param {string} [param.host='127.0.0.1'] the host on which to run the program
 * @param {string} param.executable path to executable
 * @param {string|Array} [param.programArgs] array or stringified array or string with the program arguments
 * @param {number} param.timeout=0 timeout for waiting for end of execution
 * @param {string} [param.cwd=''] - working directory. if not an absolute path, it is calculated depending on the
 *  root directory of ALEPIZ
 * @param {string} [param.stdinData] if set, then write stdinData to the stdin of the executable
 * @param {Boolean} [param.dontLogStdout] if set, then did not log stdout
 * @param {Boolean} [param.dontLogStderr] if set then did not log stderr
 * @param {Boolean} [param.returnStdout] if set, then return stdout in callback
 * @param {Boolean} [param.returnStderr] if set, then return stdout in callback
 * @param {Boolean} [param.returnCode] if set, then return exit code in callback
 * @param {Object} [param.env]: <object> Environment key-value pairs. Default process.env
 * @param {string} [param.encodingFrom='cp866'] source command line code page
 * @param {string} [param.encodingTo='utf8'] destination ALEPIZ code page
 * @param {Boolean} [param.dontSplitOutput] Do not split the output into lines
 * @param {Boolean} [param.windowsVerbatimArguments] No quoting or escaping of arguments is done on Windows.
 *  Ignored on Unix. Default true
 * @param {Object} args launcher arguments from HTML page
 * @param {string|Array} args.programArgs array or stringified array or string with the program arguments
 * @param {string} [args.cwd=''] - working directory. if not an absolute path, it is calculated depending on the
 *  root directory of ALEPIZ
 * @param {string|Array} [args.stdinData] if set, then write stdinData to the stdin of the executable
 * @param {function(Error)|function(null, {stdout: string, stderr:string, exitCode:number})} callback
 */
module.exports = function(param, args, callback) {

    // trying to find the sessionID when the launcher was running not from runAction
    if (!param.sessionID) {
        for (var mod = module; mod; mod = mod.parent) {
            if (mod.sessionID) {
                param.sessionID = Number(mod.sessionID);
                break;
            }
        }
    }

    var logParam = {
        sessionID: param.sessionID,
        filename: __filename,
    }

    const log = _log(logParam);

    var executable = param.executable;
    var workingDir = param.cwd || args.cwd || '';
    var timeout = param.timeout || 0;
    var encodingFrom = param.encodingFrom || 'cp866';
    var encodingTo = param.encodingTo || 'utf8';
    var stdinData = param.stdinData || args.stdinData;
    var windowsVerbatimArguments = param.windowsVerbatimArguments !== false; // if not false then true
    var callbackAlreadyRunning = false,
        startTime = Date.now(),
        exitTimer;
    var initProgramArgs = param.programArgs || args.programArgs || [];
    var host = param.host ? param.host : "127.0.0.1";

    if (!path.isAbsolute(workingDir)) {
        try {
            workingDir = path.join(__dirname, '..', '..', workingDir);
        } catch (err) {
            return callback(new Error('[exec]: set unexpected workingDir : ' + workingDir));
        }
    }

    if (Number(timeout) !== parseInt(String(timeout), 10) || Number(timeout) < 0) {
        return callback(new Error('[exec]: set unexpected timeout : ' + timeout));
    } else timeout = Number(timeout);

    if (initProgramArgs) {
        if (typeof initProgramArgs === 'string') {
            try {
                var programArgs = JSON.parse(initProgramArgs);
            } catch (e) {
                // initProgramArgs is a string with command line arguments. Try to make an array
                var splitQuotes = initProgramArgs.split('"');
                programArgs = [];
                splitQuotes.forEach((strPart, idx) => {
                    if (!strPart.length) return;
                    // string in quotes
                    if (idx && idx % 2 !== 0) programArgs.push(strPart);
                    else Array.prototype.push.apply(programArgs, strPart.trim().split(' '))
                });
            }
        } else programArgs = initProgramArgs;

        if (!Array.isArray(programArgs)) {
            return callback(new Error('[exec]: Arguments ' + initProgramArgs +
                ' is not an array or stringified JSON array'))
        }
    } else programArgs = [];

    log.debug('[exec]: starting on ', host, ': ', executable, ' ', programArgs.join(' '));

    if (host !== '127.0.0.1') {
        programArgs = [`Invoke-Command -ComputerName ${host} {${executable} ${programArgs.join(' ')}}`];
        executable = "powershell.exe";
    }

    // one time I got exception when call cp.spawn()
    var proc;
    try {
        proc = cp.spawn(executable, programArgs, {
            cwd: workingDir || path.join(__dirname, '..', '..'),
            windowsVerbatimArguments: windowsVerbatimArguments,
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

    if (stdinData) {
        if (Array.isArray(stdinData) && stdinData.length) {
            stdinData.forEach(element => {
                proc.stdin.write(element);
            });
        } else if (typeof(stdinData) === 'string') {
            proc.stdin.write(stdinData);
        }
    }

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
        data = iconv.encode(iconv.decode(data, encodingFrom), encodingTo);

        var str = data.toString();

        fullStdout += str;
        //log.warn('!!', str.replace(/\n/gm, '\\n'));
        if (param.dontLogStdout) return;
        if(param.dontSplitOutput) {
            if(str.trim()) log.info('[exec] ', executable, ': ', str);
        } else {
            if (str.indexOf('\n') !== -1) {
                var arr = str.split('\n');
                arr[0] = lastPartOfStdout + arr[0];
                lastPartOfStdout = arr.pop();
                setTimeout(printLog, 1, log.info, arr);
            } else lastPartOfStdout += str;
        }
    });

    proc.stderr.on('data', function(data) {
        data = iconv.encode(iconv.decode(data, encodingFrom), encodingTo);

        var str = data.toString();
        fullStderr += str;
        //log.warn('!!!', str.replace(/\n/gm, '\\n'));
        if (param.dontLogStderr) return;
        if(param.dontSplitOutput) {
            if(str.trim()) log.error('[exec] ', executable, ': ', str);
        } else {
            if (str.indexOf('\n') !== -1) {
                var arr = str.split('\n');
                arr[0] = lastPartOfStderr + arr[0];
                lastPartOfStderr = arr.pop();
                setTimeout(printLog, 1, log.info, arr);
            } else lastPartOfStderr += str;
        }
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
        // add pause before printing last log message for separate log messages
        setTimeout(function () {
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

                log.debug('[exec] ', executable, ': exit with code: ', code, '; execution time: ',
                    Date.now() - startTime, 'ms; dir: ', workingDir, '; args: ', args);
                callback(null, result);
            }
        }, 1);
    }

    // print data to log with delay in 1ms for separate log line when sorting
    function printLog(logFunc, arr) {
        var str = arr.shift();
        if(str === undefined) return;
        if (str.trim()) logFunc('[exec] ', executable, ': ', str);
        setTimeout(printLog, 1, logFunc, arr);
    }
};