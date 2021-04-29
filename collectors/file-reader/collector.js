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

    prms - object with collector parameters {
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

collector.get = function(prms, callback) {

    if(!prms.fileName || !prms.regExp) {
        return callback(new Error('Incorrect parameters fileName: ' + prms.fileName + '; regExp: ' + prms.regExp));
    }
    try {
        var re = new RegExp(prms.regExp, 'igms');
    } catch(e) {
        return callback(new Error('Incorrect regExp: ' + prms.regExp + ': ' + e.message));
    }
    // removes whitespace from both ends of a string
    prms.fileName = prms.fileName.trim();
    
    fs.stat(prms.fileName, function(err, stat) {
        if(err) return callback(new Error('Can\'t stat file ' + prms.fileName + ': ' + err.message));
        if(!stat.isFile()) return callback(new Error('Not a file: ' + prms.fileName));
       
        if(stat.size > maxFileSize || stat.size === 0) {
            return callback(new Error('Size of the file ' + prms.fileName + ' is too big or zero: ' +
                Math.round(stat.size / 1024 / 1024) + 'MB'));
        }
        fs.readFile(prms.fileName, 'utf8', function(err, data) {
			if(err) return callback(new Error('Can\'t open file ' + prms.fileName + ': ' + err.message));
            
            var result = data.replace(re, '$1');
            callback(null, result);
	    });
    });
};
