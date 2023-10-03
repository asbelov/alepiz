/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const Conf = require('../lib/conf');
const confWebServer = new Conf('config/webServer.json');

/**
 * Get web server cache expiration time from webServer configuration file config/webServer.json
 * @return {number} web server cache expiration time in ms
 */
module.exports = function() {
    var cacheExpirationTime = confWebServer.get('cacheExpirationTime');
    if(cacheExpirationTime !== parseInt(String(cacheExpirationTime), 10) || cacheExpirationTime < 1000) {
        cacheExpirationTime = 60000;
    }

    return cacheExpirationTime;
}