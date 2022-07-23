/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.02.2017.
 */
var fs = require('fs');
var path = require('path');

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

    this.file = file;
    this.save = save;
    this.reload = reload;
    this.get = get;

    file(initFileName, initReloadTimeInterval);

    /** Change init file name or reload time interval. return false on error. Not an async function
     * @param {string} initFileName - path to JSON configuration file
     * @param {int} [initReloadTimeInterval=60000] - time interval for reread configuration file
     * @returns {boolean} - true on success or false on fail. if error occurred while read configuration file,
     * @memberOf Conf
     */
    function file(initFileName, initReloadTimeInterval) {

        if(!initFileName) {
            console.log('[get configuration] Configuration file not specified');
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
            console.log('[get configuration] Can\'t read configuration file ', initFileName, ': ', err.stack);
            return false;
        }

        try {
            configuration = new Map(Object.entries(JSON.parse(fileBody)));
        } catch (err) {
            console.log('[get configuration] Can\t parse configuration file ', initFileName, ': ', err.stack);
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
    function save (newConfiguration) {

        //console.log('!!!Save to ', fileName);
        try {
            fs.writeFileSync(fileName, JSON.stringify(newConfiguration, null, 4),'utf8');
        } catch (e) {
            console.log('Can\'t save ' + fileName + ': ' + e.message)
            return 'Can\'t save ' + fileName + ': ' + e.message;
        }

        configuration = Object.entries(newConfiguration);
    }


    /** Reload configuration from file. Not an async function
     * @returns {boolean} - true on success or false on fail. if error occurred while read configuration file,
     * using previous configuration
     * @memberOf Conf
     */

    function reload () {
        var savedConfiguration = configuration;
        var result = file(fileName, reloadTimeInterval);
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
        if(reloadTimeInterval && Date.now() - lastReloadTime > reloadTimeInterval) reload();

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