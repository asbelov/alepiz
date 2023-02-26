/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created on 2019-6-10 16:59:55
*/
const log = require('../../lib/log')(module);
const activeCollector = require('../../server/activeCollector'); // for insert
const communication = require('../../lib/communication');
const prepareUser = require('../../lib/utils/prepareUser');
const usersDB = require('../../models_db/usersDB');
const Conf = require('../../lib/conf');
const confActions = new Conf('config/actions.json');
const confMyNode = new Conf('config/node.json');

const eventGenerator = 'event-generator';

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var action = args.action;
    if(!action) return callback(new Error('Action not specified'));
    if(['enableEvents', 'addAsHint', 'addAsHintForObject', 'addAsComment', 'solveProblem', 'disableEvents',
        'removeTimeIntervals'].indexOf(action) === -1) {
        callback(new Error('Unknown action: ' + JSON.stringify(args)));
    }

    var eventIDs = getSelectedEventsIDs(args);
    if(!eventIDs.length) return callback();

    var cfg = args.actionCfg;
    if(!cfg || !cfg.restrictions) return callback(new Error('Can\'t find "restrictions" in action configuration'));
    var user = prepareUser(args.username);
    usersDB.getUsersInformation(user, function(err, rows) {
        if (err) {
            return callback(new Error('Can\'t get user information for ' + args.username + '(' + user + '): ' +
                err.message));
        }
        if (rows.length < 1) {
            return callback(new Error('Error while getting user information for ' + args.username + '(' + user +
                '): received data for ' + rows.length + ' users'));
        }

        var role = rows[0].roleName;
        if (!role) return callback(new Error('Can\'t find any role for user ' + args.username + '(' + user + ')'));
        var restrictions = cfg.restrictions[role] || cfg.restrictions.Default;
        if (!restrictions) {
            return callback(new Error('Can\'t find restrictions for role ' + role + ' user ' + args.username +
                '(' + user + ') and "Default" restriction is not set'));
        }

        var restrictAction = restrictions.Message;
        if(restrictAction !== true) {
            if (!restrictAction ||
                (action.enableEvents && !restrictAction.Enable) ||
                ((action.addAsHint || action.addAsHintForObject) && !restrictAction.Hints) ||
                (action.addAsComment && !restrictAction.Comments) ||
                (action.solveProblem && !restrictAction.Solve) ||
                ((action.disableEvents || action.removeTimeIntervals) && !restrictAction.Disable)
            ) {
                return callback(new Error('Access denied for ' + user + ' and action : "' + action + '", args: ' +
                    JSON.stringify(args)));
            }
        }


        activeCollector.connect(eventGenerator, function (err, collector) {
            if (err) return callback(err);

            log.info('Connect to collector "', eventGenerator, '" is completed');

            collector.send({
                eventsIDs: eventIDs,
                action: action,
                user: args.username,
                subject: args.subject || null,
                recipients: args.recipients || null,
                comment: args.message || null,
                disableUntil: args.disableUntil || null,
                intervals: args.disableTimeInterval || null,
                // for remove time intervals '<from>-<to>,<from>-<to>,...'
                timeIntervalsForRemove: args.timeIntervalsForRemove || null,
            }, function (err) {
                if (err) return callback(err);

                if(cfg.dontSendMessage || confMyNode.get('dontSendMessageFromDashboard')) return callback();

                if (!args.recipients) {
                    log.info('There are no recipients. The email will not be sent');
                    return callback();
                }

                if (action === 'enableEvents' && !args.comment) {
                    log.info('There are no comment for enabled event. The email will not be sent');
                    return callback();
                }

                var messageBodyHTML = '<div id="JSON-representation" hidden>\n' + args.hiddenMessageData +
                    '\n</div>\n' + args.message;

                communication.send({
                    message: {
                        to: args.recipients,
                        subject: args.subject,
                        replyTo: args.replyTo || undefined,
                        html: messageBodyHTML,
                    },
                    sender: args.username,
                    mediaID: 'email',
                }, callback);
            });
        });
    });
};

function getSelectedEventsIDs(args) {
    const hostPort = (args.hostPort ?
            args.hostPort :
            confActions.get('serverAddress') + ':' + confActions.get('serverPort'))
        + ':';

    var eventIDs = new Set(),
        notEnableEventAction = args.action !== 'enableEvents';
    for(var key in args) {

        // example of selected event: 'selectCurrentEvent_127.0.0.1:10164:51095': 'on'
        // event not selected
        if(!args[key]) continue;

        if(key.indexOf('selectDisabledEvent_' + hostPort) === 0) {
            eventIDs.add(
                parseInt(key.replace('selectDisabledEvent_' + hostPort, '')));
        } else if(notEnableEventAction) {
            if(key.indexOf('selectCurrentEvent_' + hostPort) === 0) {
                eventIDs.add(
                    parseInt(key.replace('selectCurrentEvent_' + hostPort, '')));
            } else if(key.indexOf('selectHistoryEvent_' + hostPort) === 0) {
                eventIDs.add(
                    parseInt(key.replace('selectHistoryEvent_' + hostPort, '')));
            } else if(key.indexOf('selectHistoryCommentedEvent_' + hostPort) === 0) {
                eventIDs.add(
                    parseInt(key.replace('selectHistoryCommentedEvent_' + hostPort, '')));
            }
        }
    }

    log.info('Number of events selected for the ', hostPort, ' ', eventIDs.size);
    return Array.from(eventIDs);
}