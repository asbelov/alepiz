/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.03.2017.
 */
function onChangeObjects(objects){
    JQueryNamespace.setSharedCounters(objects);
}

function callbackBeforeExec(callback) {

    if($('#taskExecutionCondition').val() === 'runAtTime') {

        var timeParts = $('#runTaskAtTime').val().match(/^(\d\d?):(\d\d?)$/);
        var startTime = timeParts ? Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000 : 0;

        var timeToRun = Number($('#runTaskAtDateTimestamp').val()) + startTime;

        if (timeToRun < Date.now() - 30000) {
            var modalTimePassedConfirmElm = $('#modalTimePassedConfirm'),
                modalTimePassedConfirmNoElm = $('#modalTimePassedConfirmNo'),
                modalTimePassedConfirmYesElm = $('#modalTimePassedConfirmYes');

            modalTimePassedConfirmElm.modal({dismissible: false});
            modalTimePassedConfirmElm.modal('open');

            modalTimePassedConfirmNoElm.unbind('click').click(function () {
                callback(new Error('Operation is canceled because task start time has passed: ' +
                    new Date(timeToRun).toLocaleString()));
            });
            modalTimePassedConfirmYesElm.unbind('click').click(function () {
                callback();  // modalTimePassedConfirmYesElm.click(callback) will return an event as callback argument
            });
            return;
        }
    }

    callback();
}

function callbackAfterExec(callback) {
    JQueryNamespace.afterExec(callback);
}

