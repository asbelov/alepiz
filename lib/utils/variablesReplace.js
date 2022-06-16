/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

module.exports = variablesReplace;

/** Simple replacement of variables like %:var:% in a string with their values
 *
 * @param {string} str - string with a variables
 * @param {object} variables - object with variables and their values, like {'varName1': 'varVal1', 'varName2': 'varVal2',... }
 * @returns {undefined|object} - return undefined if type of the first parameter is not a "string" or first parameter is empty string.
 * Otherwise, return object like
 * {newStr, unresolvedVariables, allUnresolvedVariables}, where newStr is a new string where variables are replaced with their values,
 * unresolvedVariables is an array with unresolved variable names without variables like %:?<VARIABLE>:%, like
 * ['unresolvedVar1', 'unresolvedVar2', ...] or an empty array if all variables are resolved
 * allUnresolvedVariables is an array with all unresolved variable names, like
 * ['unresolvedVar1', 'unresolvedVar2', ...] or an empty array if all variables are resolved
 */
function variablesReplace(str, variables) {
    // it's mean that nothing to replace. don't change this to return {value: str, unresolvedVariables..: []}
    if(!str || typeof(str) !== 'string') return;

    var re = new RegExp('%:(.+?):%', 'gm'), newStr = str;
    for(var result = re.exec(str), firstAttempt = true, unresolvedVariables = [], allUnresolvedVariables = []; result !== null; result = re.exec(str)) {
        /*
        str = 'qqq %:varName1:% zzz %:varName2:% ttt'
        result[0] = '%:varName1:%'
        result[1] = 'varName1'
        */

        var name = result[1].toUpperCase();
        if(name.charAt(0) === '?') {
            name = name.substring(1);
            var addUnresolved = true;
        } else addUnresolved = false;

        if(variables[name] !== undefined && variables[name] !== null) {
            // return value of single variable and save type of variable value
            if(firstAttempt && str.trim() === result[0]) {
                return {
                    value: variables[name],
                    unresolvedVariables: [],
                    allUnresolvedVariables: [],
                }
            }
            newStr = newStr.replace(result[0], String(variables[name]));
        } else {
            if(!addUnresolved) unresolvedVariables.push(name);
            allUnresolvedVariables.push(name);
        }

        firstAttempt = false;
    }

    return {
        value: newStr,
        unresolvedVariables: unresolvedVariables,
        allUnresolvedVariables: allUnresolvedVariables,
    };
}