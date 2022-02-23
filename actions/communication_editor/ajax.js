/**
 * Created by Alexander Belov on 28.04.2020
 */

var fs = require('fs');
var path = require('path');
var log = require('../../lib/log')(module);
var Conf = require('../../lib/conf');
const confCommunicationMedia = new Conf('config/communicationMedia.json');
var help = require('../../lib/help');

var dir = path.join(__dirname, '..', '..', confCommunicationMedia.get('dir'));
var server = confCommunicationMedia.get('server');
var config = confCommunicationMedia.get('configuration');

module.exports = function(args, callback) {
    log.debug('Starting ajax '+__filename+' with parameters', args);

    if(args.func === 'getMedias') return getCommunicationMedias(callback);

    if(!args.name) return callback(new Error('communication media name is not specified for getting required data'));
    if(args.func === 'getMedia') return  getFiles(args.name, callback);

    if(args.func === 'getHelpLanguages') {
        return help.getLanguages(path.join(dir, args.name), null, function(err, languages) {
            callback(null, languages);
        });
    }

    if(args.func === 'getHelpContent') help.getHelpContent(path.join(dir, args.name), null, args.lang, callback);
};

function getCommunicationMedias(callback) {
    fs.readdir(dir, function (err, files) {	
        if(err) return callback(new Error('Can\'t get communication medias list from ' + dir + ': ' + err.message));

        var serverFiles = files.filter(function(fileName) {
            return fs.existsSync(path.join(dir, fileName, server));
        });
        
        callback(null, serverFiles);
    });
}

function getFiles(name, callback) {
    fs.readFile(path.join(dir, name, server), 'utf8', function(err, serverContent) {
        if(err) return callback(err);

        fs.readFile(path.join(dir, name, config), 'utf8', function(err, confContent) {
            callback(err, {
                server: serverContent,
                config: confContent,
            });
        });
    });
}