var JQueryNamespace = (function ($) {
    $(function () {

        taskParametersAreaElm = $('#taskParametersArea');
        taskExecuteConditionSettingsAreaElm = $('#taskExecuteConditionSettingsArea');
        taskNameDivElm = $('#taskNameDiv');
        taskExecuteTimeSettingsAreaElm = $('#taskExecuteTimeSettingsArea');
        runTaskOnceElm = $('#runTaskOnce');
        newTaskGroupElm = $('#newTaskGroup');
        taskExecutionConditionElm = $('#taskExecutionCondition');
        taskExecutionConditionDivElm = taskExecutionConditionElm.parent();
        runTaskAtDateElm = $('#runTaskAtDate');
        runTaskAtDateTimestampElm = $('#runTaskAtDateTimestamp');

        var todayMidnight = new Date();
        todayMidnight.setHours(0,0,0,0);
        var dateOffset =
            Number(parameters.action.offsetDaysForRunTask) === parseInt(String(parameters.action.offsetDaysForRunTask)) ?
                Number(parameters.action.offsetDaysForRunTask) * 86400000 : 1;

        runTaskAtDateTimestampElm.val(todayMidnight.getTime() + dateOffset);
        runTaskAtDateInstance = M.Datepicker.init(runTaskAtDateElm[0], {
            firstDay: 1,
            format: 'dd mmmm, yy',
            setDefaultDate: true,
            defaultDate: new Date(todayMidnight.getTime() + dateOffset),
            autoClose: true,
            onClose: function() {
                runTaskAtDateTimestampElm.val((runTaskAtDateInstance.date).getTime());
                taskUpdated();
            },
        });
        runTaskAtTimeElm = $('#runTaskAtTime');
        if(parameters.action.defaultTimeForRunTask &&
            /^[012]\d:\d\d$/.test(parameters.action.defaultTimeForRunTask)) {
            runTaskAtTimeElm.val(parameters.action.defaultTimeForRunTask);
        }

        M.Timepicker.init(runTaskAtTimeElm[0], {
            twelveHour: false,
            showClearBtn: false,
            autoClose: true,
            onCloseEnd: taskUpdated,
        });

        // jquery-ui functions
        taskParametersAreaElm.sortable({
            stop: function() {
                updateActionsOrder();
                taskUpdated();
            }
        });

        taskParametersAreaElm.disableSelection();

        init(function() {
            initTaskExecutionCondition();

            taskExecutionConditionElm.change(function() {
                var selectedOptions = $(this).val();
                taskUpdated();
                if(!Array.isArray(taskExecutionConditionElmPrevValue)) taskExecutionConditionElmPrevValue = [];


                // finding new selected option
                for(var i = 0, newOption = ''; i < selectedOptions.length; i++) {
                    if(taskExecutionConditionElmPrevValue.indexOf(selectedOptions[i]) === -1) {
                        newOption = selectedOptions[i];
                        break;
                    }
                }
                //console.log(selectedOptions, taskExecutionConditionElmPrevValue, newOption);

                /*
                when choose option with value like "dontRun" or "runNow" or other not number option,
                uncheck other options and call M.FormSelect.init() for close select element
                when choose first option with number in value, unselect selected options
                when choose second or more options with number in value, do nothing and work like multiple select
                for select several OCIDs for make task execute conditions
                 */
                if(newOption &&
                    (!isOptionMultiple(newOption) ||
                    (isOptionMultiple(newOption) && !isOptionMultiple(selectedOptions[0])))) {

                    taskExecutionConditionElm.val([newOption]);

                    if(!isOptionMultiple(newOption)) M.FormSelect.init(taskExecutionConditionElm[0], {});
                    else if(!isOptionMultiple(selectedOptions[0])) {
                        var instance = M.FormSelect.getInstance(taskExecutionConditionElm[0]);
                        $(instance.dropdownOptions).find('input[type="checkbox"]:checked').first().prop('checked', false);
                    }
                    selectedOptions = [newOption] || [];
                }

                taskExecutionConditionElmPrevValue = taskExecutionConditionElm.val();
                if(selectedOptions.length !== 1) return;

                var value = selectedOptions[0];

                var actionSelectorBtnElms = $('i[data-action-selector-btn]');
                if(value === 'runByActions') {
                    actionSelectorBtnElms.addClass('red');
                    $('[data-action-selector-input]').val('1');

                    actionSelectorBtnElms.click(function (e) {
                        e.stopPropagation();
                        var sessionID = $(this).attr('data-action-selector-btn');
                        var actionSelectorInputElm = $('[name=selected-' + sessionID + ']');
                        if($(this).hasClass('red')) {
                            $(this).removeClass('red');
                            actionSelectorInputElm.val('');
                        } else {
                            $(this).addClass('red');
                            actionSelectorInputElm.val('1');
                        }
                    });
                } else {
                    actionSelectorBtnElms.removeClass('red');
                    actionSelectorBtnElms.unbind('click');
                }

                if(value === 'runNow' || value === 'dontRun' || value === 'runByActions') {
                    taskExecuteConditionSettingsAreaElm.addClass('hide');
                    taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                    taskExecuteTimeSettingsAreaElm.addClass('hide');
                } else if(value === 'runAtTime') {
                    taskExecuteConditionSettingsAreaElm.addClass('hide');
                    taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                    taskExecuteTimeSettingsAreaElm.removeClass('hide');
                } else {
                    //taskExecuteConditionSettingsAreaElm.removeClass('hide');
                    //taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                    taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                    taskExecuteTimeSettingsAreaElm.addClass('hide');
                }
                M.updateTextFields();
            });

            function isOptionMultiple(val) {
                return Number(val) || val.indexOf(',') !== -1;
            }

            runTaskOnceElm.click(taskUpdated);

            M.Collapsible.init(document.querySelectorAll('.collapsible'), {});
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {inDuration: 500});
            M.FormSelect.init(document.querySelectorAll('select'), {});
            M.updateTextFields(); // update active inputs
        });
    });

    var serverURL = parameters.action.link+'/ajax',
        objects = parameters.objects,
        taskParametersAreaElm,
        removedTasks = {},
        workflow = {},
        unnamedTaskName = 'New unnamed task',
        //actionsIDs = [],
        confirmYes,
        confirmNo,
        taskListParameters = {
            onClick: onClickOnTask,
            onAdd: onAddTask,
            onRemove: onRemoveTask,
            onComplete: onCompleteDrawingTaskList,
            removedTasks: []
        };

    var taskExecuteConditionSettingsAreaElm,
        taskNameDivElm,
        taskExecuteTimeSettingsAreaElm,
        newTaskGroupElm,
        runTaskOnceElm,
        taskExecutionConditionElm,
        taskExecutionConditionDivElm,
        taskExecutionConditionElmPrevValue = [],
        runTaskAtDateElm,
        runTaskAtDateTimestampElm,
        runTaskAtDateInstance,
        runTaskAtTimeElm,
        taskGroupForSearchElm;

    return {
        init: init,
        afterExec: afterExec,
        setSharedCounters: function(_objects, callback) {
            objects = _objects;
            setSharedCounters(_objects, callback);
        }
    };

    function afterExec(result, callback) {
        delete taskListParameters.aprovedTasks;
        drawTasksList(taskListParameters, callback);
    }

    function onClickOnTask(taskID, taskName, callback) {

        if($('#taskUpdated').val()) {
            var modalChangeTaskConfirmElm = $('#modalChangeTaskConfirm'),
                modalChangeTaskConfirmNoElm = $('#modalChangeTaskConfirmNo'),
                modalChangeTaskConfirmYesElm = $('#modalChangeTaskConfirmYes');

            modalChangeTaskConfirmElm.modal({dismissible: false});
            modalChangeTaskConfirmElm.modal('open');

            if(confirmNo) modalChangeTaskConfirmNoElm.unbind('click', confirmNo);
            if(confirmYes) modalChangeTaskConfirmYesElm.unbind('click', confirmYes);

            confirmYes = function () {
                drawTask(callback);
            };

            confirmNo = function () {
                callback(new Error('Change task operation canceled'));
            };

            modalChangeTaskConfirmNoElm.click(confirmNo);
            modalChangeTaskConfirmYesElm.click(confirmYes);

        } else drawTask(callback);

        function drawTask(callback) {
            drawTaskParameters(taskID, taskName, true, function(err) {
                if(!taskID || err) $('#taskSettings').addClass('hide');
                else $('#taskSettings').removeClass('hide');
                callback();
            });
        }
    }

    function onAddTask(taskID, taskName, isSelected) {
        drawTaskParameters(taskID, taskName, false, function(err) {
            if(isSelected) $('#taskID').val(''); // create a new task, when click "+" on a selected task
            if(!taskID || err) $('#taskSettings').addClass('hide');
            else $('#taskSettings').removeClass('hide');
        });
    }

    function onRemoveTask(taskID, taskName) {
        removedTasks[Number(taskID)] = taskName;
        $('#removedTaskList').val(Object.values(removedTasks).join('\n'));
        $('#removedTaskIDs').val(Object.keys(removedTasks).join(','));
        $('#removedTaskCard').removeClass('hide');
        M.updateTextFields();

        taskListParameters.removedTasks = Object.keys(removedTasks);
        drawTasksList(taskListParameters);
    }

    function onCompleteDrawingTaskList(taskID, taskName) {
        drawTaskParameters(taskID, taskName, true, function(err) {
            if(!taskID || err) $('#taskSettings').addClass('hide');
            else $('#taskSettings').removeClass('hide');
        });
    }

    function init(callback){

        initTaskList($('#taskListArea'), taskListParameters, function() {
            // set variable after draw element
            taskGroupForSearchElm = $('#taskGroupForSearch');
            // copy task groups to the newTaskGroup selector
            newTaskGroupElm.html(taskGroupForSearchElm.html());
            M.FormSelect.init(newTaskGroupElm[0], {});
            try {
                workflow = JSON.parse($('#workflow').val());
            } catch (e) {}
        });

        $('#clearListOfRemovedTasks').click(function(){
            removedTasks = {};
            $('#removedTaskList').val('');
            $('#removedTaskIDs').val('');
            $('#removedTaskCard').addClass('hide');

            taskListParameters.removedTasks = [];
            drawTasksList(taskListParameters);
        });

        $('#taskName').change(function () {
            taskUpdated(2); // not important update
        });

        newTaskGroupElm.change(function () {
            taskUpdated(2); // not important update
        });

        if(typeof(callback) === 'function') callback();
    }

    function initTaskExecutionCondition() {
        taskExecutionConditionElm.html(
            '<option data-requiredOption value="dontRun">Save but don\'t run the task</option>' +
            '<option data-requiredOption value="runByActions">Run selected actions but don\'t save the task</option>' +
            '<option data-requiredOption value="runNow">Ask to run the task immediately</option>' +
            '<option data-requiredOption="last" value="runAtTime">Ask to run the task at</option>');
    }

    function setSharedCounters(objects, label, id, callback) {
        var shared = !!label;
        if(!label) label = 'From selected objects';
        if(!id) id = 'data-value="counterFromSelectedObjects"';

        // remove option with equal OCID
        taskExecutionConditionElm.find('[' + id + ']').remove();
        M.FormSelect.init(taskExecutionConditionElm[0], {});
        if(!objects.length) {
            if(typeof callback === 'function') callback();
            return;
        }

        var objectsIDs = objects.map(function(obj) {
            return obj.id;
        });
        // [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
        $.post(serverURL, {func: 'getCounters', objectsIDs: objectsIDs.join(',')}, function (rows) {

            if(shared) rows = Object.values(getSharedCountersFromAllCounters(objectsIDs.length, rows));

            if(!Array.isArray(rows) || !rows.length) {
                if(typeof callback === 'function') callback();
                return;
            }

            var selectOptions = rows.map(function (row) {
                var OCIDs = row.OCIDs ? row.OCIDs.sort().join(',') : row.OCID;
                var objectsNames = row.objectsNames ? row.objectsNames.sort().join(',') : row.objectName;

                if(taskExecutionConditionElm.find('option[value="' + OCIDs+ '"]').length) return '';
                return '<option ' + id + ' value="' + OCIDs + '">Ask to run when ' +
                    row.name + ' for ' + objectsNames + '</option>';
            });

            if(selectOptions.join('').length) {
                var optGroupElm = $('optgroup[label="' + label + '"]');
                if(optGroupElm.length) {
                    optGroupElm.append(selectOptions.join(''));
                } else {
                    var html = '<optgroup label="' + label + '" ' + id + '>' +
                        selectOptions.join('') + '</optgroup>';
                    taskExecutionConditionElm.append(html);
                }
            }
            M.FormSelect.init(taskExecutionConditionElm[0], {});
            if(typeof callback === 'function') callback();
        });

        /*
        get array with shared counters for specific objects from all cpounters fro specific objects

        objectsCnt: count of objects
        countersArray: [{id: <counterID>, .....}, ]

        return sharedCounters: [{id: <counterID>, .....}, ]

     */
        function getSharedCountersFromAllCounters(objectsCnt, countersArray) {
            if(!countersArray || !countersArray.length) return [];

            var counters = {};
            countersArray.forEach(function (counter) {
                if(!counters[counter.id]) counters[counter.id] = [];
                counters[counter.id].push(counter);
            });

            var sharedCounters = {};
            for(var counterID in counters) {
                if(counters[counterID].length === objectsCnt) {
                    counters[counterID].forEach(function (counter) {
                        if(!sharedCounters[counterID]) {
                            sharedCounters[counterID] = {
                                name: counter.name,
                                objectsNames: [counter.objectName],
                                OCIDs: [counter.OCID],
                            }
                        } else {
                            sharedCounters[counterID].OCIDs.push(counter.OCID);
                            sharedCounters[counterID].objectsNames.push(counter.objectName);
                        }
                    });
                }
            }

            return sharedCounters;
        }
    }

    /*
    Update input value with comma separated actions sessionID, sorted by order as you see
     */
    function updateActionsOrder() {
        var actionsOrder = $('li[sessionID]').map(function(){return $(this).attr("sessionID");}).get();
        if(actionsOrder) $('#actionsOrder').val(actionsOrder.join(','));
    }

    function taskUpdated(val) {
        $('#taskUpdated').val(val === undefined ? '1' : String(val));
    }

    function drawTaskParameters(taskID, taskName, isCleanup, callback) {

        if(!taskID) {
            if(typeof(callback) === 'function') return callback();
            return;
        }

        $.post(serverURL, {func: 'getTaskParameters', id: taskID}, function (data) {

            if(!data || !data.actions || !data.parameters) {
                if(typeof(callback) === 'function') return callback(new Error('No task data returned'));
                return;
            }

            var actions = data.actions;
            var task = data.parameters;
            var OCIDs = data.OCIDs || [];
            var objectsForOCIDs = data.objects || {};
            var countersForOCIDs = data.counters;
            if(isCleanup) {

                var actionsRemain = Object.keys(actions).length;
                $('#taskExecutionConditionsDescription').text('');

                for(var sessionID in actions) {
                    var hasOParam = false;
                    actions[sessionID].parameters.forEach(function (prm) {
                        if(prm.name !== 'o' || !prm.value) return;
                        hasOParam = true;

                        try {
                            var _objects = JSON.parse(prm.value);
                        }  catch(err) {
                            _objects = [];
                            //console.log('Error parsing o parameter: ', err.message);
                        }

                        setSharedCounters(_objects, 'From task actions',
                            'data-value="OCIDsFromTaskActions"',function() {

                            // run setSharedCounters(objects); after draw all 'From task actions' options
                            if(--actionsRemain) return;
                            setSharedCounters(objects, null,null, function () {
                                if (!OCIDs.length) return;

                                // convert array to string
                                taskExecutionConditionElmPrevValue = OCIDs.map(function (OCID) {
                                    return String(OCID);
                                });
                                var optionsHtml = '<optgroup label="From task saved data" data-value="savedTaskExecutionCondition">';
                                var selected = task.runType === 11 ? '' : ' selected';
                                if(OCIDs.length > 20) { // on many conditions for task

                                    var counters = {};
                                    OCIDs.forEach(function (OCID) {
                                        var counterName = countersForOCIDs[OCID];
                                        if(!counters[counterName]) counters[counterName] = [objectsForOCIDs[OCID]];
                                        else counters[counterName].push(objectsForOCIDs[OCID]);
                                    });

                                    var conditionStrs = [];
                                    for(var counterName in counters) {
                                        conditionStrs.push(counterName + ' for ' + counters[counterName].join(','));
                                    }

                                    $('#taskExecutionConditionsDescription').text('Condition description: ' +
                                        conditionStrs.join('; '));

                                    optionsHtml += '<option value="' + OCIDs.join(',') +
                                        '"' + selected + ' data-value="savedTaskExecutionCondition">' +
                                        'Ask to run for ' + OCIDs.length + ' saved task conditions</option>';
                                } else {
                                    OCIDs.forEach(function (OCID) {
                                        // remove option with equal OCID
                                        taskExecutionConditionElm.find('option[value="' + OCID + '"]').remove();
                                        optionsHtml += '<option value="' + OCID +
                                            '"' + selected + ' data-value="savedTaskExecutionCondition">Ask to run when ' +
                                            countersForOCIDs[OCID] + ' for ' + objectsForOCIDs[OCID] + '</option>';
                                    });
                                }
                                optionsHtml += '</optgroup>';
                                if(task.runType !== 11) taskExecutionConditionElm.val('');
                                taskExecutionConditionElm.append(optionsHtml);
                                M.FormSelect.init(taskExecutionConditionElm[0], {});
                            });
                        });
                    });
                    if(!hasOParam) --actionsRemain;
                }

                taskExecutionConditionElm.find('[data-value="savedTaskExecutionCondition"]').remove();
                taskExecutionConditionElm.find('[data-value="completed"]').remove();
                switch (task.runType) {
                    case 11: // run once completed
                    case 0: // run permanently
                    case 1: // run once
                        if(task.runType === 11) {
                            $('option[data-requiredOption="last"]').
                            after('<option data-value="completed" value="runCompleted">' +
                                'Task execution completed (Run the task when the condition is met)</option>');
                            taskExecutionConditionElmPrevValue = ['runCompleted'];
                            taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                        }
                        runTaskOnceElm.prop('checked', task.runType === 1 || task.runType === 11); // true for run once
                        taskExecuteTimeSettingsAreaElm.addClass('hide');
                        taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                        //taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                        //taskExecuteConditionSettingsAreaElm.removeClass('hide');
                        break;
                    case 2: // run now
                        taskExecutionConditionElmPrevValue = ['runNow'];
                        taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                        setSharedCounters(objects);
                        taskExecuteConditionSettingsAreaElm.addClass('hide');
                        taskExecuteTimeSettingsAreaElm.addClass('hide');
                        taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                        break;
                    case 12: // run now completed
                        $('option[value="runNow"]').after('<option data-value="completed" value="runCompleted">' +
                            'Task execution completed (Run the task immediately)</option>');
                        taskExecutionConditionElmPrevValue = ['runCompleted'];
                        taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                        setSharedCounters(objects);
                        taskExecuteConditionSettingsAreaElm.addClass('hide');
                        taskExecuteTimeSettingsAreaElm.addClass('hide');
                        taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                        break;
                    case null: // only save
                        taskExecutionConditionElmPrevValue = ['dontRun'];
                        taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                        setSharedCounters(objects);
                        taskExecuteConditionSettingsAreaElm.addClass('hide');
                        taskExecuteTimeSettingsAreaElm.addClass('hide');
                        taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                        break;
                    default: // run by time
                        taskExecutionConditionElmPrevValue = ['runAtTime']
                        taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                        setSharedCounters(objects);
                        var midnight = new Date(task.runType);
                        midnight.setHours(0,0,0,0);
                        runTaskAtDateInstance.setDate(midnight);
                        runTaskAtDateElm.val(runTaskAtDateInstance.toString());
                        runTaskAtDateTimestampElm.val(midnight.getTime());
                        var d = new Date(task.runType);
                        runTaskAtTimeElm.val(d.getHours() + ':' + (d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes()));
                        taskExecuteConditionSettingsAreaElm.addClass('hide');
                        taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                        taskExecuteTimeSettingsAreaElm.removeClass('hide');
                        break;
                }

                // disable option for running task immediately after saving
                $('option[value=runByActions]').prop('disabled', !data.canExecuteTask);

                var groupID = taskGroupForSearchElm.val();
                var nextGroupIdx = workflow[groupID];
                if(typeof nextGroupIdx === 'number') groupID = nextGroupIdx;

                if(groupID) newTaskGroupElm.val(groupID);
                else newTaskGroupElm.val(taskGroupForSearchElm.val());

                $('#taskID').val(taskID || '');

                taskUpdated('')
            } else {
                taskUpdated();

                for(sessionID in actions) {
                    var newSessionID = sessionID;
                    while($('li[sessionID="' + newSessionID + '"]').length) {
                        newSessionID = parseInt(String(Date.now()) + String(parseInt(String(Math.random() * 100), 10)), 10);
                    }
                    if(newSessionID !== sessionID) {
                        actions[newSessionID] = actions[sessionID];
                        delete actions[sessionID];
                        actions[newSessionID].addNewSessionID = true;
                    }
                }
            }

            var sessionIDs = Object.keys(actions);
            var html = isCleanup ? '' : taskParametersAreaElm.html();
            // sort actions without actionsOrder for a new task
            if (taskName === unnamedTaskName || !taskName) {
                if(isCleanup) $('#taskName').val('');

                var actionsWithOrder = [], actionsWithoutOrder = [];
                sessionIDs.forEach(function (sessionID) {
                    if (actions[sessionID].actionsOrder !== null) actionsWithOrder.push(sessionID);
                    else actionsWithoutOrder.push(sessionID);
                });

                sessionIDs = actionsWithOrder;
                Array.prototype.push.apply(sessionIDs, actionsWithoutOrder);
            } else if(isCleanup) $('#taskName').val(taskName);

            var newObjectSelectors = [];
            sessionIDs.forEach(function (sessionID) {
                //if(!actions.hasOwnProperty(sessionID) || !actions[sessionID].name) continue;


                var action = actions[sessionID];
                var actionName = escapeHtml(action.name);

                /*
                if(!isCleanup && $('li[sessionID=' + sessionID + ']').attr('sessionID')) {
                    M.toast({html: 'Try to add same action ' + actionName + ' (' + sessionID + ') to task', displayLength: 10000});
                    //console.log(sessionIDs, sessionID);
                    return;
                }
                 */

                var actionDescription = (action.descriptionHTML ? action.descriptionHTML : 'no description for this action');
                var actionIcon = (action.configuration && action.configuration.icon ? escapeHtml(action.configuration.icon) : 'bookmark');
                var canAddParametersToAction = action.configuration && action.configuration.canAddParametersToAction;
                var actionID = escapeHtml(action.ID);
                //actionsIDs.push(actionID); // fill array of actions IDs for setSharedCounters()

                // 0 - Run action only if previous action completed without errors
                // binary 1 - Run action only if last executed actionhas an errors
                // binary 10 - Do not wait until previous actions will be completed
                var startupOptions = action.startupOptions ? Number(action.startupOptions) : 0;

                html += '\
<li sessionID="' +sessionID+ '">\
    <input type="hidden" name="actionName-'+sessionID+'" value="'+actionName+'"/>\
    <input type="hidden" name="actionID-'+sessionID+'" value="'+actionID+'"/>\
    <input type="hidden" name="selected-'+sessionID+'" data-action-selector-input/>\
    <input type="hidden" name="addNewSessionID-'+sessionID+'" value="' + (actions[sessionID].addNewSessionID ? 1 : 0) + '"/>\
    <div class="collapsible-header no-padding">\
        <ul class="collection" style="width: 100%">\
            <li class="collection-item avatar">\
                <i class="material-icons circle" data-action-selector-btn="' + sessionID + '">'+actionIcon+'</i>\
                <p class="title section">'+actionName.toUpperCase()+'</p>\
                <p class="section">'+actionDescription.replace(/[\r\n]/g, '<br>')+'</p>\
                <div class="row">\
                    <div class="col s12 m4 l4 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-'+sessionID+'" value="0" id="runOnPrevSuccess-'+sessionID+'"'+(!startupOptions ? ' checked' : '')+'/>\
                            <span>Run if previous action completed without errors</>\
                        </label>\
                    </div>\
                    <div class="col s12 m4 l4 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-'+sessionID+'" value="1" id="runOnPrevUnSuccess-'+sessionID+'"'+(startupOptions === 1 ? ' checked' : '')+'/>\
                            <span>Run if someone of previous actions executed with an errors</span>\
                        </label>\
                    </div>\
                    <div class="col s12 m4 l4 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-'+sessionID+'" value="2" id="doNotWaitPrevious-'+sessionID+'"'+(startupOptions === 2 ? ' checked' : '')+'/>\
                            <span>Run and don\'t wait until the previous action will be completed</>\
                        </label>\
                    </div>\
                </div>\
                <a delete-action class="secondary-content"><i class="material-icons right">close</i></a>\
            </li>\
        </ul>\
    </div>\
    <div class="collapsible-body row">\
        <div class="secondary-content">* insert %:PREV_ACTION_RESULT:% variable for using result of previous action</div><div>&nbsp;</div>';

                var objectsSelectorOptions, objectsSelectorJSONString = '', objectsDescription = '', actionParametersHTML = '';
                action.parameters.forEach(function(prm){

                    var prmDescription = '', canBeDeleted;
                    if(action.configuration && action.configuration.parameters) {
                        if (action.configuration.parameters[prm.name]) {

                            if (action.configuration.parameters[prm.name].description)
                                prmDescription = escapeHtml(action.configuration.parameters[prm.name].description);

                            if (action.configuration.parameters[prm.name].canBeDeleted) canBeDeleted = true;

                        } else {
                            var isFoundTemplate = false;
                            for(var name in action.configuration.parameters) {
                                if(name.indexOf('*') === -1) continue;
                                var reStr = escapeRegExp(name.replace(/\*/g, '%:!ASTERISK!:%')).replace(/%:!ASTERISK!:%/g, '(.*?)');
                                try {
                                    var re = new RegExp(reStr, 'i');
                                } catch (e) {
                                    continue;
                                }

                                if(re.test(prm.name)) {
                                    if (action.configuration.parameters[name].description)
                                        prmDescription = escapeHtml(action.configuration.parameters[name].description);

                                    if (action.configuration.parameters[name].canBeDeleted) canBeDeleted = true;
                                    isFoundTemplate = true;
                                    break;
                                }
                            }

                            // all not described parameters can be deleted
                            if(!isFoundTemplate) canBeDeleted = true;
                        }
                    }

                    if(prm.name === 'o') {
                        objectsSelectorOptions = '';
                        objectsDescription = prmDescription ? prmDescription : 'Objects list';

                        if(!prm.value) return;

                        try {
                            JSON.parse(prm.value).forEach(function(obj) {
                                objectsSelectorOptions += '<option value="'+obj.id+'">'+obj.name+'</option>';
                            });
                        } catch(err) {
                            objectsSelectorOptions += '<option value="'+prm.value+'">'+prm.value+'</option>';
                        }

                        objectsSelectorJSONString = prm.value;

                    } else actionParametersHTML += actionParameter(sessionID, prm.name, prm.value, prmDescription, canBeDeleted);
                });

                if(objectsSelectorOptions !== undefined) {// action has 'o' parameter
                    var objectSelectorID = escapeHtml('select_' + sessionID + '-o');

                    html += '<select class="objects-selector browser-default" title="' + objectsDescription +
                        '" id="' + objectSelectorID + '" add-custom-object="variable" no-border=1 ' +
                        'description="Add objects or variable. Variable used for running task in action. ' +
                        'Variable name can be with or without \'%:\' and \':%\'. ' +
                        'Variable value can be an object ID, array of objects IDs, object name, array of objects names or ' +
                        'array of objects with objects IDs and objects names like [{name: object1Name, id: object1ID}, {name: object2Name, id: object2ID}, ...]. ' +
                        'Also all of this except of single object ID can be a stringify JSON object.">'
                        + objectsSelectorOptions + '</select>' +
                        '<input type="hidden" id="' + escapeHtml('prm_' + sessionID + '-o') + '" value="' + escapeHtml(objectsSelectorJSONString) + '"/>';

                    newObjectSelectors.push(objectSelectorID);
                }
                html += actionParametersHTML;

                if(canAddParametersToAction) {
                    html += '\
        <div class="col s11 input-field">\
            <input type="text" id="newParameterName-'+sessionID+'">\
            <label for="newParameterName-'+sessionID+'">Enter new parameter name for add to parameters list for action "'+actionName+'"</label>\
        </div>\
        <a href="#!" add-parameter-action="'+sessionID+'" class="secondary-content"><i class="material-icons">add</i></a>';
                }

                html += '\
    </div>\
</li>';
            });

            // don\'t use empty().append(html) because it will be slow redrawing
            taskParametersAreaElm.html(html);
            updateActionsOrder();

            newObjectSelectors.forEach(function (objectSelectorID) {
                // init new object selector and function onChange for object selector
                $('#' + objectSelectorID).objectsSelector(null, function(selectElm){
                    var inputElm = $('#'+selectElm.attr('id').replace(/^select/, 'prm'));

                    var objects = selectElm.children('option').map(function() {
                        var val = $(this).val();
                        if(val && Number(val) === parseInt(String(val), 10)) val = Number(val);

                        return {
                            name: $(this).text(),
                            id: val
                        }
                    }).get();

                    if(objects.length) {
                        if(objects[0].name === objects[0].id) inputElm.val(objects[0].id); // for variable
                        else inputElm.val(JSON.stringify(objects)); // for real objects
                    } else inputElm.val('');
                    taskUpdated();
                });
            });

            M.FormSelect.init(document.querySelectorAll('select'), {});
            M.updateTextFields(); // update active inputs and textAreas
            M.textareaAutoResize($('textarea'));

            $('input[type=radio]').change(taskUpdated);
            $('[data-actionParameter]').change(taskUpdated);

            $('a[delete-action]').click(function(){
                $(this).parent().parent().parent().parent().remove();
                updateActionsOrder();
                taskUpdated();
            });

            $('a[delete-parameter]').click(function(){
                $(this).parent().remove();
                taskUpdated();
            });

            $('a[add-parameter-action]').click(function(){

                var newParameterNameElm = $(this).prev().children('input');
                var name = newParameterNameElm.val();
                if(/^[_a-zA-Z][_\-\da-zA-Z]*$/.test(name)) {
                    if(name.toLowerCase() !== 'username' &&
                        name.toLowerCase() !== 'actionname' &&
                        name.toLowerCase() !== 'actionid' &&
                        name.toLowerCase() !== 'sessionid'
                    ) {
                        var sessionID = $(this).attr('add-parameter-action');
                        if (sessionID) {
                            sessionID = Number(sessionID);
                            if (sessionID && sessionID === parseInt(String(sessionID), 10)) {
                                // actionParameter(sessionID, name, value, description, canBeDeleted)
                                $(this).prev().before(actionParameter(sessionID, name, '', null, true));

                                $('a[delete-parameter]').click(function () {
                                    $(this).parent().remove();
                                });
                                newParameterNameElm.val('');
                            }
                        }
                    } else M.toast({html: 'You can\'t use parameters name like "username" or "actionName"', displayLength: 5000});
                } else M.toast({html: 'Incorrect or empty parameter name. Parameter name can contain only english alphabet symbols, digits, "-" and "_"', displayLength: 5000});
                taskUpdated();
                M.updateTextFields(); // update active inputs and textAreas
                M.textareaAutoResize($('textarea'));
            });

            if(typeof(callback) === 'function') callback();
        });
    }

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    function actionParameter(sessionID, name, val, description, canBeDeleted) {

        var id = escapeHtml('prm_'+sessionID+'-'+name);

        // if object with this id exists, return ''
        /*
        if($('#'+id).attr('id')){
            M.toast({html: 'Parameter with name "'+name+'" already exists', displayLength: 5000});
            return '';
        }
        */

        if(description === undefined) description = '';
        if(val === undefined) val = '';

        return('<div>\
                    <div class="col s11 input-field">\
                        <textarea data-actionParameter id="'+id+'" class="materialize-textarea">'+ escapeHtml(val) +'</textarea>\
                        <label class="active" for="'+id+'">' + escapeHtml(name) + (description ? ': '+description : '') + '</label>\
                    </div>\
                    ' + (canBeDeleted ? '<a href="#!" delete-parameter class="secondary-content"><i class="material-icons">close</i></a>' : '') + '\
                </div>')
    }
})(jQuery); // end of jQuery name space