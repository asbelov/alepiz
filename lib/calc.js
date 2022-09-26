/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.11.2016.
 */

//const log = require('../lib/log')(module);
const async = require('async');
const calcFunctions = require('../lib/calcFunction');
const fromHuman = require('./utils/fromHuman');

module.exports = calcExpression;

/** Operators structure
 *
 * @type {{"==": {func: (function(*, *): number), unary: boolean, priority: number}, "&&": {func: (function(*, *): number), unary: boolean, priority: number}, "||": {func: (function(*, *): number), unary: boolean, priority: number}, "!": {func: (function(*): number), unary: boolean, priority: number}, "<=": {func: (function(*, *): number), unary: boolean, priority: number}, "%": {func: (function(*, *)), unary: boolean, priority: number}, "&": {func: (function(*, *)), unary: boolean, priority: number}, "(": {func: (function(*): *), unary: boolean, priority: number}, ")": {func: (function(*): *), unary: boolean, priority: number}, "*": {func: (function(*, *)), unary: boolean, priority: number}, "+": {func: (function(*, *)), unary: boolean, priority: number}, "-": {func: (function(*, *)), unary: boolean, priority: number}, "/": {func: (function(*, *)), unary: boolean, priority: number}, "<": {func: (function(*, *): number), unary: boolean, priority: number}, "!=": {func: (function(*, *): number), unary: boolean, priority: number}, "|": {func: (function(*, *)), unary: boolean, priority: number}, "^": {func: (function(*, *): number), unary: boolean, priority: number}, ">": {func: (function(*, *): number), unary: boolean, priority: number}, _: {func: (function(*): number), unary: boolean, priority: number}, ">=": {func: (function(*, *): number), unary: boolean, priority: number}}}
 * operator length must be not more than two symbols
 */
var operators = {
    // priority 1 is reserved for anything
    '_': { // unary minus. "-" will be replaced with "_" (-5 => _5)
        priority: 1,
        unary: true,
        func: function (x) { return -x }
    },
    '!':  {
        priority: 2,
        unary: true,
        func: function(x) { return Number(!x)  },
    },
    '^':  {
        priority: 3,
        unary: false,
        func: function(y, x) { return Math.pow(x, y) },
    },
    '*':  {
        priority: 4,
        unary: false,
        func: function(y, x) { return x * y },
    },
    '/':  {
        priority: 4,
        unary: false,
        func: function(y, x) { return x / y },
    },
    '%':  {
        priority: 4,
        unary: false,
        func: function(y, x) { return x % y },
    },
    '+':  {
        priority: 5,
        unary: false,
        func: function(y, x) { return x + y },
    },
    '-':  {
        priority: 5,
        unary: false,
        func: function(y, x) { return x - y },
    },
    // skip >> and <<
    '>':  {
        priority: 7,
        unary: false,
        func: function(y, x) { return Number(x > y) },
    },
    '<':  {
        priority: 7,
        unary: false,
        func: function(y, x) { return Number(x < y) },
    },
    '>=': {
        priority: 7,
        unary: false,
        func: function(y, x) { return Number(x >= y) },
    },
    '<=': {
        priority: 7,
        unary: false,
        func: function(y, x) { return Number(x <= y) },
    },
    '==': {
        priority: 8,
        unary: false,
        func: function(y, x) { return Number(toBaseType(x) === toBaseType(y)) },
    },
    '!=': {
        priority: 8,
        unary: false,
        func: function(y, x) { return Number(toBaseType(x) !== toBaseType(y)) },
    },
    '&':  {
        priority: 9,
        unary: false,
        func: function(y, x) { return x & y },
    },
    // here skipping bitwise XOR (^). Think, that it's not needed
    '|':  {
        priority: 11,
        unary: false,
        func: function(y, x) { return x | y },
    },
    '&&': {
        priority: 12,
        unary: false,
        func: function(y, x) { return Number(Boolean(x) && Boolean(y)) },
    },
    '||': {
        priority: 13,
        unary: false,
        func: function(y, x) { return Number(Boolean(x) || Boolean(y)) },
    },
    '(':  {
        priority: 20,
        unary: true,
        func: function(x) { return x },
    },
    ')': {
        priority: 20,
        unary: false, // it's right!!!
        func: function(x) { return x },
    }
};

/*
Array of operators, sorted by operator length. I.e. array ['&', '*', '&&'] will be a ['&&', '&', '*']
 */
