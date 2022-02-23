/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var Conf = require('../../lib/conf');
const conf = new Conf('config/common.json');

/*
Prepare username:
convert to low case
if undefined, return username from configuration key 'unauthorizedUser' or 'guest'
 */

module.exports = function(userName){
    if(!userName) {
        userName =  conf.get('unauthorizedUser') || 'guest';
    }
    //return(userName.toLowerCase());
    return(userName);
};
