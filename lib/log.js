/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var async = require('async');
var util = require('util');
var IPC = require('../lib/IPC');
var proc = require('../lib/proc');
var auditDB = require('../lib/auditDB');
var conf = require('../lib/conf');
conf.file('config/conf.json');

//var maxLength = 1024;

var logFD = {};
var isLogRotateProcessing = false;
var cfg = conf.get('log'); // configuration for each module
var configurations = {};
var messagesCache = []; // used separately in client for sending message one time per minute and in server for waiting log rotate
var dateSuffix = setDateSuffix();
var cfgInit = {
    localAddress: '127.0.0.1',
    serverAddress: '127.0.0.1',
    serverPort: 10161,
    maxSocketErrorsCnt: 500, // for IPC system
    id: 'log', // for IPC log
    path: 'logs',
    file: 'log.log',
    topDirName: path.basename(path.join(__dirname, '..')),
    logLevel: 'D',
    printObjectWithDepth: 10,
    daysToKeepLogs: 2,
    logToConsole: true,
    logToDatabase: false,
    databaseLogLevel: 'I',
    maxMessageLengthForDebug: 4096,
    alwaysLogToConsoleIfLogLevelMoreThen: "D",
    exitLogFileName: 'exit.log'
};

// open stream for exit.log for write to log in any case on crashing
var logExitFilePath = path.join(String(cfg.path), cfg.exitLogFileName ? cfg.exitLogFileName : cfgInit.exitLogFileName);
logFD[logExitFilePath] = fs.createWriteStream(logExitFilePath, {flags: 'a'});

var levelOrder = {S:0, D:1, I:2, W:3, E:4, EXIT:5};

// http://wiki.bash-hackers.org/scripting/terminalcodes
//    \0x1b = 27 = ←: Esc character
var consoleColors = {
    // foreground colors
    fgBlack:        '\u001b[30m',
    fgRed:          '\u001b[31m',
    fgGreen:        '\u001b[32m',
    fgYellow:       '\u001b[33m',
    fgBlue:         '\u001b[34m',
    fgMagenta:      '\u001b[35m',
    fgCyan:         '\u001b[36m',
    fgWhite:        '\u001b[37m',
    fgDefault:      '\u001b[39m',

    // background colors
    bgBlack:        '\u001b[40m',
    bgRed:          '\u001b[41m',
    bgGreen:        '\u001b[42m',
    bgYellow:       '\u001b[43m',
    bgBlue:         '\u001b[44m',
    bgMagenta:      '\u001b[45m',
    bgCyan:         '\u001b[46m',
    bgWhite:        '\u001b[47m',
    bgDefault:      '\u001b[49m',

    // attributes
    attrReset:      '\u001b[0m',
    attrBright:     '\u001b[1m',
    attrDim:        '\u001b[2m',
    attrUnderlined: '\u001b[4m', //set smul unset rmul :?:	Set "underscore" (underlined text) attribute
    attrBlink:      '\u001b[5m',
    attrReverse:    '\u001b[7m',
    attrHidden:     '\u001b[8m'
};

var levelsColors = {
    S:          ['fgGrey','fgDefault'],
    D:          ['fgGreen','fgDefault'],
    I:          ['fgDefault','fgDefault'],
    W:          ['fgBlue','fgDefault'],
    E:          ['fgRed','fgDefault'],
    EXIT:       ['fgMagenta','fgDefault'],
    timestamp:  ['fgDefault','fgDefault'],
    number:     ['attrUnderlined','attrReset']
};


// log server standalone process, running by forkLogServer()
if(!module.parent) {

    // merge configuration from conf.json with cfgInit variable
    for(var key in cfgInit) {
        if(cfg[key] === undefined) cfg[key] = cfgInit[key];
    }

    new IPC.server(cfg, function(err, message, socket) {
        if(err) return writeLog(err.message);

        if(message) return writeLog(message);
        if(socket === -1) {
            new proc.child({
                module: 'log',
                IPCLog: true,
                onStop: function(callback) {
                    if(log) log.exit('Log server stopped');
                    setTimeout(callback, 50);
                },
                onDisconnect: function() {  // exit on disconnect from parent
                    if(log) log.exit('Log server was disconnected from parent unexpectedly. Exiting');
                    process.exit(2);
                },
            });
        }
    });

    logRotate();
    return;
}