var operatorsArray = Object.keys(operators).sort(function(a,b){ return b.length - a.length; });
//var resultsReturnedFromExprCache = 0, resultsExprReturned = 0;
var recalculateCalcExprResultTimeInterval = 30000, expressionCache = new Map();
setInterval(cacheCleaner, 300000);

function expressionCacheSet(initExprString, variablesStr, result) {
    expressionCache.set(initExprString + ':' + variablesStr, {
        timestamp: Date.now(),
        result: result,
    });
}

function expressionCacheGet(initExprString, variablesStr) {
    //++resultsExprReturned;
    var exprResult = expressionCache.get(initExprString + ':' + variablesStr);
    if(!exprResult || Date.now() - exprResult.timestamp > recalculateCalcExprResultTimeInterval) return null;
    //++resultsReturnedFromExprCache;
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
    resultsReturnedFromExprCache = resultsExprReturned = 0;
     */
}

/** Checking for numeric
 *
 * @param n - value for check
 * @returns {boolean} - true if value is a numeric. Otherwise false
 */
function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

/** Convert argument from string to number if argument is a stringified number.
 * If one of arithmetic argument is number, JS tries to make number other arguments not need to use this function
 * to arithmetic expression function make correct result when compare:
 * false === 0; undefined === 0
 *
 * @param n - argument for convert
 * @returns {number|*} - converted argument, or original argument if conversion is not possible
 */
function toBaseType(n) {
    if(typeof n === 'string' && isNumeric(n)) return Number(n);
    return n;
}

/** Callback parameters description
 *
 * @callback calcExpressionCallback
 * @param {Error|null} Error - if error occurred, return only error
 * @param {string|number|boolean|null} [result] - the result of evaluating initExpression. the type of the result will
 * depend on the value returned after initExpression is evaluated
 * @param {Array} [functionDebug] -an array of objects with debug information for calculating functions in an initExpression.
 * { type: 'func', data: functions[num].str, name: functions[num].name, parameters: functions[num].parameters }
 * @param {Array} [unresolvedVariables] - Array with names of unresolved variables {'%:var1:%', '%:?var2:%', ... }
 * @param {Object} [variables] - Object with variables {<variableName1>: <value1>, ....}
 */

/** Calculate expression with variables, functions and operators
 *
 * @param {string} initExprString - string with expression for calculation
 * @param {Object} variables - object with variables like {variableName1: <value1>, variableName2: <value2>, ...}
 * @param {function} getVariableValue - function for getting unresolved variable getVariableValue(variableName, callback),
 *      where callback(err, variableValue): variableValue - variable value. If variable can not be resolved,
 *      function mast run callback(err) with error
 * @param {calcExpressionCallback} callback - callback(err, result, functionDebug, unresolvedVariables, variables)
 * called when done. Return Error if error occurred. Result has type depended on
 * initExprString calculation. functionDebug - Array of objects with calculation debug information, used for dynamicLog.
 * unresolvedVariables - Array with names of unresolved variables. variables - object with variables and values
 */

