
/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function initTaskList(taskListAreaElm, taskListParameters, callback) {
    taskListJQueryNamespace.init(taskListAreaElm, taskListParameters, callback);
}

function drawTasksList(prms, callback) {
    taskListJQueryNamespace.drawTasksList(prms, callback);
}

var monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

/*
     returned date string in format DD MonthName, YYYY
     date: date object (new Date())
     */
function getDateString(date){
    if(!date) date = new Date();

    return date.getDate() + ' ' + monthNames[date.getMonth()] + ', ' + date.getFullYear();
}

/*
     Converting date and time string in format DD MonthName, YYYY to timestamp in ms

     dateStr: date string in format DD MonthName, YYYY
     timeStr: time in formet hh:mm or undefined
     return time from 1.1.1970 in ms
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


var taskListJQueryNamespace = (function ($) {
    //$(function () {});

    var serverURL = parameters.action.link+'/ajax',
        taskListParameters,
        unnamedTaskName = 'New unnamed task',
        prevDateFrom,
        prevDateTo,
        taskDateFromInstance,
        taskDateToInstance,
        collapsibleTaskSettingsElmClosed = false,
        taskListUpdateTimeElm;

    var launchModeTheme = {
        null: { // only save
            "icon": "save",
            "color": "",
            "comment": "do not run",
        },
        0: { // ask to run permanently
            "icon" : "hourglass_empty",
            "nextLaunchMode": 20,
            "color" : "amber lighten-3",
            "comment": "ask to run every time the condition is met",
        },
        1: { // ask to run once
            "icon" : "hourglass_empty",
            "nextLaunchMode": 21,
            "color" : "amber lighten-3",
            "comment": "ask to run once when the condition is met",
        },
        2: { // ask to run now
            "icon" : "hourglass_empty",
            "nextLaunchMode": 22,
            "color" : "amber lighten-3",
            "comment": "ask to run immediately",
        },
        9: { // ask to run by time
            "icon" : "hourglass_empty",
            "nextLaunchMode": 29,
            "color" : "amber lighten-3",
            "comment": "ask to run on time",
        },
        11: { // run once task has already started
            "icon" : "done",
            "nextLaunchMode": 21,
            "color" : "amber darken-3",
            "comment": "the task was run once when the condition is met",
        },
        12: { // run now already started
            "icon" : "done",
            "nextLaunchMode": 22,
            "color" : "amber darken-3",
            "comment": "task was launched on demand",
        },
        19: {
            "icon" : "done",
            "nextLaunchMode": 29,
            "color" : "amber darken-3",
            "comment": "task run time has passed",
        },
        20: { // approved run permanently
            "icon" : "thumb_up",
            "nextLaunchMode": 30,
            "color" : "teal lighten-5",
            "comment": "approved to run every time the condition is met",
        },
        21: { // approved run once
            "icon" : "thumb_up",
            "nextLaunchMode": 31,
            "color" : "teal lighten-5",
            "comment": "approved to run once when the condition is met",
        },
        22: { // approved run now
            "icon" : "play_arrow",
            "nextLaunchMode": 32,
            "color" : "teal lighten-5",
            "comment": "approved to run immediately",
        },
        29: { // approved run by time
            "icon" : "alarm",
            "nextLaunchMode": 39,
            "color" : "teal lighten-5",
            "comment": "approved to run on time",
        },
        30: { // canceled run permanently
            "icon" : "thumb_down",
            "nextLaunchMode": 20,
            "color" : "grey lighten-3",
            "comment": "canceled to run every time the condition is met",
        },
        31: { // canceled run once
            "icon" : "thumb_down",
            "nextLaunchMode": 21,
            "color" : "grey lighten-3",
            "comment": "canceled to run once when the condition is met",
        },
        32: { // canceled run now
            "icon" : "thumb_down",
            "nextLaunchMode": 22,
            "color" : "grey lighten-3",
            "comment": "canceled to run immediately",
        },
        39: { // canceled run by time
            "icon" : "thumb_down",
            "nextLaunchMode": 29,
            "color" : "grey lighten-3",
            "comment": "canceled to run on time",
        },
    };

    // getting launchModeTheme data from configuration and merge with default values
    if(typeof parameters.action.launchModeTheme === 'object') {
        for(var launchMode in launchModeTheme) {
            if(parameters.action.launchModeTheme[String(launchMode)]) {
                for(var param in launchModeTheme[launchMode]) {
                    if(parameters.action.launchModeTheme[String(launchMode)][param]) {
                        launchModeTheme[String(launchMode)][param] = parameters.action.launchModeTheme[String(launchMode)][param];
                    }
                }
            }
        }
    }

    return {
        init: init,
        drawTasksList: drawTasksList
    };

    function init(taskListAreaElm, initTaskListParameters, callback) {

        taskListParameters = initTaskListParameters;

        if(initTaskListParameters.serverURL) serverURL = initTaskListParameters.serverURL;

        drawTaskListArea(taskListAreaElm);
        taskListUpdateTimeElm = $('#taskListUpdateTime');

        prevDateFrom = getDateString();
        $('#taskDateFrom').val(prevDateFrom); // set current date to the date picker
        taskDateFromInstance = M.Datepicker.init(document.getElementById('taskDateFrom'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            defaultDate: new Date(),
            setDefaultDate: true,
            autoClose: true
        });
        var d = new Date();
        d.setDate(d.getDate()+1); // set start date to tomorrow
        prevDateTo = getDateString(d);
        $('#taskDateTo').val(prevDateTo); // set current date to the date picker
        taskDateToInstance = M.Datepicker.init(document.getElementById('taskDateTo'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            defaultDate: d,
            setDefaultDate: true,
            autoClose: true
        });

        drawTasksList(taskListParameters, function(/*activeTaskID, activeTaskName*/) {

            setInterval(updateTaskList, parameters.action.refreshTaskList || 30000);

            $('#taskGroupForSearch').change(function() {
                drawTasksList(taskListParameters);
            });

            var dateFromElm = $('#taskDateFrom');
            var dateToElm = $('#taskDateTo');

            dateFromElm.change(function(){
                if(!$(this).val()) {
                    dateFromElm.val(prevDateFrom);
                    return;
                }
                var timestampFrom = getTimestampFromStr(dateFromElm.val());
                if(!timestampFrom) {
                    dateFromElm.val(prevDateFrom);
                    return;
                }

                if(timestampFrom > (new Date()).getTime()){
                    dateFromElm.val(getDateString());
                    timestampFrom = getTimestampFromStr(dateFromElm.val());
                }

                var timestampTo = getTimestampFromStr(dateToElm.val());

                if(timestampTo <= timestampFrom) dateToElm.val(getDateString(new Date(timestampFrom + 86400000)));

                prevDateFrom = dateFromElm.val();
                drawTasksList(taskListParameters);
            });

            dateToElm.change(function(){
                if(!$(this).val()) {
                    dateToElm.val(prevDateTo);
                    return;
                }
                var timestampTo = getTimestampFromStr(dateToElm.val());
                if(!timestampTo) {
                    dateToElm.val(prevDateTo);
                    return;
                }

                var d = new Date();
                d.setDate(d.getDate()+1); // set start date to tomorrow
                if(timestampTo > d.getTime()){
                    dateToElm.val(getDateString(d));
                    timestampTo = getTimestampFromStr(dateToElm.val());
                }

                var timestampFrom = getTimestampFromStr(dateFromElm.val());

                if(timestampTo <= timestampFrom) dateFromElm.val(getDateString(new Date(timestampTo-86400000)));
                prevDateTo = dateToElm.val();
                drawTasksList(taskListParameters);
            });

            $('#filterByTaskName').keyup(function(e){
                if(e.which === 27) $(this).val(''); // When pressing Esc, clear search field
                drawTasksList(taskListParameters);
            });

            $('#filterByTaskOwner').keyup(function(e){
                if(e.which === 27) $(this).val(''); // When pressing Esc, clear search field
                drawTasksList(taskListParameters);
            });

            if(typeof callback === 'function') callback();
        });
    }

    function drawTaskListArea(taskListAreaElm) {

        taskListAreaElm.append('\
<ul data-collapsible="accordion" class="collapsible" id="collapsibleTaskSettings">\
    <li>\
        <div class="collapsible-header active">\
            <i class="material-icons">view_list</i>\
            <div class="col s9 margin-0 padding-0">Task selector</div>\
            <div class="secondary-content sol s3">Updated at \
                <span id="taskListUpdateTime">' + new Date().toLocaleString() + '</span></div> \
        </div>\
        <div style="line-height:1.5rem" class="collapsible-body row">\
            <div class="col s12 m8 l4 input-field">\
                <input type="text" id="filterByTaskName"/>\
                <label for="filterByTaskName">Searching by subject</label>\
            </div>\
            <div class="col s12 m4 l2 input-field">\
                <input type="text" id="filterByTaskOwner"/>\
                <label for="filterByTaskOwner">Searching by owner</label>\
            </div>\
            <div class="col s12 m8 l2 input-field">\
                <select id="taskGroupForSearch"></select>\
                <label for"taskGroupForSearch">Select task group</label>\
            </div>\
            <div class="col s12 m4 l2 input-field">\
                <input type="text" id="taskDateFrom" class="datepicker"/>\
                <label for="taskDateFrom">Select first date</label>\
            </div>\
            <div class="col s12 m4 l2 input-field">\
                <input type="text" id="taskDateTo" class="datepicker"/>\
                <label for="taskDateTo">Select last date</label>\
            </div>\
            <div class="col s12 collection" id="taskList"></div>\
        </div>\
    </li>\
</ul>');

    }

    function updateTaskList() {
        if(collapsibleTaskSettingsElmClosed) return;
        taskListParameters.reloadTaskListMode = true;
        drawTasksList(taskListParameters, function() {
            taskListUpdateTimeElm.text(new Date().toLocaleString());
        });
    }

    /*
    Draw task list

    prms: {
        onClick: function(taskID, taskName){}, - run on click on task
        onAdd: function(taskID, taskName){}, - run on click on "+" task button
        onRemove: function(taskID, taskName){}, - run on click on "x" task button
        onComplete: function(activeTaskID, activeTaskName){} - use this function on complete drawing task list
        removedTasks: [taskID1, taskID2, ...] - task list, which is not showing
    }

    callback(activeTaskID, activeTaskName)

    activeTaskID - active task ID or undefined
    activeTaskName - activeTaskName or undefined
     */
    function drawTasksList(prms, callback) {

        var reloadTaskListMode = prms.reloadTaskListMode;
        delete prms.reloadTaskListMode;

        taskListParameters = prms;

        var timestampFrom = getTimestampFromStr($('#taskDateFrom').val());
        var timestampTo = getTimestampFromStr($('#taskDateTo').val());
        var groupID = $('#taskGroupForSearch').val() || '';
        var filterByTaskName = $('#filterByTaskName').val();
        var filterByTaskOwner = $('#filterByTaskOwner').val();

        if(!filterByTaskName) filterByTaskName = undefined;
        if(!filterByTaskOwner) filterByTaskOwner = undefined;


        $.post(serverURL, {
            func: 'getTasksList',
            timestampFrom: timestampFrom,
            timestampTo: timestampTo,
            taskName: filterByTaskName,
            userName: filterByTaskOwner,
            groupID: groupID,

            // [{id: <taskID>, name: <taskName or NULL for a new task>, timestamp:.., userName:.., userFullName:..}]
        }, function (data) { // {taskData:.., workflow:..., groups:...}

            // create taskGroups selector
            var taskGroupForSearchOptions = '';
            var groups = data.groups, workflow = data.workflow;
            groups.forEach(function (group) {
                if(group.id === data.groupID) var selected = ' selected';
                else selected = '';
                taskGroupForSearchOptions += '<option value="'+group.id+'"'+selected+'>'+group.name+'</option>';
            });

            var taskGroupForSearchElm = $('#taskGroupForSearch');
            taskGroupForSearchElm.html(taskGroupForSearchOptions);
            M.FormSelect.init(taskGroupForSearchElm[0], {});

            // workflow {<groupID1>: <nextGroupID1>, <groupID2>: <nextGroupID2>, ...}
            if(typeof workflow === 'object') $('#workflow').val(JSON.stringify(workflow));

            // create task list
            var tasksData = data.taskData, html = '', activeTaskName = '';

            if(!Array.isArray(tasksData)) tasksData = [];

            // set fromDate to timestamp of last showed task
            if(tasksData.length && tasksData[tasksData.length - 1].timestamp < timestampFrom) {
                $('#taskDateFrom').val(getDateString(new Date(tasksData[tasksData.length - 1].timestamp)));
                taskDateFromInstance.setDate(new Date(tasksData[tasksData.length - 1].timestamp));
            }

            var taskLaunchMode = {}, tasksCnt = 0;

            tasksData.forEach(function(task) {

                if(!task.canViewTask) {
                    M.toast({html: 'You do not have permission to view one or more actions for the "#' + task.id +': ' +
                            ( task.name || 'Unnamed') +'" task', displayLength: 10000});
                    return;
                }
                //console.log(task.id, task.canViewTask);

                if(prms && $.isArray(prms.removedTasks)) {
                    // don't showing removed tasks in the task list
                    // prms.removedTasks is a array of tasks ID: [taskID1, taskID2, ...]
                    if ($.inArray(String(task.id), prms.removedTasks) !== -1) return;
                }

                if(!task.name) var taskName = unnamedTaskName;
                else taskName = escapeHtml(task.name);

                if(!taskListParameters.selectedTaskID || taskListParameters.selectedTaskID === task.id) {
                    activeTaskName = taskName;
                    taskListParameters.selectedTaskID = task.id; // set selectedTaskID for the first task in the list
                }

                if(prms && typeof prms.onRemove === 'function') var removeHTML = '<i removeTask class="material-icons">close</i>';
                else removeHTML = '';

                if(prms && typeof prms.onAdd === 'function') var addHTML = '<i addToCurrentTask class="material-icons">add</i>';
                else addHTML = '';

                var launchMode = task.runType;
                if(launchMode > 100) {
                    var runByTime = launchMode;
                    if(runByTime > Date.now()) launchMode = 9; // waiting for time
                    else launchMode = 19; // task was launched on time
                }
                var approvedComment = '';
                if(task.userApproved) {
                    if(!task.userCanceled) {
                        approvedComment = ', approved by ' + escapeHtml(task.userApproved) + ' at ' +
                            new Date(task.changeStatusTimestamp).toLocaleString();
                        if(launchMode !== null && launchMode < 10)  launchMode += 20;
                    } else {
                        approvedComment = ', approved by ' + escapeHtml(task.userApproved) + ' and then canceled by ' +
                            escapeHtml(task.userCanceled) + ' at ' +   new Date(task.changeStatusTimestamp).toLocaleString();
                        if(launchMode !== null && launchMode < 10)  launchMode += 30;
                    }
                }

                var runStateComment = '; run state: ' + launchModeTheme[launchMode].comment;
                if(runByTime) runStateComment += ' at ' + new Date(runByTime).toLocaleString();

                taskLaunchMode[task.id] = launchMode;

                var approveAttr = '', approveBtnClass = '';
                if(task.canExecuteTask && launchMode !== null) {
                    approveAttr = ' data-approve-btn';
                    approveBtnClass = ' red';
                }

                if(taskListParameters.aprovedTasks && taskListParameters.aprovedTasks[task.id]) {
                    var approvedTaskInput = '<input type="hidden" id="taskRunType_' + escapeHtml(task.id) + '" value="' + launchMode + '">';
                    var icon = launchModeTheme[launchModeTheme[launchMode].nextLaunchMode].icon;
                    var dataColorAttr = 'red lighten-4';
                } else {
                    approvedTaskInput = '';
                    icon = launchModeTheme[launchMode].icon;
                    dataColorAttr = launchModeTheme[launchMode].color;
                }

                html += '\
<a href="#!" taskID="'+escapeHtml(task.id)+'" data-color="' + dataColorAttr + '" class="collection-item avatar black-text ' +
                    dataColorAttr + '">\
    <i class="material-icons circle' + approveBtnClass + '"' + approveAttr + '>' + icon + '</i>\
    <span>#'+escapeHtml(task.id)+': </span><span class="title">'+taskName+'</span><span>' + runStateComment + '</span>\
    <p>Created at '+ new Date(task.timestamp).toLocaleString()+' by '+escapeHtml(task.ownerFullName)+' ('+escapeHtml(task.ownerName)+
    ')' + approvedComment + '</p>\
    <span class="secondary-content">' + addHTML + removeHTML + '</span><span data-is-approved>' + approvedTaskInput + '</span>\
</a>\
';
                tasksCnt++;
            });

            var collapsibleTaskSettingsInstance = M.Collapsible.init(document.getElementById('collapsibleTaskSettings'), {
                onCloseStart: function () {
                    collapsibleTaskSettingsElmClosed = true;
                },
                onOpenEnd: function () {
                    collapsibleTaskSettingsElmClosed = false;
                    updateTaskList();
                },
            });
            var collapsibleHeaderElms = $('div.collapsible-header');
            var taskListElm = $('#taskList');

            if(!tasksCnt) {
                taskListElm.empty();

                collapsibleHeaderElms.addClass('active');
                collapsibleTaskSettingsInstance.open();

                if(prms && typeof prms.onComplete === 'function') prms.onComplete();
                if(typeof callback === 'function') callback();
                return;
            }

            taskListElm.html(html);

            // select task
            if(!activeTaskName) selectTask(taskListElm.children().first()); // first child
            else selectTask($('a[taskID="' + taskListParameters.selectedTaskID + '"'));

            collapsibleHeaderElms.addClass('active');
            collapsibleTaskSettingsInstance.open();

            $('i[removeTask]').click(function(event){
                event.stopPropagation(); // canceling event processing on a parent elements

                var taskID = $(this).parent().parent().attr('taskID');
                var taskName = $(this).parent().parent().children('span.title').text();
                $(this).parent().parent().remove();

                if(prms && typeof prms.onRemove === 'function') prms.onRemove(taskID, taskName);
            });

            $('a[taskID]').click(function() {
                taskClick($(this));
            });

            function taskClick(taskElm) {
                if(prms && typeof prms.onClick === 'function') {
                    var taskID = taskElm.attr('taskID');
                    var taskName = taskElm.children('span.title').text();
                    prms.onClick(taskID, taskName, function(err) {
                        if(err) return M.toast({html: err.message, displayLength: 4000});
                        else selectTask(taskElm);
                    });
                }
            }

            function selectTask(taskElm) {
                var taskID = taskElm.attr('taskID');
                var taskName = taskElm.children('span.title').text();

                if(taskElm.hasClass('active')) {
                    taskElm.removeClass('active').addClass(taskElm.attr('data-color'));
                    delete taskListParameters.selectedTaskID;
                    activeTaskName = '';
                } else {
                    var activeElm = $('a[taskID].active');
                    activeElm.removeClass('active').addClass(activeElm.attr('data-color'));
                    taskElm.removeClass(taskElm.attr('data-color')).addClass('active');
                    taskListParameters.selectedTaskID = Number(taskID);
                    activeTaskName = taskName;
                }
            }

            $('i[data-approve-btn]').click(function (event) {
                event.stopPropagation(); // canceling event processing on a parent elements

                var taskElm = $(this).parent();
                var taskID = taskElm.attr('taskID');
                var launchMode = taskLaunchMode[taskID];
                if(launchMode === null) return;
                var isApprovedElm = taskElm.find('span[data-is-approved]');

                if(!isApprovedElm.find('input').length) {
                    isApprovedElm.append('<input type="hidden" id="taskRunType_' + taskID+ '" value="' + launchMode + '">');
                    $(this).text(launchModeTheme[launchModeTheme[launchMode].nextLaunchMode].icon);
                    taskElm.removeClass(taskElm.attr('data-color')).attr('data-color', 'red lighten-4');
                    if(!taskListParameters.aprovedTasks) taskListParameters.aprovedTasks = {};
                    taskListParameters.aprovedTasks[taskID] = true;
                } else {
                    isApprovedElm.children().remove();
                    $(this).text(launchModeTheme[launchMode].icon);
                    taskElm.removeClass(taskElm.attr('data-color')).attr('data-color', launchModeTheme[launchMode].color);
                    delete taskListParameters.aprovedTasks[taskID];
                }

                // will skip reload selected task changes from other user
                //if(!taskElm.hasClass('active')) taskClick(taskElm);
                taskClick(taskElm);
            });

            $('i[addToCurrentTask]').click(function(event){
                event.stopPropagation(); // canceling event processing on a parent elements
                var taskElm = $(this).parent().parent();

                var taskID = taskElm.attr('taskID');
                var taskName = taskElm.children('span.title').text();

                if(prms && typeof prms.onAdd === 'function') prms.onAdd(taskID, taskName, taskElm.hasClass('active'));
            });

            if(!reloadTaskListMode && prms && typeof prms.onComplete === 'function') {
                prms.onComplete(taskListParameters.selectedTaskID, activeTaskName);
            }
            if(typeof callback === 'function') return callback(taskListParameters.selectedTaskID, activeTaskName);
        });
    }

})(jQuery); // end of jQuery name space