// client code

// for compare log levels
var cfgMain = conf.get('log');
var isServerInit = 0;
var serverPID;
var clientIPC;
var logServerProcessStop = function(callback) {callback()};

function setColor(str, level) {
    if(level in levelsColors) return consoleColors[levelsColors[level][0]] + str + consoleColors[levelsColors[level][1]];
    else return str;
}

function setDateSuffix() {
    var now = new Date();
    var month = now.getMonth()+1;
    var date = now.getDate();
    dateSuffix = '.' + String((now.getYear()-100)) + String(month<10 ? '0' + month : month) + String(date<10 ? '0' + date: date);
    return dateSuffix;
}

module.exports = function(module) {
    if(!module) module = {};
    if(!module.filename) module.filename = 'log.js';

    if(!isServerInit) {
        isServerInit = 1; // don't initialize server, while it initialized, but also don't connect to server
        clientIPC = new IPC.client(cfg, function(err, message, isConnected) {
            if(err) writeLog(err.message);
            if(isConnected) isServerInit = 2; // server fully initialized
        })
    }

    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    setTimeout(setDateSuffix, d - (new Date()));

    // sending messages cache to log server each 1 seconds
    var sendMessageInProgress = false;
    setInterval(function() {
        if(sendMessageInProgress || !messagesCache.length) return;
        sendMessageInProgress = true;

        var myMessagesCache = messagesCache.slice();
        messagesCache = [];
        if(process.pid === serverPID) { // we are a log server
            writeLog(myMessagesCache, true);
            sendMessageInProgress = false;
        } else if(isServerInit === 2 && clientIPC) { // send log to server only if it fully initialized
            clientIPC.send(myMessagesCache, function(err) {
                if(err) {
                    myMessagesCache.error = err.stack;
                    writeLog(myMessagesCache);
                }
                sendMessageInProgress = false;
            })
        } else {
            myMessagesCache.error = 'Log server not initialized';
            writeLog(myMessagesCache, true);
            sendMessageInProgress = false;
        }
    }, 1000);

    return log(module);
};

function forkLogServer(callback) {
    new proc.parent({
        IPCLog: true,
        childrenNumber: 1,
        childProcessExecutable: __filename,
        restartAfterErrorTimeout: 500,
        killTimeout: 300,
        module: 'log',
    }, function (err, logServerProcess) {
        if(err) return callback(new Error('Can\'t initialize log server: ' + err.message));

        logServerProcessStop = logServerProcess.stop;

        logServerProcess.start(function(err) {
            if(err) return callback(new Error('Can\'t initialize log server: ' + err.message));
            callback();
        })
    });
}

var log = function(module) {

    return {
        silly: function () {
            addMessageToCache('S', Array.prototype.slice.call(arguments), module)
        },
        debug: function () {
            addMessageToCache('D', Array.prototype.slice.call(arguments), module)
        },
        info: function () {
            addMessageToCache('I', Array.prototype.slice.call(arguments), module)
        },
        warn: function () {
            addMessageToCache('W', Array.prototype.slice.call(arguments), module)
        },
        error: function () {
            addMessageToCache('E', Array.prototype.slice.call(arguments), module)
        },
        exit: function () {
            addMessageToCache('EXIT', Array.prototype.slice.call(arguments), module)
        },
        raw: addMessageToCache,
        start: forkLogServer,
        stop: logServerProcessStop,
        disconnect: clientIPC.stop,
        lastExitRecord: function () {
            try {
                var stats = fs.statSync(logExitFilePath);
            } catch (e) {
                writeLog('Can\'t stat file ' + logExitFilePath + ': ' + e.message);
                return 0;
            }
            return stats && stats.size ? stats.mtimeMs : 0;
        }
    }
};

/*
Create label from module object
 */
function createLabel(module) {

    if(module) {
        if(module.filename) var label = module.filename;
        else if(typeof(module) === 'string') label = module;
    } else label = '';

    if(label) {
        label = label
            .substring(
                label.toLowerCase().lastIndexOf(cfg.topDirName) + cfg.topDirName.length+1,
                label.lastIndexOf('.')
            ).replace(/[\\/]/g, ':');
    } else label = 'log';

    return label;
}

