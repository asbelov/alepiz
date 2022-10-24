/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var prepareUser = require('../lib/utils/prepareUser');
var encrypt = require('../lib/encrypt');
var usersDB = require('../models_db/usersDB');
var usersDBSave = require('../models_db/modifiers/modifierWapper').usersDB;
var Conf = require('../lib/conf');
const conf = new Conf('config/common.json');

var user = {};
module.exports = user;

// Login user into the system:
// user: user name for login or
// pass: password for login or
// newPass: new password if need to change password
// session: reference for the session (req.session)
// callback(err, userName)
//  userName: <full user name (short user name)> or empty for error
user.login = function (user, pass, newPass, session, callback) {
    var hash = encrypt(pass);
    user = prepareUser(user);

    usersDB.checkAndGetFullUserName(user, hash, function(err, data){
        if(err) {
            return callback(new Error('User "' + user + '" login failed: ' + err.message));
        }

        if(!data || data.fullName === undefined) {
            return callback(new Error('Incorrect user name "' + user + '" or password'));
        }

        session.authorized = true;
        session.username = user.toLowerCase();

        if(!newPass) return callback(null, data.fullName + ' (' + user + ')');

        usersDBSave.updateUserPassword(user, encrypt(newPass), function(err) {
            if(err) return callback(new Error('Can\'t change password for user "' + user + '": ' + err.message));

            callback(null, data.fullName + ' (' + user + ')');
        });
    });

};

/*
 Logout user from system.
 session: reference for the session (req.session)
 callback()
 */
user.logout = logout;

function logout(session, callback){
    delete session.authorized;
    delete session.username;
    return callback();
}

/*
 Get full user name for current session. Used when user enter to the system without login
 for user identification with saved session
 session: reference for the session (req.session)
 callback(err, userName) where userName: <full user name (short user name)> or empty if error
 */
user.getFullName = function(session, callback){
    var user = prepareUser(session.username);

    var guestUser = conf.get('unauthorizedUser') || 'guest';
    if(user === guestUser) return callback(null, '');

    usersDB.getFullUserName(user, function(err, data){
        if(err) {
            return logout(session, function () {
                callback(new Error('Error getting full user name for user "' + user + '": ' + err.message));
            });
        }

        if(!data || data.fullName === undefined) {
            return logout(session, function() {
                callback(new Error('User "' + user + '" undefined. Can\'t get full name for this user from user database'));
            });
        }
        return callback(null, data.fullName + ' (' + user + ')');
    });
};