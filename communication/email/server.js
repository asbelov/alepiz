/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var nodeMailer = require('nodemailer');
var log = require('../../lib/log')(module);

var media = {};
module.exports = media;

var transporter = {};

/*
message: {
    from:
    to:
    cc:
    bcc:
    subject:
    html:
    text:
    attachments:
}
 */
media.send = function (param, callback) {

    if(!transporter[param.configID]) {
        transporter[param.configID] = nodeMailer.createTransport(param.transport);
    }

    var message = param.message || {};

    if(!message.form && param.sender) message.from = createAddress(param.sender);
    if(!message.to && param.rcpt) message.to = createAddress(param.rcpt);
    if(!message.text && !message.html && param.text) message.text = param.text;

    transporter[param.configID].sendMail(message, function(err, info, response) {
        /*
        info includes the result, the exact format depends on the transport mechanism used
        info.messageId most transports should return the final Message-Id value used with this property
        info.envelope includes the envelope object for the message
        info.accepted is an array returned by SMTP transports (includes recipient addresses that were accepted by the server)
        info.rejected is an array returned by SMTP transports (includes recipient addresses that were rejected by the server)
        info.pending is an array returned by Direct SMTP transport. Includes recipient addresses that were temporarily rejected together with the server response
        response is a string returned by SMTP transports and includes the last SMTP response from the server
        */

        if(err) return callback(new Error('Can\'t sent email: ' + err.message + '; message: '+ JSON.stringify(message)));

        log.info('Email successfully sending messageID: ', info.messageId, '; response: ', response, '; message: ', message);
        callback();
    });
};

/*
users: array of objects [{address: <address>, fullName: <full name>}, ...]
 */
function createAddress(users) {
    if(!Array.isArray(users) || !users.length) return '';

    var re = /^(([^<>()\[\].,;:\s@"]+(\.[^<>()\[\].,;:\s@"]+)*)|(".+"))@(([^<>()\[\].,;:\s@"]+\.)+[^<>()\[\].,;:\s@"]{2,})$/i;

    var addresses = [];
    users.forEach(function (user) {
        if(!user.address || !re.test(user.address)) {
            log.warn('Address ' + user.address + ' is not a valid email address in ', users);
            return;
        }
        if(user.fullName) addresses.push('"' + user.fullName.replace(/"/g, "'") + '" <'+ user.address +'>');
        else addresses.push(user.address);
    });

    return addresses.join(', ');
}