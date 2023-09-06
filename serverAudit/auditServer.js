/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const threads = require('../lib/threads');
const auditDB = require('./auditDB');
const auditCreateDB = require('./auditCreateDB');
const usersDB = require('../models_db/usersDB');
const getAuditData = require('./getAuditData');
const actionsConf = require('../lib/actionsConf');
const Conf = require('../lib/conf');
const tasksDB = require('../models_db/tasksDB');

const conf = new Conf('config/common.json');
var systemUser = conf.get('systemUser') || 'system';

const dbPath = threads.workerData && threads.workerData[0];
var sessions = new Map();

// Initializing the audit server
// printing cache info and clearing deleted sessions from the cache every 5 minutes
setInterval(function () {
    var now = Date.now();
    var sessionsRemoved = 0;
    var sessionsForRemove = 0;
    sessions.forEach((sessionObj, sessionID) => {
        if(sessionObj.deleted) {
            ++sessionsForRemove;
            if (now - sessionObj.deleted > 3600000) {
                ++sessionsRemoved;
                sessions.delete(sessionID);
            }
        }
    });
    log.info('Sessions in the cache: ', sessions.size, '; ', sessionsRemoved,
        ' deleted sessions has been cleared; ', sessionsForRemove,
        ' sessions have been marked for deletion in the future');
}, 300000);


auditDB.dbOpen(dbPath, false, function (err, db) {
    if(err) return log.throw('Can\'t open audit DB: ' + err.message);

    auditCreateDB(db, function (err) {
        if(err) log.error(err.message);

        new threads.child({
            module: 'auditDB',
            onMessage: onMessage,
            onStop: auditDB.close,
            onDestroy: auditDB.close,
            simpleLog: true,
        });

        log.info('Audit server started: ', dbPath);
    });
});

/**
 * Processing messages from actionClient
 * @param {Object} messageObj
 * @param {function(Error)|function(null, object)} callback callback(err, returnedMessage), where returned message is
 *    message which returned from auditDB
 */
function onMessage (messageObj, callback) {
    if (!messageObj || typeof messageObj !== 'object') return;

    log.debug('Receive message: ', messageObj);

    if (messageObj.messageBody) {
        addNewRecord(messageObj);
    } else if (messageObj.auditData === 'logRecords') {
        getAuditData.getLogRecords(messageObj, callback);
    } else if (messageObj.auditData === 'sessions') {
        getAuditData.getSessions(messageObj, callback);
    } else if (messageObj.auditData === 'usersAndActions') {
        getAuditData.getUsersAndActions(callback);
    } else if (messageObj.username !== undefined && !sessions.has(messageObj.sessionID)) {
        sessions.set(messageObj.sessionID, messageObj);
        callback();
    } else if (messageObj.stopTimestamp) {
        addSessionResult(messageObj);
    } else if (messageObj.taskComment) {
        addTaskComment(messageObj);
    } else if (messageObj.actionComment) {
        addActionComment(messageObj);
    } else {
        return callback(new Error('Unreachable message ' + JSON.stringify(messageObj, null, 4)));
    }
}

/**
 * Add a new audit log record
 * @param {Object} messageObj object with data for create a new audit record
 * @param {number} messageObj.sessionID sessionID
 * @param {number} messageObj.timestamp timestamp
 * @param {number} messageObj.level character code for the level of the message ("D", "I", "W", "E")
 * @param {string} messageObj.label message label
 * @param {string} messageObj.messageBody message
 * @param {Object} [messageObj.options] log options
 * @param {Object} messageObj.cfg log configuration
 * @param {Boolean} messageObj.cfg.auditSystemTasks when true, then log of the tasks, running from the server
 * will be also add to audit
 */
function addNewRecord(messageObj) {
    var sessionObj = sessions.get(messageObj.sessionID);
    if(!sessionObj) {
        log.debug('The session ', messageObj.sessionID ,' not found for ', messageObj.messageBody)
        return;
    }

    if(!messageObj.cfg.auditSystemTasks && sessionObj.username === systemUser) {
        sessions.delete(messageObj.sessionID);
        log.debug('Don\'t add system task ', messageObj.messageBody, sessionObj)
        return;
    }

    addNewSession(sessionObj, function (err) {
        if(err) return log.error(err.message);

        try {
            auditDB.insertRecord(messageObj);
            log.debug('Added a new record: ', messageObj.messageBody);
        } catch (err) {
            log.error('Can\'t insert message: ', err.message, ': ', messageObj);
        }
    });
}

