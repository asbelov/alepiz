/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */
var async = require('async');
var log = require('../../lib/log')(module);
var checkIDs = require('../../lib/utils/checkIDs');
var usersDBSave = require('../../models_db/modifiers/modifierWapper').usersDB;
var communication = require('../../lib/communication');
var encrypt = require('../../lib/encrypt');
var transactionDB = require('../../models_db/modifiers/transaction');

module.exports = function(args, callback) {
    // prevent to print a password from parameters
    log.debug('Starting action server "', args.actionName/*, '" with parameters', args*/);

    transactionDB.begin(function(err) {
        if(err) return callback('Can\'t make changes with users: ' + err.message);

        removeUsers(args, function(err) {
            if(err) return transactionDB.rollback(err, callback);

            addOrUpdateUser(args, function(err) {
                if(err) return transactionDB.rollback(err, callback);
                transactionDB.end(callback);
            })
        })
    });
};

function removeUsers(args, callback) {
    if (!args.removedUsers) return callback();
    checkIDs(args.removedUsers.split(','), function (err, removedUsersIDs) {
        if (err) return callback(err);

        usersDBSave.removeUsers(removedUsersIDs, function(err) {
            if(err) return callback(new Error('Can\'t remove users with IDs: ' + args.removedUsers + ': ' + err.message));

            log.info('Removed users IDs: ', removedUsersIDs);
            callback();
        })
    });
}

function addOrUpdateUser(args, callback) {

    if(!args.userID && !args.userName) return callback();
    if(!args.userName) return callback(new Error('User name is not set'));
    if(!args.userID && !args.userPassword1) return callback(new Error('Password for new user '+ args.userName +' is not set'));
    if(args.userPassword1 !== args.userPassword2) return callback(new Error('User ' + args.userName + ' passwords are not equals'));

    checkIDs(args.userRoles, function(err, checkedRoles) {
        if(err) callback(new Error('Error in user roles: ' + err.message));

        var medias= createMedias(args);

        if(!args.userID) {
            usersDBSave.addUser({
                name: args.userName,
                fullName: args.fullUserName,
                password: encrypt(args.userPassword1)
            }, function (err, newUserID) {
                if (err) return callback(new Error('Can\'t add new user ' + args.userName + ': ' + err.message));

                usersDBSave.addRolesForUser(newUserID, checkedRoles, function (err) {
                    if (err) return callback(new Error('Can\'t add roles "' + checkedRoles.join(',') +
                        '" for a new user ' + args.userName + ', user ID: '+ newUserID +' : ' + err.message));

                    addCommunicationMedia(newUserID, medias, function (err) {
                        if (err) {
                            return callback(new Error('Can\'t add communication medias "' + JSON.stringify(medias) +
                                '" for a new user ' + args.userName + ', user ID: '+ newUserID +' : ' + err.message));
                        }

                        log.info('Added user ', args.userName, ', full name: ', args.fullUserName,', user ID: ',
                            newUserID, ', roles: ', checkedRoles, ', medias: ', medias);
                        callback();
                    });
                })
            })
        } else {
            var userID = Number(args.userID);

            usersDBSave.updateUser({
                id: userID,
                name: args.userName,
                fullName: args.fullUserName,
                password: args.userPassword1 ? encrypt(args.userPassword1) : undefined
            }, function (err) {
                if (err) return callback(new Error('Can\'t update user ' + args.userName + ', user ID: ' +
                    userID + ' : ' + err.message));

                usersDBSave.deleteAllRolesForUser(userID, function(err) {
                    if(err) return callback(new Error('Can\'t delete roles for user ' + args.userName +
                        ', user ID: ' + userID +' when updating: ' + err.message));

                    usersDBSave.addRolesForUser(userID, checkedRoles, function (err) {
                        if (err) return callback(new Error('Can\'t add roles "' + checkedRoles.join(',') +
                            '" for a user ' + args.userName + ', user ID: ' + userID + ' when updating: ' + err.message));

                        usersDBSave.deleteAllMediasForUser(userID, function (err) {
                            if(err) return callback(new Error('Can\'t delete communication medias for user ' + args.userName +
                                ', user ID: ' + userID +' when updating: ' + err.message));

                            addCommunicationMedia(userID, medias, function (err) {
                                if (err) {
                                    return callback(new Error('Can\'t add communication medias "' + JSON.stringify(medias) +
                                        '" for a new user ' + args.userName + ', user ID: '+ userID +' : ' + err.message));
                                }

                                log.info('Updated user ', args.userName, ', full name: ', args.fullUserName,', user ID: ',
                                    userID, ', roles: ', checkedRoles, ', medias: ', medias);
                                callback();
                            });
                        })
                    });
                });
            });
        }
    });
}

function createMedias(args) {
    var medias = {};
    for(var arg in args) {
        if(arg.indexOf('address_') !== -1) {
            var mediaID = arg.slice('address_'.length);
            if(!medias[mediaID]) {
                medias[mediaID] = {
                    address: args[arg],
                }
            } else medias[mediaID].address = args[arg];
        } else if(arg.indexOf('priorities_') !== -1) {
            mediaID = arg.slice('priorities_'.length);
            var priorities = [];
            args[arg].split(',').forEach(function (priority) {
                if(Number(priority) !== parseInt(priority, 10)) return;
                priorities.push(Number(priority));
            });
            if(!priorities.length) {
                delete medias[mediaID];
                continue;
            }
            if(!medias[mediaID]) {
                medias[mediaID] = {
                    priorities: priorities,
                }
            } else medias[mediaID].priorities = priorities;
        }
    }

    return medias;
}

function addCommunicationMedia(userID, medias, callback) {
    if(!Object.keys(medias).length) return callback();

    communication.getMedias(function(err, initMedias) {
        var initMediasArr = Object.keys(initMedias);
        var mediasArr = initMediasArr.map(function (mediaID) {
            return mediaID.toLowerCase();
        });

        async.eachSeries(Object.keys(medias), function (mediaID, callback) {
            if(!medias[mediaID].address || !medias[mediaID].priorities || !medias[mediaID].priorities.length) return callback();

            // check for mediaID is exist
            var mediaInx = mediasArr.indexOf(mediaID.toLowerCase());
            if(mediaInx === -1) {
                return callback(new Error('Media ' + mediaID + ' not exist'));
            }

            usersDBSave.addCommunicationMedia(userID, initMediasArr[mediaInx], medias[mediaID].address, function (err, ID) {
                if(err) return callback(new Error('Can\'t add media ' + mediaID + ': ' + err.message));

                async.eachSeries(medias[mediaID].priorities, function (priority, callback) {
                    usersDBSave.addCommunicationMediaPriority(ID, priority, callback);
                }, callback);
            })
        }, callback)
    });
}