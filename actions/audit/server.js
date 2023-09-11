/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const _log = require('../../lib/log');
const tasks = require('../../serverTask/tasks');

/**
 * Send message
 * @param {Object} args
 * @param {string} args.taskID taskID
 * @param {string} args.taskSessionID task session ID for add a new comment to the task
 * @param {string} args.sessionID action session ID for add a new comment to the action
 * @param {string} args.actionName action name
 * @param {string} args.modalComment auditor comment
 * @param {Object} args.actionCfg action configuration
 * @param {string} args.username username
 * @param {function(Error)|function(null, string)} callback callback(err, args.modalComment)
 */
module.exports = function(args, callback) {
    var sessionID = args.actionCfg.launcherPrms.sessionID;
    var log = _log({
        sessionID: sessionID,
        filename: __filename,
    });

    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    if(Number(args.taskID)) {
        log.info('User ', args.username, ' adding the comment: "', args.modalComment, '" for the taskID: ', args.taskID,
            '; taskSessionID: ', args.taskSessionID);


        if(Number(args.taskSessionID) !== parseInt(args.taskSessionID, 10) ||
            Number(args.taskSessionID) < 1) {
            return callback(new Error('Error add a new comment for the task to the auditDB: ' +
                'incorrect taskSessionID: ' +  args.taskSessionID + '; comment: ' + args.modalComment));
        }

        log.addTaskComment(Number(args.taskSessionID), args.modalComment, args.username);

        tasks.getWorkflow(args.username, function (err, workflows) {
            if(err) {
                return callback(new Error('Error get workflow for task ' + args.taskID + ' user ' + args.username +
                    ': ' + err.message));
            }

            workflows.forEach(workflow => {
                if(typeof workflow.message === 'object' && workflow.action === 'check') {
                    workflow.message.variables = {
                        CHECKER_COMMENT: args.modalComment.split('\n').join('<br/>'),
                    }
                }
            });
            tasks.processWorkflows(args.username, Number(args.taskID), workflows, 'check', null,
                function (err) {
                    if(err) {
                        return callback(new Error('Error process workflow for task ' + args.taskID +
                            ' user ' + args.username + ': ' + err.message + '; workflows: ' +
                            JSON.stringify(workflows, null, 4)), args.modalComment);
                    }
                    callback(null, args.modalComment);
                });
        });
    } else {
        log.info('User ', args.username, ' adding the comment: "', args.modalComment,
            '" for the action with sessionID: ', args.sessionID);

        if(Number(args.sessionID) !== parseInt(args.sessionID, 10) || Number(args.sessionID) < 1) {
            return callback(new Error('Error add a new comment for the action to the auditDB: incorrect sessionID: ' +
                args.sessionID + '; comment: ' + args.modalComment));
        }

        log.addActionComment(Number(args.sessionID), args.modalComment, args.username);
        callback(null, args.modalComment);
    }
}