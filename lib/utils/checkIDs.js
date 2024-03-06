/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var log = require('../../lib/log')(module);

module.exports = checkIDs

/** Check array or comma separated string of IDs for duplicates, integer, not 0 or undefined.
 * Remove duplicates and incorrect items. Return new array and error, if array is not equal to IDs from initIDs
 *
 * @param {Array|string|number} initIDs single ID, array of IDs, string with comma separated IDs
 * @param {function(Error)|function(null, Array)} [callback]: callback(err, IDs) return error or array of IDs or
 *  empty array. Also return error if new array of IDs not equal to initIDs
 * @returns {void|Array|number}: if callback is not defined then return IDs f.e. newIDs = checkIDs(initIDs);
 * and print warning, if some error occurred
 */
function checkIDs(initIDs, callback) {

    if(typeof callback !== 'function') {
        callback = function (err, IDs) {
            if(err) log.warn(err.message);
            return IDs;
        }
    }

    if(typeof(initIDs) === 'string') {
        initIDs = initIDs.trim().split(/ *[,;] */);
        if(!initIDs) return callback(new Error('Incorrect string with IDs: "' + initIDs + '"'), []);
    } else if(typeof(initIDs) === 'number') initIDs = [initIDs];

    if(!Array.isArray(initIDs) || !initIDs.length) {
        return callback(new Error('IDs are not defined or incorrect: "' + JSON.stringify(initIDs) + '"'), []);
    }

    // remove duplicates and not integer values from array
    // Basically, we iterate over the array and, for each element, check if the first position of this element
    // in the array is equal to the current position. Obviously, these two positions are different for duplicate elements.
    // Using the 3rd ("this array") parameter of the filter callback we can avoid a closure of the array variable
    var IDs = initIDs.filter(function(item, pos, self) {
        return Number(item) && self.indexOf(item) === pos && Number(item) === parseInt(item, 10);
    }).map(function(item) {
        return Number(item);
    });

    if(initIDs.length !== IDs.length) {
        return callback(new Error('found duplicate or incorrect IDs in "' +
            JSON.stringify(initIDs) + '"' +
            (IDs.length ? '. Correct IDs: "' + (JSON.stringify(IDs) + '"') : '')), IDs);
    }

    return callback(null, IDs);
}