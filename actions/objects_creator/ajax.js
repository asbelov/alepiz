/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var rawObjectsDB = require('../../models_db/objectsDB');

module.exports = function(args, callback) {
    if (args.func === 'getAlepizIDs') rawObjectsDB.getAlepizIDs(callback);
    else return callback(new Error('Ajax function is unexpected or is not set'));
};