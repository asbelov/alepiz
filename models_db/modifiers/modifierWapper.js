/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../../lib/log')(module);
const fs = require('fs');
const path = require('path');

module.exports = getDBModifiers();

function getDBModifiers() {
    try {
        var fileNames = fs.readdirSync(__dirname);
    } catch (e) {
        throw new Error('Can\'t read DB modifier dir ' + __dirname + ': ' + e.message);
    }

    var dbModifiers = {};
    fileNames.forEach(fileName => {
        if(!/\.js$/i.test(fileName)) return;
        try {
            var dbModifier = require(path.join(__dirname, fileName));
        } catch (e) {
            return log.warn('Can\'t attach DB modifier file ', fileName, ': ', e.message);
        }

        var modifierName = path.basename(fileName, '.js');
        dbModifiers[modifierName] = dbModifier;
    });

    return dbModifiers;
}