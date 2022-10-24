//var log = require('../../lib/log')(module);
const taskServer = require('../../serverTask/taskServerClient');

var Conf = require('../../lib/conf');
const conf = new Conf('config/common.json');
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
        taskActionID1: actionData1,
        taskActionID1: actionData2,
        ...
    }
     */
    taskServer.runTask({
        userName: systemUser,
        taskID: taskID,
        variables: prms.$variables,
        runTaskFrom: 'server',
    }, function(err, result) {
		if(err) return callback(err);

		callback(null, typeof result === 'object' ? JSON.stringify(result) : result.toString());
    });
};