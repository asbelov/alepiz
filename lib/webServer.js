/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var cluster = require('cluster');
var os = require('os');
var async = require('async');
var log = require('./log')(module);
var exitHandler = require('../lib/exitHandler');
var conf = require('./conf');
conf.file('config/conf.json');

exitHandler.init(); // for parent and child

// webServer server standalone process
if(!module.parent) return initWebServer();


module.exports = {
    start: serverRun,
    kill: workersKill,
    stop: workersKill,
};

var killingInProgress = false;
var restartInProgress = {};

function serverRun(callback) {

    if(typeof cluster.workers === 'object' && Object.keys(cluster.workers).length) {
        log.error('Try to start web server, but web server already started. ', new Error('for stack').stack);
        return;
    }

    cluster.setupMaster({
        windowsHide: true,
        exec: __filename
    });
    var workersNum = Number(conf.get('webServersNumber')) || os.cpus().length;

    // Fork workers.
    killingInProgress = false;
    log.info('HTTP Master ', process.pid, ' is running. Forking ', workersNum,
        ' web server cluster nodes. CPU cores: ', os.cpus().length);

    for (var i = 0; i < workersNum; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker/*, code, signal*/) => {
        if(killingInProgress) log.warn(`HTTP worker ${worker.process.pid} died`);
        else {
            if(restartInProgress[worker.process.pid]) {
                log.warn(`Prevent to restarting worker ${worker.process.pid} again`);
            } else {
                restartInProgress[worker.process.pid] = true;
                log.info(`Restarting worker ${worker.process.pid}...`);

                setTimeout(function (pid) {
                    delete restartInProgress[pid];
                    if(Object.keys(cluster.workers).length < workersNum) cluster.fork();
                    else {
                        var allWorkersAreRunning = true;
                        for(var id in cluster.workers) {
                            if(cluster.workers[id].isDead()) {
                                delete cluster.workers[id];
                                allWorkersAreRunning = false;
                            }
                        }
                        if(allWorkersAreRunning) {
                            log.error(`The required number of workers (${workersNum}) has already been launched. Will not start a new worker for ${pid}`);
                        } else cluster.fork();
                    }

                } , 5000, worker.process.pid);
            }
        }
    });

    setTimeout(restartWorkers, 60000);

    if(typeof callback === 'function') callback();
}

function restartWorkers() {
    var restartInterval = Number(conf.get('webServersRestartIntervalSec'));

    // don't restart webserver workers if restartInterval < 0
    if(restartInterval < 0) return setTimeout(restartWorkers, 60000);

    var workersNum = Object.keys(cluster.workers).length;
    if(!restartInterval ||
        restartInterval !== parseInt(String(restartInterval), 10) ||
        restartInterval < 10000 * workersNum
    ) restartInterval = 60000 * workersNum;
    else restartInterval *= 1000;

    async.eachOfSeries(cluster.workers, function (worker, id, callback) {

        // don't restart worker when problems occurred
        var timeFromLastRecordInExitLog = Date.now() - log.lastExitRecord();
        if(timeFromLastRecordInExitLog < 300000) {
            log.warn('Prevent to restart web worker: detected some changes in exit.log. Waiting ',
                Math.round((300000 - timeFromLastRecordInExitLog) / 1000), ' sec');
            return setTimeout(callback, 300000 - timeFromLastRecordInExitLog);
        }

        try {
            worker.send('exit');
        } catch (e) {
            log.warn('Can\'t send message "exit" to worker with PID: ', worker ? worker.pid : 'undefined', ': ', e.message);

            try {
                worker.kill(1);
            } catch (e) {
                log.error('Can\'t kill worker with PID: ', worker ? worker.pid : 'undefined', ': ', e.message);
            }
        }

        setTimeout(callback, Math.ceil(restartInterval / workersNum));
    }, function () {
        log.info('All web workers are restarted, starting from first worker...')
        restartWorkers();
    });
}

function workersKill(callback) {
    if(killingInProgress) return callback();
    killingInProgress = true;
    for (const id in cluster.workers) {
        log.exit('Stopping worker ' + cluster.workers[id].process.pid);
        try {
            cluster.workers[id].kill();
        } catch (e) {
            log.exit('Can\'t stop webServer worker: ' + e.message);
        }
    }

    log.exit('Web server cluster was stopped');
    if(typeof callback === 'function') callback();
}

