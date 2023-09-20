/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var prepareUser = require('../lib/utils/prepareUser');
var actionRightsWrapper = require('../rightsWrappers/actions');
var log = require('../lib/log')(module);
var tasksDB = require('../models_db/tasksDB');
var tasksDBSave = require('../models_db/modifiers/tasksDB');
var countersDB = require('../models_db/countersDB');
var objectsDB = require('../models_db/objectsDB');
var usersDB = require('../models_DB/usersDB');
var transactionDB = require('../models_db/modifiers/transaction');
var checkIDs = require('../lib/utils/checkIDs');


var rightsWrapper = {};
module.exports = rightsWrapper;


rightsWrapper.getTasksGroupsList = tasksDB.getTasksGroupsList;

/**
 * Checking user rights for actions
 * @param {string} username username
 * @param {Array<string>} actionIDs array with action IDs (action dir names)
 * @param {null|"run"|"view"|"modify"} checkedRights checked rights
 * @param {function(Error)|function(null, Object)} callback callback(err, actionsRights), where actionsRights is an
 * object {<actionID>:  {view: 0|1, run: 0|1, makeTask: 0|1, audit: 0|1}, ... }
 */
rightsWrapper.checkActionsRights = function(username, actionIDs, checkedRights, callback) {
    username = prepareUser(username);

    if(!Array.isArray(actionIDs) || !actionIDs.length) {
        return callback(new Error('Error in actions specified for checking rights: ' +
            JSON.stringify(actionIDs, null, 4) ));
    }

    if(checkedRights) checkedRights = checkedRights.toLowerCase();
    if(checkedRights !== null && checkedRights !== 'run' && checkedRights !== 'view' && checkedRights !== 'modify') {
        return callback(new Error('Incorrect checked rights parameter "' + checkedRights + '" for check user "' +
            username + '" rights for actions ' + actionIDs.join(', ')));
    }

    if(!username) {
        return callback(new Error('Incorrect user name "'+username+'" for for check rights for actions ' +
            actionIDs.join(', ')));
    }

    var actionsRights = {};
    async.each(actionIDs, function (actionID, callback) {
        if(typeof actionID !== 'string') {
            return callback(new Error('Can\'t check rights for action ID "' + actionID +
                '", user "' + username + '": actionID is not a string in actions array ' + actionIDs.join(', ')));
        }

        actionRightsWrapper.checkActionRights(username, actionID, null,
            function (err, rights) {
            if (err) return callback(err);

            actionsRights[actionID] = rights;
            if(!checkedRights) return callback();

            if (!rights) {
                return callback(new Error('User "' + username + '" doesn\'t have rights for action ' + actionID));
            }
            if (checkedRights === 'view' && !rights.view) {
                return callback(new Error('User "' + username + '" doesn\'t have rights for view action ' + actionID));
            }
            if (checkedRights === 'modify' && (!rights.view || !rights.makeTask)) {
                return callback(new Error('User "' + username +
                    '" doesn\'t have rights for view or edit task for action' + actionID));
            }
            if (checkedRights === 'run' && !rights.run) {
                return callback(new Error('User "' + username + '" doesn\'t have rights for execute action ' +
                    actionID));
            }

            callback();
        });
    }, function(err) {
        if(err) return callback(err);
        callback(null, actionsRights);
    });
};

/**
 * Checking user rights for task
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {null|"run"|"view"|"modify"} checkedRights checked rights
 * @param {function(Error)|function(null, Object)} callback callback(err, actionsRights), where actionsRights is an
 * object {<actionID>:  {view: 0|1, run: 0|1, makeTask: 0|1, audit: 0|1}, ... } */
rightsWrapper.checkTaskRights = function(username, taskID, checkedRights, callback) {
    tasksDB.getTaskParameters(username, taskID, function (err, taskParameters) {
        if (err) return callback(err);

        // create list of unique actions IDs for checking user rights for tasks;
        var actionsIDs = {};
        taskParameters.forEach(function (prm) {
            actionsIDs[prm.actionID] = true;
        });

        rightsWrapper.checkActionsRights(username, Object.keys(actionsIDs), checkedRights, callback);
    });
};

