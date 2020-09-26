/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 12.02.2017.
 */
var fs = require('fs');
var path = require('path');

var conf = {};
module.exports = conf;

var configuration = {};
var fileName;
var lastReloadTime = Date.now(), reloadTimeInterval = 60000;


/*
    Initializing - read configuration from file
    it's sync function

    initFileName: <>string JSON file name with configuration
    initReloadTimeInterval: <integer> time interval for reload file initFileName in millisecond 0 - don't reload.

    return false or true
 */
conf.file = function(initFileName, initReloadTimeInterval) {

    if(!initFileName) {
        console.log('[get configuration] Configuration file not specified');
        return false;
    }

    if(typeof initReloadTimeInterval === 'number' &&
        initReloadTimeInterval !== parseInt(String(initReloadTimeInterval), 10)
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
        configuration = JSON.parse(fileBody);
    } catch (err) {
        console.log('[get configuration] Can\t parse configuration file ', initFileName, ': ', err.stack);
        return false;
    }
    fileName = initFileName;
    lastReloadTime = Date.now();
    return true;
};


conf.save = function(newConfiguration) {

    //console.log('!!!Save to ', fileName);
    try {
        fs.writeFileSync(fileName, JSON.stringify(newConfiguration, null, 4),'utf8');
    } catch (e) {
        return 'Can\'t save ' + fileName + ': ' + e.message;
    }

    configuration = newConfiguration;
}


/*
    reload configuration file
    sync function

    if error occurred while read configuration file, using previous configuration

    return true or false
 */
conf.reload = function(){
    var savedConfiguration = configuration;
    var result =  conf.file(fileName, reloadTimeInterval);
    if(!result) {
        configuration = savedConfiguration;
        return false;
    } else {
        lastReloadTime = Date.now();
        return true;
    }
};

/*
    getting one of configuration parameters
    sync function

    pathToParameter - path to parameters with ':' as divider
    f.e. 'path:to:my:parameter' for
    {
    "path":{
        "to": {
            "my": {
                "parameter": "We found it!!!"
            }
        }
    }

    div - divider. default ':'

    return parameter value or undefined if error occurred
 */
conf.get = function(pathToParameter, div) {
    if(reloadTimeInterval && Date.now() - lastReloadTime > reloadTimeInterval) conf.reload();

    if(!pathToParameter) return configuration;

    if(typeof div !== 'string') div = ':';
    var pathParts = pathToParameter.split(div);

    for(var cnf = configuration, i = 0; i < pathParts.length; i++) {
        if (!cnf[pathParts[i]]) return;

        cnf = cnf[pathParts[i]];
    }

    return cnf;
};