function initWebServer() {

    var express = require('express');
    var path = require('path');
    var favicon = require('serve-favicon');
    var logger = require('morgan');
    var cookieParser = require('cookie-parser');
    var bodyParser = require('body-parser');
    var session = require('express-session');
    var compression = require('compression');
    var SQLiteStoreSession = require('../models_db/connect-sqlite3')(session);

    var homePage = require('../routes');
    var mainMenu = require('../routes/mainMenu');
    var actions = require('../routes/actions');
    var actionsHelp = require('../routes/help');
    var browserLog = require('../routes/browserLog');

    var app = express();

// gzip/deflate outgoing responses
    app.use(compression());

// view engine setup
    app.set('views', [path.join(__dirname, '../views'), path.join(__dirname, '..', conf.get('actions:dir'))]);
    app.set('view engine', 'pug');

// uncomment after placing your favicon in /public
    app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));
    app.use(logger('short', {stream: {write: function(msg){log.info(msg);}}}));
    app.use(bodyParser.json({limit: conf.get('downloadWebServerMaxSize')}));
    app.use(bodyParser.urlencoded({ extended: false, limit: conf.get('downloadWebServerMaxSize'), parameterLimit: conf.get('parameterLimit'), }));

// secret for sign cookies
    app.use(cookieParser('qYUuiPOk^78(*98%434fgUhnBHIJoj(&87hJHJHjhkjh^&*YkjhIJH98y(*^LJlhjlNHLH(*&***&^^%7$%tyfdHJG*7g*'));

    var sessionDBPath = path.dirname(path.join(__dirname, '..', conf.get('sqlite:sessionDB')));
    var sessionDBFile = path.basename(path.join(__dirname, '..', conf.get('sqlite:sessionDB')), '.db');
    var sessionTableName = conf.get('sqlite:sessionTableName');
    var sessionMaxAgeInDays = conf.get('sessionMaxAgeInDays') || 7;

    app.use(session({
        store: new SQLiteStoreSession({table: sessionTableName, db: sessionDBFile, dir: sessionDBPath}),
        secret: 'asbel0711',
        cookie: { maxAge: sessionMaxAgeInDays * 24 * 60 * 60 * 1000 }, // in ms
        resave: true,
        saveUninitialized: true
    }));

    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use('/material-design-icons', express.static(path.join(__dirname, '..', 'node_modules', 'material-design-icons', 'iconfont')));
    app.use('/materialize-css', express.static(path.join(__dirname, '..', 'node_modules', 'materialize-css')));
    app.use('/jquery', express.static(path.join(__dirname, '..', 'node_modules', 'jquery', 'dist')));
    app.use('/jquery-ui', express.static(path.join(__dirname, '..', 'node_modules', 'jquery-ui-dist')));
    app.use('/codemirror', express.static(path.join(__dirname, '..', 'node_modules', 'codemirror')));
    app.use('/jshint', express.static(path.join(__dirname, '..', 'node_modules', 'jshint')));
    app.use('/quill', express.static(path.join(__dirname, '..', 'node_modules', 'quill', 'dist')));


    app.use(homePage);
    app.use(mainMenu);
    app.use(actions);
    app.use(actionsHelp);
    app.use(browserLog);

// catch 404 and forward to error handler
    app.use(function(req, res, next) {
        var err = new Error('Not Found');
        err.status = 404;
        next(err);
    });

// error handlers

// production error handler
// no stacktraces leaked to user

    app.use(function(err, req, res/*, next*/) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: {err}
        });
    });

    var port = conf.get('port') || 3000;
    var server = app.listen(port, function() {
        log.info('HTTP worker ', process.pid,' started and listening on ', port);
    })

    process.on('message', function (message) {
        if(message === 'exit') {
            server.close(function () {
                log.disconnect(function () {
                    exitHandler.exit(0);
                });
            });

            setTimeout(function () {
                log.error('Could not close connections in time, forcefully shutting down');
                exitHandler.exit(5);
            });
        }
    });
}
