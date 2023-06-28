/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 25.03.2017.
 */
function onChangeObjects(objects) {
    JQueryNamespace.setSharedCounters(objects);
}

function callbackBeforeExec(callback) {
    JQueryNamespace.beforeExec(callback);
}

function callbackAfterExec(parameterNotUsed, callback) {
    JQueryNamespace.afterExec(parameterNotUsed, callback);
}

var JQueryNamespace = (function ($) {
    /**
     * Run after the page drawing is finished
     */
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
        modalPressAddOnTaskConfirmElm = $('#modalPressAddOnTaskConfirm');
        modalPressAddOnTaskConfirmNoElm = $('#modalPressAddOnTaskConfirmNo');
        modalPressAddOnTaskConfirmYesElm = $('#modalPressAddOnTaskConfirmYes');
        modalPressAddOnTaskConfirmTaskName = $('[data-modal-add-on-task-confirm-taskname]');
        modalChangeTaskConfirmElm = $('#modalChangeTaskConfirm');
        modalChangeTaskConfirmNoElm = $('#modalChangeTaskConfirmNo');
        modalChangeTaskConfirmYesElm = $('#modalChangeTaskConfirmYes');
        modalTimePassedConfirmElm = $('#modalTimePassedConfirm');
        modalTimePassedConfirmNoElm = $('#modalTimePassedConfirmNo');
        modalTimePassedConfirmYesElm = $('#modalTimePassedConfirmYes');

        initResizer();

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

        // add drag and drop form jquery-ui functions
        taskParametersAreaElm.sortable({
            stop: function() {
                updateActionsOrder();
                taskUpdated();
            }
        });

        taskParametersAreaElm.disableSelection();

        init(function() {
            initTaskExecutionCondition();

            // change the direction of opening the "select" drop-down list to "down"
            // so that the list is visible even on a small screen for taskGroup selector
            $('#newTaskGroupParent').click(function () {
                setTimeout(function () {
                    $('ul.select-dropdown').css({top: 0});
                }, 100);
            });

            // change the direction of opening the "select" drop-down list to "down"
            // so that the list is visible even on a small screen for taskCondition selector
            $('#taskExecutionConditionParent').click(function () {
                setTimeout(function () {
                    $('ul.select-dropdown').css({top: 0});
                }, 100);
            });

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
                        var taskActionID = $(this).attr('data-action-selector-btn');
                        var actionSelectorInputElm = $('[name=selected-' + taskActionID + ']');
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
            M.Tooltip.init(document.querySelectorAll('.toolTipped'), {inDuration: 500});
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
        mergeTasksData = {},
        taskListParameters = {
            onClick: onClickOnTask,
            onAdd: onAddTask,
            onRemove: onRemoveTask,
            onComplete: onCompleteDrawingTaskList,
            removedTasks: [],
        },
        removeTasksToastNowShowing = false;

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
        taskGroupForSearchElm,
        modalPressAddOnTaskConfirmElm,
        modalPressAddOnTaskConfirmNoElm,
        modalPressAddOnTaskConfirmYesElm,
        modalPressAddOnTaskConfirmTaskName,
        modalChangeTaskConfirmElm,
        modalChangeTaskConfirmNoElm,
        modalChangeTaskConfirmYesElm,
        modalTimePassedConfirmElm,
        modalTimePassedConfirmNoElm,
        modalTimePassedConfirmYesElm;

    return {
        init: init,
        beforeExec: beforeExec,
        afterExec: afterExec,
        setSharedCounters: function(_objects) {
            objects = _objects;
            setSharedCounters(_objects, null, null, function() {
                M.FormSelect.init(taskExecutionConditionElm[0], {});
            });
        },
    };

    /**
     * Run function after user press button to run action, but before running action
     * @param {function(Error)|function()} callback callback(err) if an error has occurred, then the action will not be started
     */
    function beforeExec(callback) {
        if($('#taskExecutionCondition').val() === 'runAtTime') {
            var timeParts = $('#runTaskAtTime').val().match(/^(\d\d?):(\d\d?)$/);
            var startTime = timeParts ? Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000 : 0;

            var timeToRun = Number($('#runTaskAtDateTimestamp').val()) + startTime;

            if (timeToRun < Date.now() - 30000) {
                modalTimePassedConfirmElm.modal({dismissible: false});
                modalTimePassedConfirmElm.modal('open');

                modalTimePassedConfirmNoElm.unbind().click(function () {
                    callback(new Error('Operation is canceled because task start time has expired: ' +
                        new Date(timeToRun).toLocaleString()));
                });
                modalTimePassedConfirmYesElm.unbind().click(function () {
                    // modalTimePassedConfirmYesElm.click(callback) will return an event as callback argument
                    callback();
                });
                return;
            }
        }
        callback();
    }

    /**
     * Run after the action is executed
     * @param {*} result action execution result. not used
     * @param {function()} callback callback()
     */
    function afterExec(result, callback) {
        clearRemovedTasks();
        delete taskListParameters.aprovedTasks;
        // task list will be refreshed automatically
        //drawTasksList(taskListParameters, callback);
        callback();
    }

    function onClickOnTask(taskID, taskName, callback) {

        if($('#taskUpdated').val()) {
            modalChangeTaskConfirmElm.modal({dismissible: false});
            modalChangeTaskConfirmElm.modal('open');

            modalChangeTaskConfirmNoElm.unbind().click(function () {
                callback(new Error('Change task operation canceled'));
            });
            modalChangeTaskConfirmYesElm.unbind().click(function () {
                drawTask(callback);
            });

        } else drawTask(callback);

        function drawTask(callback) {
            drawTaskParameters(taskID, taskName, !mergeTasksData.taskID, function (err) {
                if (!taskID || err) $('#taskSettings').addClass('hide');
                else $('#taskSettings').removeClass('hide');
                mergeTasksData = {};
                callback();
            });
        }
    }

    /**
     * Run when user press '+' button for add actions from the task to selected task
     * @param {number} taskID task ID
     * @param {string} taskName task name
     */
    function onAddTask(taskID, taskName) {
        modalPressAddOnTaskConfirmTaskName.html(taskName);
        modalPressAddOnTaskConfirmElm.modal({dismissible: false});
        modalPressAddOnTaskConfirmElm.modal('open');

        modalPressAddOnTaskConfirmNoElm.unbind().click(function () {
            mergeTasksData = {};
            M.toast({html: 'The task merge operation has been canceled', displayLength: 4000});
        });

        modalPressAddOnTaskConfirmYesElm.unbind().click(function () {
            taskUpdated('');
            mergeTasksData = {
                taskID: Number(taskID),
                taskName: taskName,
            };
        });
    }

    /**
     * Run when user press 'x' button for remove the selected task
     * @param {number} taskID task ID
     * @param {string} taskName task name
     */
    function onRemoveTask(taskID, taskName) {
        removedTasks[Number(taskID)] = taskName;
        $('#removedTaskIDs').val(Object.keys(removedTasks).join(','));

        taskListParameters.removedTasks = Object.keys(removedTasks);
        drawTasksList(taskListParameters);

        // remove tasks animation icon
        $('#removedTask').removeClass('hide');
        $('#removedTaskNum').text(Object.values(removedTasks).length);
        $('#removedTaskIcon').text('recycling').css({color: 'green'});
        setTimeout(function () {
            $('#removedTaskIcon').text('delete').css({color: 'red'});
        }, 300);
    }

    /**
     * Run when complete drawing the task list
     * @param {number} taskID selected task ID
     * @param {string} taskName selected task name
     */
    function onCompleteDrawingTaskList(taskID, taskName) {
        drawTaskParameters(taskID, taskName, true, function(err) {
            if(!taskID || err) $('#taskSettings').addClass('hide');
            else $('#taskSettings').removeClass('hide');
        });
    }

    /**
     * Initialize the task_maker action interface
     * @param {function()} callback callback()
     */
    function init(callback) {

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

        $('#removedTask').click(clearRemovedTasks).mouseover(function () { // show hint
            if(removeTasksToastNowShowing) return;
            removeTasksToastNowShowing = true;
            M.toast({
                html: 'Click on the trash to restore the tasks:<br/>' +
                    Object.keys(removedTasks).map(function (taskID) {
                        //var humanTaskID = String(taskID).replace(/^(.*)(.{5})$/, '$1 $2');
                        var humanTaskID = String(taskID).replace(/^(.*)(.{5})$/, '$2');
                        return '#' + humanTaskID + ': ' + removedTasks[taskID];
                    }).join('<br/>'),
                completeCallback: function () { removeTasksToastNowShowing = false; }
            });
        });

        $('#taskName').change(function () {
            taskUpdated(2); // not important update
        });

        newTaskGroupElm.change(function () {
            taskUpdated(2); // not important update
        });

        if(typeof(callback) === 'function') callback();
    }

    /**
     * Clear removed task from the trash, redraw task list and hide the trash
     */
    function clearRemovedTasks() {
        $('#removedTaskIDs').val('');
        $('#removedTaskNum').text('');

        taskListParameters.removedTasks = [];
        drawTasksList(taskListParameters);

        // restore tasks animation icon
        $('#removedTaskIcon').text('restore_from_trash').css({color: 'green'});
        setTimeout(function () {
            $('#removedTaskIcon').text('delete').css({color: 'red'});
            $('#removedTask').addClass('hide');
            removedTasks = {};
        }, 500);
    }

    /**
     * Init taskCondition select element
     */
    function initTaskExecutionCondition() {
        taskExecutionConditionElm.html(
            '<option data-requiredOption value="dontRun">Save but don\'t run the task</option>' +
            '<option data-requiredOption value="runByActions">Run selected actions but don\'t save the task</option>' +
            '<option data-requiredOption value="runNow">Ask to run the task immediately</option>' +
            '<option data-requiredOption="last" value="runAtTime">Ask to run the task at</option>');
    }

    /**
     * Get counters with run condition for specific objects
     * @param {Array<number>} objectIDs an array with object IDs
     * @param {function(Array<Object>)} callback callback(counterArray) where counterArray is
     * [{id:.., name:.., taskCondition:…, unitID:…, collectorID:…, debug:…, sourceMultiplier:…, groupID:…, OCID:…,
     * objectID:…, objectName:…, objectDescription:..}, …]
     */
    function getCounters(objectIDs, callback) {
        // add objectCache support in the future
        $.post(serverURL, {
            func: 'getCounters',
            objectsIDs: objectIDs.join(',')
        }, callback);
    }

    /**
     * Set shared counters
     * @param {Array<Object>} objects [{id:.., }]
     * @param {string|null} label optGroup label
     * @param {string|null} id exclusive attribute for options
     * @param {function()} callback callback()
     */
    function setSharedCounters(objects, label, id, callback) {
        var shared = !!label;
        if(!label) label = 'From selected objects';
        if(!id) id = 'data-value="counterFromSelectedObjects"';

        // remove option with equal OCID
        taskExecutionConditionElm.find('[' + id + ']').remove();
        if(!objects.length) {
            if(typeof callback === 'function') callback();
            return;
        }

        var objectIDs = objects.map(function(obj) {
            return obj.id;
        });
        // [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:...,
        // objectName:..., objectDescription:..}, ...]
        //$.post(serverURL, {func: 'getCounters', objectIDs: objectIDs.join(',')}, function (rows) {
        getCounters(objectIDs, function(rows) {

            if(shared) rows = Object.values(getSharedCountersFromAllCounters(objectIDs.length, rows));

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
            if(typeof callback === 'function') callback();
        });
    }

    /**
     * get array with shared counters for specific objects from all counters fro specific objects
     * @param {number} objectsNum number of objects
     * @param {Array<Object>} countersArray an array of the counters
     * @return {Object} sharedCounters[<counterID>] = {
     *  name: <counterName>,
     *  objectsNames: <array with object names>,
     *  OCIDs: <array with OCIDs>}
     */
    function getSharedCountersFromAllCounters(objectsNum, countersArray) {
        if(!countersArray || !countersArray.length) return {};

        var counters = {};
        countersArray.forEach(function (counter) {
            if(!counters[counter.id]) counters[counter.id] = [];
            counters[counter.id].push(counter);
        });

        var sharedCounters = {};
        for(var counterID in counters) {
            if(counters[counterID].length === objectsNum) {
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

    /**
     * Update input value with comma separated actions taskActionID, sorted by order as you see
     */
    function updateActionsOrder() {
        var actionsOrder = $('li[data-tasks-actions-id]').map(function() {
            return $(this).attr("data-tasks-actions-id");
        }).get();
        if(actionsOrder) $('#actionsOrder').val(actionsOrder.join(','));
        else console.error('Error create actionOrder');
    }

    /**
     * Set flag that task parameters was updated for prevent change the edited task and loss changes.
     * Value will be added to the <input id="taskUpdated">
     * @param {*} [val] value for indicate what was updates in the task. Set '' for remove that task was updated
     */
    function taskUpdated(val) {
        $('#taskUpdated').val(val === undefined ? '1' : String(val));
    }

    /**
     * Draw task actions and parameters (in the bottom window)
     * @param {number} taskID task ID
     * @param {string} taskName task name
     * @param {boolean} isCleanup clear the data in the window and draw task actions
     *      or add task actions from another task to the current task
     * @param {function(Error)|function()} callback callback(err)
     */
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

            var actionsRemain = Object.keys(actions).length;
            $('#taskExecutionConditionsDescription').text('');

            for(var taskActionID in actions) {
                var hasOParam = false;
                actions[taskActionID].parameters.forEach(function (actionParam) {
                    if(actionParam.name !== 'o' || !actionParam.value) return;
                    hasOParam = true;

                    try {
                        var _objects = JSON.parse(String(actionParam.value));
                    }  catch(err) {
                        _objects = [];
                        //console.log('Error parsing o parameter: ', err.message);
                    }

                    setSharedCounters(_objects, 'From task actions',
                        'data-value="OCIDsFromTaskActions"',function() {

                        // run setSharedCounters(objects); after draw all 'From task actions' options
                        M.FormSelect.init(taskExecutionConditionElm[0], {});
                        if(--actionsRemain) return;
                        setSharedCounters(objects, null,null, function () {
                            M.FormSelect.init(taskExecutionConditionElm[0], {});
                            if (!OCIDs.length) return;

                            // convert array to string
                            taskExecutionConditionElmPrevValue = OCIDs.map(function (OCID) {
                                return String(OCID);
                            });
                            var optionsHtml =
                                '<optgroup label="From task saved data" data-value="savedTaskExecutionCondition">';
                            var selected = task.runType === 11 ? '' : ' selected';
                            if(OCIDs.length > 20) { // on many conditions for task

                                var counters = {};
                                OCIDs.forEach(function (OCID) {
                                    var counterName = countersForOCIDs[OCID];
                                    if(!counters[counterName]) counters[counterName] = [objectsForOCIDs[OCID]];
                                    else counters[counterName].push(objectsForOCIDs[OCID]);
                                });

                                var conditionStrings = [];
                                for(var counterName in counters) {
                                    conditionStrings.push(counterName + ' for ' + counters[counterName].join(','));
                                }

                                $('#taskExecutionConditionsDescription').text('Condition description: ' +
                                    conditionStrings.join('; '));

                                optionsHtml += '<option value="' + OCIDs.join(',') +
                                    '"' + selected + ' data-value="savedTaskExecutionCondition">' +
                                    'Ask to run for ' + OCIDs.length + ' saved task conditions</option>';
                            } else {
                                OCIDs.forEach(function (OCID) {
                                    // remove option with equal OCID
                                    taskExecutionConditionElm.find('option[value="' + OCID + '"]').remove();
                                    optionsHtml += '<option value="' + OCID +
                                        '"' + selected +
                                        ' data-value="savedTaskExecutionCondition">Ask to run when ' +
                                        countersForOCIDs[OCID] + ' for ' + objectsForOCIDs[OCID] + '</option>';
                                });
                            }
                            optionsHtml += '</optgroup>';
                            if(task.runType !== 11) taskExecutionConditionElm.val('');
                            taskExecutionConditionElm.append(optionsHtml);

                            setActiveTaskConditionOption(task.runType, function () {
                                // disable option for running task immediately after saving
                                $('option[value=runByActions]').prop('disabled', !data.canExecuteTask);

                                M.FormSelect.init(taskExecutionConditionElm[0], {});
                            });
                        });
                    });
                });
                if(!hasOParam) --actionsRemain;
            }

            var groupID = taskGroupForSearchElm.val();
            var nextGroupIdx = workflow[groupID];
            if(typeof nextGroupIdx === 'number') groupID = nextGroupIdx;

            if(groupID) newTaskGroupElm.val(groupID);
            else newTaskGroupElm.val(taskGroupForSearchElm.val());

            $('#taskID').val(taskID || '');

            if(!isCleanup) {
                taskUpdated();
                for(taskActionID in actions) {
                    var newTaskActionID = taskActionID;
                    while($('li[data-tasks-actions-id="' + newTaskActionID + '"]').length) {
                        newTaskActionID = parseInt(String(Date.now()) +
                            String(parseInt(String(Math.random() * 100), 10)), 10);
                    }
                    if(newTaskActionID !== taskActionID) {
                        actions[newTaskActionID] = actions[taskActionID];
                        delete actions[taskActionID];
                        actions[newTaskActionID].addNewTaskActionID = true;
                    }
                }
            } else taskUpdated('');

            var taskActionIDs = Object.keys(actions);
            var html = '';
            // sort actions without actionsOrder for a new task
            if (taskName === unnamedTaskName || !taskName) {
                $('#taskName').val('');

                var actionsWithOrder = [], actionsWithoutOrder = [];
                taskActionIDs.forEach(function (taskActionID) {
                    if (actions[taskActionID].actionsOrder !== null) actionsWithOrder.push(taskActionID);
                    else actionsWithoutOrder.push(taskActionID);
                });

                taskActionIDs = actionsWithOrder;
                Array.prototype.push.apply(taskActionIDs, actionsWithoutOrder);
            } else $('#taskName').val(taskName);

            var newObjectSelectors = [];
            taskActionIDs.forEach(function (taskActionID) {
                //if(!actions.hasOwnProperty(taskActionID) || !actions[taskActionID].name) continue;
                taskActionID = Number(taskActionID);

                var action = actions[taskActionID];
                var actionName = escapeHtml(action.name);

                var actionDescription = (action.descriptionHTML ?
                    action.descriptionHTML : 'no description for this action');
                var actionIcon = (action.configuration && action.configuration.icon ?
                    escapeHtml(action.configuration.icon) : 'bookmark');
                var canAddParametersToAction = action.configuration && action.configuration.canAddParametersToAction;
                var actionID = escapeHtml(action.ID);
                //actionsIDs.push(actionID); // fill array of actions IDs for setSharedCounters()

                // 0 - Run action only if previous action completed without errors
                // binary 1 - Run action only if last executed action has an errors
                // binary 10 - Do not wait until previous actions will be completed
                var startupOptions = [0,1,2,3].indexOf(action.startupOptions) !== -1 ?
                    action.startupOptions : 3;

                html += '\
<li data-tasks-actions-id="' +taskActionID+ '">\
    <input type="hidden" name="actionName-'+taskActionID+'" value="'+actionName+'"/>\
    <input type="hidden" name="actionID-'+taskActionID+'" value="'+actionID+'"/>\
    <input type="hidden" name="selected-'+taskActionID+'" data-action-selector-input/>\
    <input type="hidden" name="addNewTaskActionID-'+taskActionID+'" value="' +
                    (actions[taskActionID].addNewTaskActionID ? 1 : 0) + '"/>\
    <div class="collapsible-header no-padding">\
        <ul class="collection" style="width: 100%">\
            <li class="collection-item avatar">\
                <i class="material-icons circle" data-action-selector-btn="' + taskActionID + '">'+actionIcon+'</i>\
                <p class="title section">'+actionName.toUpperCase()+'</p>\
                <p class="section">'+actionDescription.replace(/[\r\n]/g, '<br>')+'</p>\
                <div class="row">\
                    <div class="col s12 m3 l3 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-' + taskActionID +
                    '" value="4" id="runOnPrevSuccess-' + taskActionID+'"'+(startupOptions === 3 ? ' checked' : '')+'/>\
                            <span>Run anyway</span>\
                        </label>\
                    </div>\
                    <div class="col s12 m3 l3 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-' + taskActionID +
                    '" value="0" id="runOnPrevSuccess-' + taskActionID+'"'+(startupOptions === 0 ? ' checked' : '')+'/>\
                            <span>Run if previous action completed without errors</span>\
                        </label>\
                    </div>\
                    <div class="col s12 m3 l3 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-' + taskActionID +
                    '" value="1" id="runOnPrevUnSuccess-' + taskActionID+'"'+(startupOptions === 1 ? ' checked' : '')+'/>\
                            <span>Run if someone of previous actions executed with an errors</span>\
                        </label>\
                    </div>\
                    <div class="col s12 m3 l3 no-padding">\
                        <label>\
                            <input type="radio" name="startupOptions-' + taskActionID +
                    '" value="2" id="doNotWaitPrevious-'+taskActionID+'"'+(startupOptions === 2 ? ' checked' : '')+'/>\
                            <span>Run and don\'t wait until the previous action will be completed</>\
                        </label>\
                    </div>\
                </div>\
                <a delete-action class="secondary-content"><i class="material-icons right">close</i></a>\
            </li>\
        </ul>\
    </div>\
    <div class="collapsible-body row">\
        <div class="secondary-content">* insert %:PREV_ACTION_RESULT:% variable for using result of previous action\
        </div><div>&nbsp;</div>';

                var objectsSelectorOptions,
                    objectsSelectorJSONString = '',
                    objectsDescription = '',
                    actionParametersHTML = '';
                action.parameters.forEach(function(actionParam){

                    var prmDescription = '', canBeDeleted;
                    if(action.configuration && action.configuration.parameters) {
                        if (action.configuration.parameters[actionParam.name]) {

                            if (action.configuration.parameters[actionParam.name].description)
                                prmDescription = escapeHtml(action.configuration.parameters[actionParam.name].description);

                            if (action.configuration.parameters[actionParam.name].canBeDeleted) canBeDeleted = true;

                        } else {
                            var isFoundTemplate = false;
                            for(var name in action.configuration.parameters) {
                                if(name.indexOf('*') === -1) continue;
                                var reStr = escapeRegExp(name
                                    .replace(/\*/g, '%:!ASTERISK!:%'))
                                    .replace(/%:!ASTERISK!:%/g, '(.*?)');
                                try {
                                    var re = new RegExp(reStr, 'i');
                                } catch (e) {
                                    continue;
                                }

                                if(re.test(actionParam.name)) {
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

                    if(actionParam.name === 'o') {
                        objectsSelectorOptions = '';
                        objectsDescription = prmDescription ? prmDescription : 'Objects list';

                        if(!actionParam.value) return;

                        try {
                            JSON.parse(String(actionParam.value)).forEach(function(obj) {
                                objectsSelectorOptions += '<option value="'+obj.id+'">'+obj.name+'</option>';
                            });
                        } catch(err) {
                            objectsSelectorOptions += '<option value="'+actionParam.value+'">'+actionParam.value+'</option>';
                        }

                        objectsSelectorJSONString = actionParam.value;

                    } else {
                        actionParametersHTML += addActionParameter(Number(taskActionID), actionParam.name,
                            String(actionParam.value), prmDescription, canBeDeleted);
                    }
                });

                if(objectsSelectorOptions !== undefined) {// action has 'o' parameter
                    var objectSelectorID = escapeHtml('select_' + taskActionID + '-o');

                    html += '<select class="objects-selector browser-default" title="' + objectsDescription +
                        '" id="' + objectSelectorID + '" add-custom-object="variable" no-border=1 ' +
                        'description="Add objects or variable. Variable used for running task in action. ' +
                        'Variable name can be with or without \'%:\' and \':%\'. ' +
                        'Variable value can be an object ID, array of objects IDs, object name, array of objects names or ' +
                        'array of objects with objects IDs and objects names like [{name: object1Name, id: object1ID}, ' +
                        '{name: object2Name, id: object2ID}, ...]. ' +
                        'Also all of this except of single object ID can be a stringify JSON object.">'
                        + objectsSelectorOptions + '</select>' +
                        '<input type="hidden" id="' + escapeHtml('prm_' + taskActionID + '-o') + '" value="' +
                        escapeHtml(objectsSelectorJSONString) + '"/>';

                    newObjectSelectors.push(objectSelectorID);
                }
                html += actionParametersHTML;

                if(canAddParametersToAction) {
                    html += '\
        <div class="col s11 input-field">\
            <input type="text" id="newParameterName-' + taskActionID + '">\
            <label for="newParameterName-' + taskActionID +
                        '">Enter new parameter name for add to parameters list for action "' + actionName + '"</label>\
        </div>\
            <a href="#" data-add-action-parameter="' + taskActionID +
                    '" class="secondary-content"><i class="material-icons">add</i></a>';
                }

                html += '</div></li>';
            });

            if(!isCleanup) html += taskParametersAreaElm.html();

            taskParametersAreaElm.html(html);
            updateActionsOrder();

            newObjectSelectors.forEach(function (objectSelectorID) {
                // init new object selector and function onChange for object selector
                $('#' + objectSelectorID).objectsSelector(null, function(selectElm){
                    var inputElm = $('#'+selectElm.attr('id').replace(/^select/, 'prm'));

                    var objects = selectElm.children('option').map(function() {
                        var val = $(this).val();
                        return {
                            name: $(this).text(),
                            id: isNaN(Number(val)) ? val : Number(val),
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

            $('a[delete-action]').click(function() {
                $(this).parent().parent().parent().parent().remove();
                updateActionsOrder();
                taskUpdated();
            });

            $('a[delete-parameter]').click(function() {
                $(this).parent().remove();
                taskUpdated();
            });

            $('a[data-add-action-parameter]').click(function() {

                var newParameterNameElm = $(this).prev().children('input');
                var name = newParameterNameElm.val();
                if(/^[_a-zA-Z][_\-\da-zA-Z]*$/.test(name)) {
                    if(name.toLowerCase() !== 'username' &&
                        name.toLowerCase() !== 'actionName'.toLowerCase() &&
                        name.toLowerCase() !== 'actionID'.toLowerCase() &&
                        name.toLowerCase() !== 'taskActionID'.toLowerCase()
                    ) {
                        var taskActionID = $(this).attr('data-add-action-parameter');
                        if (taskActionID) {
                            taskActionID = Number(taskActionID);
                            if (taskActionID && taskActionID === parseInt(String(taskActionID), 10)) {
                                // addActionParameter(taskActionID, name, value, description, canBeDeleted)
                                $(this).prev().before(addActionParameter(taskActionID, name, '',
                                    null, true));

                                $('a[delete-parameter]').click(function () {
                                    $(this).parent().remove();
                                });
                                newParameterNameElm.val('');
                            }
                        }
                    } else {
                        M.toast({
                            html: 'You can\'t use parameter name like "username", "actionName", ' +
                                '"actionID", "taskActionID"',
                            displayLength: 5000,
                        });
                    }
                } else {
                    M.toast({
                        html: 'Incorrect or empty parameter name. Parameter name can contain only english alphabet ' +
                            'symbols, digits, "-" and "_"',
                        displayLength: 5000,
                    });
                }

                taskUpdated();
                M.updateTextFields(); // update active inputs and textAreas
                M.textareaAutoResize($('textarea'));
            });

            if(typeof(callback) === 'function') callback();
        });
    }

    /**
     * Set active task condition in the "Task execute condition" select element
     * @param {number} runType task.runType
     * @param {function()} callback callback()
     */
    function setActiveTaskConditionOption(runType, callback) {
        taskExecutionConditionElm.find('[data-value="savedTaskExecutionCondition"]').remove();
        taskExecutionConditionElm.find('[data-value="completed"]').remove();
        switch (runType) {
            case 11: // run once completed
            case 0: // run permanently
            case 1: // run once
                if(runType === 11) {
                    $('option[data-requiredOption="last"]').
                    after('<option data-value="completed" value="runCompleted">' +
                        'Task execution completed (Run the task when the condition is met)</option>');
                    taskExecutionConditionElmPrevValue = ['runCompleted'];
                    taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                }
                runTaskOnceElm.prop('checked', runType === 1 || runType === 11); // true for run once
                taskExecuteTimeSettingsAreaElm.addClass('hide');
                taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                //taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                //taskExecuteConditionSettingsAreaElm.removeClass('hide');
                callback();
                break;
            case 2: // run now
                taskExecutionConditionElmPrevValue = ['runNow'];
                taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                taskExecuteConditionSettingsAreaElm.addClass('hide');
                taskExecuteTimeSettingsAreaElm.addClass('hide');
                taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                setSharedCounters(objects, null, null, callback);
                break;
            case 12: // run now completed
                $('option[value="runNow"]').after('<option data-value="completed" value="runCompleted">' +
                    'Task execution completed (Run the task immediately)</option>');
                taskExecutionConditionElmPrevValue = ['runCompleted'];
                taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                taskExecuteConditionSettingsAreaElm.addClass('hide');
                taskExecuteTimeSettingsAreaElm.addClass('hide');
                taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                setSharedCounters(objects, null, null, callback);
                break;
            case null: // only save
                taskExecutionConditionElmPrevValue = ['dontRun'];
                taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                taskExecuteConditionSettingsAreaElm.addClass('hide');
                taskExecuteTimeSettingsAreaElm.addClass('hide');
                taskExecutionConditionDivElm.removeClass('l4').addClass('l6');
                setSharedCounters(objects, null, null, callback);
                break;
            default: // run by time
                taskExecutionConditionElmPrevValue = ['runAtTime']
                taskExecutionConditionElm.val(taskExecutionConditionElmPrevValue);
                var midnight = new Date(runType);
                midnight.setHours(0,0,0,0);
                runTaskAtDateInstance.setDate(midnight);
                runTaskAtDateElm.val(runTaskAtDateInstance.toString());
                runTaskAtDateTimestampElm.val(midnight.getTime());
                var d = new Date(runType);
                runTaskAtTimeElm.val(d.getHours() + ':' +
                    (d.getMinutes() < 10 ? '0' + d.getMinutes() : d.getMinutes()));
                taskExecuteConditionSettingsAreaElm.addClass('hide');
                taskExecutionConditionDivElm.removeClass('l6').addClass('l4');
                taskExecuteTimeSettingsAreaElm.removeClass('hide');
                setSharedCounters(objects, null, null, callback);
                break;
        }
    }

    /**
     * Escape regExp characters in the string for make a regExp from the string
     * @param {string} string string for regExp
     * @return {string} string with escaped regExp characters
     */
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    /**
     * Add action parameter to the action
     * @param {number} taskActionID
     * @param {string} name parameter name
     * @param {string} val parameter value
     * @param {string|null} description parameter description
     * @param {boolean} canBeDeleted is parameter can be deleted by user
     * @return {string} HTML with new parameter form
     */
    function addActionParameter(taskActionID, name, val, description, canBeDeleted) {

        var id = escapeHtml('prm_' + taskActionID + '-' + name);

        if(description === undefined) description = '';
        if(val === undefined) val = '';

        return('<div>\
                    <div class="col s11 input-field">\
                        <textarea data-actionParameter id="' + id + '" class="materialize-textarea">' +
            escapeHtml(val) + '</textarea>\
                        <label class="active" for="'+id+'">' + escapeHtml(name) +
            (description ? ': '+description : '') + '</label>\
                    </div>' + (canBeDeleted ?
                '<a href="#" delete-parameter class="secondary-content"><i class="material-icons">close</i></a>' : '') +
                '</div>');
    }
})(jQuery); // end of jQuery name space