/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var async = require('async');
var initDB = require('../../models_db/createDB/initDB');
var objectsDB = require('../../models_db/createDB/createObjectsDB');
var countersDB = require('../../models_db/createDB/createCountersDB');
var usersRolesRightsDB = require('../../models_db/createDB/createUsersRolesRightsDB');
var auditUsersDB = require('../../models_db/createDB/createAuditUsersDB');
var tasksDB = require('../../models_db/createDB/createTasksDB');


module.exports = function(callback){
    initDB(function(err) {
        if(err) return callback(err);

        objectsDB(function(err){
            if(err) return callback(err);
            async.parallel([
                function(callback){
                    countersDB(callback);
                },
                function(callback){
                    usersRolesRightsDB(function(err){
                        if(err) return callback(err);
                        async.parallel([auditUsersDB, tasksDB], callback);
                    })
                }
            ], callback);
        })
    })
};