/**
 * Get object with the task parameters
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Array<Object>, Array<Object>, Array<number>, Object, Object)} callback
 * callback(err, taskParameters, taskData, checkedOCIDs, counters, objects)
 * @example
 * taskParameters:  [{
 *      taskActionID: <id from tasksActions table>,
 *      name: <action parameter name>,
 *      value: <action parameter value>,
 *      actionID: <action ID (action dir)>,
 *      startupOptions: <startup options for action>,
 *      actionsOrder: <action order in the task>
 * }, ...]
 * taskData: [{
 *      id: <taskID>,
 *      name: <taskName>,
 *      timestamp: <taskCreatedTime>,
 *      group: <taskGroupName>,
 *      ownerName: <task creator login>,
 *      ownerFullName: <task creator full name>,
 *      runType: <task condition runType>,
 *      conditionTimestamp: <task condition timestamp>
 * }, ...]
 *
 * checkedOCIDs: [<OCID1>, <OCID2>, ....]
 *
 * counters: {
 *     <OCID>: <counterName>,
 *     ...
 * }
 *
 * objects: {
 *     <OCID>: <objectName>,
 *     ....
 * }
 */
rightsWrapper.getTaskParameters = function(username, taskID, callback) {

    if(!taskID) return callback(new Error('Undefined task ID for getting task parameters'));

    username = prepareUser(username);

    tasksDB.getTaskData(username, taskID, function(err, taskData) {
        if (err) return callback(err);
        if(!taskData.length) return callback(new Error('Can\'t find task ID: ' + taskID));

        tasksDB.getTaskParameters(username, taskID, function (err, taskParameters) {
            if (err) return callback(err);

            // create list of unique actions IDs for checking user rights for tasks;
            var actionsIDs = {};
            taskParameters.forEach(function (prm) {
                actionsIDs[prm.actionID] = true;
            });

            rightsWrapper.checkActionsRights(username, Object.keys(actionsIDs), 'modify',
                function (err) {
                if (err) return callback(err);

                // runType = 0: run permanently, runType=1: run once, runType=11: task was run once when the
                // condition is met
                if(taskData[0].runType !== 0 && taskData[0].runType !== 1 && taskData[0].runType !== 11)  {
                    return callback(err, taskParameters, taskData, []);
                }

                tasksDB.getRunConditionOCIDs(taskID, function (err, conditionsRows) {
                    if(err) {
                        return callback(new Error('Can\'t get condition OCIDs for taskID ' + taskID + ': ' +
                            err.message));
                    }

                    if(!conditionsRows.length) return callback(err, taskParameters, taskData, []);

                    var OCIDs = conditionsRows.map(function (row) {
                        return row.OCID;
                    });

                    var counters = {}, checkedOCIDs = [];
                    async.eachSeries(OCIDs, function (OCID, callback) {
                        countersDB.getCounterByOCID(OCID, function (err, rows) {
                            if(err || !rows.length) {
                                log.warn('Incorrect task run condition for taskID: ', taskID ,': counter for OCID ',
                                    OCID, ' not found or error ', err);
                            } else {
                                counters[OCID] = rows[0].name;
                                checkedOCIDs.push(OCID);
                            }
                            callback();
                        });
                    }, function () {

                        if(!checkedOCIDs.length) return callback(err, taskParameters, taskData, []);
                        objectsDB.getObjectsByOCIDs(checkedOCIDs, function (err, rows) {
                            if(err) return callback(new Error('Can\'t get objects names for OCIDs ' +
                                OCIDs.join(', ') + ': ' + err.message));

                            var objects = {};
                            rows.forEach(function (row) {
                                objects[row.OCID] = row.name;
                            });

                            callback(err, taskParameters, taskData, checkedOCIDs, counters, objects);
                        });
                    });
                });
            });
        });
    });
};

