/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 19.06.2017.
 */

var JQueryNamespace = (function ($) {
    $(function () {
        init();
    });

    var serverURL = parameters.action.link+'/ajax',
        removingGroupsNames = [];

    function init() {
        $.post(serverURL, {func: 'getTasksGroups'}, function (groups) {
            getTaskGroupsRoles(function(taskGroupRoles) {
                var html = '';

                groups.forEach(function(group) {
                    // skip "defaul group" with id = 0
                    var deleteElmHTML = group.id ? '<span class="secondary-content"><i class="material-icons">close</i></span>' : ''

                    html += '<a href="#!" class="collection-item" id="'+escapeHtml(group.id)+'"><span groupName>' +
                        escapeHtml(group.name) + '</span>' + deleteElmHTML + '</a>';
                });

                $('#groupsList').append(html);

                $('a.collection-item').click(function(){
                    var id = $(this).attr('id');
                    if(id !== '00') {
                        var name = $(this).children('span[groupName]').text();
                    }  else name = '';

                    $('#groupName').val(name);
                    $('#groupID').val(id);
                    $('a.collection-item').removeClass('active');
                    $('span.secondary-content').removeClass('hide');
                    $(this).addClass('active');
                    $(this).children('span.secondary-content').addClass('hide');
                    $('#userRoles').val(taskGroupRoles[id]);
                    M.updateTextFields(); // update active inputs
                    M.FormSelect.init(document.getElementById('userRoles'), {});
                });

                $('span.secondary-content').click(function(){
                    var name = $(this).parent().children('span[groupName]').text();
                    removingGroupsNames.push(name);
                    $('#removingGroupsNames').val(removingGroupsNames.join(','));
                    $(this).parent().remove();
                });
            });
        });

        getRolesInformation(function(roles) {
            createRolesSelect(roles);
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

    function getTaskGroupsRoles(callback) {
        $.post(serverURL, {func: 'getTasksGroupsRoles'}, function(rows) {
            var roles = {};

            rows.forEach(function (row) {
                if(!roles[row.taskGroupID]) roles[row.taskGroupID] = [row.roleID];
                else roles[row.taskGroupID].push(row.roleID);
            });
            callback(roles);
        });
    }
})(jQuery); // end of jQuery name space