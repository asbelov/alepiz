/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const path = require('path');

const topDirName = path.join(__dirname, '..');

/**
 * Create log label
 * @param {{filename: string, sessionID: number}|NodeModule} parentModule parent node module
 * @returns {string} log label
 */
module.exports = function (parentModule) {
    return ( typeof parentModule.filename === 'string' ?
        parentModule.filename
            .substring((topDirName + path.sep).length, parentModule.filename.lastIndexOf('.')) // remove topDir and extension
            .split(path.sep).join(':') : // replace all '\' or '/' to ':'
        (parentModule || '') );
}