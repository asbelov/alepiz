/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


module.exports = setShift;

/** set shift(): remove first element from a set and return it (like array shift() function)
 *
 * @param {Set<any>} set - javascript new Set()
 * @return removed first element
 */
function setShift(set) {
    if(!set.size) return;

    //get iterator
    var iterator = set.values();
    //get first entry
    var firstEntry = iterator.next();
    //get value out of the iterator entry
    var firstValue = firstEntry.value;
    //delete first value
    set.delete(firstValue);

    return firstValue;
}