/**
 * Check rights and remove task with specific ID, if user has rights to it
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.removeTask = function(username, taskID, callback) {
    username = prepareUser(username);

    if(!username) return callback(new Error('Incorrect user name "'+username+'" for task ID "' + taskID + '"'));

    taskID = taskID ? Number(taskID) : undefined;
    if(!taskID) {
        return callback(new Error('Can\'t get actions for task with incorrect ID: ' + taskID));
    }

    tasksDB.getTaskActions(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get actions for task with ID "' + taskID + '": ' + err.message));

        var actionsIDs = rows.map(function(row) { return row.actionID} );

        rightsWrapper.checkActionsRights(username, actionsIDs, 'modify', function (err) {
            if (err) return callback(err);
            tasksDBSave.removeTask(taskID, callback);
        });
    })
};

/**
 * Add a new task
 * @param {string} username username
 * @param {Object} task object with the task parameters
 * @param {number} [task.taskID] task ID when update task
 * @param {number} [task.newTaskID] new task ID for a new task
 * @param {string|null} task.name task name (null for new unnamed task)
 * @param {number} task.groupID task group ID
 * @param {Array} task.actionsOrder array with task actions in order [taskActionID1, taskActionID2...]
 * @param {number} task.taskActionID task action ID
 * @param {Object} actions object with task actions (see example)
 * @param {function(Error)|function(null, number)} callback callback(err, taskID)
 * @example
 * actions:
 * {
 *     taskActionID1: {
 *         startupOptions: [0|1|2|3] // 0 - runOnPrevSuccess; 1 - runOnPrevUnSuccess; 2 - doNotWaitPrevious; 3 - runAnyway
 *         parameters: [{name:..., val:..}, {},...]
 *     },
 *     taskActionID2: {},
 *     ....
 * }
 */
rightsWrapper.addOrUpdateTask = function(username, task, actions, callback) {
    log.debug((task.taskID ? 'Updating task ' : 'Add a new task '), task, ', user: ', username,
        ', actions: ', actions);

    username = prepareUser(username);
    if (!username) return callback(new Error('Incorrect user name "' + username + '" for add new task'));

    if (!task.actionsOrder || !Array.isArray(task.actionsOrder) || !task.actionsOrder.length) {
        return callback(new Error('Incorrect actionsOrder "' + task.actionsOrder + '" for add new task'));
    }

    if (!task.name || typeof task.name !== 'string') task.name = null;

    if (task.groupID === undefined || task.groupID === null) {
        return callback(new Error('Undefined group ID for add new task'));
    }
    var groupID = Number(task.groupID);
    if (groupID === undefined || groupID !== parseInt(String(groupID), 10)) {
        return callback(new Error('Incorrect group ID "' + task.groupID + '" for add new task'));
    }


    tasksDB.getActionsIDs(task.actionsOrder, function(err, taskActionID2actionID) {
        if (err) {
            return callback(new Error('Can\'t get actions IDs by taskActionID IDs "' + task.actionsOrder + '": ' +
            err.message));
        }

        rightsWrapper.checkActionsRights(username, Object.values(taskActionID2actionID), 'modify',
            function (err) {
            if (err) return callback(err);

            usersDB.getID(username, function(err, userID) {
                if (err) return callback(new Error('Can\'t get userID for user "' + username + '": ' + err.message));
                if (userID === undefined) {
                    return callback(new Error('Can\'t get userID for user "' + username + '": no such user'));
                }

                var timestamp = Date.now();

                log.info((task.taskID ? 'Updating the task ' + task.taskID : 'Adding a new task ' + task.newTaskID),
                    ' name: "', task.name,'", user: ', username, ' , userID: ', userID, ', groupID: "', groupID,
                    '", timestamp: ', timestamp);

                /*
                For a new task, just insert the data for the new task
                When updating, we update the task data in order to save data with the task conditions.
                But for simplicity, we delete actions and parameters and save them again
                 */
                addOrUpdateTaskAndRemoveActions(task.taskID, task.newTaskID, userID, timestamp, task.name,
                    groupID, task.taskActionID, function(err, taskID) {
                    if (err) return callback(err);

                    var actionsOrder = {};
                    for(var i = 0; i < task.actionsOrder.length; i++) {
                        var taskActionID = task.actionsOrder[i];
                        actionsOrder[taskActionID] = i;
                    }

                    log.info('Processing actions with order: ', task.actionsOrder, '; task ID: ', taskID);

                    async.eachSeries(task.actionsOrder, function(taskActionID, callback) {
                        if (!actions[taskActionID]) {
                            return callback(new Error('Undefined action for taskActionID ' + taskActionID));
                        }

                        var startupOptions = actions[taskActionID].startupOptions;
                        if (startupOptions !== 0 && startupOptions !== 1 && startupOptions !== 2 && startupOptions !== 3) {
                            return callback(new Error('Incorrect startup options "'+startupOptions+
                                '" for action taskActionID "'+taskActionID+'"'));
                        }

                        if (!actions[taskActionID].args || !Object.keys(actions[taskActionID].args).length) {
                            return callback(new Error('Action parameters undefined for action taskActionID ' +
                                taskActionID));
                        }

                        log.info('Adding a new action for task ID ', taskID, ', taskActionID: ', taskActionID,
                            ', startupOptions: ', startupOptions, ', action order: ', actionsOrder[taskActionID]);
                        log.debug('Action parameters: ', actions[taskActionID]);

                        // when updating the task all task actions will be removed and will be added again
                        tasksDBSave.addAction(taskID, taskActionID2actionID[taskActionID], startupOptions,
                            actionsOrder[taskActionID],function(err, newTaskActionID) {
                            if (err) return callback(err);

                            log.info('Add parameters for task ID: ', taskID, ', new taskActionID: ', newTaskActionID);
                            log.debug('Task parameters: ', actions[taskActionID].args);

                            tasksDBSave.addParameters(newTaskActionID, actions[taskActionID].args, callback);
                        });
                    }, function (err) {
                        callback(err, taskID);
                    });
                });
            });
        });
    });
};

