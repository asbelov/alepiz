//var log = require('../../lib/log')(module);
var tasks = require('../../lib/tasks');

var conf = require('../../lib/conf');
conf.file('config/conf.json');
var systemUser = conf.get('systemUser') || 'system';

var collector = {};
module.exports = collector;
/*
    get data and return it to server

    prms - object with collector parameters {
        <parameter1>: <value>,
        <parameter2>: <value>,
        ....
        $id: <objectCounterID>,
        $variables: {
            <variable1>: <variableValue1>,
            <variable2>: <variableValue2>,
            ...
        }; // all variables from counter
    }

    where
    $id - objectCounter ID
    $variables - variables for collector from counter settings

    callback(err, result)
    result - object {timestamp: <timestamp>, value: <value>} or simple value
*/

collector.get = function(prms, callback) {

    var taskID = parseInt(prms.taskID, 10);
    if(!taskID) return callback(new Error('Incorrect task ID "' + prms.taskID + '" for running task'));

    /*
    result: {
        sessionID1: actionData1,
        sessionID2: actionData2,
        ...
    }
     */
	tasks.runTask({
        userName: systemUser,
        taskID: taskID,
        variables: prms.$variables,
    }, function(err, result) {
		if(err) return callback(err);

		try {
			return callback(null, JSON.stringify(result));
        } catch(err) {
			return callback(null, result);
        }
    });
};
