/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-12-18 17:30:07
*/

var collector = {};
module.exports = collector;

var fs = require('fs');
var log = require('../../lib/log')(module);

var maxFileSize = 1048576; // 1MB
/*
    get data and return it to server

    param - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $counterID: <counterID>,
        $objectID: <objectID>,
        $parentID: <parentObjectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }
    }

    where
    $id - objectCounter ID
    $counterID - counter ID,
    $objectID - object ID
    $parentID - parent objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

collector.get = function(param, callback) {

    if(!param.fileName || !param.regExp) {
        return callback(new Error('Incorrect parameters: fileName: ' + param.fileName + '; regExp: ' + param.regExp));
    }
    try {
        var re = new RegExp(param.regExp, 'igms');
    } catch(e) {
        return callback(new Error('Incorrect regExp: ' + param.regExp + ': ' + e.message));
    }
    // removes whitespace from both ends of a string
    param.fileName = param.fileName.trim();
    
    fs.stat(param.fileName, function(err, stat) {
        if(err) {
            if(!param.dontLogErrors) log.warn('Can\'t stat file ' + param.fileName + ': ' + err.message);
            return callback();
        }
        if(!stat.isFile()) {
            if(!param.dontLogErrors) log.warn('Not a file: ' + param.fileName);
            return callback();
        }
       
        if(stat.size > maxFileSize || stat.size === 0) {
            return callback(new Error('Size of the file ' + param.fileName + ' is too big or zero: ' +
                Math.round(stat.size / 1024 / 1024) + 'MB'));
        }
        fs.readFile(param.fileName, 'utf8', function(err, data) {
			if(err) {
                if(!param.dontLogErrors) log.warn('Can\'t open file ' + param.fileName + ': ' + err.message);
			    return callback();
            }
            
            var result = data.replace(re, '$1');
            callback(null, result);
	    });
    });
};