/**
 *
 * @param {number} taskID task ID
 * @param {number} newTaskID task ID for not existed task
 * @param {number} userID user ID
 * @param {number} timestamp time when the task was created
 * @param {string|null} taskName task name or null for a new unnamed task
 * @param {number} groupID task group ID
 * @param {number} taskActionID task action ID
 * @param {function(Error)|function(null, number)} callback callback(err, taskID)
 */
function addOrUpdateTaskAndRemoveActions(taskID, newTaskID, userID, timestamp, taskName, groupID, taskActionID, callback) {
    if(!taskID) {
        tasksDBSave.addTask(newTaskID, userID, timestamp, taskName, groupID,function(err) {
            if(err) {
                return callback(new Error('Can\'t insert a new task "' + taskName + '", userID "' + userID +
                    '", timestamp: "' + timestamp + '", groupID: "' + groupID + ', taskActionID: ' + taskActionID +
                    '": ' + err.message));
            }
            callback(null, newTaskID);
        });
        return;
    }

    tasksDBSave.updateTask(taskID, taskName, groupID, function (err) {
        if(err) {
            return callback(new Error('Can\'t update task ' + taskID + ' name: "' + taskName +
                '", groupID: "' + groupID + '", userID ' + userID + ': ' + err.message));
        }
        tasksDBSave.removeTaskActionsAndParameters(taskID, function (err) {
            if(err) {
                return callback(new Error('Can\'t remove actions for update task #' + taskID + '"' + taskName +
                    '", groupID: "' + groupID + '": ' + err.message));
            }
            callback(null, taskID);
        });
    });
}


