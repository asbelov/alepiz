/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var removedUsersNames = [];
var userNameElm;
var userRolesElm;
var userPassword1Elm;
var userPassword2Elm;


function callbackBeforeExec(callback) {

    var userName = userNameElm.val();
    if(userName && userPassword1Elm.val() !== userPassword2Elm.val()) {
        callback(new Error('Entered passwords for user ' + userName + ' are not equal'));
        return;
    }

    if(userName && (!userRolesElm.val() || !userRolesElm.val().length)) {
        callback(new Error('Roles for user ' + userName + ' are not set'));
        return;
    }

    if(!removedUsersNames.length) return callback();

    $('#usersNamesInModalDialog').text(removedUsersNames.join(', '));
    var userNamesInModalDialogInstance = M.Modal.init(document.getElementById('modalDeleteConfirm'), {dismissible: false});
    userNamesInModalDialogInstance.open();

    $('#modalDeleteConfirmNo').unbind('click').click(function(){
        callback(new Error('Delete operation for users ' + removedUsersNames.join(', ') + ' was canceled'));
    });

    $('#modalDeleteConfirmYes').unbind('click').click(function(){
        callback();
    });
}

function callbackAfterExec(callback) {
    JQueryNamespace.init(callback);
}

var JQueryNamespace = (function ($) {
    $(function () {
        userNameElm = $('#userName');
        userFullNameElm = $('#fullUserName');
        userPassword1Elm = $('#userPassword1');
        userPassword2Elm = $('#userPassword2');
        userRolesElm = $('#userRoles');
        userIDElm = $('#userID');

        init();
    });

    var removedUsersIDs = [],
        userFullNameElm,
        userIDElm;


    // path to ajax
    var serverURL = parameters.action.link+'/ajax';

    return {
        init: init
    };

    function init(callback) {
        removedUsersNames = [];
        $('#removedUsers').val('');

        getRolesInformation(function(roles) {
            createRolesSelect(roles);
            setUserProperties();

            getPriorityDescriptionsAndMedias(function () {
                getUsersList(function(users) {
                    createUserList(users, roles);

                    M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});

                    if(typeof callback === 'function') callback();
                });
            });
        });
    }

    function getRolesInformation(callback) {
        $.post(serverURL, {func: 'getRolesInformation'}, function(rows) {
            var roles = {};

            rows.forEach(function (row) {
                roles[row.id] = {
                    name: row.name,
                    description: row.description
                }
            });

            callback(roles);
        });
    }

    function createRolesSelect(roles) {
        var html = Object.keys(roles).map(function (id) {
            return '<option value="' + id + '">' + escapeHtml(roles[id].name) + '</option>';
        });

        $('#userRoles').empty().append(html);
        M.FormSelect.init(document.getElementById('userRoles'), {});
    }

    function getPriorityDescriptionsAndMedias(callback) {
        $.post(serverURL, {func: 'getPriorityDescriptions'}, function(rows) {
            var priorityDescriptions = {}, priorityHTML = '';
            rows.forEach(function (row) {
                priorityDescriptions[row.id] = row.description;
                priorityHTML += '<option value="' + row.id + '">' + escapeHtml('#' + row.id + ': ' + row.description) + '</option>';
            });

            $.post(serverURL, {func: 'getMedias'}, function (medias) {


                var html = Object.keys(medias).sort().map(function (mediaID) {
                    var label = escapeHtml(medias[mediaID].address || 'Address for ' + mediaID);
                    return '' +
                        '<div class="col l3 m6 s12 input-field">' +
                            '<input type="text" id="address_' + mediaID + '" data-address/>' +
                            '<label for="address_' + mediaID + '">' + label + '</label>' +
                        '</div><div class="col l3 m6 s12 input-field">' +
                            '<select multiple id="priorities_' + mediaID + '" data-priority>' + priorityHTML + '</select>' +
                            '<label for="priorities_' + mediaID + '">' + label + ' priority</label>' +
                        '</div>';
                });
                $('#communicationMedia').empty().append(html.join(''));

                M.FormSelect.init(document.querySelectorAll('select'), {});

                return callback();
            });
        });
    }

    function getUsersList(callback) {
        $.post(serverURL, {func: 'getUsersInformation'}, function(rows) {

            var users = {};
            rows.forEach(function (row) {
                if(!users[row.name]) {
                    users[row.name] = {
                        name: row.name,
                        id: row.id,
                        fullName: row.fullName,
                        roles: [row.roleID],
                        medias: {},
                    };
                } else {
                    if(users[row.name].roles.indexOf(row.roleID) === -1) {
                        users[row.name].roles.push(row.roleID);
                    }
                }
                if(row.address && row.mediaID) {
                    if(!users[row.name].medias[row.mediaID]) {
                        users[row.name].medias[row.mediaID] = {
                            address: row.address,
                            priorities: [row.priority],
                        };
                    }
                    else users[row.name].medias[row.mediaID].priorities.push(row.priority);
                }
            });

            return callback(users);
        });

    }

    function createUserList(users, roles) {
        var htmlNewUser = '<a href="#!" userID="" class="collection-item avatar active">' +
            '<i class="material-icons circle">person_add</i>' +
            '<span class="title">NEW USER</span>' +
            '<p>Description: none</p>' +
            '<p>Roles: none</p>';

        var html = Object.keys(users).sort().map(function (name) {
            var user = users[name];

            var rolesStr = user.roles.map(function (id) {
                return roles[id].name + ' (' + roles[id].description + ')'
            }).join(', ');

            return '<a href="#!" userID="' + user.id + '" userName="' + name + '" class="collection-item avatar">' +
                '<i class="material-icons circle">person</i>' +
                '<span class="title">' + escapeHtml(name).toUpperCase() + '</span>' +
                '<p>Description: ' + escapeHtml(user.fullName) + '</p>' +
                '<p>Roles: ' + escapeHtml(rolesStr) + '</p>' +
                (user.id ? '<span class="secondary-content"><i class="material-icons" removeUser>close</i></span>' : '') +
                '</a>'
        }).join('');

        $('#userList').empty().append(htmlNewUser + html);

        $('i[removeUser]').click(function () {
            var userID = $(this).parent().parent().attr('userID');
            $(this).parent().parent().remove();
            removedUsersIDs.push(userID);
            removedUsersNames.push($(this).parent().parent().attr('userName'));
            $('#removedUsers').val(removedUsersIDs.join(','));

            if(userID === userIDElm.val()) setUserProperties();
        });

        $('a[userID]').click(function () {
            $('a[userID].active').removeClass('active');
            $(this).addClass('active');

            var name = $(this).attr('userName');

            setUserProperties(users[name]);
        })
    }

    function setUserProperties(user) {
        if(!user) {
            userNameElm.val('');
            userPassword1Elm.val('');
            userPassword2Elm.val('');
            userFullNameElm.val('');
            userRolesElm.val('');
            userIDElm.val('');
            $('[data-address]').val('');
            $('[data-priority]').val('');
        } else {
            userNameElm.val(user.name);
            userPassword1Elm.val('');
            userPassword2Elm.val('');
            userFullNameElm.val(user.fullName);
            userRolesElm.val(user.roles);
            userIDElm.val(user.id);

            $('[data-address]').val('');
            $('[data-priority]').val('');
            Object.keys(user.medias).forEach(function (mediaID) {
                $('#address_'+mediaID).val(user.medias[mediaID].address);
                $('#priorities_'+mediaID).val(user.medias[mediaID].priorities);
            });
        }

        M.updateTextFields();
        M.FormSelect.init(document.querySelectorAll('select'), {});
    }

})(jQuery); // end of jQuery name space