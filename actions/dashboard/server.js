/*
 * Copyright © 2019. Alexander Belov. Contacts: <asbel@alepiz.com>
 * Created on 2019-6-10 16:59:55
*/
var log = require('../../lib/log')(module);
//var events_generator = require('../../collectors/event-generator/collector'); // for select
var activeCollector = require('../../lib/activeCollector'); // for insert
var communication = require('../../lib/communication');
var conf = require('../../lib/conf');
conf.file('config/conf.json');

var collectorName = 'event-generator';

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var action = args.action;
    if(!action) return callback(new Error('Action not specified'));
    if(['enableEvents', 'addAsHint', 'addAsHintForObject', 'addAsComment', 'solveProblem', 'disableEvents', 'removeTimeIntervals'].indexOf(action) === -1)
        callback(new Error('Unknown action: ' + JSON.stringify(args)));

    var eventsIDs = getSelectedEventsIDs(args);
    if(!eventsIDs.length) return callback(new Error('No events are selected for action ' + action));

    activeCollector.connect(collectorName, function(err, collector) {
        if(err) return callback(err);

        log.info('Connect to collector "', collectorName, '" is completed');

        collector.get({
            eventsIDs: eventsIDs,
            action: action,
            user: args.username,
            subject: args.subject || null,
            recipients: args.recipients || null,
            comment: args.message || null,
            disableUntil: args.disableUntil || null,
            intervals: args.disableTimeInterval || null,
            timeIntervalsForRemove: args.timeIntervalsForRemove || null, // for remove time intervals '<from>-<to>,<from>-<to>,...'
        }, function(err) {
            if(err) return callback(err);

            if(action === 'enableEvents' && (!args.recipients || !args.comment)) {
                log.info('No recipients or no comment for enabled event. Email will not be sent');
                return callback();
            }

            if(!args.recipients) {
                log.info('No recipients. Email will not be sent');
                return callback();
            }

            communication.send({
                message: {
                    to: args.recipients,
                    subject: args.subject,
                    replyTo: args.replyTo || undefined,
                    html: args.message,
                },
                sender: args.username,
                mediaID: 'email',
            }, callback);
        });
    });
};

function getSelectedEventsIDs(args) {

    var eventsIDs = {}, action = args.action;
    Object.keys(args).forEach(function (key) {
        if(key.indexOf('selectDisabledEvent_') === 0 && args[key])
            return eventsIDs[key.replace('selectDisabledEvent_', '')] = true;

        if(action !== 'enableEvents') {
            if(key.indexOf('selectCurrentEvent_') === 0 && args[key]) return eventsIDs[key.replace('selectCurrentEvent_', '')] = true;
            if(key.indexOf('selectHistoryEvent_') === 0 && args[key]) return eventsIDs[key.replace('selectHistoryEvent_', '')] = true;
            if(key.indexOf('selectHistoryCommentedEvent_') === 0 && args[key]) return eventsIDs[key.replace('selectHistoryCommentedEvent_', '')] = true;
        }
    });

    return Object.keys(eventsIDs).filter(function (id) {
        return Number(id) === parseInt(id, 10) && Number(id);
    }).map(function (id) {
        return Number(id);
    });
}
