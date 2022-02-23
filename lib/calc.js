/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.11.2016.
 */

var async = require('async');
var log = require('../lib/log')(module);
var calcFunctions = require('../lib/calcFunction');

module.exports = calcExpression;


// operator length must be not more than two symbols
var operators = {
    // 1 is reserved for anything
    '!':  {
        priority: 2,
        unary: true,
        func: function(x){ return !x  }
    },
    '­':  { // This is not ASCII '-' and it will be replaced unary '-' to distinguish between them
        priority: 2,
        unary: true,
        func: function(x){ return -x  }
    },
    '^':  {
        priority: 3,
        unary: false,
        func: function(y, x){ return Math.pow(x,y) }
    },
    '*':  {
        priority: 4,
        unary: false,
        func: function(y, x){ return x * y }
    },
    '/':  {
        priority: 4,
        unary: false,
        func: function(y, x){ return x / y }
    },
    '%':  {
        priority: 4,
        unary: false,
        func: function(y, x){ return x % y }
    },
    '+':  {
        priority: 5,
        unary: false,
        func: function(y, x){ return x + y }
    },
    '-':  {
        priority: 5,
        unary: false,
        func: function(y, x){ return x - y }
    },
    // skip >> and <<
    '>':  {
        priority: 7,
        unary: false,
        func: function(y, x){ return x > y }
    },
    '<':  {
        priority: 7,
        unary: false,
        func: function(y, x){ return x < y }
    },
    '>=': {
        priority: 7,
        unary: false,
        func: function(y, x){ return x >= y }
    },
    '<=': {
        priority: 7,
        unary: false,
        func: function(y, x){ return x <= y }
    },
    '==': {
        priority: 8,
        unary: false,
        func: function(y, x){ return toBaseType(x) === toBaseType(y) }
    },
    '!=': {
        priority: 8,
        unary: false,
        func: function(y, x){ return toBaseType(x) !== toBaseType(y) }
    },
    '&':  {
        priority: 9,
        unary: false,
        func: function(y, x){ return x & y }
    },
    // here skipping bitwise XOR (^). Think, that it's not needed
    '|':  {
        priority: 11,
        unary: false,
        func: function(y, x){ return x | y }
    },
    '&&': {
        priority: 12,
        unary: false,
        func: function(y, x){ return !!(x) && !!(y) }
    },
    '||': {
        priority: 13,
        unary: false,
        func: function(y, x){ return !!(x) || !!(y) }
    },
    '(':  {
        priority: 20,
        unary: true,
        func: function(x){ return x }
    },
    ')': {
        priority: 20,
        unary: false, // it's right!!!
        func: function(x){ return x }
    }
};

/*
Array of operators, sorted by operator length. I.e. array ['&', '*', '&&'] will be a ['&&', '&', '*']
 */
var operatorsArray = Object.keys(operators).sort(function(a,b){ return b.length - a.length; });
var recalculateCalcExprResultTimeInterval = 30000,
    resultsReturnedFromExprCache = 0,
    resultsExprReturned = 0,
    expressionCache = new Map(),
    clearCacheInterval;

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

// if one of arithmetic argument is number, JS tries to make number other arguments
// not need to use this function to arithmetic expression
// function make correct result when compare:
// false === 0; undefined === 0
function toBaseType(n) {
    if(typeof n === 'string' && isNumeric(n)) return Number(n);
    return n;
}

function expressionCacheSet(initExprString, variablesStr, result) {
    expressionCache.set(initExprString + ':' + variablesStr, {
        timestamp: Date.now(),
        result: result,
    });
    if(!clearCacheInterval) clearCacheInterval = setInterval(cacheCleaner, 300000);
}

function expressionCacheGet(initExprString, variablesStr) {
    ++resultsExprReturned;
    var exprResult = expressionCache.get(initExprString + ':' + variablesStr);
    if(!exprResult || Date.now() - exprResult.timestamp > recalculateCalcExprResultTimeInterval) return;
    ++resultsReturnedFromExprCache;
    return exprResult.result;

}

