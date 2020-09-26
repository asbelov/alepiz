/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var conf = require('../../lib/conf');

/*
Prepare user name:
convert to low case
if undefined, return user name from configuration key 'unauthorizedUser' or 'guest'
 */

module.exports = function(userName){
    if(!userName) {
        userName =  conf.get('unauthorizedUser');
        if(!userName) userName = 'guest';
    }
    //return(userName.toLowerCase());
    return(userName);
};
