/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 12.11.2016.
 */

var async = require('async');
var log = require('../lib/log')(module);
var calcFunctions = require('../lib/calcFunction');

module.exports = calcExpression;


// operator length must be not more then two symbols
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

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

// if one of arithmetic argument is number, JS try to make number other arguments
// not need to use this function to arithmetic expression
// function make correct result when compare:
// false === 0; undefined === 0
function toBaseType(n) {
    if(typeof n === 'string' && isNumeric(n)) return Number(n);
    return n;
}

function calcExpression(initExprString, variables, callback){

    if(!initExprString) return callback(null, '', []);
    if(typeof initExprString !== 'string') return callback(null, initExprString, []);
    if(typeof variables === 'function') {
        callback = variables;
        variables = null;
    } else if(!variables || typeof variables !== 'object' || !Object.keys(variables).length) variables = null;

    log.debug('Starting calculate expression: ', initExprString, '; variables: ', variables);

    var res = simpleCalc(initExprString);
    if(res) return callback(null, res, []);

    replaceQuotedStrings(initExprString, function(err, quotedStrings, exprString) {
        if (err) return callback(err);

        // !!! replaceVariables() must placed after replaceQuotedStrings() because in another case we can't process variable in quotes, f.e.
        // like this: getValueFromJSONStr('%:PARENT_VALUE:%', "hostname" )
        replaceVariables(exprString, variables, quotedStrings, function(err, quotedStrings, exprString, unresolvedVariables) {
            if (err) return callback(err);

            // stop calculation when unresolved variables are detected
            if(unresolvedVariables) return callback(null, initExprString, [], unresolvedVariables);

            replaceFunctions(exprString, function (err, functions, exprString) {
                if (err) return callback(err, null, null, unresolvedVariables);

                splitExpression(exprString, functions, quotedStrings, function (err, expr, quotedStrings, functions) {
                    if (err) return callback(err, null, null, unresolvedVariables);

                    calc(initExprString, expr, quotedStrings, functions,function(err, result, functionDebug) {
                        if(err) return callback(err, null, functionDebug, unresolvedVariables);

                        log.debug('Calculation result for expression ', initExprString, ' = ', result,
                            (unresolvedVariables ? (' unresolved vars: ' + unresolvedVariables.join(', ')) : ', all variables are resolved'),
                            ' (', exprString, '; ', expr, '): func: ', functionDebug);
                        callback(null, result, functionDebug, unresolvedVariables);
                    });
                });
            });
        });
    });
}

// export operators structure
calcExpression.operators = operators;
calcExpression.convertToNumeric = calcFunctions.fromHuman.convertToNumeric;
calcExpression.convertToHuman = calcFunctions.toHuman.convertToHuman;
calcExpression.variablesReplace = simpleVariablesReplace;

function simpleCalc(str) {
    // remove spaces around string
    str = str.trim();

    // check for simple number
    if(isNumeric(str)) return Number(str);

    // check for simple quoted string
    var quoteSymbol = str.charAt(0);
    if((quoteSymbol === '"' || quoteSymbol === "'" || quoteSymbol === '`') && // first symbol is one of quote
        (str.charAt(str.length-1) === quoteSymbol && // last symbol also quote
            // number of quotes is 2 more (first and last) number of escaped quotes
            str.split(quoteSymbol).length - 2 === str.split('\\' + quoteSymbol).length)
    ) {
        return str.slice(1, -1);
    }
}