function cacheCleaner() {
    var itemsExpr = 0, clearItemsExpr = 0;

    expressionCache.forEach(function (exprResult, key) {
        if(Date.now() - exprResult.timestamp > recalculateCalcExprResultTimeInterval) {
            expressionCache.delete(key);
            ++clearItemsExpr;
        } else ++itemsExpr;
    });

    /*
    log.info('Clearing: expressions: ', clearItemsExpr, ', now: ', itemsExpr,
        '. Results returned from: expression cache: ', resultsReturnedFromExprCache, '/', resultsExprReturned);
     */

    resultsReturnedFromExprCache = resultsExprReturned = 0;
}

/** Callback parameters description
 *
 * @callback calcExpressionCallback
 * @param {Error|null} Error - if error occurred, return only error
 * @param {string|number|boolean|null} [result] - the result of evaluating initExpression. the type of the result will
 * depend on the value returned after initExpression is evaluated
 * @param {Array} [functionDebug] -an array of objects with debug information for calculating functions in an initExpression.
 * { type: 'func', data: functions[num].str, name: functions[num].name, parameters: functions[num].parameters }
 * @param {Array} [unresolvedVariables] - Array with names of unresolved variables {'%:var1:%', '%:var2:%', ... }
 * @param {Object} [variables] - Object with variables {<variableName1>: <value1>, ....}
 */

/** Calculate expression with variables, functions and operators
 *
 * @param {string} initExprString - string with expression for calculation
 * @param {Object} initVariables - object with variables like {variableName1: <value1>, variableName2: <value2>, ...}
 * @param {number} counterID - counterID, used for make separate log file in logs/counters/<counterID>.log dir
 * @param {calcExpressionCallback} callback - callback(err, result, functionDebug, unresolvedVariables, variables)
 * called when done. Return Error if error occurred. Result has type depended on
 * initExprString calculation. functionDebug - Array of objects with calculation debug information, used for dynamicLog.
 * unresolvedVariables - Array with names of unresolved variables. variables - object with variables and values
 */

function calcExpression(initExprString, initVariables, counterID, callback){

    if(!initExprString) return callback(null, '', []);
    if(typeof initExprString !== 'string') return callback(null, initExprString, [], null, initVariables);
    if(!initVariables || typeof initVariables !== 'object' || !Object.keys(initVariables).length) initVariables = null;

    var variablesStr = '';
    if(initVariables && typeof(initVariables) === 'object') {
        var variables = {};
        variablesStr = Object.keys(initVariables).sort().map(function (name) {
            variables[name] = initVariables[name];
            return name + ':' + variables[name];
        }).join(',');
    }

    log.options('Starting calculate expression: ', initExprString, '; variables: ', initVariables, {
        filenames: ['counters/' + counterID, 'counters.log'],
        emptyLabel: true,
        noPID: true,
        level: 'D'
    });

    var res = expressionCacheGet(initExprString, variablesStr);
    if(res) return callback(null, res, [{
        name: initExprString,
        parameters: [],
        result: 'From expression cache',
    }], null, variables);

    res = simpleCalc(initExprString);
    if(res) {
        expressionCacheSet(initExprString, variablesStr, res);
        return callback(null, res, [], null, variables);
    }

    replaceQuotedStrings(initExprString, counterID, function(err, quotedStrings, exprString) {
        if (err) return callback(err);

        // !!! replaceVariables() must locate after replaceQuotedStrings() because in another case we can't process variable in quotes, f.e.
        // like this: getValueFromJSONStr('%:PARENT_VALUE:%', "hostname" )
        replaceVariables(exprString, initVariables, quotedStrings, counterID, function(err, quotedStrings, exprString, unresolvedVariables) {
            if (err) return callback(err);

            // stop calculation when unresolved variables are detected
            if(unresolvedVariables) {
                for(var i = 0, hasUnresolved = false; i < unresolvedVariables.length; i++) {
                    if(unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                        hasUnresolved = true;
                        break;
                    }
                }
                if(hasUnresolved) return callback(null, initExprString, [], unresolvedVariables, variables);
            }

            replaceFunctions(exprString, counterID, function (err, functions, exprString) {
                if (err) return callback(err, null, null, unresolvedVariables, variables);

                splitExpression(exprString, functions, quotedStrings, counterID, function (err, expr, quotedStrings, functions) {
                    if (err) return callback(err, null, null, unresolvedVariables, variables);

                    calc(initExprString, expr, quotedStrings, functions,counterID, function(err, result, functionDebug) {
                        if(err) return callback(err, null, functionDebug, unresolvedVariables, variables);

                        log.options('Calculation result for expression ', initExprString, ' = ', result,
                            (unresolvedVariables ? (' unresolved vars: ' + unresolvedVariables.join(', ')) : ', all variables are resolved'),
                            ' (', exprString, '; ', expr, '): func: ', functionDebug, {
                                filenames: ['counters/' + counterID, 'counters.log'],
                                emptyLabel: true,
                                noPID: true,
                                level: 'D'
                            });

                        expressionCacheSet(initExprString, variablesStr, result);
                        callback(null, result, functionDebug, unresolvedVariables, variables);
                    });
                });
            });
        });
    });
}

