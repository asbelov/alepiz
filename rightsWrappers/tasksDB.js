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
var sessionDB = require('../models_db/modifiers/auditUsersDB');
var checkIDs = require('../lib/utils/checkIDs');


var rightsWrapper = {};
module.exports = rightsWrapper;


rightsWrapper.getTasksGroupsList = tasksDB.getTasksGroupsList;

/*
Checking user rights for actions

initUser: user name
actionsIDs: array of actions IDs
checkedRights: null, 'view', 'modify', 'run'

callback(err); if(err, actionsRights) then no rights for task
 */
rightsWrapper.checkActionsRights = function(initUser, actionsIDs, checkedRights, callback) {
    var user = prepareUser(initUser);

    if(!actionsIDs || !actionsIDs.length) return callback(new Error('No actions specified for checking rights'));

    if(checkedRights) checkedRights = checkedRights.toLowerCase();
    if(checkedRights !== null && checkedRights !== 'run' && checkedRights !== 'view' && checkedRights !== 'modify')
        return callback(new Error('Incorrect checked rights parameter "'+checkedRights+'" for check user "' + user +
            '" rights for actions "' + JSON.stringify(actionsIDs) + '"'));

    if(!user) {
        return callback(new Error('Incorrect user name "'+initUser+'" for for check rights for actions "' +
            JSON.stringify(actionsIDs) + '"'));
    }

    var actionsRights = {};
    async.each(actionsIDs, function (actionID, callback) {
        if(typeof actionID !== 'string') callback(new Error('Can\'t check rights for action ID "' + actionID +
            '", user "' + user + '": actionID is not a string in actions array ' + JSON.stringify(actionsIDs)));

        actionRightsWrapper.checkActionRights(user, actionID, null, function (err, rights) {
            if (err) return callback(err);

            actionsRights[actionID] = rights;
            if(!checkedRights) return callback();

            if (!rights) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for action ' + actionID));
            }
            if (checkedRights === 'view' && !rights.view) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for view action ' + actionID));
            }
            if (checkedRights === 'modify' && (!rights.view || !rights.makeTask)) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for view or edit task for action' +
                    actionID));
            }
            if (checkedRights === 'run' && !rights.run) {
                return callback(new Error('User "' + user + '" doesn\'t have rights for execute action ' + actionID));
            }

            callback();
        });
    }, function(err) {
        if(err) return callback(err);
        callback(null, actionsRights);
    });
};

/*
Checking user rights for task

initUser: user name
taskID: task ID
checkedRights: null, 'view', 'modify', 'run'

callback(err, actionsRights); if(err) then no rights for task
 */
rightsWrapper.checkTaskRights = function(initUser, taskID, checkedRights, callback) {
    tasksDB.getTaskParameters(initUser, taskID, function (err, taskParameters) {
        if (err) return callback(err);

        // create list of unique actions IDs for checking user rights for tasks;
        var actionsIDs = {};
        taskParameters.forEach(function (prm) {
            actionsIDs[prm.actionID] = true;
        });

        rightsWrapper.checkActionsRights(initUser, Object.keys(actionsIDs), checkedRights, callback);
    });
};