/**
 * Save action to the task (when press yellow button to add action to the task). If new task is not found,
 * also create a new unnamed task
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {number} newTaskID new task ID
 * @param {string} actionID actionID (action dir)
 * @param {Object} args object with action parameters like {<name1>: <value1>, ...}
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.saveAction = function (username, taskID, newTaskID, actionID, args, callback) {
    username = prepareUser(username);

    log.info('Starting to save the action for the user: ', username, ', action: ', actionID);
    log.debug('args: ', args);
    usersDB.getID(username, function(err, userID) {
        if (err) return callback(new Error('Can\'t get userID for user "' + username + '": '+err.message));
        if (userID === undefined) {
            return callback(new Error('Can\'t get userID for user "' + username + '": no such user'));
        }

        tasksDB.getUnnamedTask(userID, function(err, taskID){
            if(err) return callback(err);

            if(!taskID) {
                transactionDB.begin(function(err){
                    if(err) {
                        return callback(new Error('Can\'t start transaction for add action ' + actionID +
                            ' to the new task: ' + err.message));
                    }

                    tasksDBSave.addTask(newTaskID, userID, Date.now(), null, 0,function (err) {
                        if (err) {
                            return transactionDB.rollback(new Error('Can\'t insert a new unnamed task for userID "'
                                + userID + ' for add action ' + actionID + ' : ' + err.message), callback);
                        }

                        tasksDBSave.addAction(newTaskID, actionID, 3, 0,
                            function(err, taskActionID) {
                            if (err) return transactionDB.rollback(err, callback);

                            tasksDBSave.addParameters(taskActionID, args, function(err){
                                if(err) return transactionDB.rollback(err, callback);

                                log.info('New task ', newTaskID, ', action ', actionID, ', taskActionID: ',
                                    taskActionID, ' successfully saved');

                                transactionDB.end(callback);
                            });
                        });
                    });
                });
            } else {
                // get actions from the task for set action order for a new action
                tasksDB.getTaskActions(taskID, function (err, taskActionsArr) {
                    if(err) {
                        return callback(new Error('Can\'t find the task with taskID ' + taskID + ': ' + err.message));
                    }

                    transactionDB.begin(function(err){
                        if(err) {
                            return callback(new Error('Can\'t start transaction for add new action ' + actionID +
                                ' to the task ' + taskID +': ' + err.message));
                        }

                        tasksDBSave.addAction(taskID, actionID, 3, taskActionsArr.length,
                            function (err, taskActionID) {

                            if (err) return transactionDB.rollback(err, callback);

                            tasksDBSave.addParameters(taskActionID, args, function (err) {
                                if (err) return transactionDB.rollback(err, callback);

                                log.info('Action ', actionID, ', taskActionID: ', taskActionID,
                                    ' successfully saved to the existing task ', taskID);
                                transactionDB.end(callback);
                            });
                        });
                    });
                })
            }
        });
    });
};

/**
 * Add run condition for the task
 * @param {number} taskID task ID
 * @param {0|1|11|2|12} runType 0 - run permanently, 1 - run once, 2 - run now
 * 11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
 * @param {Array<number>|string|number} OCIDs array of condition OCIDs or comma separated string or one OCID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.addRunCondition = function (taskID, runType, OCIDs, callback) {
    checkIDs(taskID, function(err, checkedTaskID) {
        if (err) {
            return callback(new Error('Invalid task ID: ' + taskID + ' while add or update task condition: ' +
                err.message));
        }

        /*
        0 - run permanently, 1 - run once, 2 - run now
        9 -
        11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
        1477236595310 = 01.01.2000
        */
        if(([0,1,2,11,12].indexOf(runType) === -1 && runType < 1477236595310) ||
            runType !== parseInt(String(runType), 10)) {
            if(runType === 9) return callback() // set scheduled task to run again
            return callback(new Error('Invalid runType (' + runType + ') while add or update condition for task ' + taskID));
        }

        addOrUpdateTaskCondition(checkedTaskID[0], runType, function(err) {
            if(err) return callback(err);

            if(!OCIDs) return callback();
            checkIDs(OCIDs, function (err, checkedOCIDs) {
                if (err && !OCIDs.length) {
                    return callback(new Error('Invalid OCIDs: ' + OCIDs + ' while add new task condition: ' +
                        err.message));
                }

                tasksDBSave.deleteRunConditionOCIDs(checkedTaskID[0], function (err) {
                    if(err) {
                        return callback(new Error('Can\'t delete old OCIDs for add a new task condition OCIDs for taskID' +
                            taskID + ', OCIDs: ' +  OCIDs + ': ' + err.message));
                    }

                    tasksDBSave.addRunConditionOCIDs(checkedTaskID[0], checkedOCIDs, function (err) {
                        if(err) {
                            return callback(new Error('Can\'t add new task condition OCIDs for taskID' + taskID +
                                ', OCIDs: ' +  OCIDs + ': ' + err.message));
                        }

                        callback();
                    });
                })
            });
        })
    });
};

/**
 * Add or update task condition
 * @param {number} taskID taskID
 * @param {0|1|11|2|12} runType 0 - run permanently, 1 - run once, 2 - run now
 * 11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
 * @param {function(Error)|function()} callback callback(err)
 */
function addOrUpdateTaskCondition(taskID, runType, callback) {
    log.info('For task ID ', taskID, ' save runType: ', runType, ' into the database');

    tasksDBSave.addRunCondition(taskID, runType, function(err) {
        if(!err) return callback();

        var insertErr = err;
        if (err) {
            tasksDBSave.updateRunCondition(taskID, runType, function(err) {
                if(err) {
                    return callback(new Error('Can\'t add or update task condition for taskID ' + taskID +
                        ', runType: ' + runType + ', insert error: ' + insertErr.message + '; update error: ' +
                        err.message));
                }
                callback();
            });
        }
    });
}

