/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const fs = require('fs');
const favicon = require('serve-favicon');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const session = require('express-session');
const compression = require('compression');
const SQLiteStoreSession = require('../models_db/connect-sqlite3')(session);

const routerIndex = require('./routerIndex');
const routerMainMenu = require('./routerMainMenu');
const routerActions = require('./routerActions');
const routerHelp = require('./routerHelp');
const routerBrowserLog = require('./routerBrowserLog');
const routerFileDownload = require('./routerFileDownload');

const webSecrets = require("./webSecrets");
const thread = require("../lib/threads");
const exitHandler = require('../lib/exitHandler');

const Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');
const confActions = new Conf('config/actions.json');


new thread.child({
    module: 'webServer',
});

var app = express();

// gzip/deflate outgoing responses
app.use(compression());

// view engine setup
app.set('views', [path.join(__dirname, '../views'), path.join(__dirname, '..', confActions.get('dir'))]);
app.set('view engine', 'pug');

// uncomment after placing your favicon in /public
app.use(favicon(path.join(__dirname, '..', 'public', 'favicon.ico')));
app.use(bodyParser.json({limit: confWebServer.get('downloadWebServerMaxSize') || '100Gb'}));
app.use(bodyParser.urlencoded({ extended: false, limit: confWebServer.get('downloadWebServerMaxSize') || '100Gb',
    parameterLimit: confWebServer.get('parameterLimit') || 10000, }));
app.use(express.json({ limit: confWebServer.get('downloadWebServerMaxSize') || '100Gb' }));

logger.token('alepiz-user', req => req.session.username);
app.use(logger(':remote-addr :alepiz-user :method :url :status :res[content-length] Bytes :response-time ms',
    {stream: {write: function(msg){log.info(msg);}}}));

webSecrets.get(function (err, web) {
    if(err) {
        log.error(err.message);
        log.disconnect(function () { process.exit(12) });
        return;
    }

    routerMainMenu(function (err, mainMenuRouter) {
        if(err) {
            log.error(err.message);
            log.disconnect(function () { process.exit(12) });
            return;
        }

// secret for sign cookies
        app.use(cookieParser(web.cookieSecret));

        var sessionDBPath = path.dirname(path.join(__dirname, '..', confWebServer.get('sessionDB') || 'db/session.db'));
        var sessionDBFile = path.basename(path.join(__dirname, '..', confWebServer.get('sessionDB') || 'db/session.db'), '.db');
        var sessionTableName = confWebServer.get('sessionTableName') || 'session';
        var sessionMaxAgeInDays = confWebServer.get('sessionMaxAgeInDays') || 7;

        app.use(session({
            store: new SQLiteStoreSession({table: sessionTableName, db: sessionDBFile, dir: sessionDBPath}),
            secret: web.sessionSecret,
            cookie: { maxAge: sessionMaxAgeInDays * 24 * 60 * 60 * 1000 }, // in ms
            resave: true,
            saveUninitialized: true
        }));

        app.use(express.static(path.join(__dirname, '..', 'public')));
        app.use('/material-design-icons', express.static(path.join(__dirname, '..', 'node_modules', 'material-icons', 'iconfont')));
        app.use('/materialize-css', express.static(path.join(__dirname, '..', 'node_modules', 'materialize-css')));
        app.use('/jquery', express.static(path.join(__dirname, '..', 'node_modules', 'jquery', 'dist')));
        app.use('/jquery-ui', express.static(path.join(__dirname, '..', 'node_modules', 'jquery-ui-dist')));
        app.use('/codemirror', express.static(path.join(__dirname, '..', 'node_modules', 'codemirror')));
        app.use('/jshint', express.static(path.join(__dirname, '..', 'node_modules', 'jshint')));
        app.use('/quill', express.static(path.join(__dirname, '..', 'node_modules', 'quill', 'dist')));


        app.use(routerFileDownload);
        app.use(routerIndex);
        app.use(mainMenuRouter);
        app.use(routerActions);
        app.use(routerHelp);
        app.use(routerBrowserLog);

// catch 404 and forward to error handler
        app.use(function(req, res, next) {
            var str = req.protocol + '://' + req.hostname + req.originalUrl + ', IP: ' + req.ip + ', method: ' +
                req.method + ', param: ' + JSON.stringify(req.body)

            var err = new Error('Not Found: ' + req.protocol + '://' + req.hostname + req.originalUrl);
            log.error('Not found: ', str);
            err.status = 404;
            next(err);
        });

        // error handler catch all errors
        app.use(errorHandler);

        function errorHandler (err, req, res) {
            log.error(err.stack);
            if (req.xhr) {
                res.status(500).send({ error: err });
            } else {
                res.status(500);
                res.render('error', { error: err });
            }
        }

        /*
        var port = conf.get('port') || 3000;
        var server = app.listen(port, function() {
            log.info('HTTP worker ', process.pid,' started and listening on ', port);
        })
         */

        var port = Number(process.env["app_port"] || process.env.PORT || confWebServer.get('httpsPort'));
        try {
            var sslOptions = {
                // private key
                key:  fs.readFileSync(path.join(__dirname, '..', confWebServer.get('privatePath') ||
                    'private', confWebServer.get('httpsKeyFile') || 'key.pem')),
                // certificate, root certificate, intermediate certificate
                cert: fs.readFileSync(path.join(__dirname, '..', confWebServer.get('privatePath') ||
                    'private', confWebServer.get('httpsCertFile') || 'cert.pem')),
            }

            log.info('Starting HTTPS ', process.pid, ' on port ', port || 443);
            https.createServer(sslOptions, app).listen(port || 443);
        } catch (e) {
            port = Number(confWebServer.get('httpPort') || confWebServer.get('port'));
            log.warn('Can\'t init https: ', e.message);
            log.info('Starting HTTP ', process.pid, ' on port ', port || 80);
            http.createServer(app).listen(port || 80);
        }

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
    });
});