function createConfiguration(module) {

    if(configurations[module.filename]){
        cfg = configurations[module.filename];
        return;
    }

    cfg = {};

    // copy elements from cfgMain to cfg object
    for(var key in cfgMain) {
        if(!cfgMain.hasOwnProperty(key)) continue;
        if(typeof cfgMain[key] !== 'object') cfg[key] = cfgMain[key];
    }

    // merge configuration from conf.json with cfgInit variable
    for(key in cfgInit) {
        if(cfg[key] === undefined) cfg[key] = cfgInit[key];
    }

    // create array with labels of this module and all parents modules.
    // f.e. if module lib/log.js called from ./apps.js and ./apps.js called from bin/alepiz.js
    // ['lib:audit', 'lib', 'apps', 'bin:alepiz', 'bin']
    var labels = [];
    for(var mod = module; mod; mod = mod.parent) {
        var labelParts = createLabel(mod).split(':');
        for(var j = labelParts.length; j !== 0; j--){
            labels.push(labelParts.slice(0, j).join(':'));
        }
    }

    // reverse scan labels array and create additionalCfg with additional additionalCfg
    for(var i = labels.length-1; i !== -1; i--) {
        var additionalCfg = conf.get('log:' + labels[i]);
        if(additionalCfg) {
            for(key in additionalCfg) {
                if(!additionalCfg.hasOwnProperty(key) || typeof(additionalCfg[key]) === 'object') continue;
                cfg[key] = additionalCfg[key];
                //console.log('AddCfg: ', key.toLowerCase(),'=',additionalCfg[key], ': ', module.filename, ':', labels.join(','));
            }
        }
    }

    // copy cfg to configurations cache
    configurations[module.filename] = {};
    for(key in cfg){
        configurations[module.filename][key] = cfg[key];
    }

    //if(cfg.logToConsole) console.log('!!!!', module.filename, ': ', cfg);
    //console.log(module.filename, ': ', cfg);
}

function addMessageToCache(level, args, module) {
    if(!args.length || levelOrder[level] < levelOrder[cfg.logLevel]) return;

    createConfiguration(module); // initializing cfg variable

    // if Error, add stack to error message
    //if(level === 'E') args.push('; ' + (new Error('occurred')).stack);

    var message = args.map(function(arg) {
        if(typeof(arg) === 'number'/* || !isNaN(arg)*/) return setColor(String(arg), 'number');
        if(typeof(arg) === 'string') return setColor(arg, level);

        try {
            return ('\n'+util.inspect(arg, {
                colors: true,
                showHidden: true,
                depth: cfg.printObjectWithDepth
            }));
        } catch(err){
            return '(ERROR CONVERTING OBJECT TO STRING: '+err.message+')'
        }
    }).join('');

    if(level === 'EXIT') {
        writeLog(createLabel(module) + ': ' + message, 'EXIT');
        messagesCache.forEach(writeLog);
        return;
    }

    for (var mod = module, sessionID = ''; mod; mod = mod.parent) {
        if (mod.sessionID) {
            sessionID = mod.sessionID;
            break;
        }
    }

    // truncate debug data in log for log level < 'I' = 2
    if (levelOrder[level] < 2 && cfg.maxMessageLengthForDebug && message.length > cfg.maxMessageLengthForDebug)
        message = message.substring(0, cfg.maxMessageLengthForDebug - 3) + "...";

    var messageObj = {
        timestamp: Date.now(),
        label: createLabel(module),
        pid: process.pid,
        level: level,
        sessionID: sessionID,
        message: message,
        logFile: cfg.file,
        logToDatabase: cfg.logToDatabase,
        logToConsole: cfg.logToConsole || levelOrder[level] > levelOrder[cfg.alwaysLogToConsoleIfLogLevelMoreThen]
    };

    messagesCache.push(messageObj);
}

