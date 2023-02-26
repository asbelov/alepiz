/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Log object for debug, info, warn, error, exit or throw log level
 * @param {NodeModule} parentModule
 * @param {function("D"|"I"|"W"|"E"|"EXIT"|"THROW", Array, NodeModule)} writeToLog
 * @returns {{warn: function, exit: function, debug: function, throw: function, error: function, info: function}}
 */
module.exports = function (parentModule, writeToLog) {

    return {
        debug: function () {
            writeToLog('D', Array.prototype.slice.call(arguments), parentModule)
        },

        info: function () {
            writeToLog('I', Array.prototype.slice.call(arguments), parentModule)
        },

        warn: function () {
            writeToLog('W', Array.prototype.slice.call(arguments), parentModule)
        },

        error: function () {
            writeToLog('E', Array.prototype.slice.call(arguments), parentModule)
        },

        exit: function () {
            writeToLog('EXIT', Array.prototype.slice.call(arguments), parentModule)
        },

        throw: function () {
            writeToLog('THROW', Array.prototype.slice.call(arguments), parentModule)
        },
    }
}
