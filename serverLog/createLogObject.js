/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Log object for debug, info, warn, error, exit or throw log level
 * @param {{filename: string, sessionID: number}|NodeModule} parentModule
 * @param {number} sessionID sessionID
 * @param {string} label label
 * @param {function("D"|"I"|"W"|"E"|"EXIT"|"THROW", Array, {filename: string, sessionID: number}|NodeModule, number, string)} writeToLog
 * @returns {{warn: function, exit: function, debug: function, throw: function, error: function, info: function}}
 */
module.exports = function (parentModule, sessionID, label, writeToLog) {

    return {
        debug: function () {
            return writeToLog('D', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },

        info: function () {
            return writeToLog('I', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },

        warn: function () {
            return writeToLog('W', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },

        error: function () {
            return writeToLog('E', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },

        exit: function () {
            return writeToLog('EXIT', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },

        throw: function () {
            return writeToLog('THROW', Array.prototype.slice.call(arguments), parentModule, sessionID, label);
        },
    }
}