/**
 * Delete run condition for the task
 * @param {number} taskID task ID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.deleteRunCondition = function (taskID, callback) {
    tasksDBSave.deleteRunCondition(taskID, function (err) {
        if(err) {
            return callback(new Error('Can\'t delete task run condition for taskID: ' + taskID + ': ' + err.message));
        }

        tasksDBSave.deleteRunConditionOCIDs(taskID, function (err) {
            if(err) return callback(new Error('Can\'t delete task run condition OCIDs for taskID: ' + taskID + ': ' +
                err.message));
            callback();
        });
    });
};

/**
 * Approve the task
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.approveTask = function (username, taskID, callback) {
    checkTaskRightsForExecution(username, taskID, function (err, userID) {
        if(err) return callback(err);

        tasksDBSave.approveTask(taskID, userID, function(err) {
            if(err) return callback(new Error('Can\'t approve task ID ' + taskID + ', user ' + username + ': ' +
                err.message));
            callback();
        });
    });
};

/**
 * Cancel the task approve
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.cancelTask = function (username, taskID, callback) {
    checkTaskRightsForExecution(username, taskID, function (err, userID) {
        if(err) return callback(err);

        tasksDBSave.cancelTask(taskID, userID, function(err) {
            if(err) return callback(new Error('Can\'t cancel task ID ' + taskID + ', user ' + username + ': ' +
                err.message));
            callback();
        });
    });
};

/**
 * Check the task rights for execute the task
 * @param {string} username username
 * @param {number} taskID task ID
 * @param {function(Error)|function(Error, number)} callback callback(err, userID)
 */
function checkTaskRightsForExecution(username, taskID, callback) {
    username = prepareUser(username);
    checkIDs(taskID, function(err, checkedTaskID) {
        if (err) {
            return callback(new Error('Invalid task ID: ' + taskID + ' while approve or cancel task: ' + err.message));
        }

        usersDB.getID(username, function (err, userID) {
            if(err) return callback(err);
            tasksDB.getTaskActions(checkedTaskID[0], function (err, rows) {
                if(err) {
                    return callback(new Error('Can\'t get actions for task ID ' + checkedTaskID[0] +
                        ': ' + err.message));
                }

                var actionsIDs = rows.map(function (row) {
                    return row.actionID;
                });

                rightsWrapper.checkActionsRights(username, actionsIDs, 'run', function (err) {
                    callback(err, userID);
                });
            });
        });
    });
}

/**
 * Get run condition OCIDs for the task
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Array<Object>)} callback callback(err, rows) where rows is
 * [{OCID: …}, {OCID: …}, ..]
 */
rightsWrapper.getRunConditionOCIDs = function(taskID, callback) {
    return tasksDB.getRunConditionOCIDs(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get task condition OCIDs for task ID: ' + taskID +
            ': ' + err.message));
        callback(null, rows);
    });
};

/**
 * Get the task condition parameters
 * @param {number} taskID task ID
 * @param {function(Error)|function(null, Array<{taskID:number, timestamp:number, runType:1|11|2|12, userApproved:number,
 * userCanceled:number}>)} callback callback(err, rows) where rows is
 * [{taskID:… , timestamp:… , runType:{1|11|2|12}, userApproved:<userID>, userCanceled:<userID>}, {}, ..]
 */
rightsWrapper.getTaskConditions = function(taskID, callback) {
    return tasksDB.getTaskConditions(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get task conditions for task ID: ' + taskID + ': ' + err.message));
        if(!rows.length) {
            return callback(new Error('Can\'t get task conditions for task ID: ' + taskID + ': task not exist'));
        }
        callback(null, rows);
    });
};

/**
 * Remove the task approval
 * @param {number} taskID task ID
 * @param {function(Error)|function()} callback callback(err)
 */
rightsWrapper.removeApproval = function (taskID, callback) {
    tasksDBSave.removeApproval(taskID, function (err) {
        if(err) return callback(new Error('Can\'t remove approval from task ID ' + taskID + ': ' + err.message));
        callback();
    });
};