function calcExpression(initExprString, variables, getVariableValue,  callback){

    if(!initExprString) return callback(null, '', []);
    if(typeof initExprString !== 'string') {
        return callback(null, initExprString, [], null, variables);
    }
    var exprString = initExprString;

    if(!variables || typeof variables !== 'object' || !Object.keys(variables).length) variables = null;
    var variablesStr = '';
    if(variables && typeof(variables) === 'object') {
        variablesStr = Object.keys(variables).sort().map(function (name) {
            return name + ':' + variables[name];
        }).join(',');
    }

    //log.info('Starting calculate expression: ', initExprString, '; variables: ', variables);

    var res = simpleCalc(exprString);
    if(res !== null) {
        return callback(null, res, [], null);
    }

    res = expressionCacheGet(exprString, variablesStr);
    if(res !== null) {
        return callback(null, res, [{
            name: exprString,
            parameters: [],
            result: 'from expression cache (' + (typeof res === 'object' ? JSON.stringify(res) : String(res)) + ')',
        }], null);
    }

    replaceQuotedStrings(exprString,function(err, quotedStrings, exprString) {
        if (err) return callback(err);

        // !!! replaceVariables() should be placed after replaceQuotedStrings() because otherwise we can't handle
        // quoted variable, i.e. eg: getValueFromJSONStr('%:PARENT_VALUE:%', "hostname")
        replaceVariables(exprString, variables, quotedStrings,
            function(err, quotedStrings, exprString, unresolvedVariables) {
            if (err) return callback(err);

            // stop calculation when unresolved variables are detected
            if(typeof getVariableValue !== 'function' && unresolvedVariables) {
                for(var i = 0, hasUnresolved = false; i < unresolvedVariables.length; i++) {
                    if(unresolvedVariables[i].charAt(2) !== '?') { // checking for %:?<name>:%
                        hasUnresolved = true;
                        break;
                    }
                }
                if(hasUnresolved) return callback(null, initExprString, [], unresolvedVariables);
            }

            replaceFunctions(exprString, function (err, functions, exprString) {
                if (err) return callback(err, null, null, unresolvedVariables);

                splitExpression(exprString, functions, quotedStrings,
                    function (err, expr, quotedStrings, functions) {
                    if (err) return callback(err, null, null, unresolvedVariables);

                    calc(initExprString, expr, quotedStrings, functions, getVariableValue, variables,
                        unresolvedVariables,function(err, result, functionDebug) {
                        if(err) return callback(err, null, functionDebug, unresolvedVariables);

                        result = convertResult(result);
                        expressionCacheSet(exprString, variablesStr, result);
                        //log.info('Calculation result for expression ', initExprString, ' = ', result, (unresolvedVariables ? (' unresolved vars: ' + unresolvedVariables.join(', ')) : ', all variables are resolved'), ' (', exprString, '; ', expr, '): func: ', functionDebug);
                        callback(null, result, functionDebug, unresolvedVariables);
                    });
                });
            });
        });
    });
}

calcExpression.operators = operators;
calcExpression.initCache = calcFunctions.__initCache;

function simpleCalc(initStr) {
    var str = initStr;
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

    return null;
}

/**
 * Convert result to number or string:
 * @example
 * Boolean to 1|0;
 * Numeric string with 0 as a first character to string like 0X (f.e. "02" -> "02")
 * other Numeric to Number()
 * null and undefined to 0
 * Object to stringified JSON
 * other not a string to a string
 *
 * @param result - source of the result
 * @returns {string|number} - converted result
 */
function convertResult(result) {
    if(typeof result === 'boolean' ||
        // we check that the result is numeric and make sure that it is not a string or the first character of the
        // string is not equal to "0".
        // that is, we convert numeric strings to a number, but a string like "02" will not be converted to 2
        (isNumeric(result) && (typeof result !== 'string' || (result.length > 1 && result.charAt(0) !== '0') ))) {
        result = Number(result);
    }
    else if(result === null || result === undefined) result = 0;
    else if(typeof result === 'object') result = JSON.stringify(result);
    else if(typeof result !== 'string') result = result.toString();

    return result;
}

function calc (initExprString, expr, quotedStrings, functions, getVariableValue, variables, unresolvedVariables, callback) {
    //log.info('!!! calc: initExprString: ', initExprString, '; expr: ', expr, '; quotedStrings: ', quotedStrings, '; functions: ', functions);
    var functionDebug = [], stack = [], skipBlockToOperatorID = 0;
    //console.log(expr)
    async.eachSeries(expr, function (operation, callback) {
        //console.log('operation: ', JSON.stringify(operation))
        if(skipBlockToOperatorID) {
            //console.log('   skip to logicalOperatorID =', skipBlockToOperatorID)
            if (skipBlockToOperatorID === operation.logicalOperatorID) skipBlockToOperatorID = 0;
            return callback();
        }

        if(operation.type === 'operator') {

            var result1 = stack.pop();
            var result2 = operators[operation.operator].unary ? '' : stack.pop();

            var res = operators[operation.operator].func(result1, result2);

            stack.push(res);
            //console.log('   expr: ', (result2 !== '' ? result2 : ''), operation.operator, result1, '=', res, '; logicalOperatorID: ', operation.logicalOperatorID, '; stack:', stack);
            return callback();
        } else {
            if((operation.logicalOperator === '&&' && !Boolean(stack[stack.length - 1])) ||
                (operation.logicalOperator === '||' && Boolean(stack[stack.length - 1]))
            ) {
                skipBlockToOperatorID = operation.logicalOperatorID;
                //console.log('   add ', operation.logicalOperator, ' for skip to skipBlockToOperatorID =', skipBlockToOperatorID)
                return callback();
            }

            resolveVarAndFunc(operation, quotedStrings, functions, getVariableValue, variables, unresolvedVariables,
                function(err, result, debug) {
                if (debug) Array.prototype.push.apply(functionDebug, debug);
                if (err) return callback(new Error('Expression: ' + initExprString + ': ' + err.message));

                operation.data = result === null ? 0 : result;
                operation.type = isNumeric(result) ? 'digit' : 'other';

                stack.push(result);
                //console.log('   add to stack: ', JSON.stringify(stack))
                return callback();
            });
        }
        //log.info('c: ', stack.join(','));
    }, function (err) {
        if (err) return callback(err);

        //console.log('res stack: ', stack);
        var result = stack.pop();

        // result !== result for checking for NaN, don't use isNan(result) because typeof result is not always "number"
        if(result === undefined || result !== result) result = initExprString;

        functionDebug.push({
            name: initExprString,
            parameters: expr,
            result: result
        });

        if(Array.isArray(unresolvedVariables)) unresolvedVariables.length = 0;
        callback(null, result, functionDebug);
    });
}

