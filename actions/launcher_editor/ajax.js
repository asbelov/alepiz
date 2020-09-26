/**
 * Created by asbel on 28.04.2020
 */

var fs = require('fs');
var path = require('path');
var log = require('../../lib/log')(module);
var conf = require('../../lib/conf');
conf.file('config/conf.json');
var help = require('../../lib/help');

var dir = path.join(__dirname, '..', '..', conf.get('launchers:dir'));
var launcherFile = conf.get('launchers:fileName');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getLaunchers') return getLaunchers(callback);

    if(!args.name) return callback(new Error('Launcher name is not specified for getting required data'));
    if(args.func === 'getLauncher') return  fs.readFile(path.join(dir, args.name, launcherFile), 'utf8', callback);

    if(args.func === 'getHelpLanguages') {
        return help.getLanguages(path.join(dir, args.name), null, function(err, languages) {
            callback(null, languages);
        });
    }

    if(args.func === 'getHelpContent') help.getHelpContent(path.join(dir, args.name), null, args.lang, callback);
};

function getLaunchers(callback) {
    fs.readdir(dir, function (err, files) {	
        if(err) return callback(new Error('Can\'t get launchers list from ' + dir + ': ' + err.message));

        var launchers = files.filter(function(launcherName) {
            return fs.existsSync(path.join(dir, launcherName, launcherFile));
        });
        
        callback(null, launchers);
    });
}