/** Export operators structure
 *
 * @type {{"==": {func: (function(*, *): boolean), unary: boolean, priority: number}, "&&": {func: (function(*, *)), unary: boolean, priority: number}, "||": {func: (function(*, *)), unary: boolean, priority: number}, "!": {func: (function(*): boolean), unary: boolean, priority: number}, "<=": {func: (function(*, *): boolean), unary: boolean, priority: number}, "%": {func: (function(*, *)), unary: boolean, priority: number}, "&": {func: (function(*, *)), unary: boolean, priority: number}, "(": {func: (function(*): *), unary: boolean, priority: number}, ")": {func: (function(*): *), unary: boolean, priority: number}, "*": {func: (function(*, *)), unary: boolean, priority: number}, "+": {func: (function(*, *)), unary: boolean, priority: number}, "­": {func: (function(*): number), unary: boolean, priority: number}, "-": {func: (function(*, *)), unary: boolean, priority: number}, "/": {func: (function(*, *)), unary: boolean, priority: number}, "<": {func: (function(*, *): boolean), unary: boolean, priority: number}, "!=": {func: (function(*, *): boolean), unary: boolean, priority: number}, "|": {func: (function(*, *)), unary: boolean, priority: number}, "^": {func: (function(*, *): number), unary: boolean, priority: number}, ">": {func: (function(*, *): boolean), unary: boolean, priority: number}, ">=": {func: (function(*, *): boolean), unary: boolean, priority: number}}}
 */
calcExpression.operators = operators;

/** Convert numeric (maybe a float) with abbreviation suffixes "Kb", "Mb", "Gb", "Tb" to bytes or
 * "s", "m", "h", "d" (day), "w" (week) to milliseconds. F.e. 2Mb => 2097152; 1.5h => 2400000
 * Abbreviation suffix is case-insensitive. Returns an argument without conversion if it is a number or not a string
 * If conversion failed, return undefined
 *
 * @param {number|string|*} val - value for convert
 * @returns {number|undefined|*} - numeric converted value or unmodified value if value for convert is not a string
 * or undefined when error occurred
 */
calcExpression.convertToNumeric = calcFunctions.fromHuman.convertToNumeric;

/** Convert val to human-readable value with abbreviation suffixes based on specified units of measurement
 *
 * @param {*} val - Convert if val is a number or a string number, or add an abbreviation suffix to val for the specified unit otherwise
 * @param {string} unitName - one of unit from countersUnits table from DB or
 * "TimeInterval" for convert to time interval (f.e 3900000 => 1hour 5min)
 * By default, the countersUnits table contains units of measurement "Byte", "Bits", "Time", "Percentage", "Byte/sec".
 * @returns {string|number} - converted value
 */
calcExpression.convertToHuman = calcFunctions.toHuman.convertToHuman;
calcExpression.variablesReplace = simpleVariablesReplace;
calcExpression.initCache = calcFunctions.__initCache

function simpleCalc(str) {
    // remove spaces around string
    str = str.trim();

    // check for simple number
    if(isNumeric(str)) return Number(str);

    // check for simple quoted string
    var quoteSymbol = str.charAt(0);
    if((quoteSymbol === '"' || quoteSymbol === "'" || quoteSymbol === '`') && // first symbol is one of quote
        str.length > 1 && str.indexOf(quoteSymbol, 1) === str.length - 1
/*      // escape quote character does not work for "\" string
        (str.charAt(str.length-1) === quoteSymbol && // last symbol also quote
            // number of quotes is 2 more (first and last) number of escaped quotes
            str.split(quoteSymbol).length - 2 === str.split('\\' + quoteSymbol).length)
 */
    ) {
        return str.slice(1, -1);
    }
}