function resolveVarAndFunc(operation, quotedStrings, functions, getVariableValue, variables, unresolvedVariables, callback) {
    if(!operation || typeof operation !== 'object') return callback(null, operation);

    if (operation.type === 'func') {
        executeFunction(operation, quotedStrings, functions, getVariableValue, variables, unresolvedVariables,
            function (err, result, debug) {

            if (err) return callback(err);
            return callback(null, result, debug);
        });
    } else if (operation.type === 'var') {
        if(typeof getVariableValue === 'function') {
            if(variables[operation.data] === null) {
                if(operation.canBeUnresolved) return callback(null, null);
                else return callback(new Error('Unresolved variable ' + operation.data));
            }
            if(variables[operation.data] !== undefined) return callback(null, variables[operation.data]);

            var result = simpleCalc(operation.data);
            if(result !== null) return callback(null, result);

            getVariableValue(operation.data, function (err, result) {
                if (err && !operation.canBeUnresolved) return callback(err);
                if((result === undefined || result === null) && !operation.canBeUnresolved) {
                    return callback(new Error('Received undefined result for ' + operation.data));
                }
                if ((err || result === undefined || result === null) && operation.canBeUnresolved) {
                    return callback(null, null);
                }

                // remove from unresolvedVariables
                removeFromUnresolved(operation.data, result, unresolvedVariables);
                return callback(null, result);
            });
        } else {
            if (operation.canBeUnresolved) return callback(null, 0);
            return callback(new Error('Unresolved variable ' + operation.data));
        }
    } else return callback(null, operation.data);
}

function removeFromUnresolved(variableName, result, unresolvedVariables) {
    if(result !== undefined && result !== null) {
        variableName = variableName.toUpperCase();
        var idx = unresolvedVariables.indexOf('%:' + variableName + ':%');
        if(idx === -1) idx = unresolvedVariables.indexOf('%:?' + variableName + ':%');
        if(idx !== -1) unresolvedVariables.splice(idx, 1);
    }
}

