/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var path = require('path');
var fs = require('fs');
var service = require('os-service');
var conf = require('../lib/conf');
conf.file('config/conf.json');

var install = {};
module.exports = install;

install.init = init;


function init() {
    /*
      Command line:
      --install, -i - install service
      --remove, -r - remove service
    */
    var serviceName = conf.get('serviceName') || 'ALEPIZ';

    if (process.argv[2] === "--install" || process.argv[2] === "-i") {
        var options = {
            displayName: conf.get('serviceDisplayName') || 'ALEPIZ',
            nodePath: path.isAbsolute(conf.get('nodePath')) ? conf.get('nodePath') : path.join(__dirname, '..', conf.get('nodePath')),
            nodeArgs: [
                '--experimental-worker',
                '--expose-gc',
                '--max-old-space-size=' + String(conf.get('maxMemSize') || 4096),
                // if you want to change this parameter, change also in public/javaScript/init.js: var maxUrlLength=32767
                '--max-http-header-size=' +  + String(conf.get('httpHeaderSize') || 32767)],
            programArgs: ["--runAsService"], // if this argument passed, then program running as service
        };

        try {
            service.remove(serviceName, function (err) {
                if (!err) installLog('Previously installed service ' + serviceName + ' successfully removed');

                service.add(serviceName, options, function (err) {
                    if (err) {
                        installLog('Error while install service ' + serviceName + ': ' + err);
                        process.exit(1);
                    }
                    else {
                        installLog('Service ' + serviceName + ' installed successfully');
                        process.exit(0);
                    }
                });
            });
        } catch (e) {
            installLog('Error installing service: ' + e.message);
            process.exit(2);
        }
        return true;
    } else if (process.argv[2] === "--remove" || process.argv[2] === "-r") {
        try {
            service.remove(serviceName, function (err) {
                if (err) {
                    installLog('Error while remove service ' + serviceName + ': ' + err);
                    process.exit(1);
                }
                else {
                    installLog('Service ' + serviceName + ' removed successfully');
                    process.exit(0);
                }
            });
        } catch (e) {
            installLog('Error removing service: ' + e.message);
            process.exit(2);
        }
        return true;
    } /* else if (process.argv[2] === "--run") {// Run service program code...} else {// Show usage...}*/
}

function installLog(message) {
    var logDir = conf.get('log:path') || 'logs';
    var exitLogFileName = conf.get('log:exitLogFileName') || 'exit.log';
    var installLogFile = path.join(__dirname, '..', logDir, exitLogFileName);

    var timeZoneOffset = (new Date()).getTimezoneOffset() * 60000;
    var dateTime = (new Date(Date.now() - timeZoneOffset)).toISOString().slice(0, -1).replace('T', ' ');
    try {
        var fd = fs.openSync(installLogFile, 'as');
        fs.writeFileSync(fd, dateTime + '[' + process.pid + ']: ' + message + '\n');
        fs.closeSync(fd);
    } catch (e) {
        console.error(message + ': ' + e.message);
        return;
    }
    console.log(message);

    //console.error('\u001b[35m' + dateTime + '[' + pid + ']: ' + message + '\u001b[39m');
}