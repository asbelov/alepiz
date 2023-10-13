//var log = require('../../lib/log')(module);
const taskServer = require('../../serverTask/taskClient');

const Conf = require('../../lib/conf');
const conf = new Conf('config/common.json');
const systemUser = conf.get('systemUser') || 'system';

var collector = {};
module.exports = collector;

/**
 * Run the task
 * @param {Object} param collector parameters
 * @param {number} param.taskID task ID (from the Task maker action)
 * @param {string} param.runOnLocalNode - Run the task only on a local instance of Alepiz
 * @param {Object} param.$variables variables
 * @param {function(Error)|function(null, string)} callback callback(err, <stringified taskResult>)
 */
collector.get = function(param, callback) {

    var taskID = parseInt(String(param.taskID), 10);
    if(!taskID || taskID < 1) return callback(new Error('Incorrect task ID ' + param.taskID));

    /*
    result: hostPort1: {
        taskActionID1: actionData1,
        taskActionID1: actionData2,
        ...
    },
    hostPort2: {
        taskActionID1: actionData1,
        taskActionID1: actionData2,
        ...
    }
     */
    taskServer.runTask({
        userName: systemUser,
        taskID: taskID,
        variables: param.$variables,
        runTaskFrom: 'collector:task-runner',
        runOnLocalNode: !!param.runOnLocalNode,
    }, function(err, result) {
		if(err) return callback(err);

		callback(null, typeof result === 'object' ? JSON.stringify(result) : result.toString());
    });
};