/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


module.exports = processUpdateEventExpressionResult;

/**
 *
 * @param result - result of update event expression calculation
 * @param mode - 0|1|2|3|4 update event mode
 * @param updateEventState - previous update event state
 * @returns {string|null} - string with text description why not need to calculate the counter jr null
 *
 * @example
 * update event mode:
 *      0: Update each time when expression value is true
 *      1: Update once when expression value is changed to true
 *      2: Update once when expression value is changed to true and once when changed to false
 *      3: Update each time when expression value is true and once when changed to false
 *      4: Update once when expression value is changed to false
 */
function processUpdateEventExpressionResult(result, mode, updateEventState) {
    var whyNotNeedToCalculateCounter = null;

    /*
     Below processing update event status when it was changed or not changed
     When result is true the counter will get a value if mode is
     0: Update each time when expression value is true and result is false
    */
    if (mode === 0 && !result) {
        whyNotNeedToCalculateCounter = 'Update event state was changed or not changed, and now it is false';
    }

    /*
     The updateEventState can be undefined if
     the counter does not have an update event expression or
     this is the first calculation of the update event expression or
     the previous value of the update event expression has not been saved (f.e. if process was terminated)

    */

    /*
     Below processing update event status when it changed to true or false or when status is undefined
     When update event status is changed the counter will get a value if mode is
     1: Update once when expression value is changed to true and result is changed to true
     2: Update once when expression value is changed to true and once when changed to false and result is changed to true or false
     3: Update each time when expression value is true and once when changed to false and result is changed to true or false
     4: Update once when expression value is changed to false and result is changed to false

     Boolean(0, -0, null, false, NaN, undefined, "") = false
    */
    if (updateEventState === undefined || Boolean(updateEventState) !== Boolean(result)) {
        /*
         Not need to calculate the counter when mode is
         1: Update once when expression value is changed to true and result is false
        */
        if (mode === 1 && !result) whyNotNeedToCalculateCounter = 'Update event state was changed to false';

        /*
         Not need to calculate the counter when mode is
         4: Update once when expression value is changed to false and result is true
        */
        if (mode === 4 && result) whyNotNeedToCalculateCounter = 'Update event state was changed to true';
    }
    /*
     Below processing update event status when it is not changed
     When update event status is NOT changed the counter will get a value if mode is
     3: Update each time when expression value is true and once when changed to false and result is changed to true
    */
    else {
        /*
         Not need to calculate the counter when result is not changed and mode is
         1: Update once when expression value is changed to true
         2: Update once when expression value is changed to true and once when changed to false
         4: Update once when expression value is changed to false
        */
        if (mode === 1 || mode === 2 || mode === 4) {
            whyNotNeedToCalculateCounter = 'Update event state was not changed';
        }

        /*
         Not need to calculate the counter when result is not changed, and it is a false, and mode is
         3: Update each time when expression value is true and once when changed to false
        */
        if (mode === 3 && !result) {
            whyNotNeedToCalculateCounter = 'Update event state was not changed and result is false';
        }
    }

    return whyNotNeedToCalculateCounter;
}