function simpleVariablesReplace(str, variables) {
    if(!str || typeof(str) !== 'string') return; // it's mean that nothing to replace. don't change this to return {value: str, unres..: []}

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

        if(variables[name] !== undefined) {
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

function calc(initExprString, expr, quotedStrings, functions, callback) {

    var functionDebug = [];
    async.eachOf(expr, function (operation, index, callback) {
        if (operation.type === 'func') {
            executeFunction(operation, quotedStrings, functions, function (err, result, debug) {
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
            log.debug('Error while calculate expression ', initExprString, ': ', err.message);
            return callback(err);
        }

        for(var i = 0, stack = [], len = expr.length; i < len; i++){
            if(expr[i].type === 'operator') {

                var operation1 = stack.pop();
                if(!operators[expr[i].operator].unary) var operation2 = stack.pop();
                else operation2 = '';
                var res = operators[expr[i].operator].func(operation1, operation2);
                stack.push(res);
                //log.debug(i, ': expr: ', (operation2 !== '' ? '"' + operation2 + '" ' : ' '), expr[i].operator, ' "', operation1, '" = ', res, ': ', stack);
            } else {
                //log.debug(i, ': data: "', expr[i].data, '": ', expr[i].type);
                stack.push(expr[i].data);
            }
            //log.debug('c: ', stack.join(','));
        }
        var result = stack.pop();

        if(result === undefined || result !== result) { // checking for NaN
            result = initExprString;
        }/* else if(typeof result === 'string') { // replacing quotedString[] to strings value
            result = result.replace(/quotedString\[(\d+)]/g, function(str, idx) {
                //console.log('!!!!: ', str, Number(idx), quotedStrings, result);
                log.debug('quotedString replace: ', str, '; ', Number(idx), '; ', quotedStrings, '; ', result);
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

function splitExpression(exprString, functions, quotedStrings, callback){

    // add \ before each symbols in array with operators for create correct regExp
    var arr = operatorsArray.map(function(op){ return '\\'+op.split('').join('\\')});
    // create regExp with operators for split expression /(\!)|(\^)|(\*)|..../g
    var regExp = new RegExp('('+arr.join(')|(')+')', 'g');

    var expr = [],
        tempOperatorsStack = [],
        prevOperator = '',
        posAfterPrevOperator = 0;

//log.debug(arr);
    while(true) {
        arr = regExp.exec(exprString);
        if(arr) {
            var operator = arr[0];
            var posBeforeCurrentOperator = regExp.lastIndex - operator.length;
        } else {
            posBeforeCurrentOperator = exprString.length;
            operator = '';
        }

        // will used bellow if expression part is a string
        var strBeforeCurrentOperator = exprString.substring(posAfterPrevOperator, posBeforeCurrentOperator);

        // These '-' characters seem the same, but they are different.
        // We replace a unary ASCII character minus (UTF-8: 0x002D) with a non ASCII character minus (UTF-8: 0x00AD)
        // it's applying to expression with unary '-' f.e. "10 * -3"
        if(operator === '-' && strBeforeCurrentOperator.trim() === '') operator = '­';

        var operation = calcFunctions.fromHuman.convertToNumeric(strBeforeCurrentOperator.split(/[ \t\r\n]+/).join(''));

        //log.debug('operation: ', operation, ' operator: "', operator, '" arr: ', arr);
        if((!operator || !operators[operator].unary) && prevOperator !== ')') {
            if (isNumeric(operation)) {
                expr.push({
                    type: 'digit',
                    data: operation
                });
            } else if (operation.indexOf('"quotedString[') === 0) {
                var idx = Number(operation.replace(/"quotedString\[(\d+)]".*/, '$1'));
                expr.push({
                    type: 'other',
                    data: quotedStrings[idx]
                })
            } else if (operation.indexOf('"function[') === 0) {
                idx = Number(operation.replace(/"function\[(\d+)]".*/, '$1'));
                if (functions[idx])
                    expr.push({
                        type: 'func',
                        data: functions[idx].str,
                        name: functions[idx].name,
                        parameters: functions[idx].parameters
                    });
                else log.error('Error while calculate expression ', exprString,
                    ': function[Number(', operation.replace(/"function\[(\d+)]".*/, '$1'), ')=', idx,
                    '] is undefined for operation: ', operation, '; functions: ', functions);
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

        //log.debug('Expr: ', expr, ' tempOperatorsStack: ', tempOperatorsStack);
        posAfterPrevOperator = posBeforeCurrentOperator+operator.length;
        prevOperator = operator;
    }

    while(tempOperatorsStack.length !== 0){
        expr.push({
            type: 'operator',
            operator: tempOperatorsStack.pop()
        });
    }

    //log.debug('Expr res: ', expr);
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
function replaceQuotedStrings(str, callback) {

    var quotedStrings = [];

    // str.length must calculate at each iterate of cycle
    for(var i=0, quotedStringsIdx = 0; i < str.length; i++) {

        // find quoted string
        if (str[i] === '"' || str[i] === "'" || str[i] === '`') {
            for (var pos = i, quote = str[i], len = str.length; pos < len;) {
                var endOfQuotedString = str.indexOf(quote, pos + 1);
                if (endOfQuotedString === -1 || str[endOfQuotedString - 1] !== '\\') break;
                pos = endOfQuotedString;
                endOfQuotedString = 0;
            }

            if (!endOfQuotedString || endOfQuotedString === -1)
                return callback(new Error('Error in expression: "' + str + '": unfinished quoted string from ' + str.substring(i)));


            var quotedString = str.substring(i + 1, endOfQuotedString);
            quotedStrings.push(quotedString);
            var arr = str.split('');
            var stringForReplace = '"quotedString['+(quotedStringsIdx++)+']"';
            arr.splice(i, quotedString.length+2, stringForReplace);
            str = arr.join('');

            i += stringForReplace.length;
        }
    }

    //log.debug('quitedStr: ', quotedStrings, '; str: ', str);
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
function replaceVariables(str, variables, quotedStrings, callback) {
    if(!variables || !Object.keys(variables).length) return callback(null, quotedStrings, str);

    var quotedStringsIdx = quotedStrings.length, strParts = str.split('%:');

    if(strParts.length < 2) return callback(null, quotedStrings, str);

    for(var i = 1, newStr = strParts[0], unresolvedVariables = []; i < strParts.length; i++) {
        var partsOfStrParts = strParts[i].split(':%'),
            name = (partsOfStrParts[0] || '').toUpperCase();

        if(name.charAt(0) === '?') {
            name = name.substr(1);
            var addUnresolved = true;
        } else addUnresolved = false;

        if(!name) newStr += '%:' + strParts[i];
        else if(!addUnresolved && variables[name] === undefined) {
            //log.debug('Unresolved: ', name, ', str: ', str, '; variables: ', variables);
            unresolvedVariables.push('%:' + name + ':%');
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
 */
function replaceFunctions(str, callback){
    if(!str) return callback(new Error('Error calculate functions values for expression: expression is null'));

    var regExpFunc = /([a-zA-Z_][a-zA-Z_0-9]+)[ \t]*\([ \t]*([^()]*?)[ \t]*\)/g;

    for(var funcArray, myFunctions = [], functionNum = 0; (funcArray = regExpFunc.exec(str)) /*!== null*/; ){

        if(!(funcArray[1] in calcFunctions)) {
            log.warn('Skip calculation of unknown function "', funcArray[0], '" in expression "', str, '"');
            continue;
        }
        myFunctions.push({
            str: funcArray[0],
            name: funcArray[1],
            parameters: funcArray[2].split(/[\s\t]*,[\s\t]*/)
        });

        var arr = str.split('');
        var replaceVariable = '"function['+(functionNum++)+']"';
        arr.splice(regExpFunc.lastIndex - funcArray[0].length, funcArray[0].length, replaceVariable);
        str = arr.join('');
        regExpFunc.lastIndex = 0;
    }

    //log.debug('functions: ', myFunctions, ', str: ', str);
    callback(null, myFunctions, str);
}

function executeFunction(funcObj, quotedStrings, functions, callback){

    var funcName = funcObj.name;
    var parameters = [], functionDebug = [];

    async.eachOf(funcObj.parameters, function(parameter, index, callback){
        splitExpression(parameter, functions, quotedStrings, function(err, expr){
            if(err) return callback(err);

    //log.warn('!!! expr: ', expr);
            if(expr.length > 1) {
                return calc(parameter, expr, quotedStrings, functions, function(err, result) {
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
                var num = Number(parameter.substr('"function['.length, 1));
                var funcObj = {
                    type: 'func',
                    data: functions[num].str,
                    name: functions[num].name,
                    parameters: functions[num].parameters
                };
                return executeFunction(funcObj, quotedStrings, functions, function (err, debug) {
                    if (err) return callback(err);

                    if(typeof debug === 'object' ) {
                        functionDebug.push(debug);
                        parameters[index] = debug.result;
                    }
                    else parameters[index] = debug;

                    return callback();
                })
            }
        })
    }, function(err){
        if(err) return callback(err);

        calcFunction(funcName, parameters, function(err, debug) {
            if(err) return callback(err);

            functionDebug.push(debug);
            callback(null, debug.result, functionDebug);
        });
    });
}

function calcFunction(name, parameters, callback){
    if(name in calcFunctions) {
        try {
            return calcFunctions[name](parameters, function(err, result) {
                if(err) return callback(new Error('Function ' + name + '(' +
                    (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) +
                    ') returned error: ' + err.message));

                log.debug('Executing function name: ', name, ', parameters: ', parameters, ', result: ', result);
                return callback(null, {name: name, parameters: parameters, result: result});
            });
        } catch(err) {
            log.error('Error in ', name+ '('+ (parameters !== undefined && parameters.length ? parameters.join(',') : parameters) + '): ' + err.message);
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