function createLogMessage(messageObj) {

    var timestamp = new Date(messageObj.timestamp);
    var dateStr = String((timestamp.getMonth() + 1) + '.0' + timestamp.getDate()).replace(/0(\d\d)/g, '$1');
    var timeStr = String('0' + timestamp.getHours() + ':0' + timestamp.getMinutes() + ':0' + timestamp.getSeconds()).replace(/0(\d\d)/g, '$1') +
        '.' + String('00' + timestamp.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

    var auditLabel = cfg.logToDatabase  ? (levelOrder[messageObj.level] >= levelOrder[cfg.databaseLogLevel] ? ':A' : ':a') : '';
    var sessionID = messageObj.sessionID ? ' [' + messageObj.sessionID + ']' : '';

    return setColor((dateStr + ' ' + timeStr), 'timestamp') + '[' + messageObj.label + ':' + messageObj.pid + '] ' +
        messageObj.level + auditLabel + sessionID + ': ' + messageObj.message;
}

function writeLog(messagesObj, force) {
    var errorLogFilePath = path.join(String(cfg.path), cfg.errorLogFileName || 'error.log' + dateSuffix);
    if(!logFD[errorLogFilePath]) {
        logFD[errorLogFilePath] = fs.createWriteStream(errorLogFilePath, {flags: 'a'});
        writeLog('Open log file: ' + errorLogFilePath, 'I');
    }

    if(typeof messagesObj !== 'object') {
        var message = createLogMessage( {
            message: String(messagesObj),
            timestamp: Date.now(),
            label: 'log',
            pid: process.pid,
            level: force === 'EXIT' ? 'EXIT' : (typeof force === 'string' && force.length === 1 ? force : 'E'),
        });
        var logFilePath = path.join(String(cfg.path), String(force === 'EXIT' ? cfg.exitLogFileName : cfg.file + dateSuffix));

        if(!logFD[logFilePath]) {
            logFD[logFilePath] = fs.createWriteStream(logFilePath, {flags: 'a'});
            writeLog('Open log file: ' + logFilePath, 'I');
        }

        console.log(message);

        message = message.replace(/\x1B\[\d+m/g, '') + '\n';

        // always error level
        if((!force || levelOrder[force] > levelOrder.I) && logFD[errorLogFilePath] &&
            logFD[errorLogFilePath].writable) logFD[errorLogFilePath].write(message);

        if(logFD[logFilePath] && logFD[logFilePath].writable) logFD[logFilePath].write(message);
        else {
            // try another way to write to log, closure
            (function(logFilePath) {
                fs.open(logFilePath, 'a', function (err, fd) {
                    if (err) {
                        if(logFD[logExitFilePath] && logFD[logExitFilePath].writable) logFD[logExitFilePath].write(message);
                        return console.error('Can\'t open log file ' + logFilePath + ' for write log: ' + err.stack);
                    }
                    fs.writeFile(fd, message, function (err) {
                        if (err) {
                            if(logFD[logExitFilePath] && logFD[logExitFilePath].writable) logFD[logExitFilePath].write(message);
                            console.error('Can\'t write to log file ' + logFilePath + ' : ' + err.stack);
                        }
                        fs.close(fd, function (err) {
                            if (err) console.error('Can\'t close log file ' + logFilePath + ': ' + err.stack);
                        });
                    });
                })
            })(logFilePath);
        }
        return;
    }

    if(!messagesObj.length) return;


    // write messages to audit
    // checking for log to database in auditDB.insertRecords function
    auditDB.insertRecords(messagesObj, function(err){
        if(err) return writeLog('Error while add log records to audit: ' + err.stack);
    });

    if(isLogRotateProcessing && !force) {
        Array.prototype.push.apply(messagesCache, messagesObj);
        return;
    }

    // sorting messages by log files
    var sortedMessagesByFiles = {};
    messagesObj.forEach(function(message) {

        var messageText = createLogMessage(message).replace(/[\r\n]/g, '');
        if(message.logToConsole) console.log(messageText);

        var logFilePath = path.join(String(cfg.path), String(message.logFile)) + dateSuffix;

        messageText = messageText.replace(/\x1B\[\d+m/g, '') + '\n';
        if(sortedMessagesByFiles[logFilePath] === undefined) sortedMessagesByFiles[logFilePath] = messageText;
        else sortedMessagesByFiles[logFilePath] += messageText;

        if(levelOrder[message.level] > levelOrder['I'] &&
            logFD[errorLogFilePath] &&
            logFD[errorLogFilePath].writable) logFD[errorLogFilePath].write(messageText);
    });

// write messages to log files
    for(logFilePath in sortedMessagesByFiles) {
        if(!sortedMessagesByFiles.hasOwnProperty(logFilePath)) continue;

        if(!logFD[logFilePath] && !force) {
            logFD[logFilePath] = fs.createWriteStream(logFilePath, {flags: 'a'});
            writeLog('Open log file: ' + logFilePath, 'I');
        }

        if(logFD[logFilePath] && logFD[logFilePath].writable) logFD[logFilePath].write(sortedMessagesByFiles[logFilePath]);
        else {
            // try another way to write to log,  closure
            (function(logFilePath) {
                fs.open(logFilePath, 'a', function (err, fd) {
                    if (err) {
                        if(logFD[logExitFilePath] && logFD[logExitFilePath].writable) logFD[logExitFilePath].write(sortedMessagesByFiles[logFilePath]);
                        console.log(sortedMessagesByFiles[logFilePath]);
                        return console.error('Can\'t open log file ' + logFilePath + ' for write log: ' + err.stack);
                    }
                    fs.writeFile(fd, sortedMessagesByFiles[logFilePath], function (err) {
                        if (err) {
                            if(logFD[logExitFilePath] && logFD[logExitFilePath].writable) logFD[logExitFilePath].write(sortedMessagesByFiles[logFilePath]);
                            console.log(sortedMessagesByFiles[logFilePath]);
                            console.error('Can\'t write to log file ' + logFilePath + ' : ' + err.stack);
                        }
                        fs.close(fd, function (err) {
                            if (err) console.error('Can\'t close log file ' + logFilePath + ': ' + err.stack);
                        });
                    });
                })
            })(logFilePath);
        }
    }
}

function logRotate() {

    if(!Number(cfg.daysToKeepLogs) || !cfg.path) return;

    writeLog('[logRotate] Log rotation started. Removing files older then ' + cfg.daysToKeepLogs + ' days from ' + cfg.path, 'I');

    var now = new Date();
    var lastDayToKeepLogs = new Date(now.setDate(now.getDate() - cfg.daysToKeepLogs));

    var removedLogFiles = [];

    fs.readdir(cfg.path, function(err, logFiles){
        if(err) return writeLog('[logRotate] Can\'t read dir ' + cfg.path + ': ' + err.message);

        isLogRotateProcessing = true;
        async.each(logFiles, function(logFile, callback){

            if(logFile === cfg.exitLogFileName) return callback(); // skip rotate exit.log file

            if(!/\.\d\d\d\d\d\d$/.test(logFile)){
                writeLog('[logRotate] file ' + logFile + ' is not a log file. Skip it', 'W');
                return callback();
            }

            logFile = path.join(cfg.path, logFile);

            //writeLog('[logRotate] processing file ' + logFile, 'D');

            fs.stat(logFile, function(err, stats){

                if(err) {
                    writeLog('[logRotate] Can\'t stat log file ' + logFile + ': ' + err.message);
                    return callback();
                }

                if(!stats.isFile()) {
                    writeLog('[logRotate] ' + logFile + ' is not a file, skip it', 'W');
                    return callback();
                }

                if (stats.birthtime >= lastDayToKeepLogs) return callback();

                if(logFD[logFile]) {
                    writeLog('[logRotate] file ' + logFile + ' is opened. Try to close it in first.', 'D');

                    logFD[logFile].end('', function() {

                        fs.unlink(logFile, function (err) {
                            if (err) {
                                writeLog('[logRotate] Can\'t remove log file ' + logFile + ': ' + err.message);
                                return callback();
                            }

                            delete logFD[logFile];
                            removedLogFiles.push(logFile.replace(/^.+[\\/]/, ''));
                            return callback();
                        });
                    });
                } else {
                    fs.unlink(logFile, function (err) {
                        if (err) {
                            writeLog('[logRotate] File not opened, but error occurred while removing log file ' + logFile + ': ' + err.message);
                            return callback();
                        }
                        removedLogFiles.push(logFile.replace(/^.+[\\/]/, ''));
                        return callback();
                    });
                }
            })
        }, function() {
            writeLog('[logRotate] Log rotation is finished. Removed: ' + (removedLogFiles.length ? removedLogFiles.join(', ') : 'nothing'), 'I');
            setDateSuffix();

            writeLog(messagesCache, true);

            isLogRotateProcessing = false;

            // running logRotate at next day at 00:00:00.000
            var d = new Date();
            d.setDate(d.getDate() + 1);
            d.setHours(0, 0, 0, 0);
            setTimeout(logRotate, d - (new Date()));
        });
    })
}