rightsWrapper.getTaskParameters = function(initUser, taskID, callback) {

    if(!taskID) return callback(new Error('Undefined task ID for getting task parameters'));

    var user = prepareUser(initUser);

    tasksDB.getTaskData(user, taskID, function(err, taskData) {
        if (err) return callback(err);
        if(!taskData.length) return callback(new Error('Can\'t find task ID: ' + taskID));

        tasksDB.getTaskParameters(user, taskID, function (err, taskParameters) {
            if (err) return callback(err);

            // create list of unique actions IDs for checking user rights for tasks;
            var actionsIDs = {};
            taskParameters.forEach(function (prm) {
                actionsIDs[prm.actionID] = true;
            });

            rightsWrapper.checkActionsRights(initUser, Object.keys(actionsIDs), 'modify',
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

/*
    Check rights and remove task with specific ID, if user has rights to it

    initUser: user name
    taskIDL task ID

    callback(err)
 */
rightsWrapper.removeTask = function(initUser, taskID, callback) {
    var user = prepareUser(initUser);

    if(!user) return callback(new Error('Incorrect user name "'+initUser+'" for task ID "' + taskID + '"'));

    taskID = taskID ? Number(taskID) : undefined;
    if(!taskID) {
        return callback(new Error('Can\'t get actions for task with incorrect ID "' + taskID + '": ' + err.message));
    }

    tasksDB.getTaskActions(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get actions for task with ID "' + taskID + '": ' + err.message));

        var actionsIDs = rows.map(function(row) { return row.actionID} );

        rightsWrapper.checkActionsRights(initUser, actionsIDs, 'modify', function (err) {
            if (err) return callback(err);
            tasksDBSave.removeTask(taskID, callback);
        });
    })
};

/*
Add a new task

task: { name: .., groupID:.., actionsOrder:[sessionID1, sessionID2...]}
actions: {
    sessionID1: {
        startupOptions: [0|1|2] // 0 - runOnPrevSuccess; 1 - runOnPrevUnSuccess; 2 - doNotWaitPrevious
        parameters: [{name:..., val:..}, {},...]
    },
    sessionID2: {},
    ....
}
callback(err)
 */

rightsWrapper.addTask = function(initUsername, task, actions, callback) {
    log.info('Add task ', task, ', user: ', initUsername, ', actions: ', actions);

    var username = prepareUser(initUsername);
    if (!username) return callback(new Error('Incorrect user name "' + initUsername + '" for add new task'));

    if (!task.actionsOrder || !Array.isArray(task.actionsOrder) || !task.actionsOrder.length) {
        return callback(new Error('Incorrect actionsOrder "'+ task.actionsOrder + '" for add new task'));
    }

    if (!task.name || typeof task.name !== 'string') task.name = null;

    if (task.groupID === undefined || task.groupID === null) {
        return callback(new Error('Undefined group ID for add new task'));
    }
    var groupID = Number(task.groupID);
    if (groupID === undefined || groupID !== parseInt(String(groupID), 10)) {
        return callback(new Error('Incorrect group ID "'+task.groupID+'" for add new task'));
    }


    tasksDB.getActionsIDs(task.actionsOrder, function(err, actionsToSessionsID) {
        if (err) return callback(new Error('Can\'t get actions IDs by sessions IDs "' + task.actionsOrder + '"'));

        var actionsIDs = actionsToSessionsID.map(function(action) { return action.actionID});

        rightsWrapper.checkActionsRights(initUsername, actionsIDs, 'modify', function (err) {
            if (err) return callback(err);

            usersDB.getID(username, function(err, userID) {
                if (err) return callback(new Error('Can\'t get userID for user "' + username + '": ' + err.message));
                if (userID === undefined) return callback(new Error('Can\'t get userID for user "' + username + '": no such user'));

                var timestamp = Date.now();

                log.info((task.taskID ? 'Updating' : 'Add a new '), ' task with name: "', task.name, '", userID: "',
                    userID, '", groupID: "', groupID, '", timestamp: ', timestamp);

                /*
                For a new task, just insert the data for the new task
                When updating, we update the task data in order to save data with the task conditions.
                But for simplicity, we delete actions and parameters and save them again
                 */
                addOrUpdateTask(task.taskID, userID, timestamp, task.name, groupID, task.sessionID,
                    function(err, taskID) {
                    if (err) return callback(err);

                    var actionsOrder = {};
                    for(var i = 0; i < task.actionsOrder.length; i++) {
                        var sessionID = task.actionsOrder[i];
                        actionsOrder[sessionID] = i;
                    }

                    log.info('Processing actions with order: ', task.actionsOrder, '; task ID is ', taskID);

                    async.eachSeries(task.actionsOrder, function(sessionID, callback) {
                        if (!actions[sessionID]) {
                            return callback(new Error('Undefined action for sessionID ' + sessionID));
                        }

                        var startupOptions = actions[sessionID].startupOptions;
                        if (startupOptions !== 0 && startupOptions !== 1 && startupOptions !== 2) {
                            return callback(new Error('Incorrect startup options "'+startupOptions+
                                '" for action sessionID "'+sessionID+'"'));
                        }

                        if (!actions[sessionID].args || !Object.keys(actions[sessionID].args).length) {
                            return callback(new Error('Action parameters undefined for action sessionID ' +
                                sessionID));
                        }

                        log.info('Adding a new action for task ID ', taskID, ', sessionID: ', sessionID,
                            ', startupOptions: ', startupOptions, ', action order: ', actionsOrder[sessionID],
                            ', action parameters: ', actions[sessionID]);
                        addNewSessionID(userID, sessionID, actions[sessionID].id, actions[sessionID].name, timestamp,
                            actions[sessionID].addNewSessionID, function(err) {
                            if (err) return callback(err);

                            tasksDBSave.addAction(taskID, sessionID, startupOptions, actionsOrder[sessionID],
                                function(err, actionID) {
                                if (err) return callback(err);

                                log.info('Add parameters for task ID: ', taskID, ', actionID: ', actionID, ', params: ',
                                    actions[sessionID].args);
                                tasksDBSave.addParameters(actionID, actions[sessionID].args, callback);
                            });
                        });
                    }, function (err) {
                        callback(err, taskID);
                    });
                });
            });
        });
    });

    function addNewSessionID(userID, sessionID, actionID, actionName, timestamp, doIt, callback) {
        if(!doIt) return callback();

        sessionDB.addNewSessionID(userID, sessionID, actionID, actionName, timestamp, function(err) {
            if(err) {
                return callback(new Error('Error while inserting new session "'+sessionID+'", for action ID "' +
                    actionID+'" and action name "'+actionName+'" into the auditUsers table: ' + err.message));
            }
            log.info('Adding a new session "'+sessionID+'", for action ID "'+actionID+'" and action name "' +
                actionName+'" into the auditUsers table');
            callback();
        });
    }

    function addOrUpdateTask(taskID, userID, timestamp, name, groupID, sessionID, callback) {
        if(!taskID) {
            tasksDBSave.addTask(userID, timestamp, name, groupID, sessionID, function(err, taskID) {
                if(err) {
                    return callback(new Error('Can\'t insert a new task "' + name + '", userID "' + userID +
                        '", timestamp: "' + timestamp + '", groupID: "' + groupID + ', sessionID: '+ sessionID +
                        '": ' + err.message));
                }
                callback(null, taskID);
            });
            return;
        }

        tasksDBSave.updateTask(userID, taskID, name, groupID, function (err) {
            if(err) {
                return callback(new Error('Can\'t update task #' + taskID + '"' + name +
                    '", groupID: "' + groupID + '": ' + err.message));
            }
            tasksDBSave.removeTaskActionsAndParameters(taskID, function (err) {
                if(err) {
                    return callback(new Error('Can\'t remove actions for update task #' + taskID + '"' + name +
                        '", groupID: "' + groupID + '": ' + err.message));
                }
                callback(null, taskID);
            });
        });
    }
};

rightsWrapper.saveAction = function (username, args, callback) {
    username = prepareUser(username);
    var sessionID = args.sessionID;

    log.info('Starting to save the action for the user: ', username, ', sessionID: ', sessionID, ', args: ', args);
    usersDB.getID(username, function(err, userID) {
        if (err) return callback(new Error('Can\'t get userID for user "' + username + '": '+err.message));
        if (userID === undefined) return callback(new Error('Can\'t get userID for user "' + username + '": no such user'));

        tasksDB.getUnnamedTask(userID, function(err, taskID){
            if(err) return callback(err);

            if(!taskID) {
                transactionDB.begin(function(err){
                    if(err) {
                        return callback(new Error('Can\'t start transaction for add new task into the database: ' +
                            err.message));
                    }

                    var timestamp = new Date().getTime();
                    tasksDBSave.addTask(userID, timestamp, null, 0, sessionID,
                        function (err, taskID) {
                        if (err) {
                            return transactionDB.rollback(new Error('Can\'t insert a new unnamed task for userID "'
                                + userID + ': ' + err.message), callback);
                        }

                        tasksDBSave.addAction(taskID, sessionID, 0, 0,
                            function(err, actionID) {
                            if (err) return transactionDB.rollback(err, callback);

                            tasksDBSave.addParameters(actionID, args, function(err){
                                if(err) return transactionDB.rollback(err, callback);
                                log.info('New task ', taskID, ' and action ', sessionID, ' successfully saved');
                                transactionDB.end(callback);
                            });
                        });
                    });
                });
            } else {
                transactionDB.begin(function(err){
                    if(err) {
                        return callback(new Error('Can\'t start transaction for add new task into the database: ' +
                            err.message));
                    }

                    tasksDBSave.addAction(taskID, sessionID, null, null,
                        function(err, actionID) {
                        if (err) return transactionDB.rollback(err, callback);

                        tasksDBSave.addParameters(actionID, args, function(err) {
                            if(err) return transactionDB.rollback(err, callback);
                            log.info('Action ', sessionID, ' successfully added to task ', taskID);
                            transactionDB.end(callback);
                        });
                    });
                });
            }
        });
    });
};

rightsWrapper.addRunCondition = function (taskID, runType, OCIDs, callback) {
    checkIDs(taskID, function(err, checkedTaskID) {
        if (err) {
            return callback(new Error('Invalid task ID: ' + taskID + ' while add or update task condition: ' +
                err.message));
        }

        /*
        0 - run permanently, 1 - run once, 2 - run now
        11 - run once task has already started, 12 - run now already started, <timestamp> - run by time
        // 1477236595310 = 01.01.2000
        */
        if(([0,1,2,10,11,12].indexOf(runType) === -1 && runType < 1477236595310) || runType !== parseInt(String(runType), 10)) {
            return callback('Invalid runType (' + runType + ') while add or update condition for task ' + taskID);
        }

        addOrUpdateTaskCondition(checkedTaskID[0], runType, function(err) {
            if(err) return callback(err);

            // return timeToRun
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

    function addOrUpdateTaskCondition(taskID, runType, callback) {
        log.info('For task ID ', taskID, ' set runType: ', runType);
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
};

rightsWrapper.deleteRunCondition = function (taskID, callback) {
    tasksDBSave.deleteRunCondition(taskID, function (err) {
        if(err) return callback(new Error('Can\'t delete task run condition for taskID: ' + taskID + ': ' + err.message));

        tasksDBSave.deleteRunConditionOCIDs(taskID, function (err) {
            if(err) return callback(new Error('Can\'t delete task run condition OCIDs for taskID: ' + taskID + ': ' +
                err.message));
            callback();
        });
    });
};

rightsWrapper.approveTask = function (userName, taskID, callback) {
    checkTaskRightsForExecution(userName, taskID, function (err, userID) {
        if(err) return callback(err);

        tasksDBSave.approveTask(taskID, userID, function(err) {
            if(err) return callback(new Error('Can\'t approve task ID ' + taskID + ', user ' + userName + ': ' +
                err.message));
            callback();
        });
    });
};

rightsWrapper.cancelTask = function (userName, taskID, callback) {
    checkTaskRightsForExecution(userName, taskID, function (err, userID) {
        if(err) return callback(err);

        tasksDBSave.cancelTask(taskID, userID, function(err) {
            if(err) return callback(new Error('Can\'t cancel task ID ' + taskID + ', user ' + userName + ': ' +
                err.message));
            callback();
        });
    });
};

function checkTaskRightsForExecution(userName, taskID, callback) {
    userName = prepareUser(userName);
    checkIDs(taskID, function(err, checkedTaskID) {
        if (err) {
            return callback(new Error('Invalid task ID: ' + taskID + ' while approve or cancel task: ' + err.message));
        }

        usersDB.getID(userName, function (err, userID) {
            if(err) return callback(err);
            tasksDB.getTaskActions(checkedTaskID[0], function (err, rows) {
                if(err) {
                    return callback(new Error('Can\'t get actions for task ID ' + checkedTaskID[0] + ': ' + err.message));
                }

                var actionsIDs = rows.map(function (row) {
                    return row.actionID;
                });

                rightsWrapper.checkActionsRights(userName, actionsIDs, 'run', function (err) {
                    callback(err, userID);
                });
            });
        });
    });
}

rightsWrapper.markTaskCompleted = function (taskID, callback) {
    if(!Number(taskID) || Number(taskID) !== parseInt(String(taskID), 10)) {
        return callback(new Error('Can\'t mark task ID ' + taskID + ' completed: Invalid taskID'));
    }

    tasksDBSave.updateRunCondition(Number(taskID), 11, function(err) {
        if(err) return callback(new Error('Can\'t mark task ID ' + taskID + ' completed: ' + err.message));
        callback();
    });
};

rightsWrapper.getRunConditionOCIDs = function(taskID, callback) {
    return tasksDB.getRunConditionOCIDs(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get task condition OCIDs for task ID: ' + taskID + ': ' + err.message));
        callback(null, rows);
    });
};

rightsWrapper.getTaskConditions = function(taskID, callback) {
    return tasksDB.getTaskConditions(taskID, function(err, rows) {
        if(err) return callback(new Error('Can\'t get task conditions for task ID: ' + taskID + ': ' + err.message));
        if(!rows.length) {
            return callback(new Error('Can\'t get task conditions for task ID: ' + taskID + ': task not exist'));
        }
        callback(null, rows);
    });
};

rightsWrapper.removeApproval = function (taskID, callback) {
    tasksDBSave.removeApproval(taskID, function (err) {
        if(err) return callback(new Error('Can\'t remove approval from task ID ' + taskID + ': ' + err.message));
        callback();
    });
};