function splitExpression(exprString, functions, quotedStrings, callback) {
    //log.info('exprString: ', exprString)
    // add \ before each symbols in array with operators for create correct regExp
    var arr = operatorsArray.map(function(op){ return '\\' + op.split('').join('\\')});
    // create regExp with operators for split expression /(\!)|(\^)|(\*)|..../g
    var regExp = new RegExp('('+arr.join(')|(')+')', 'g');

    var expr = [],
        tempOperatorsStack = [],
        prevOperator = '',
        posAfterPrevOperator = 0,
        operationObj = null,
        logicalOperator = '',
        logicalOperatorID = 0;

    //log.info(arr);
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

        // We replace a unary minus '-' with '_'
        // it's applying to expression with unary '-' f.e. "10 * -3"
        if(operator === '-' && strBeforeCurrentOperator.trim() === '') operator = '_';

        var operation = fromHuman(strBeforeCurrentOperator.split(/[ \t\r\n]+/).join(''));

        //log.info('operation: ', operation, ' operator: "', operator, '" arr: ', arr);
        if((!operator || !operators[operator].unary) && prevOperator !== ')') {
            if (isNumeric(operation)) {
                operationObj = {
                    type: 'digit',
                    data: operation,
                }
            } else if (operation && operation.indexOf('"quotedString[') === 0) {
                var idx = Number(operation.replace(/"quotedString\[(\d+)]".*/, '$1'));
                if(quotedStrings[idx] && /^\r%:.+:%\r$/.test(quotedStrings[idx])) {
                    var varName = quotedStrings[idx].replace(/^\r%:(.+):%\r$/, '$1');
                    var canBeUnresolved = false;

                    if(varName.charAt(0) === '?') {
                        varName = varName.substring(1);
                        canBeUnresolved = true;
                    }
                    operationObj = {
                        type: 'var',
                        data: varName,
                        canBeUnresolved: canBeUnresolved,
                    }
                } else {
                    operationObj = {
                        type: 'other',
                        data: quotedStrings[idx],
                    }
                }
            } else if (operation && operation.indexOf('"function[') === 0) {
                idx = Number(operation.replace(/"function\[(\d+)]".*/, '$1'));
                if (functions[idx]) {
                    operationObj = {
                        type: 'func',
                        data: functions[idx].str,
                        name: functions[idx].name,
                        parameters: functions[idx].parameters,
                    }
                } /*else {
                    log.info('Error while calculate expression ', exprString,
                        ': function[Number(', operation.replace(/"function\[(\d+)]".*?/, '$1'), ')=', idx,
                        '] is undefined for operation: ', operation, '; functions: ', functions);
                }*/
            }/* else if(operation && /^%:.+:%$/.test(operation)) {
                var varName = operation.replace(/^%:(.+):%$/, '$1');
                var canBeUnresolved = false;

                if(varName.charAt(0) === '?') {
                    varName = varName.substring(1);
                    canBeUnresolved = true;
                }

                expr.push({
                    type: 'var',
                    data: varName,
                    canBeUnresolved: canBeUnresolved,
                });
            } */else {
                operationObj = {
                    type: 'other',
                    data: strBeforeCurrentOperator, // exprString.substring(posAfterPrevOperator, posBeforeCurrentOperator) // calc again because from "operation" was removed some symbols
                }
            }

            if(operationObj) {
                if(logicalOperator) {
                    operationObj.logicalOperatorID = logicalOperatorID;
                    operationObj.logicalOperator = logicalOperator;
                }
                expr.push(operationObj);
                operationObj = null;
                logicalOperator = '';
            }
        }

        if(operator === '||' || operator === '&&') {
            logicalOperatorID++;
            logicalOperator = operator;
        }

        if(!arr) break;

        var operatorsStackLength = tempOperatorsStack.length;
        var tempOperatorObj = null;
        if(operatorsStackLength === 0 ||
            operator === '(' ||
            tempOperatorsStack[operatorsStackLength-1].operator === '(' ||
            operators[operator].priority < operators[tempOperatorsStack[operatorsStackLength-1].operator].priority) {

            tempOperatorObj = {
                type: 'operator',
                operator: operator,
            }

        } else if(operator === ')') {
            for(var operatorObj = tempOperatorsStack.pop();
                operatorObj.operator !== '(' && tempOperatorsStack.length !== 0;
                operatorObj = tempOperatorsStack.pop()) {

                expr.push(operatorObj);
                //console.log('operatorObj:', expr);
            }
            if(tempOperatorsStack.length === 0 && operatorObj.operator !== '(') {
                return callback(new Error('Error in expression: "' + exprString +
                    '": Can\'t find an open bracket "(" for expression with closed bracket ")" at "...' +
                    strBeforeCurrentOperator + ' )"'));
            }
        } else if(operators[operator].priority >= operators[tempOperatorsStack[operatorsStackLength-1].operator].priority) {
            while(tempOperatorsStack.length && operators[tempOperatorsStack[tempOperatorsStack.length-1].operator] &&
            operators[operator].priority >= operators[tempOperatorsStack[tempOperatorsStack.length-1].operator].priority) {
                expr.push(tempOperatorsStack.pop());
                //console.log('op1:', expr);
            }
            tempOperatorObj = {
                type: 'operator',
                operator: operator,
            };
        }

        if(tempOperatorObj) {
            if(tempOperatorObj.operator === logicalOperator) tempOperatorObj.logicalOperatorID = logicalOperatorID;
            tempOperatorsStack.push(tempOperatorObj);
            tempOperatorObj = null;
        }

        //log.info('Expr: ', expr, ' tempOperatorsStack: ', tempOperatorsStack);
        posAfterPrevOperator = posBeforeCurrentOperator+operator.length;
        prevOperator = operator;
    }

    while(tempOperatorsStack.length !== 0){
        expr.push(tempOperatorsStack.pop());
        //console.log('op2:', expr);
    }

    //log.info('Expr res: ', expr);
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
function replaceQuotedStrings(initStr, callback) {

    var quotedStrings = [], str = initStr;

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
            if (endOfQuotedString === -1) {
                return callback(new Error('Error in expression: [' + initStr + ']: unfinished quoted string from ' +
                    str.substring(i)));
            }

            var quotedString = str.substring(i + 1, endOfQuotedString);
            quotedStrings.push(quotedString);
            var arr = str.split('');
            var stringForReplace = '"quotedString['+(quotedStringsIdx++)+']"';
            arr.splice(i, quotedString.length+2, stringForReplace);
            str = arr.join('');

            i += stringForReplace.length;
        }
    }

    //log.info('!!! quitedStr: ', quotedStrings, '; str: ', initStr, ' => ', str);
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
function replaceVariables(exprStr, variables, quotedStrings, callback) {
    if(!variables || !Object.keys(variables).length) return callback(null, quotedStrings, exprStr);

    var quotedStringsIdx = quotedStrings.length, strParts = exprStr.split('%:');

    if(strParts.length < 2) return callback(null, quotedStrings, exprStr);

    for(var i = 1, newStr = strParts[0], unresolvedVariables = []; i < strParts.length; i++) {
        var partsOfStrParts = strParts[i].split(':%'),
            name = (partsOfStrParts[0] || '').toUpperCase();

        if(name.charAt(0) === '?') {
            name = name.substring(1);
            var addUnresolved = '?';
        } else addUnresolved = '';

        if(!name) newStr += '%:' + strParts[i];
        else if(variables[name] === null) {
            // wrong - if(addUnresolved) newStr += '0' + partsOfStrParts.slice(1).join(':%');
            // because variable value may be used as a function parameter, and
            // function parameter mast be null for unresolved variable
            if(addUnresolved) {
                quotedStrings.push('\r%:' + addUnresolved + name + ':%\r');
                newStr += '"quotedString['+(quotedStringsIdx++)+']"' + partsOfStrParts.slice(1).join(':%');
            } else {
                return callback(new Error('Can\'t calculate expression ' + exprStr +
                    ': found unresolved variable ' + name));
            }
        } else if(variables[name] === undefined) {
            unresolvedVariables.push('%:' + addUnresolved + name + ':%');
            quotedStrings.push('\r%:' + addUnresolved + name + ':%\r');
            newStr += '"quotedString['+(quotedStringsIdx++)+']"' + partsOfStrParts.slice(1).join(':%');
        } else if(isNumeric(variables[name])) {
            newStr += String(variables[name]) + partsOfStrParts.slice(1).join(':%');
        } else {
            quotedStrings.push(variables[name]);
            newStr += '"quotedString['+(quotedStringsIdx++)+']"' + partsOfStrParts.slice(1).join(':%');
        }
    }

    //log.info('!!! vars Unresolved: ', unresolvedVariables, '; exprStr: ', exprStr, ' => ', newStr, '; quotedStrings: ', quotedStrings, '; variables: ', variables);
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
function replaceFunctions(str, callback) {
    if(!str) return callback(new Error('Error calculate functions values for expression: expression is null'));

    // \w = [a-zA-Z_0-9]
    var regExpFunc = /([a-zA-Z_]\w+)[ \t]*\(/g;

    var funcPositions = [];

    // Looking for functions like "<name> ("
    for(var funcArray; (funcArray = regExpFunc.exec(str)) /*!== null*/; ) {
        if (!(funcArray[1] in calcFunctions) || funcArray[1].indexOf('__') === 0) {
            return callback(new Error('Skip calculation of unknown function "' + funcArray[0] + '" in expression "' +
                str + '"'));
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

    //log.info('Functions: ', myFunctions, ', str: ', str, ', initStr: ', initStr);
    callback(null, myFunctions, str);
}


function executeFunction(funcObj, quotedStrings, functions, getVariableValue, variables, unresolvedVariables, callback) {

    var funcName = funcObj.name;
    var parameters = [], functionDebug = [];

    /*
    if use the function async.eachOf(), then calculate several variables of the function in parallel.
    But if one variable occurs several times, then its value will be calculated several times
     */
    async.eachOfSeries(funcObj.parameters, function(parameter, index, callback){
        splitExpression(parameter, functions, quotedStrings, function(err, expr) {
            if(err) return callback(err);

            //log.info('!!! expr: ', parameter, '=>', expr, '; func: ', funcObj, '; quotedStrings: ', quotedStrings);
            if(expr.length > 1) {
                return calc(parameter, expr, quotedStrings, functions, getVariableValue, variables, unresolvedVariables,
                    function(err, result) {

                    if(err) return callback(err);

                    parameters[index] = result;
                    return callback();
                });
            }

            var type = expr[0].type;

            if(type === 'var') {
                if(typeof getVariableValue === 'function') {
                    if(variables[expr[0].data] !== undefined) {
                        if(variables[expr[0].data] === null) {
                            if (expr[0].canBeUnresolved) parameters[index] = null;
                            else return callback(new Error('variable ' + expr[0].data + ' is unresolved'));
                        }
                        parameters[index] = variables[expr[0].data];
                        return callback();
                    }

                    var result = simpleCalc(expr[0].data);
                    if(result !== null) {
                        parameters[index] = result;
                        return callback();
                    }

                    return getVariableValue(expr[0].data, function (err, result) {
                        if (err && !expr[0].canBeUnresolved) return callback(err);
                        // if the variable is unresolved, we pass to the function not 0, but null, so that the function
                        // can distinguish an unresolved variable
                        if((result === undefined || result === null) && !expr[0].canBeUnresolved) {
                            return callback(new Error('got "' + result + '" result for ' + expr[0].data));
                        }
                        if ((err || result === undefined || result === null) && expr[0].canBeUnresolved) {
                            parameters[index] = null;
                        } else parameters[index] = result;

                        // remove from unresolvedVariables
                        removeFromUnresolved(expr[0].data, result, unresolvedVariables);
                        return callback();
                    });
                } else {
                    if (expr[0].canBeUnresolved) {
                        // if the variable is unresolved, we pass to the function not 0, but null, so that the function
                        // can distinguish an unresolved variable
                        parameters[index] = null;
                        return callback();
                    } else {
                        return callback(new Error('found unresolved variable ' + expr[0].data +
                            ' and no function to resolve it'));
                    }
                }
            }

            if(type === 'other' || type === 'digit'){
                parameters[index] = expr[0].data;
                return callback();
            }

            if(type === 'func') {
                var num = Number(parameter.trim().substr('"function['.length, 1));
                if(!functions[num]) {
                    return callback(new Error('Unknown function ID ("' + num +
                        '") parameter.trim().substr(\'"function[\'.length, 1): ' + parameter));
                }
                var newFuncObj = {
                    type: 'func',
                    data: functions[num].str,
                    name: functions[num].name,
                    parameters: functions[num].parameters
                };

                return executeFunction(newFuncObj, quotedStrings, functions, getVariableValue, variables,
                    unresolvedVariables,function (err, debug) {

                    if (err) return callback(err);

                    if(debug !== null && typeof debug === 'object' ) {
                        functionDebug.push(debug);
                        parameters[index] = debug.result;
                    } else parameters[index] = debug;

                    return callback();
                });
            }
        });
    }, function(err){
        if(err) return callback(new Error('Can\'t process function ' + funcName +
            '(' + funcObj.parameters.join(', ') + '): ' + err.message));

        calcFunction(funcName, parameters, function(err, debug) {
            if(err) return callback(err);

            // when got an error in try{} block while calculating the function
            if(!debug) {
                debug = {
                    name: funcName,
                    parameters  : parameters,
                    result: null,
                }
            }

            functionDebug.push(debug);
            callback(null, debug.result, functionDebug);
        });
    });
}

function calcFunction(functionName, parameters, callback){
    if(functionName in calcFunctions) {
        return calcFunctions[functionName](parameters, function(err, result) {
            if(err) return callback(new Error('Function ' + functionName + '(' +
                (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) +
                ') returned error: ' + err.message));

            result = convertResult(result);

            //console.log('Executing function name: ', functionName, ', parameters: ', parameters, ', result: ', result);
            return callback(null, {name: functionName, parameters: parameters, result: result});
        });
    } else {
        return callback(new Error('Can\'t executing unknown function '+ functionName+ '('+
            (parameters !== undefined && parameters.length ? parameters.join(', ') : parameters)+ ')'));
    }
}