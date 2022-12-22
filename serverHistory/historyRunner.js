/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const proc = require('../lib/proc');
const path = require('path');
const parameters = require('./historyParameters');
const Conf = require("../lib/conf");
const confHistory = new Conf('config/history.json');
parameters.init(confHistory.get());


var historyRunner = {
    start: historyStart,
    // after initialization this functions will be redefined in the historyStart()
    stop: function(callback) { callback(); },
    dump: function(callback) { callback(); }
};
module.exports = historyRunner;


/** Starting history server as separate process
 * @param {function(Error):void} callback - Called when done
 */
function historyStart(callback) {

    var historyProcess = new proc.parent({
        childrenNumber: 1,
        childProcessExecutable: path.join(__dirname, 'historyServer.js'),
        killTimeout: 1900000,
        restartAfterErrorTimeout: 10000,
        onStart: function(err) {
            if(err) return callback(new Error('Can\'t run history server: ' + err.message));
            historyProcess.sendAndReceive({type: 'init'}, function(err) {
                if(typeof callback === 'function') callback(err);
            });
        },
        module: 'history',
    }, function(err, historyProcess) {
        if(err) return callback(new Error('Can\'t initializing history server: ' + err.message));

        historyRunner.stop = historyProcess.stop;

        /** Dumps the cached historical data to a file before exiting.
         * The data from the dump file will be loaded into the cache on next startup
         * @param {function(void): void} callback - Cash was dumped when called
         */
        historyRunner.dump = function (callback) {
            historyProcess.sendAndReceive({type: 'makeDump'}, callback);
        }
        historyProcess.start();
    });
}