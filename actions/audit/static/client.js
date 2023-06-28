/*
* Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 22.02.2023, 23:52:38
*/
function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

var JQueryNamespace = (function ($) {
    $(function () {
        init(); // Will run after finishing drawing the page
    });

    var serverURL = parameters.action.link+'/ajax'; // path to ajax
    var objects = parameters.objects; // initialize the variable "objects" for the selected objects on startup
    var firstSessionID = {};
    var actions = {};
    var datePickerFromInstance,
        datePickerToInstance,
        selectUsersInstance,
        selectActionsInstance;
    var bodyElm,
        auditBodyElm,
        actionListElm,
        sessionTableHeaderElm,
        sessionTableBodyElm,
        startDateElm,
        endDateElm,
        selectUsersElm,
        selectActionsElm,
        descriptionFilterElm,
        simpleFilterCBElm,
        sessionTableFirstRowTDElms,
        taskIDFilterElm,
        messageFilterElm,
        sessionTableTHElms;

    return {
        onChangeObjects: _onChangeObjects,
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
    }

    function init() {
        bodyElm = $('body');
        actionListElm = $('#actionList');
        auditBodyElm = $('#auditBody');

        startDateElm = $('#startDate');
        endDateElm = $('#endDate');
        selectUsersElm = $('#selectUsers');
        selectActionsElm = $('#selectActions');
        descriptionFilterElm = $('#descriptionFilter');
        taskIDFilterElm = $('#taskIDFilter');
        messageFilterElm = $('#messageFilter');
        simpleFilterCBElm = $('#simpleFilterCB');

        alepizActionLogViewerNamespace.init($('#actionLog'));

        initMaterialElm();
        getSessions(firstSessionID);
        initResizer();
        initEvents();
    }

    function initEvents() {

        $('#modalFilterClear').click(function () {
            datePickerFromInstance.setDate();
            datePickerToInstance.setDate();
            startDateElm.val('');
            endDateElm.val('')
            selectUsersElm.prop('selectedIndex', -1);
            selectActionsElm.prop('selectedIndex', -1);
            descriptionFilterElm.val('');
            simpleFilterCBElm.prop('checked', true);
            taskIDFilterElm.val('');
            messageFilterElm.val('');
            M.FormSelect.init(document.querySelectorAll('select'), {});
        });

        $('#modalFilterApply').click(function () {
            getSessions();
        });
    }

    function initMaterialElm() {
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {
            enterDelay: 1000
        });

        M.Collapsible.init(document.querySelectorAll('.collapsible'), {
            onOpenStart: getUsersAndActions,
        });

        datePickerFromInstance = M.Datepicker.init(startDateElm[0], {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            container: bodyElm[0],
        });
        datePickerToInstance = M.Datepicker.init(endDateElm[0], {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            container: bodyElm[0],
        });
    }

    function getUsersAndActions() {
        bodyElm.css("cursor", "wait");
        $.post(serverURL, {
            func: 'getUsersAndActions',
        }, function(data) {
            bodyElm.css("cursor", "pointer");
            if(!data || !data.users || !data.actions) {
                return console.error('Received unreachable users ans actions: ', data);
            }

            var usersHTML = data.users.sort(function (a, b) {
                if(a.user > b.user) return 1;
                return -1;
            }).map(userObj => '<option value = "' + userObj.id + '">' + userObj.user + '</option>').join('');

            var actionsHTML = data.actions.sort(function (a, b) {
                if(a.name > b.name) return 1;
                return -1;
            }).map(actionObj => '<option value = "' + actionObj.id + '">' + actionObj.name + '</option>').join('');

            selectUsersElm.html(usersHTML);
            selectActionsElm.html(actionsHTML);

            M.FormSelect.init(document.querySelectorAll('select'), {});
        });
    }

    function getSessions(firstID) {
        bodyElm.css("cursor", "wait");
        // i known, that select initialized in the initEvents, but dont remove this from here
        selectUsersInstance = M.FormSelect.init(selectUsersElm[0], {});
        selectActionsInstance = M.FormSelect.init(selectActionsElm[0], {});

        var from = new Date(datePickerFromInstance.toString()).getTime() || '';
        var to = new Date(datePickerToInstance.toString()).getTime() || '';

        var description = simpleFilterCBElm.is(':checked') ?
            '"' + descriptionFilterElm.val() + '"' : descriptionFilterElm.val();
        var message = simpleFilterCBElm.is(':checked') ?
            '"' + messageFilterElm.val() + '"' : messageFilterElm.val();

        $.ajax(serverURL, {
            type: 'POST',
            data: {
                func: 'getSessions',
                firstID: JSON.stringify(firstID),
                from: from,
                to: to,
                userIDs: selectUsersInstance.getSelectedValues().join(','),
                actionIDs: selectActionsInstance.getSelectedValues().join(','),
                description: description,
                taskIDs: taskIDFilterElm.val().split(' ').join(''),
                message: message,
                objectIDs: objects.map(obj => obj.id).join(','),
            },
            success: function(sessions) {
                bodyElm.css("cursor", "pointer");
                if(Array.isArray(sessions)) { // print result returned from ajax
                    printSessions(sessions);
                    //console.log(sessions)
                } else {
                    if(sessions.actionError) log.error(sessions.actionError)
                    else log.error('Returned unexpected result')

                    console.log('Result from ajax: ', sessions); // debug result returned from ajax
                }
            },
            error: ajaxError,
            timeout: 180000,
            cache: false
        });
    }

    function ajaxError(jqXHR, exception) {
        bodyElm.css({cursor: 'default'});
        var err;
        if (jqXHR.status === 404) {
            err = 'Requested page not found. [404]';
        } else if (jqXHR.status === 500) {
            err = 'Internal Server Error [500].';
        } else if (exception === 'parsererror') {
            err = 'Requested JSON parse failed.';
        } else if (exception === 'timeout') {
            err = 'Time out error.';
        } else if (exception === 'abort') {
            err = 'Ajax request aborted.';
        } else if (jqXHR.status === 0) {
            err = 'Not connect. Verify Network.';
        } else {
            err = 'Uncaught Error.\n' + jqXHR.responseText;
        }
        log.error('Web server error: ' + err + ' [status: ' + jqXHR.status +
                (exception ? '; exception: ' + exception : '')+ ']');
    }

    function printSessions(sessions) {
        alepizActionLogViewerNamespace.clearLog();
        var tableHTML = '<table class="bordered highlight" style="table-layout:fixed;" id="sessionTable">' +
            '<tbody id="sessionTableBody">';

        var tasksRef = {}, actionNum = 0;
        var filteredObjectIDs = {};
        objects.forEach(obj => filteredObjectIDs[obj.id] = obj.name);

        var from = new Date(datePickerFromInstance.toString()).getTime() || '';
        var to = new Date(datePickerToInstance.toString()).getTime() || '';

        var actionIDFilter = {};
        selectActionsInstance.getSelectedValues().forEach(actionID => actionIDFilter[actionID] = true);

        sessions.sort((a,b) => b.startTimestamp - a.startTimestamp).forEach(function (row) {
            if(row.taskID) {
                var hideClass = ' class="hide"';
                var taskSession = row.taskSession;
                var taskIDAttr = 'data-task-action-id="' + taskSession + '"';
                var taskLabel = '<i style="margin-left: 0.5rem" class="material-icons">subdirectory_arrow_right</i>';
            } else {
                hideClass = '';
                taskSession = 'a' + actionNum++;
                taskIDAttr = '';
                taskLabel = '';
            }

            var description = row.description ?
                row.description
                    .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                    .replace(/{{highlightClose}}/g, '</span>') :
                '';

            var error = row.error ?
                escapeHtml(row.error)
                    .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                    .replace(/{{highlightClose}}/g, '</span>') :
                '';

            var taskName = row.taskName ?
                escapeHtml(row.taskName)
                    .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                    .replace(/{{highlightClose}}/g, '</span>') :
                '';

            var objectList = row.objects.map(obj => {
                if(objects.length && filteredObjectIDs[obj.id]) {
                    return '<span class="highLight">' + escapeHtml(obj.name) + '</span>';
                } else return escapeHtml(obj.name)
            }).join(',<br/>');

            var actionName = actionIDFilter[row.actionID] ?
                '<span class="highLight">' + escapeHtml(row.actionName) + '</span>' :
                escapeHtml(row.actionName);

            var userName = selectUsersInstance.getSelectedValues().length ?
                '<span class="highLight">' + escapeHtml(row.userName) + '</span>' :
                escapeHtml(row.userName);

            var actionHTML = '<tr style="cursor:pointer" data-session-id="' + row.sessionID + '""' +
                hideClass + taskIDAttr + '">' +
                '<td style="width: 5%">' + taskLabel  +
                '</td><td style="width: 5%">' +
                (row.startTimestamp ?
                    (from ? '<span class="highLight">' : '') + (new Date(row.startTimestamp)).toLocaleString()
                        .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '') + (from ? '</span>' : '') :
                    '-') +
                '</td><td style="width: 5%">' +
                (row.stopTimestamp ?
                    (to ? '<span class="highLight">' : '') + (new Date(row.stopTimestamp)).toLocaleString()
                        .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '')  + (to ? '</span>' : ''):
                    '-') +
                '</td><td style="width: 10%">' + userName +
                '</td><td style="width: 10%">' + actionName +
                '</td><td style="width: 35%">' + description +
                '</td><td class="red-text" style="width: 20%">' + error +
                '</td><td style="width: 10%">' + objectList || ''+
                '</td><td class="hide">' + row.userID +
                '</td></tr>';
            actions[row.actionID] = row.actionName;

            if(!tasksRef[taskSession]) {
                var taskObjects = {};
                row.objects.forEach(function (obj) {
                    taskObjects[obj.name] = obj.id;
                });
                tasksRef[taskSession] = {
                    taskID: row.taskID,
                    startTimestamp: row.startTimestamp,
                    stopTimestamp: row.stopTimestamp,
                    userName: userName,
                    userID: row.userID,
                    actionName: [actionName],
                    description: taskName,
                    error: error ? [error] : '',
                    objects: taskObjects,
                    actions: [actionHTML],
                }
            } else {
                if(taskName && !tasksRef[taskSession].description) {
                    tasksRef[taskSession].description = taskName;
                }
                if (row.startTimestamp < tasksRef[taskSession].startTimestamp) {
                    tasksRef[taskSession].startTimestamp = row.startTimestamp
                }
                if (row.stopTimestamp > tasksRef[taskSession].stopTimestamp) {
                    tasksRef[taskSession].stopTimestamp = row.stopTimestamp
                }

                tasksRef[taskSession].actionName.unshift(actionName);

                if (error) tasksRef[taskSession].error.unshift(error);

                row.objects.forEach(function (obj) {
                    tasksRef[taskSession].objects[escapeHtml(obj.name)] = obj.id;
                });

                tasksRef[taskSession].actions.unshift(actionHTML);
            }
        });

        for(var taskSession in tasksRef) {
            var task = tasksRef[taskSession];
            if(task.taskID) {
                var humanTaskID = String(task.taskID).replace(/^(.*)(.{5})$/, '$1 $2');
                //var humanTaskID = String(task.taskID).replace(/^(.*)(.{5})$/, '$2');

                if(taskIDFilterElm.val()) {
                    humanTaskID = '<span class="highLight">' +'<span class="highLight">' + humanTaskID + '</span>';
                }

                var objectList = Object.keys(task.objects).map(name => {
                    if(objects.length && filteredObjectIDs[task.objects[name]]) {
                        return '<span class="highLight">' + escapeHtml(name) + '</span>';
                    } else return escapeHtml(name)
                }).join(',<br/>');

                tableHTML += '<tr style="cursor:pointer; font-weight: bold" data-task-id="' + taskSession + '">' +
                    '<td><i class="material-icons" data-task-icon="' + taskSession + '">expand_more</i></td><td>' +
                    (task.startTimestamp ?
                        (from ? '<span class="highLight">' : '') + (new Date(task.startTimestamp)).toLocaleString()
                            .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '') + (from ? '</span>' : '') :
                        '-') +
                    '</td><td>' +
                    (task.stopTimestamp ?
                        (to ? '<span class="highLight">' : '') + (new Date(task.stopTimestamp)).toLocaleString()
                            .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '') + (to ? '</span>' : '') :
                        '-') +
                    '</td><td>' + task.userName +
                    '</td><td>' + task.actionName.join(',<br/>') +
                    '</td><td>' + '#' + humanTaskID + ': ' + task.description +
                    '</td><td class="red-text">' +
                        (task.error.length ?
                            '* ' + task.error.join('</br>* ') : '') +
                    '</td><td>' + objectList || '' +
                    '</td><td class="hide">' + task.userID +
                    '</td></tr>';

                task.actions.forEach(function (actionHTML) {
                    tableHTML += actionHTML;
                });
            } else tableHTML += task.actions[0];
        }

        actionListElm.html(tableHTML +  '</tbody></table>');
        sessionTableHeaderElm = $('#sessionTableHeader');
        sessionTableBodyElm = $('#sessionTableBody');

        // settings for the correct display of the floating header
        sessionTableFirstRowTDElms = sessionTableBodyElm.children('tr:first').find('td');
        sessionTableTHElms = sessionTableHeaderElm.find('th')
        sessionTableTHElms.each(function (idx) {
            sessionTableFirstRowTDElms.eq(idx).css({width: $(this).width()});
        });

        var sessionTRElms = $('[data-session-id]');
        var tasksTRElms = $('[data-task-id]');

        sessionTRElms.click(function () {
            var sessionID = Number($(this).attr('data-session-id'));
            sessionTRElms.css({backgroundColor: ''})
            $(this).css({backgroundColor: '#DDDDDD'});
            sessionTRElms.css({cursor: 'wait'});
            var message = simpleFilterCBElm.is(':checked') ?
                '"' + messageFilterElm.val() + '"' : messageFilterElm.val();
            alepizActionLogViewerNamespace.getLastLogRecords([sessionID], {},
                function (actionID) {
                    sessionTRElms.css({cursor: 'pointer'});
                    return actions[actionID];
                }, false, message);
        });

        tasksTRElms.click(function () {
            var taskID = $(this).attr('data-task-id');
            $('[data-task-action-id=' + taskID + ']').toggleClass('hide');
            $(this).toggleClass('task-open');
            tasksTRElms.css({backgroundColor: ''})
            if($(this).hasClass('task-open')) {
                $(this).css({backgroundColor: '#CCCCCC'});
                $('[data-task-icon="' + taskID + '"]').text('expand_less');
            } else $('[data-task-icon="' + taskID + '"]').text('expand_more')
        });
    }

})(jQuery); // end of jQuery name space