/**
 * Add a new session
 * @param {Object} sessionObj  sessionObj for add a new sessionID
 * @param {string} sessionObj.username username
 * @param {number} sessionObj.userID user ID
 * @param {number} sessionObj.sessionID sessionID
 * @param {string} sessionObj.actionID action dir
 * @param {number} [sessionObj.taskID] taskID if action was running from the task
 * @param {number} [sessionObj.taskName] task name if action was running from the task
 * @param {number} [sessionObj.taskSession] unique taskSession if action was running from the task
 * @param {number} sessionObj.startTimestamp timestamp when action was started
 * @param {string} [sessionObj.descriptionTemplate] action description template
 * @param {string} [sessionObj.description] action description
 * @param {Object} [sessionObj.objects] objects for action
 * @param {boolean} [sessionObj.saved] true if the session with sessionID was added before
 * @param {Object} sessionObj.args action parameters like {<name>: <value>, ...}}
 * @param {function(Error)|function()} callback callback(err)
 */
function addNewSession(sessionObj, callback) {
    if(sessionObj.saved) return callback();

    usersDB.getID(sessionObj.username, function (err, userID) {
        if (err) return callback(new Error('Can\'t get userID for user ' + sessionObj.username + ': ' + err.message));
        if(userID === undefined) {
            log.warn('Can\'t find user ', sessionObj.username, ' for add a new session. UserID will be set to 0 for ',
                sessionObj);
            userID = 0;
        }

        sessionObj.userID = userID;

        createActionDescription(sessionObj.args, sessionObj.descriptionTemplate,
            function(err, description) {
            //if (err) log.warn('Can\'t create description for action: ', err.message, '; ', sessionObj);

            if (description) sessionObj.description = description;

            // get task name
            tasksDB.getTaskData(null, sessionObj.taskID, function (err, rows) {
                if (err) {
                    return callback(new Error('Can\'t get task name for task ' + sessionObj.taskID +
                        ': ' + err.message));
                }

                if(rows && rows[0] && rows[0].name) {
                    sessionObj.taskName = rows[0].name;
                    sessionObj.userID = rows[0].userID;
                }

                try {
                    auditDB.addNewSession(sessionObj);
                    sessions.get(sessionObj.sessionID).saved = true;
                } catch (err) {
                    return callback(err);
                }

                log.info('Added a new session ', sessionObj.sessionID,
                    ', action: ', sessionObj.actionID, ', objects: ', sessionObj.objects,
                    ', task: ', sessionObj.taskName, ' #', sessionObj.taskID,
                    ', taskSession: ', sessionObj.taskSession,
                    ', username: ', sessionObj.username, ', task userID: ',  sessionObj.userID);

                return callback()
            });
        });
    });
}

/**
 * Update the saved session to add a session stop timestamp
 * @param {Object} sessionObj object with parameters
 * @param {number} sessionObj.sessionID session ID
 * @param {number} sessionObj.stopTimestamp session stop timestamp
 * @param {string|null} sessionObj.error session error message or null
 */
function addSessionResult(sessionObj) {
    var savedSession = sessions.get(sessionObj.sessionID);
    if(!savedSession || !savedSession.saved) return;

    try {
        auditDB.addSessionResult(sessionObj);
        savedSession.deleted = Date.now(); // savedSession ia a pointer to the sessions.get(sessionObj.sessionID)
        log.debug('Add session stop timestamp: ', sessionObj.sessionID);
    } catch (err) {
        log.error('Can\'t update session for add stop timestamp to the sessions table: ', err.message,
            ': ', sessionObj);
    }
}

/**
 * Create action description using action execute parameters and descriptionTemplate parameter from action config.json
 * @param {Object} args action parameters like {<name>: <value>, ...}
 * @param {string} descriptionTemplate descriptionTemplateHTML or descriptionTemplate parameter from action config.json
 * @param {function()|function(null, string)} callback callback(null, <action description>)
 */
function createActionDescription(args, descriptionTemplate, callback) {
    if(!descriptionTemplate) return callback();

    var variables = [];
    if(args && typeof args === 'object') {
        for (var name in args) {
            variables.push({
                name: name,
                value: args[name],
            });
        }
    }
    actionsConf.makeActionDescription(descriptionTemplate, variables, callback);
}

/**
 * Add a new comment for the task
 * @param {Object} messageObj
 * @param {number} messageObj.taskSessionID task session ID
 * @param {string} messageObj.taskComment a new comment for the task
 */
function addTaskComment(messageObj) {
    if(typeof messageObj.taskSessionID !== 'number') return;
    try {
        auditDB.addTaskComment(messageObj.taskSessionID, messageObj.taskComment);
    } catch (err) {
        log.error('Error add comment for the task: ', err.message, '; taskSession: ', messageObj.taskSessionID,
            '; comment: "', messageObj.taskComment, '"');
    }
}

/**
 * Add a new comment for the action
 * @param {Object} messageObj
 * @param {number} messageObj.sessionID action session ID
 * @param {string} messageObj.actionComment a new comment for the action
 */
function addActionComment(messageObj) {
    if(typeof messageObj.sessionID !== 'number') return;
    try {
        auditDB.addTaskComment(messageObj.sessionID, messageObj.actionComment);
    } catch (err) {
        log.error('Error add comment for the action: ', err.message, '; sessionID: ', messageObj.sessionID,
            '; comment: "', messageObj.actionComment, '"');
    }
}