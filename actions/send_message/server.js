/*
* Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-6-23 0:39:38
*/
var log = require('../../lib/log')(module);
var communication = require('../../lib/communication');

module.exports = function(args, callback) {
    log.debug('Starting action server "', args.actionName, '" with parameters', args);

    var message = {};
    for(var arg in args) {
        if(arg.indexOf('newField_') === 0) {
            var name = arg.slice('newField_'.length);
            var val = args[arg];
            if(!isNaN(parseFloat(val)) && isFinite(val)) val = Number(val);
            message[name] = val;
        }
    }

    var priorities = [], mediaID = null;
    args.priorities.split(',').forEach(function (priority) {
        if(Number(priority) === parseInt(priority, 10)) {
            priorities.push(Number(priority));
        } else if(!mediaID) mediaID = priority;
    });

    var param = {
        priorities: priorities,
        mediaID: mediaID,
        configID: args.configID,
        sender: args.sender,
        rcpt: args.rcpt.split(','),
        text: args.text,
        message: message,
    };

    log.info('Sending message with param: ', param);
    communication.send(param, callback)
};