function simpleVariablesReplace(str, variables) {
    // it's mean that nothing to replace. don't change this to return {value: str, unresolvedVariables..: []}
    if(!str || typeof(str) !== 'string') return;

    var re = new RegExp('%:(.+?):%', 'gm'), newStr = str;
    for(var result = re.exec(str), firstAttempt = true, unresolvedVariables = [] ; result !== null; result = re.exec(str)) {
        /*
        str = 'qqq %:varName1:% zzz %:varName2:% ttt'
        result[0] = '%:varName1:%'
        result[1] = 'varName1'
        */

        var name = result[1].toUpperCase();
        if(name.charAt(0) === '?') {
            name = name.substr(1);
            var addUnresolved = true;
        } else addUnresolved = false;

        if(variables[name] !== undefined && variables[name] !== null) {
            // return value of single variable and save type of variable value
            if(firstAttempt && str.trim() === result[0]) {
                return {
                    value: variables[name],
                    unresolvedVariables: []
                }
            }
            newStr = newStr.replace(result[0], String(variables[name]));
        } else if(!addUnresolved) unresolvedVariables.push('%:' + name + ':%');

        firstAttempt = false;
    }

    return {
        value: newStr,
        unresolvedVariables: unresolvedVariables
    };
}

function calc(initExprString, expr, quotedStrings, functions, counterID, callback) {
    //log.options('initExprString: ', initExprString, '; expr: ', expr, '; quotedStrings: ', quotedStrings, '; functions: ', functions, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
    var functionDebug = [];
    async.eachOf(expr, function (operation, index, callback) {
        if (operation.type === 'func') {
            executeFunction(operation, quotedStrings, functions, counterID, function (err, result, debug) {
                if (err) return callback(new Error('Expression: ' + initExprString + ': ' + err.message));

                if (isNumeric(result)) expr[index].type = 'digit';
                else expr[index].type = 'other';
                expr[index].data = result;
                delete(expr[index].name);
                delete(expr[index].parameters);
                if(debug) Array.prototype.push.apply(functionDebug, debug);
                return callback();
            });
        } /* else if (operation.type === 'var') {
                            getVariableValue(operation.data, function (err, result) {
                                if (err) return callback(err);

                                if (isNumeric(result)) expr[index].type = 'digit';
                                else expr[index].type = 'other';
                                expr[index].data = result;
                                return callback();
                            })
        } */ else return callback();

    }, function (err) {
        if (err){
            log.options('Error while calculate expression ', initExprString, ': ', err.message, {
                filenames: ['counters/' + counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'D'
            });
            return callback(err);
        }

        for(var i = 0, stack = [], len = expr.length; i < len; i++){
            if(expr[i].type === 'operator') {

                var operation1 = stack.pop();
                if(!operators[expr[i].operator].unary) var operation2 = stack.pop();
                else operation2 = '';
                var res = operators[expr[i].operator].func(operation1, operation2);
                stack.push(res);
                //log.options(i, ': expr: ', (operation2 !== '' ? '"' + operation2 + '" ' : ' '), expr[i].operator, ' "', operation1, '" = ', res, ': ', stack, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
            } else {
                //log.options(i, ': data: "', expr[i].data, '": ', expr[i].type, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
                stack.push(expr[i].data);
            }
            //log.options('c: ', stack.join(','), { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
        }
        var result = stack.pop();

        if(result === undefined || result !== result) { // checking for NaN
            result = initExprString;
        }/* else if(typeof result === 'string') { // replacing quotedString[] to strings value
            result = result.replace(/quotedString\[(\d+)]/g, function(str, idx) {
                //console.log('!!!!: ', str, Number(idx), quotedStrings, result);
                log.options('quotedString replace: ', str, '; ', Number(idx), '; ', quotedStrings, '; ', result, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
                return quotedStrings[Number(idx)] !== undefined ? quotedStrings[Number(idx)] : str
            });
        }*/

        functionDebug.push({
            name: initExprString,
            parameters: expr,
            result: result
        });

        callback(null, result, functionDebug);
    })
}

function splitExpression(exprString, functions, quotedStrings, counterID, callback){

    // add \ before each symbols in array with operators for create correct regExp
    var arr = operatorsArray.map(function(op){ return '\\'+op.split('').join('\\')});
    // create regExp with operators for split expression /(\!)|(\^)|(\*)|..../g
    var regExp = new RegExp('('+arr.join(')|(')+')', 'g');

    var expr = [],
        tempOperatorsStack = [],
        prevOperator = '',
        posAfterPrevOperator = 0;

//log.options(arr, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
    while(true) {
        arr = regExp.exec(exprString);
        if(arr) {
            var operator = arr[0];
            var posBeforeCurrentOperator = regExp.lastIndex - operator.length;
        } else {
            posBeforeCurrentOperator = exprString.length;
            operator = '';
        }

        // will use bellow if expression part is a string
        var strBeforeCurrentOperator = exprString.substring(posAfterPrevOperator, posBeforeCurrentOperator);

        // These '-' characters seem the same, but they are different.
        // We replace a unary ASCII character minus (UTF-8: 0x002D) with a non ASCII character minus (UTF-8: 0x00AD)
        // it's applying to expression with unary '-' f.e. "10 * -3"
        if(operator === '-' && strBeforeCurrentOperator.trim() === '') operator = '­';

        var operation = calcFunctions.fromHuman.convertToNumeric(strBeforeCurrentOperator.split(/[ \t\r\n]+/).join(''));

        //log.options('operation: ', operation, ' operator: "', operator, '" arr: ', arr, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
        if((!operator || !operators[operator].unary) && prevOperator !== ')') {
            if (isNumeric(operation)) {
                expr.push({
                    type: 'digit',
                    data: operation
                });
            } else if (operation && operation.indexOf('"quotedString[') === 0) {
                var idx = Number(operation.replace(/"quotedString\[(\d+)]".*/, '$1'));
                expr.push({
                    type: 'other',
                    data: quotedStrings[idx]
                })
            } else if (operation && operation.indexOf('"function[') === 0) {
                idx = Number(operation.replace(/"function\[(\d+)]".*/, '$1'));
                if (functions[idx])
                    expr.push({
                        type: 'func',
                        data: functions[idx].str,
                        name: functions[idx].name,
                        parameters: functions[idx].parameters
                    });
                else log.options('Error while calculate expression ', exprString,
                    ': function[Number(', operation.replace(/"function\[(\d+)]".*/, '$1'), ')=', idx,
                    '] is undefined for operation: ', operation, '; functions: ', functions, {
                        filenames: ['counters/' + counterID, 'counters.log'],
                        emptyLabel: true,
                        noPID: true,
                        level: 'D'
                    });
            } /*else if(/^[a-zA-Z_][a-zA-Z0-9_]+$/.test(operation)){
                expr.push({
                    type: 'digit',
                    data: null
                })
            } */ else {
                expr.push({
                    type: 'other',
                    data: strBeforeCurrentOperator // exprString.substring(posAfterPrevOperator, posBeforeCurrentOperator) // calc again because from "operation" was removed some symbols
                })
            }
        }

        if(!arr) break;

        var operatorsStackLength = tempOperatorsStack.length;
        if(operatorsStackLength === 0 ||
            operator === '(' ||
            tempOperatorsStack[operatorsStackLength-1] === '(' ||
            operators[operator].priority < operators[tempOperatorsStack[operatorsStackLength-1]].priority) {

            tempOperatorsStack.push(operator);
        } else if(operator === ')') {
            var ops;
            while((ops = tempOperatorsStack.pop()) !== '(' && tempOperatorsStack.length !== 0) {
                expr.push({
                    type: 'operator',
                    operator: ops
                });
            }
            if(tempOperatorsStack.length === 0 && ops !== '(') {
                return callback(new Error('Error in expression: "' + exprString +
                    '": Can\'t find an open bracket "(" for expression with closed bracket at "...' + strBeforeCurrentOperator + ' )"'));
            }
        } else if(operators[operator].priority >= operators[tempOperatorsStack[operatorsStackLength-1]].priority) {
            while(tempOperatorsStack.length && operators[tempOperatorsStack[tempOperatorsStack.length-1]] &&
            operators[operator].priority >= operators[tempOperatorsStack[tempOperatorsStack.length-1]].priority) {
                expr.push({
                    type: 'operator',
                    operator: tempOperatorsStack.pop()
                });
            }
            tempOperatorsStack.push(operator);
        }

        //log.options('Expr: ', expr, ' tempOperatorsStack: ', tempOperatorsStack, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
        posAfterPrevOperator = posBeforeCurrentOperator+operator.length;
        prevOperator = operator;
    }

    while(tempOperatorsStack.length !== 0){
        expr.push({
            type: 'operator',
            operator: tempOperatorsStack.pop()
        });
    }

    //log.options('Expr res: ', expr, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
    callback(null, expr, quotedStrings, functions);
}


/*
replace all quoted strings to "quotedString[<NUMBER>]" (with quotes)
quotes can be " or ' or `
understand escaped quotes, like \", \', \`

str - string for replacement
callback(err, quotedStrings, str):
    quotedStrings - [<quoted string1>, ....]. <quoted string> without quotes
    str - new string with replaced quoted strings

    f.e.
    was: 2 + 7 + date('20.11.16') + time(`12:47`)
    will: 2 + 7 + date("quotedString[0]") + time("quotedString[1]")
        quotedString = ["20.11.16", "12:47"]
 */
function replaceQuotedStrings(str, counterID, callback) {

    var quotedStrings = [];

    // str.length must calculate at each iterate of cycle
    for(var i=0, quotedStringsIdx = 0; i < str.length; i++) {

        // find quoted string
        if (str[i] === '"' || str[i] === "'" || str[i] === '`') {
            /*//escaping the quote character does not work for the "\" string
            for (var pos = i, quote = str[i], len = str.length; pos < len;) {
                var endOfQuotedString = str.indexOf(quote, pos + 1);
                if (endOfQuotedString === -1 || str[endOfQuotedString - 1] !== '\\') break;
                pos = endOfQuotedString;
                endOfQuotedString = 0;
            }

            if (!endOfQuotedString || endOfQuotedString === -1)
                return callback(new Error('Error in expression: "' + str + '": unfinished quoted string from ' + str.substring(i)));

             */

            var endOfQuotedString = str.indexOf(str[i], i + 1);
            if (endOfQuotedString === -1)
                return callback(new Error('Error in expression: [' + str + ']: unfinished quoted string from ' + str.substring(i)));

            var quotedString = str.substring(i + 1, endOfQuotedString);
            quotedStrings.push(quotedString);
            var arr = str.split('');
            var stringForReplace = '"quotedString['+(quotedStringsIdx++)+']"';
            arr.splice(i, quotedString.length+2, stringForReplace);
            str = arr.join('');

            i += stringForReplace.length;
        }
    }

    //log.options('quitedStr: ', quotedStrings, '; str: ', str, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
    callback(null, quotedStrings, str);
}

/*
replace resolved variables to "quotedString[<NUMBER>]" (with quotes)

str - string for replacement
variables - object {name1: value1, name2: value2, ...}
quotedStrings - array with quotedStrings from replaceQuotedStrings() for add to it variables values.
        [<quoted string1>, ....]. <quoted string> without quotes
callback(err, quotedStrings, str):
    quotedStrings - [<variableValue1>, <variableValue2>, ....]. <variableValue1> without quotes
    str - new string with replaced variables

    f.e.
    was: 2 + 7 + date(%:date:%) + time(%:time:%)
    will: 2 + 7 + date("quotedString[0]") + time("quotedString[1]")
        variablesValues = ["20.11.16", "12:47"]
 */
function replaceVariables(str, variables, quotedStrings, counterID, callback) {
    if(!variables || !Object.keys(variables).length) return callback(null, quotedStrings, str);

    var quotedStringsIdx = quotedStrings.length, strParts = str.split('%:');

    if(strParts.length < 2) return callback(null, quotedStrings, str);

    for(var i = 1, newStr = strParts[0], unresolvedVariables = []; i < strParts.length; i++) {
        var partsOfStrParts = strParts[i].split(':%'),
            name = (partsOfStrParts[0] || '').toUpperCase();

        if(name.charAt(0) === '?') {
            name = name.substr(1);
            var addUnresolved = '?';
        } else addUnresolved = '';

        if(!name) newStr += '%:' + strParts[i];
        else if(variables[name] === undefined || variables[name] === null) {
            //log.options('Unresolved: ', name, ', str: ', str, '; variables: ', variables, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
            unresolvedVariables.push('%:' + addUnresolved + name + ':%');
            quotedStrings.push(null);
            newStr += '"quotedString['+(quotedStringsIdx++)+']"' + partsOfStrParts.slice(1).join(':%');
        } else if(isNumeric(variables[name])) newStr += String(variables[name]) + partsOfStrParts.slice(1).join(':%');
        else {
            quotedStrings.push(variables[name]);
            newStr += '"quotedString['+(quotedStringsIdx++)+']"' + partsOfStrParts.slice(1).join(':%');
        }
    }
    callback(null, quotedStrings, newStr, unresolvedVariables.length ? unresolvedVariables : null);
}

/*
replace functions to "function[<NUM>]" (with quotes

str - string for replacement
callback(err, functions, str):
functions - [{str: <function>, name: <functionName>, parameters: [prm1, prm2, prm3]}, ...]

f.e.
    was: 2 + 7 + func1 (10+15/7, func2(12, 4), 5) + func3 ("quotedString[0]")
    will: 2 + 7 + "function[1]" + "function[2]"
    functions = [{
            str: "func2(12, 4)",
            name: "func2",
            parameters: [12, 4]
        }, {
            str: "func1 (10+15/7, \"function[0]\", 5)",
            name: "func1",
            parameters ["10+15/7", "\"function[0]\"", 5]
        }, {
            str: "func3 (\"quotedString[0]\")",
            name: "func3",
            parameters: ["\"quotedString[0]\""]
        }
    ]

    Looking for functions like "<name> ("
    Iterate over the found functions in a loop in reverse order to first find the nested functions
    At each iteration, look for a right bracket to understand. where the function ends.
    It should be noted that the function parameters may contain expressions with brackets.
 */
function replaceFunctions(str, counterID, callback) {
    if(!str) return callback(new Error('Error calculate functions values for expression: expression is null'));

    var regExpFunc = /([a-zA-Z_][a-zA-Z_0-9]+)[ \t]*\(/g;

    var funcPositions = [];

    // Looking for functions like "<name> ("
    for(var funcArray; (funcArray = regExpFunc.exec(str)) /*!== null*/; ) {
        if (!(funcArray[1] in calcFunctions) || funcArray[1].indexOf('__') === 0) {
            log.options('Skip calculation of unknown function "', funcArray[0], '" in expression "', str, '"', {
                filenames: ['counters/' + counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'W'
            });
            continue;
        }
        funcPositions.push({
            beginPos: regExpFunc.lastIndex - funcArray[0].length,
            endPos: regExpFunc.lastIndex,
            name: funcArray[1],
        });
    }

    // Iterate over the found functions in a loop in reverse order to first find the nested functions
    funcPositions = funcPositions.reverse();
    var myFunctions = [], functionNum = 0;
    funcPositions.forEach(function(func) {
        var beginPos = func.beginPos;
        var endPos = func.endPos
        var funcName = func.name;

        // Look for a right bracket. The function parameters may contain expressions with brackets. Skip it
        var paramStr = str.slice(endPos);
        while(true) {
            var leftBracketPos = paramStr.indexOf('(');
            var rightBracketPos = paramStr.indexOf(')');
            // not found ')' or '(' or '(' found after ')'
            if(rightBracketPos === -1 || leftBracketPos === -1 || leftBracketPos > rightBracketPos) break;
            // replace first '(' and\or ')'
            paramStr = paramStr.replace('(', ' ').replace(')', ' ');
        }
        // can't find right bracket. possible it is not a function
        if(rightBracketPos === -1) return;
        paramStr = str.slice(endPos, endPos + rightBracketPos);

        myFunctions.push({
            str: funcName + '(' + paramStr.trim() + ')',
            name: funcName,
            parameters: paramStr.trim().split(/[ \t]*,[ \t]*/),
        });

        var arr = str.split('');
        var replaceVariable = '"function['+(functionNum++)+']"';
        arr.splice(beginPos, endPos - beginPos + paramStr.length + 1, replaceVariable);
        str = arr.join('');
    });

    //log.options('Functions: ', myFunctions, ', str: ', str, ', initStr: ', initStr, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
    callback(null, myFunctions, str);
}


function executeFunction(funcObj, quotedStrings, functions, counterID, callback){

    var funcName = funcObj.name;
    var parameters = [], functionDebug = [];

    async.eachOf(funcObj.parameters, function(parameter, index, callback){
        splitExpression(parameter, functions, quotedStrings, counterID, function(err, expr){
            if(err) return callback(err);

    //log.options('!!! expr: ', expr, { filenames: ['counters/' + counterID, 'counters.log'], emptyLabel: true, noPID: true, level: 'D' });
            if(expr.length > 1) {
                return calc(parameter, expr, quotedStrings, functions, counterID,function(err, result) {
                    if(err) return callback(err);

                    parameters[index] = result;
                    return callback();
                });
            }

            var type = expr[0].type;
            var data = expr[0].data;

            /*if(type === 'var') return getVariableValue(data, function(err, result){
                if(err) return callback(err);

                parameters[index] = result;
                return callback();
            }); */

            if(type === 'other' || type === 'digit'){
                parameters[index] = data;
                return callback();
            }

            if(type === 'func') {
                var num = Number(parameter.trim().substr('"function['.length, 1));
                if(!functions[num]) {
                    return callback(new Error('Unknown function ID ("' + num+ '") parameter.trim().substr(\'"function[\'.length, 1): ' + parameter));
                }
                var funcObj = {
                    type: 'func',
                    data: functions[num].str,
                    name: functions[num].name,
                    parameters: functions[num].parameters
                };
                return executeFunction(funcObj, quotedStrings, functions, counterID, function (err, debug) {
                    if (err) return callback(err);

                    if(debug !== null && typeof debug === 'object' ) {
                        functionDebug.push(debug);
                        parameters[index] = debug.result;
                    } else parameters[index] = debug;

                    return callback();
                })
            }
        })
    }, function(err){
        if(err) return callback(err);

        calcFunction(funcName, parameters, counterID, function(err, debug) {
            if(err) return callback(err);

            // when got an error in try{} block while calculating the function
            if(!debug) {
                debug = {
                    name: funcName,
                    parameters  : parameters,
                    result: null
                }
            }

            functionDebug.push(debug);
            callback(null, debug.result, functionDebug);
        });
    });
}

function calcFunction(name, parameters, counterID, callback){
    if(name in calcFunctions) {
        try {
            return calcFunctions[name](parameters, function(err, result) {
                if(err) return callback(new Error('Function ' + name + '(' +
                    (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) +
                    ') returned error: ' + err.message));

                log.options('Executing function name: ', name, ', parameters: ', parameters, ', result: ', result, {
                    filenames: ['counters/' + counterID, 'counters.log'],
                    emptyLabel: true,
                    noPID: true,
                    level: 'D'
                });
                return callback(null, {name: name, parameters: parameters, result: result});
            });
        } catch(err) {
            log.options('Error in ', name+ '('+
                (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) + '): ' +
                err.message, {
                filenames: ['counters/' + counterID, 'counters.log'],
                emptyLabel: true,
                noPID: true,
                level: 'E'
            });
            // You get 'callback already called', if uncomment this and got an error in a try{} block
            //return callback(new Error(name+ '('+ (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) + '): ' + err.message));
        }
    } else {
        return callback(new Error('Can\'t executing unknown function '+ name+ '('+ (parameters !== undefined && parameters.length ? parameters.join(', ') : parameters)+ ')'));
    }
}

/*
you can't use variables

function getVariableValue(variable, callback){

    callback(null, variable);
    //callback(new Error('Unknown operation ' + variable));
}

*/


//var expr = '10 -17 / func(123, date("13-12-16", 10) ,666) - qqqqq + 10 % count(10, "qqq", "qt") > 7 && 21';
//var expr = '3 + 4 * 2 / (1 - 5)^2';
/*
var expr = '-12247.602625 < 0 && 358190.712 > 300000 && 1 && !0';
//var expr = '10 * -12247.602625';

console.log(expr);
calcExpression(expr, function(err, result){
    if(err) return log.debug('err: ', err.message);

    console.log('res: ', result);
});

*/