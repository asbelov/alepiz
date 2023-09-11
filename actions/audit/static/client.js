/*
* Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 22.02.2023, 23:52:38
*/
function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

function callbackBeforeExec(callback) {
    JQueryNamespace.beforeExec(callback)
}


// The functions will be passed from the parent frame
// describe the function here to prevent the error message
if(!getActionParametersFromBrowserURL) getActionParametersFromBrowserURL = function (callback) {callback([]);}

var JQueryNamespace = (function ($) {
    $(function () {
        init(); // Will run after finishing drawing the page
    });

    var serverURL = parameters.action.link + '/ajax'; // path to ajax
    var objects = parameters.objects; // initialize the variable "objects" for the selected objects on startup
    var firstSessionID = {};
    var actions = {};
    var selectedSessionID, selectedTaskID;

    var correctlyText = parameters.action.correctly || 'correct';
    var incorrectlyText = parameters.action.incorrectly || 'incorrect: ';

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
        onlyTasksCBElm,
        sessionTableFirstRowTDElms,
        taskIDFilterElm,
        messageFilterElm,
        sessionTableTHElms,
        commentDescriptionElm,
        modalCommentElm,
        taskIDElm,
        taskSessionIDElm,
        selectedSessionIDElm;

    var monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];


    return {
        onChangeObjects: _onChangeObjects,
        beforeExec: _beforeExec,
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
        drawAction();
    }

    function _beforeExec(callback) {
        if(!selectedTaskID && !selectedSessionID) {
            return callback(new Error('Task or action not selected. ' +
                'Please select the task or action you want to comment on'))
        }

        var addCommentElm = $('#modalComment');
        var modalCommentBtn = null;
        var sendMessageBtnElm = $('#modalSendMessage');
        var cancelBtnElm = $('#modalCancel');

        addCommentElm.characterCounter();
        sendMessageBtnElm.unbind('click').click(function() { modalCommentBtn = this; });
        cancelBtnElm.unbind('click').click(function() { modalCommentBtn = this; });

        var modal = M.Modal.init(document.getElementById('addCommentModal'), {
            inDuration: 0,
            outDuration: 0,
            dismissible: false,
            onCloseStart: function() { addCommentElm.blur(); },
            onCloseEnd: function() {
                if(!modalCommentBtn || $(modalCommentBtn).attr('id') === 'modalSendMessage') callback()
                else callback(new Error('Adding a comment has been canceled'));
            }
        });

        setTimeout(function() {
            modal.open();
            setTimeout(function() {
                addCommentElm.focus();
            }, 200);
        }, 500);
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
        onlyTasksCBElm = $('#onlyTasksCB');
        commentDescriptionElm = $('#commentDescription');
        modalCommentElm = $('#modalComment');
        taskIDElm = $('#taskID');
        taskSessionIDElm = $('#taskSessionID');
        // don't use "sessionID" as the element ID. It is reserved for the sessionID of the current action
        selectedSessionIDElm = $('#selectedSessionID');

        alepizActionLogViewerNamespace.init($('#actionLog'));

        initMaterialElm();
        initResizer();
        initEvents();
        drawAction();
    }

    function drawAction() {
        getActionParametersFromBrowserURL(function(actionParametersFromURL) {
            var selectedUsers = [], selectedActions = [];
            actionParametersFromURL.forEach(function (param) {
                if (param.key === 't') taskIDFilterElm.val(Number(param.val)); // taskID
                else if (param.key === 'td') descriptionFilterElm.val(param.val); // description or error
                else if (param.key === 'tm') messageFilterElm.val(param.val); // log message
                else if (param.key === 'tsf' && param.val === '0') simpleFilterCBElm.prop('checked', false); // simple filter checkbox
                else if (param.key === 'tsd') startDateElm.val(getDateString(new Date(Number(param.val)))); // start date
                else if (param.key === 'ted') endDateElm.val(getDateString(new Date(Number(param.val)))); // end date
                else if (param.key === 'tu') selectedUsers = param.val.split(',').map(id => parseInt(id, 10)); // userIDs
                else if (param.key === 'ta') selectedActions = param.val.split(',').map(actionID => actionID.trim()); // actionIDs
                else if (param.key === 'tst' && param.val === '0') onlyTasksCBElm.prop('checked', false) // show only tasks
            });

            getUsersAndActions(selectedUsers, selectedActions, function () {
                getSessions(firstSessionID);
            })
        });
    }

    /*
        returned date string in format DD MonthName, YYYY
        date: date object (new Date())
     */
    function getDateString(date) {
        if(!date) date = new Date();

        return (date.getDate() < 10 ? '0' + date.getDate() : date.getDate()) + ' ' + monthNames[date.getMonth()] +
            ', ' + date.getFullYear();
    }

    /**
     * Converting date and time string in format DD MonthName, YYYY to timestamp in ms
     * @param {string} dateStr date string in format DD MonthName, YYYY
     * @param {string} [timeStr] time in format hh:mm or undefined
     * @return {number|undefined} JS timestamp in ms or undefined if dateStr is null
     */
    function getTimestampFromStr(dateStr, timeStr) {
        var dateParts = dateStr.match(/^(\d\d?)\s([^,]+),\s(\d\d\d\d)$/);
        if(dateParts === null) return;
        var monthNum = monthNames.indexOf(dateParts[2]);

        var timeParts = [0,0];
        if(timeStr) {
            timeParts = timeStr.match(/^(\d+):(\d+)$/);
            if(timeParts === null) timeParts = [0,0];
        }
        return new Date(Number(dateParts[3]), monthNum, Number(dateParts[1]), timeParts[0], timeParts[1], 0, 0).getTime();
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
            selectUsersInstance = M.FormSelect.init(selectUsersElm[0], {});
            selectActionsInstance = M.FormSelect.init(selectActionsElm[0], {});
            setBrowserParam();
        });

        $('#modalFilterApply').click(function () {
            getSessions();
            setBrowserParam();
        });

        var filterElms = $('[data-filter-prm]');

        filterElms.keyup(function (e) {
            if (e.which === 27) $(this).val(''); // Esc
            else if (e.which === 13) $('#modalFilterApply').trigger('click'); // Enter
        });
    }

    function initMaterialElm() {
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {
            enterDelay: 1000
        });

        M.Collapsible.init(document.querySelectorAll('.collapsible'), {
            onOpenStart: getUsersAndActions,
            onOpenEnd: initResizer,
            onCloseEnd: initResizer,
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

        selectUsersInstance = M.FormSelect.init(selectUsersElm[0], {});
        selectActionsInstance = M.FormSelect.init(selectActionsElm[0], {});
    }

    /**
     * Add filter parameters to the browser URL
     */
    function setBrowserParam() {
        var param = [];

        if (taskIDFilterElm.val()) {
            param.push({
                key: 't',
                val: taskIDFilterElm.val(),
            });
        }
        if (descriptionFilterElm.val()) {
            param.push({
                key: 'td',
                val: descriptionFilterElm.val(),
            });
        }
        if (messageFilterElm.val()) {
            param.push({
                key: 'tm',
                val: messageFilterElm.val(),
            });
        }
        if (!simpleFilterCBElm.is(':checked')) {
            param.push({
                key: 'tsf',
                val: 0,
            });
        }
        if (!onlyTasksCBElm.is(':checked')) {
            param.push({
                key: 'tst',
                val: 0,
            });
        }

        if (startDateElm.val()) {
            var startDate = getTimestampFromStr(startDateElm.val());
            startDate += (new Date(startDate) - new Date(startDate).setHours(0, 0, 0, 0));
            param.push({
                key: 'tsd',
                val: startDate,
            })
        }
        if (endDateElm.val()) {
            var endDate = getTimestampFromStr(endDateElm.val());
            endDate += (new Date(endDate) - new Date(endDate).setHours(0,0,0,0));
            param.push({
                key: 'ted',
                val: endDate,
            });
        }

        if (selectUsersInstance.getSelectedValues().length) {
            param.push({
                key: 'tu',
                val: selectUsersInstance.getSelectedValues().join(','),
            });
        }

        if (selectActionsInstance.getSelectedValues().length) {
            param.push({
                key: 'ta',
                val: selectActionsInstance.getSelectedValues().join(','),
            });
        }

        setActionParametersToBrowserURL(param);
    }

    function getUsersAndActions(selectedUsers, selectedActions, callback) {
        bodyElm.css("cursor", "wait");
        $.post(serverURL, {
            func: 'getUsersAndActions',
        }, function(data) {
            bodyElm.css("cursor", "pointer");
            if(!data || !data.users || !data.actions) {
                typeof callback === 'function' && callback();
                return console.error('Received unreachable users ans actions: ', data);
            }

            if(!Array.isArray(selectedUsers)) selectedUsers = [];
            if(!Array.isArray(selectedActions)) selectedActions = [];

            var usersHTML = data.users.sort(function (a, b) {
                if(a.user > b.user) return 1;
                return -1;
            }).map(userObj => {
                var isSelected = selectedUsers.indexOf(userObj.id) !== -1 ? ' selected' : '';
                return '<option value = "' + userObj.id + '"' + isSelected + '>' + userObj.user + '</option>'
            }).join('');

            var actionsHTML = data.actions.sort(function (a, b) {
                if(a.name > b.name) return 1;
                return -1;
            }).map(actionObj => {
                var isSelected = selectedActions.indexOf(actionObj.id) !== -1 ? ' selected' : '';
                return '<option value = "' + actionObj.id + '"' + isSelected + '>' + actionObj.name + '</option>'
            }).join('');

            selectUsersElm.html(usersHTML);
            selectActionsElm.html(actionsHTML);

            selectUsersInstance = M.FormSelect.init(selectUsersElm[0], {});
            selectActionsInstance = M.FormSelect.init(selectActionsElm[0], {});

            typeof callback === 'function' && callback();
        });
    }

    function getSessions(firstID) {
        bodyElm.css("cursor", "wait");
        // i known, that select initialized in the initEvents, but dont remove this from here

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

        var tasksRef = {}, actionErrors = {}, actionNum = 0;
        var filteredObjectIDs = {};
        objects.forEach(obj => filteredObjectIDs[obj.id] = obj.name);

        var from = new Date(datePickerFromInstance.toString()).getTime() || '';
        var to = new Date(datePickerToInstance.toString()).getTime() || '';

        var actionIDFilter = {};
        selectActionsInstance.getSelectedValues().forEach(actionID => actionIDFilter[actionID] = true);

        var actionForObjects = parameters.action.actionForObjects;
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

            var description = '';
            if(row.description) {
                // trying to determine if there are HTML tags in the description
                description = /<\/[a-z]+>/gi.test(row.description) || /<br>/gi.test(row.description) ?
                    row.description : escapeHtml(row.description);
                description = description
                        .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                        .replace(/{{highlightClose}}/g, '</span>');
            }

            var error = row.error ?
                escapeHtml(row.actionName)  + ': ' + escapeHtml(row.error)
                    .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                    .replace(/{{highlightClose}}/g, '</span>').split('\n').filter(str => str.trim()).join('<br/>') :
                '';
            var actionComment = row.actionComment.length ?
                row.actionComment.map((actionComment, i) => {
                    return '<b>' + escapeHtml(row.actionCommentUsername[i]) + ':&nbsp;' +
                        new Date(row.actionCommentTimestamp[i]).toLocaleString() +
                        ':</b><br/>' + escapeHtml(actionComment)
                            .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                            .replace(/{{highlightClose}}/g, '</span>').split('\n')
                            .filter(str => str.trim()).join('<br/>')
                }).join('<br/>') : '';

            var taskComment = row.taskComment.length ?
                row.taskComment.map((taskComment, i) => {
                    return '<b>' + escapeHtml(row.taskCommentUsername[i]) + ':&nbsp;' +
                        new Date(row.taskCommentTimestamp[i]).toLocaleString() +
                        ':</b><br/>' + escapeHtml(taskComment)
                            .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                            .replace(/{{highlightClose}}/g, '</span>').split('\n')
                            .filter(str => str.trim()).join('<br/>')
                }).join('<br/>') : '';

            if(error.length > 1000) error = error.substring(0, 1000) + '...';

            if(row.error) actionErrors[row.sessionID] = row.error;

            var taskName = row.taskName ?
                escapeHtml(row.taskName)
                    .replace(/{{highlightOpen}}/g, '<span class="highLight">')
                    .replace(/{{highlightClose}}/g, '</span>') :
                '';

            if(row.objects.length) {
                var urlParameters = {
                    'c': encodeURIComponent(row.objects.map(obj => obj.name).join(',')),
                };

                var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' + row.actionID;
                urlParameters.a = encodeURIComponent(actionPath); // /action/information

                var url = '/?' + Object.keys(urlParameters).map(function(key) {
                    return key + '=' + urlParameters[key];
                }).join('&');

                var objectList = '<a href="' + url + '" target="_blank">' + row.objects.map(obj => {
                    if(objects.length && filteredObjectIDs[obj.id]) {
                        return '<span class="highLight">' + escapeHtml(obj.name) + '</span>';
                    } else return escapeHtml(obj.name)
                }).join(',<br/>') + '</a>';
            } else objectList = '';

            var actionName = actionIDFilter[row.actionID] ?
                '<span class="highLight">' + escapeHtml(row.actionName) + '</span>' :
                escapeHtml(row.actionName);

            var userName = selectUsersInstance.getSelectedValues().length ?
                '<span class="highLight">' + escapeHtml(row.userName) + '</span>' :
                escapeHtml(row.userName);

            var actionHTML = '<tr style="cursor:pointer" data-session-id="' + row.sessionID + '"' +
                hideClass + taskIDAttr + ' data-action-name="' + escapeHtml(row.actionName) +
                '" data-error="' + (error ? 1 : 0) + '">' +
                '<td style="width: 5%">' + taskLabel  +
                '</td><td style="width: 5%">' +
                (row.startTimestamp ?
                    (from ? '<span class="highLight">' : '') + (new Date(row.startTimestamp)).toLocaleString()
                        .replace(/\D\d\d\d\d/, '')
                        .replace(/:\d\d$/, '') + (from ? '</span>' : '') :
                    '-') +
                '</td><td style="width: 5%">' +
                (row.stopTimestamp ?
                    (to ? '<span class="highLight">' : '') + (new Date(row.stopTimestamp)).toLocaleString()
                        .replace(/\D\d\d\d\d/, '')
                        .replace(/:\d\d$/, '')  + (to ? '</span>' : ''):
                    '-') +
                '</td><td style="width: 10%">' + userName +
                '</td><td style="width: 10%">' + actionName +
                '</td><td style="width: 35%">' + description +
                '</td><td class="' + (actionComment ? 'green-text' : 'red-text' ) +
                    '" style="width: 20%; font-weight: normal; overflow-wrap: break-word;">' + (actionComment || error) +
                '</td><td style="width: 10%; overflow-wrap: break-word;">' + objectList +
                '</td><td class="hide">' + row.userID +
                '</td></tr>';
            actions[row.actionID] = row.actionName;

            if (!tasksRef[taskSession]) {
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
                    error: error ? [error] : [],
                    taskComment: taskComment,
                    rawError: error ? [row.actionName + ': ' + row.error] : [],
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

                if (error) {
                    tasksRef[taskSession].error.unshift(error);
                    tasksRef[taskSession].rawError.unshift(row.actionName + ': ' + row.error);
                }

                row.objects.forEach(function (obj) {
                    tasksRef[taskSession].objects[escapeHtml(obj.name)] = obj.id;
                });

                tasksRef[taskSession].actions.unshift(actionHTML);
            }
        });

        var showOnlyTasks = onlyTasksCBElm.is(':checked');
        for(var taskSession in tasksRef) {
            var task = tasksRef[taskSession];
            if(task.taskID) {
                var highlightedTaskID = taskIDFilterElm.val() ?
                    '<span class="highLight">' + '#' + task.taskID + '</span>' : '#' + String(task.taskID);

                if(Object.keys(task.objects).length) {

                    var urlParameters = {
                        'c': encodeURIComponent(Object.keys(task.objects).join(',')), // selected objects
                    };

                    if(actionForObjects) {
                        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' + actionForObjects;
                        urlParameters.a = encodeURIComponent(actionPath); // /action/information
                    }

                    var url = '/?' + Object.keys(urlParameters).map(function(key) {
                        return key + '=' + urlParameters[key];
                    }).join('&');

                    var objectList = '<a href="' + url + '" target="_blank">' +
                        Object.keys(task.objects).map(name => {
                        if(objects.length && filteredObjectIDs[task.objects[name]]) {
                            return '<span class="highLight">' + escapeHtml(name) + '</span>';
                        } else return escapeHtml(name)
                    }).join(',<br/>') + '</a>';
                } else objectList = '';

                tableHTML += '<tr style="cursor:pointer; font-weight: bold" data-task-session-id="' + taskSession +
                    '"  data-task-id="' + task.taskID +
                    '" data-task-description="' + '#' + task.taskID + ' ' + escapeHtml(task.description) +
                    '" data-error="' + (task.error.length ? 1 : 0) + '">' +
                    '<td><i class="material-icons" data-task-icon="' + taskSession + '">expand_more</i></td><td>' +
                    (task.startTimestamp ?
                        (from ? '<span class="highLight">' : '') + (new Date(task.startTimestamp)).toLocaleString()
                            .replace(/\D\d\d\d\d/, '')
                            .replace(/:\d\d$/, '') + (from ? '</span>' : '') :
                        '-') +
                    '</td><td>' +
                    (task.stopTimestamp ?
                        (to ? '<span class="highLight">' : '') + (new Date(task.stopTimestamp)).toLocaleString()
                            .replace(/\D\d\d\d\d/, '')
                            .replace(/:\d\d$/, '') + (to ? '</span>' : '') :
                        '-') +
                    '</td><td>' + escapeHtml(task.userName) +
                    '</td><td>' + task.actionName.join(',<br/>') +
                    '</td><td>' + highlightedTaskID + ': ' + escapeHtml(task.description) +
                    '</td><td class="' + (task.taskComment ? 'green-text' : 'red-text') +
                        '" style="font-weight: normal; overflow-wrap: break-word;">' +
                            (task.taskComment ||
                            (task.error.length ?
                                '* ' + task.error.join('</br>* ') : '')) +
                    '</td><td style="overflow-wrap: break-word;">' + objectList +
                    '</td><td class="hide">' + task.userID +
                    '</td></tr>';

                task.actions.forEach(function (actionHTML) {
                    tableHTML += actionHTML;
                });
            } else if(!showOnlyTasks) tableHTML += task.actions[0];
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
        var tasksTRElms = $('[data-task-session-id]');

        sessionTRElms.click(function () {
            selectedTaskID = null;
            taskIDElm.val('');
            taskSessionIDElm.val('');
            selectedSessionID = Number($(this).attr('data-session-id'));
            selectedSessionIDElm.val(selectedSessionID);
            commentDescriptionElm.text(' action "' + $(this).attr('data-action-name') + '"');
            var error = $(this).attr('data-error');
            modalCommentElm.val(error === '0' ? correctlyText : incorrectlyText + actionErrors[selectedSessionID] || '');
            M.textareaAutoResize(modalCommentElm);
            sessionTRElms.css({backgroundColor: ''});
            $(this).css({backgroundColor: '#DDDDDD'});
            sessionTRElms.css({cursor: 'wait'});
            var messageFilter = simpleFilterCBElm.is(':checked') ?
                '"' + messageFilterElm.val() + '"' : messageFilterElm.val();
            alepizActionLogViewerNamespace.getLastLogRecords([selectedSessionID], {},
                function (actionID) {
                    sessionTRElms.css({cursor: 'pointer'});
                    return actions[actionID]; // this getActionName function should return the name of the action
                }, false, messageFilter, true);
        });

        tasksTRElms.click(function () {
            selectedSessionID = null;
            var selectedTaskSessionID = $(this).attr('data-task-session-id');
            selectedTaskID = $(this).attr('data-task-id');
            taskIDElm.val(selectedTaskID);
            taskSessionIDElm.val(selectedTaskSessionID);
            selectedSessionIDElm.val('');
            commentDescriptionElm.text(' task "' + $(this).attr('data-task-description') + '"');
            var error = $(this).attr('data-error');
            modalCommentElm.val(error === '0' ?
                correctlyText : incorrectlyText + tasksRef[selectedTaskSessionID].rawError.join('\n'));

            M.textareaAutoResize(modalCommentElm);
            $('[data-task-action-id=' + selectedTaskSessionID + ']').toggleClass('hide');
            $(this).toggleClass('task-open');
            tasksTRElms.css({backgroundColor: ''})
            if($(this).hasClass('task-open')) {
                $(this).css({backgroundColor: '#CCCCCC'});
                $('[data-task-icon="' + selectedTaskSessionID + '"]').text('expand_less');

                // show actions log
                var actionsTRElms = $('tr[data-task-action-id=' + selectedTaskSessionID + '][data-session-id]');
                var sessionIDs = $.map(actionsTRElms, function(actionElm) {
                    return Number($(actionElm).attr('data-session-id'));
                });

                tasksTRElms.css({cursor: 'wait'});
                var messageFilter = simpleFilterCBElm.is(':checked') ?
                    '"' + messageFilterElm.val() + '"' : messageFilterElm.val();
                alepizActionLogViewerNamespace.getLastLogRecords(sessionIDs, {},
                    function (actionID) {
                        tasksTRElms.css({cursor: 'pointer'});
                        return actions[actionID]; // this getActionName function should return the name of the action
                    }, false, messageFilter, true);
            } else {
                commentDescriptionElm.text(' unselected task');
                modalCommentElm.val('');
                $('[data-task-icon="' + selectedTaskID + '"]').text('expand_more');
                selectedTaskID = null;
                taskIDElm.val('');
            }
        });
    }
})(jQuery); // end of jQuery name space