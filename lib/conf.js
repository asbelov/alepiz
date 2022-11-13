/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.02.2017.
 */
const fs = require('fs');
const path = require('path');

module.exports = Conf;

/** Initialize a new object to work with a JSON configuration file.
 * @example
 * const Conf = require('../lib/conf);
 * const conf = new Conf(<fileName>, <initReloadTimeInterval>)
 *
 * @name Conf
 * @param {string} initFileName - path to JSON configuration file
 * @param {int} [initReloadTimeInterval=60000] - time interval for reread configuration file
 * @class
 */
function Conf(initFileName, initReloadTimeInterval) {

    var configuration = new Map();
    var fileName;
    var lastReloadTime = Date.now(), reloadTimeInterval = 60000;

    this.file = loadFile;
    this.save = saveFile;
    this.reload = reloadFile;
    this.get = get;

    loadFile(initFileName, initReloadTimeInterval);

    /** Change init file name or reload time interval. return false on error. Not an async function
     * @param {string} initFileName - path to JSON configuration file
     * @param {int} [initReloadTimeInterval=60000] - time interval for reread configuration file
     * @returns {boolean} - true on success or false on fail. if error occurred while read configuration file,
     * @memberOf Conf
     */
    function loadFile(initFileName, initReloadTimeInterval) {

        if(!initFileName) {
            simpleLog('[get configuration] Configuration file not specified');
            return false;
        }

        if(typeof initReloadTimeInterval === 'number' &&
            initReloadTimeInterval === parseInt(String(initReloadTimeInterval), 10) &&
            initReloadTimeInterval > 1000
        ) {
            reloadTimeInterval = initReloadTimeInterval;
        }

        initFileName = path.join.apply(this, initFileName.split(/[/\\]/));

        try {
            var fileBody = fs.readFileSync(initFileName, 'utf8');
        } catch(err) {
            simpleLog('[get configuration] Can\'t read configuration file ', initFileName, ': ', err.stack);
            return false;
        }

        try {
            configuration = new Map(Object.entries(JSON.parse(fileBody)));
        } catch (err) {
            simpleLog('[get configuration] Can\'t parse configuration file ', initFileName, ': ', err.stack);
            return false;
        }
        fileName = initFileName;
        lastReloadTime = Date.now();
        return true;
    }


    /** Save a new object with configuration back to the file.
     * @param {Object} newConfiguration - Object with a new configuration to save
     * @returns {undefined|string} - return undefined in success or error string on error
     * @memberOf Conf
     */
    function saveFile (newConfiguration) {

        //simpleLog('!!!Save to ', fileName);
        try {
            fs.writeFileSync(fileName, JSON.stringify(newConfiguration, null, 4),'utf8');
        } catch (e) {
            simpleLog('Can\'t save ' + fileName + ': ' + e.message)
            return 'Can\'t save ' + fileName + ': ' + e.message;
        }

        configuration = Object.entries(newConfiguration);
    }


    /** Reload configuration from file. Not an async function
     * @returns {boolean} - true on success or false on fail. if error occurred while read configuration file,
     * using previous configuration
     * @memberOf Conf
     */

    function reloadFile () {
        var savedConfiguration = configuration;
        var result = loadFile(fileName, reloadTimeInterval);
        if(!result) {
            configuration = savedConfiguration;
            return false;
        } else {
            lastReloadTime = Date.now();
            return true;
        }
    }

    /** Get configuration or part of configuration from file. If the configuration is not reloaded from the file for
     * more than 1 minute, load the configuration from the file.
     * setInterval() is not used for reload configuration from file
     *
     * @example
     * configuration file: {"key1": { "key2": "value"}}
     * // returns "value"
     * get("key1:key2")
     * @param {string} [pathToParameter] - Path to required parameter.
     * @param {string} [separator=":"] - Path separator
     * @returns {*|undefined} - required parameter or undefined if not found
     * @memberOf Conf
     */
    function get (pathToParameter, separator) {
        if(reloadTimeInterval && Date.now() - lastReloadTime > reloadTimeInterval) reloadFile();

        if(!pathToParameter) return Object.fromEntries(configuration);

        if(typeof separator !== 'string') separator = ':';
        var pathParts = pathToParameter.split(separator);

        for(var cnf = configuration.get(pathParts[0]), i = 1; i < pathParts.length; i++) {
            if (cnf === undefined || cnf[pathParts[i]] === undefined) return;
            cnf = cnf[pathParts[i]];
        }

        return cnf;
    }
}

function simpleLog() {
    var logFileWithoutSuffix = path.join(__dirname, '..', 'logs', 'conf.log');
    var label = 'lib:conf';
    var level = 'E';

    var logStr = Array.prototype.slice.call(arguments).map(function(arg) {
        if( typeof arg === 'string' || typeof arg === 'number') return String(arg);
        return JSON.stringify(arg);
    }).join('').replace(/[\r\n]/g, '');

    var now = new Date();
    var month = now.getMonth()+1;
    var date = now.getDate();
    var dateStr = String(month + '.0' + date).replace(/0(\d\d)/g, '$1') + ' ';
    var timeStamp = String('0'+ now.getHours() + ':0'+ now.getMinutes() + ':0' +
            now.getSeconds()).replace(/0(\d\d)/g, '$1') +
        '.' + String('00'+now.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

    var message = dateStr + timeStamp + '[' + label + ':' + process.pid + '] ' + level + ': ' + logStr;

    console.log(message);

    var dateSuffix = String((now.getYear() - 100)) + String(month < 10 ? '0' + month : month) +
        String(date < 10 ? '0' + date: date);
    var logFile = logFileWithoutSuffix + '.' + dateSuffix;

    try {
        var streamLog = fs.createWriteStream(logFile, {flags: 'a'});
        streamLog.write(message + '\n');
        streamLog.end();
    } catch (e) {
        console.log('Can\'t create new stream from file descriptor first time for ' + logFile + ': ' + e.message);
    }

    streamLog.on('finish', function() {
        process.exit();
    })
}