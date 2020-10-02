/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var crypto = require('crypto');

var secret = 'AlexanderBelov0711';

module.exports = function(string){
    if(!string) return '';
    return crypto.createHmac('sha256', secret)
                .update(string)
                .digest('hex');
};
