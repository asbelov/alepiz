/*
 * Copyright (C) 2015. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var collector = {};

collector.get = function(prms, callback) {
	var result;
    
    try { 
        result = eval(prms.javascript); 
    }
    catch(err) { 
        return callback(err); 
    }
    callback(null, result);
};

module.exports = collector;