/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-4-9 21:01:14
*/

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

function callbackBeforeExec(callback) {
    JQueryNamespace.beforeExec(callback);
}

// The functions will be passed from the parent frame
// describe the function here to prevent the error message
if(!getActionParametersFromBrowserURL) getActionParametersFromBrowserURL = function (callback) {callback();}

var JQueryNamespace = (function ($) {
    $(function () {
        // Will run after finishing drawing the page

        importanceFilterElm = $('#importance-filter');
        counterGroupsFilterElm = $('#counters-groups-filter');
        eventsListElm = $('#events-list');
        hintSubjectElm = $('#hint-subject');
        hintEditorElm = $('#hint-editor');
        disableCommentSubjectElm = $('#disable-comment-subject');
        disableCommentEditorElm = $('#disable-comment-editor');
        counterCollectorSettingsElm = $('#counter-collector-settings');
        linkHintsToObjectsCbElm = $('#link-hint-to-objects-cb');
        disabledTabElm = $('#disabled-tab');
        disabledIntervalsObjectsInfoElm = $('#disabled-intervals-objects-info');
        counterIDElm = $('#counter-id');
        counterNameElm = $('#counterName');
        eventDescriptionElm = $('#event-description');
        eventPronunciationElm = $('#event-pronunciation');
        eventImportanceElm = $('#event-importance');
        eventDurationElm = $('#event-duration');
        eventTaskOnProblemElm = $('#event-task-on-problem');
        eventTaskOnSolvedElm = $('#event-task-on-solved');
        counterGroupsElm = $('#counterGroup');
        //commentEditorTabElm = $('#comment-editor-tab');
        addDisabledIntervalBtnElm = $('#add-disabled-interval-btn');
        disabledIntervalsPanelElm = $('#disabled-intervals');
        disableUntilDateElm = $('#disableUntilDate');
        disableUntilTimeElm = $('#disableUntilTime');
        disableTimeIntervalsElm = $('#disable-time-intervals');
        disableTimeIntervalFromElm = $('#disableTimeIntervalFrom');
        disableTimeIntervalToElm = $('#disableTimeIntervalTo');
        switchOnHintCBElm = $('#switchOnHint');
        switchOnDisableCBElm = $('#switchOffDisable');
        switchOnSettingsElm = $('#switchOnSettings');
        keepHistoryElm = $('#keepHistory');
        counterDisabledCBElm = $('#counterDisabledCB');
        taskConditionCBElm = $('#taskConditionCB');
        debugCBElm = $('#debugCB');
        counterDisabledCBSharedElm = $('#counterDisabledCBShared');
        taskConditionCBSharedElm = $('#taskConditionCBShared');
        debugCBSharedElm = $('#debugCBShared');
        counterDescriptionElm = $('#counterDescription');
        counterDescriptionSharedElm = $('#counterDescriptionShared');
        disableUntilElm = $('#disableUntil');
        openCounterSettingsElm = $('#openCounterSettings');

        init(true);
    });

    var serverURL = parameters.action.link+'/ajax'; // path to ajax
    var quillHint, quillDisableComment, quillHintInit, quillDisableCommentInit;
    var objects = parameters.objects.sort(); // initialize the variable "objects" for the selected objects on startup

    var data = {},
        cfg = {},
        disablingTimeIntervals = [],
        changesMade = [],
        importanceList = {},
        lowImportance,
        counterGroupsList = {},
        allCounterGroupsList = {};

    var tabInstance, disableUntilDateInstance, disableUntilTimeInstance, disableTimeIntervalFromInstance, disableTimeIntervalToInstance,
        importanceFilterElm,
        counterGroupsFilterElm,
        eventsListElm,
        hintSubjectElm,
        hintEditorElm,
        disableCommentSubjectElm,
        disableCommentEditorElm,
        counterCollectorSettingsElm,
        linkHintsToObjectsCbElm,
        disabledTabElm,
        disabledIntervalsObjectsInfoElm,
        counterIDElm,
        counterNameElm,
        eventDescriptionElm,
        eventPronunciationElm,
        eventImportanceElm,
        eventDurationElm,
        eventTaskOnProblemElm,
        eventTaskOnSolvedElm,
        counterGroupsElm,
        keepHistoryElm,
        counterDisabledCBElm,
        taskConditionCBElm,
        debugCBElm,
        counterDisabledCBSharedElm,
        taskConditionCBSharedElm,
        debugCBSharedElm,
        counterDescriptionElm,
        counterDescriptionSharedElm,
        //commentEditorTabElm
        addDisabledIntervalBtnElm,
        disabledIntervalsPanelElm,
        disabledEventsNoTimeIntervalsText,
        disableUntilDateElm,
        disableUntilTimeElm,
        disableTimeIntervalsElm,
        disableTimeIntervalFromElm,
        disableTimeIntervalToElm,
        switchOnHintCBElm,
        switchOnDisableCBElm,
        switchOnSettingsElm,
        disableUntilElm,
        openCounterSettingsElm
        ;

    return {
        onChangeObjects: _onChangeObjects,
        beforeExec: _beforeExec,
    };

    function _onChangeObjects (_objects) {
        // check for change objects list and clearing events filter
        if(_objects && objects.length !== _objects.length) {
            delete cfg.i;
            delete cfg.g;
        }
        if(_objects) objects = _objects;

        if (!haveChangesBeenMade()) init();
        else showModal('modal-save-changes', init, function () {});
    }

    function _beforeExec(callback) {
        if(haveChangesBeenMade()) {
            saveChanges();
            return callback();
        }

        showModal('no-changes', function() {
            saveChanges();
            callback();
        }, function() {
            callback(new Error('Action has been canceled.'));
        })

        function saveChanges() {
            var dateUntil = getDateTimestampFromStr(disableUntilDateElm.val());
            var timeUntil = getTimeFromStr(disableUntilTimeElm.val());

            var disableUntil = dateUntil && timeUntil ? dateUntil + timeUntil : '';
            disableUntilElm.val(disableUntil);

            disableTimeIntervalsElm.val(disablingTimeIntervals.join(';'));

            // empty editor is return '<p><br></p>'
            var hintText = quillHint.getHtml().replace(/^<p><br><\/p>/i, '').trim();
            $('#hint').val(hintText);

            var disableCommentText = quillDisableComment.getHtml().replace(/^<p><br><\/p>/i, '').trim();
            $('#disable-comment').val(disableCommentText);

            changesMade = [];
            quillHintInit = undefined;
            quillDisableCommentInit = undefined;
        }
    }

    function showModal(messageID, onYes, onNo) {
        $('[data-modal-text]').addClass('hide');
        $('#' + messageID).removeClass('hide');

        var modalDeleteConfirmInstance = M.Modal.init(document.getElementById('modalRunConfirm'), {dismissible: false});
        modalDeleteConfirmInstance.open();
        $('#modalRunConfirmNo').unbind('click').click(onNo);
        $('#modalRunConfirmYes').unbind('click').click(onYes);
    }

    function haveChangesBeenMade() {

        if(!changesMade.length) {
            if(disablingTimeIntervals.join(';') === disableTimeIntervalsElm.val()) {
                var newHint = quillHint.getHtml();
                if (quillHintInit === undefined || newHint === quillHintInit) {
                    var newDisabledComment = quillDisableComment.getHtml();
                    if (quillDisableCommentInit === undefined || newDisabledComment === quillDisableCommentInit) {
                        return false;
                    } else console.log('Change disable comment. Sizes:', quillDisableCommentInit.length, '=>', newDisabledComment.length);
                } else console.log('Changed hint. Sizes:', quillHintInit.length, '=>', newHint.length);
            } else console.log('Changed disabled intervals:', disableTimeIntervalsElm.val(), '=>', disablingTimeIntervals.join(';'));
        } else console.log('Changed inputs:', changesMade);

        return true;
    }

    function init(isFirstTimeInit) {
        changesMade = [];
        counterIDElm.val('');

        getDataByAjax(objects, function(data) {
            console.log(data)
            getImportanceAndCountersGroupsList(data);
            // low importance has a max value
            lowImportance = Object.keys(data.importance).sort().reverse()[0];
            if(isFirstTimeInit) initEventsAndElements();
            drawEventsEditorElements(data);
            // reset selection after change the object
            drawEventsList();
        });
    }

    function getDataByAjax(objects, callback) {
        var IDs = objects.map(function(obj){ return obj.id});

        $.post(serverURL, {func: 'getData', objectsIDs: IDs.join(',')}, function(_data) {
            if(typeof _data === 'object') { // print result returned from ajax
                //console.log(_data);
                data = _data;
                callback(_data);
            } else {
                console.log('Result from ajax: ', _data); // debug result returned from ajax
            }
        });
    }

    function getImportanceAndCountersGroupsList(data) {
        var importance = data.importance;
        importanceList = {};
        counterGroupsList = {};
        allCounterGroupsList = {};

        data.countersGroups.forEach(function (group) {
            allCounterGroupsList[group.id] = group.name;
        });

        Object.values(data.events).forEach(function (event) {

            if(allCounterGroupsList[event.groupID]) {
                counterGroupsList[event.groupID] = allCounterGroupsList[event.groupID]
            }

            if(event.importance === undefined || event.importance === null) {
                event.importance = 'null';
                var text = 'UNDEFINED';
                var color = '#e0e0e0';
            } else {
                text = importance[event.importance] ? importance[event.importance].text : event.importance;
                color = importance[event.importance] ? importance[event.importance].color : '#fff'
            }

            importanceList[event.importance] = {
                color: color,
                text: text,
            };
        });
    }

    function drawEventsEditorElements(data) {

        var htmlImportance = Object.keys(importanceList).sort().map(function (key) {
            return '<option value="'+ key +'">' + escapeHtml(importanceList[key].text) + '</option>';
        }).join('');
        importanceFilterElm.html(htmlImportance);
        if(cfg.i) importanceFilterElm.val(cfg.i.split('-'));
        else filterSelectAll(true, null);


        var importance = data.importance;
        for(var key in importanceList) {
            if(key !== 'null') importance[key] = importanceList[key];
        }
        htmlImportance = Object.keys(importance).map(function (key) {
            return '<option value="'+ key +'">' + escapeHtml(importance[key].text) + '</option>';
        }).join('');
        eventImportanceElm.html(htmlImportance);


        var htmlGroups = Object.keys(allCounterGroupsList).sort(function (a, b) {
            if(allCounterGroupsList[a] > allCounterGroupsList[b]) return 1;
            if(allCounterGroupsList[a] < allCounterGroupsList[b]) return -1;
            return 0;
        }).map(id =>
            '<option value="' + id +'">' + escapeHtml(allCounterGroupsList[id]) + '</option>').join('');
        counterGroupsElm.html(htmlGroups);

        var htmlFilteredGroups = Object.keys(counterGroupsList).sort(function (a, b) {
            if(counterGroupsList[a] > counterGroupsList[b]) return 1;
            if(counterGroupsList[a] < counterGroupsList[b]) return -1;
            return 0;
        }).map(id =>
            '<option value="' + id +'">' + escapeHtml(counterGroupsList[id]) + '</option>').join('');
        counterGroupsFilterElm.html(htmlFilteredGroups);

        if(cfg.g) counterGroupsFilterElm.val(cfg.g.split('-'));
        else filterSelectAll(null, true);

        M.FormSelect.init(document.querySelectorAll('select.materialize-select'), {});

        if(objects && objects.length) {
            linkHintsToObjectsCbElm.prop('disabled', false);
            if(cfg.l === 1) linkHintsToObjectsCbElm.prop('checked', true);
            //commentEditorTabElm.removeClass('disabled');

            disabledTabElm.removeClass('disabled');
        } else {
            linkHintsToObjectsCbElm.prop('checked', false);
            linkHintsToObjectsCbElm.prop('disabled', true);

            disabledTabElm.addClass('disabled');
            // change tab when disabledTabElm is active and disabled
            // $('ul.tabs').find(disabledTabElm).index() - getting index of disabledTabElm tab
            if(tabInstance[0].index === $('ul.tabs').find(disabledTabElm).index()) {
                tabInstance[0].select('hint-editor-tab-panel');
            }
        }
    }

    function initEventsAndElements() {

        getParametersFromURL();

        disabledEventsNoTimeIntervalsText = disabledIntervalsPanelElm.html();

        Quill.prototype.getHtml = function () {
            return this.container.querySelector('.ql-editor').innerHTML;
        };

        var quillOptions = {
            //placeholder: 'Compose new message',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline', 'strike', 'clean'],        // toggled buttons
                    ['blockquote', 'code-block'],

                    [{'list': 'ordered'}, {'list': 'bullet'}],
                    [{'script': 'sub'}, {'script': 'super'}],      // superscript/subscript
                    [{'indent': '-1'}, {'indent': '+1'}],          // indent

                    [{'size': ['small', false, 'large', 'huge']}],  // custom dropdown
                    [{'header': [1, 2, 3, 4, 5, 6, false]}],

                    [{'color': []}, {'background': []}],          // dropdown with defaults from theme
                    [{'font': []}],
                    [{'align': []}],
                    ['link', 'image']                                // remove formatting button
                ]
            },
            theme: 'snow'
        };

        quillHint = new Quill('#hint-editor', quillOptions);
        quillDisableComment = new Quill('#disable-comment-editor', quillOptions);

        /*
        quillHint.on('editor-change', function () {
            // set messageTopImportance to undefined when editor is empty
            if (quillHint.getLength() < 2) messageTopImportance = undefined;
        });
         */

        tabInstance = M.Tabs.init(document.querySelectorAll('.tabs'), {});

        var switchElms = $('[data-switch-panel]');
        switchElms.each(function () {
            var switchElm = $(this);
            if(switchElm.is(':checked')) switchElm.trigger('click');
        });

        // save selected tab to URL
        $('ul.tabs li').click(function () {
            var idx = $(this).index();
            cfg.t = idx;
            setParametersToURL();

            switchElms.each(function () {
                var switchElm = $(this);
                if(switchElm.is(':checked')) switchElm.trigger('click');
            });
            var elm = $('ul.tabs').find('a').eq(idx);
            if(elm.length) {
                var id = elm.attr('href');
                var switchElm = $(id).find('[data-switch-panel]');
                setTimeout(function () {
                    if(!switchElm.is(':checked')) switchElm.trigger('click');
                }, 300);
            }
        });

        // select saved tab
        if(Number(cfg.t) === parseInt(String(cfg.t), 10)) {
            var elm = $('ul.tabs').find('a').eq(cfg.t)
            if(elm.length) {
                var id = elm.attr('href');
                tabInstance[0].select(id.substring(1)); // remove first '#'

                var switchElm = $(id).find('[data-switch-panel]');
                setTimeout(function () {
                    if(!switchElm.is(':checked')) switchElm.trigger('click');
                    drawEventInfo();
                }, 300);
            }
        }

        M.Collapsible.init(document.querySelectorAll('ul.collapsible'), {});
        M.FormSelect.init(document.querySelectorAll('select.materialize-select'), {});


        $('#selectAll-filter-btn').click(function() {
            filterSelectAll(true);
            drawEventsList();
        });

        $('#unselectAll-filter-btn').click(function() {
            filterSelectAll(false);
            drawEventsList();
        });


        linkHintsToObjectsCbElm.change(function () {
            drawHint();
            M.updateTextFields();
        });

        importanceFilterElm.change(drawEventsList);
        counterGroupsFilterElm.change(drawEventsList);

        $(window).resize(setEventsListHeight);

        disableUntilDateInstance = M.Datepicker.init(document.getElementById('disableUntilDate'), {
            container: document.body,
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            showClearBtn: true,
        });

        disableUntilTimeInstance = M.Timepicker.init(document.getElementById('disableUntilTime'), {
            container: 'body',
            twelveHour: false,
            showClearBtn: true,
        });

        disableTimeIntervalFromInstance = M.Timepicker.init(document.getElementById('disableTimeIntervalFrom'), {
            container: 'body',
            twelveHour: false,
            showClearBtn: true,
        });

        disableTimeIntervalToInstance = M.Timepicker.init(document.getElementById('disableTimeIntervalTo'), {
            container: 'body',
            twelveHour: false,
            showClearBtn: true,
        });

        addDisabledIntervalBtnElm.click(function () {
            var from =  getTimeFromStr(disableTimeIntervalFromInstance.time) || '';
            var to = getTimeFromStr(disableTimeIntervalToInstance.time) || '';

            if(!from) return M.toast({html: 'Please set the start of the time interval', displayLength: 1000});
            if(!to) return M.toast({html: 'Please set the end of the time interval', displayLength: 1000});
            if(from + 60000 > to) return M.toast({html: 'Please set correct time interval', displayLength: 1000});

            disablingTimeIntervals.push(from + '-' + to);
            disablingTimeIntervals = clearIntervals(disablingTimeIntervals);

            drawTimeIntervals();
        });

        switchOnHintCBElm.click(function () {
            if($(this).is(':checked')) {
                hintSubjectElm.prop('disabled', false);
                quillHint.enable(true);
                if(objects.length) linkHintsToObjectsCbElm.prop('disabled', false);
                //drawHint();
            } else {
                //hintSubjectElm.val('');
                //quillHint.setText('');
                //quillHintInit = quillHint.getHtml();

                hintSubjectElm.prop('disabled', true);
                quillHint.enable(false);
                linkHintsToObjectsCbElm.prop('disabled', true);
            }
            //M.updateTextFields();
        });

        switchOnDisableCBElm.click(function () {
            if($(this).is(':checked')) {
                disableUntilDateElm.prop('disabled', false);
                disableUntilTimeElm.prop('disabled', false);
                disableTimeIntervalFromElm.prop('disabled', false);
                disableTimeIntervalToElm.prop('disabled', false);
                addDisabledIntervalBtnElm.removeClass('disabled');
                disableCommentSubjectElm.prop('disabled', false);
                quillDisableComment.enable(true);
                //drawDisabled();
            } else {
                /*
                disableUntilDateElm.val('');
                disableUntilTimeElm.val('');
                disableTimeIntervalFromElm.val('');
                disableTimeIntervalToElm.val('');
                disableCommentSubjectElm.val('');
                quillDisableComment.setText('');
                quillDisableCommentInit = quillDisableComment.getHtml();
                disablingTimeIntervals = [];
                disableTimeIntervalsElm.val('');
                disabledIntervalsPanelElm.html(disabledEventsNoTimeIntervalsText);
                */


                disableUntilDateElm.prop('disabled', true);
                disableUntilTimeElm.prop('disabled', true);
                disableTimeIntervalFromElm.prop('disabled', true);
                disableTimeIntervalToElm.prop('disabled', true);
                addDisabledIntervalBtnElm.addClass('disabled');
                disableCommentSubjectElm.prop('disabled', true);
                quillDisableComment.enable(false);
            }
            //M.updateTextFields();
        });

        switchOnSettingsElm.click(function () {
            var settingsElms = $('[data-event-settings]');
            if($(this).is(':checked')) {
                settingsElms.prop('disabled', false);
                if(getSelectedCountersIDs().length > 1) $('[data-single-event-settings]').prop('disabled', true);
                //drawSettings();
            }
            else {
                //settingsElms.val('');
                settingsElms.prop('disabled', true);
            }
            M.FormSelect.init(document.querySelectorAll('select[data-events-editor-select]'), {});
            /*
            M.updateTextFields();

            setTimeout(function() {
                $('textarea.materialize-textarea').each(function() {
                    M.textareaAutoResize($(this));
                });
            }, 500);
             */
        })

        $('[data-onchange-watchdog]').change(function () {
            changesMade.push($(this).attr('id'));
        });

        counterDisabledCBElm.change(function () {
            counterDisabledCBSharedElm.val(1);
        });

        debugCBElm.change(function () {
            debugCBSharedElm.val(1);
        })

        taskConditionCBElm.change(function() {
            taskConditionCBSharedElm.val(1);
        });

        counterDescriptionElm.change(function () {
            counterDescriptionSharedElm.val(1);
        });

        openCounterSettingsElm.click(function () {
            var url = $(this).attr('data-href');
            if(url) window.open(url, '_blank').focus();
        });

    }

    function drawTimeIntervals() {
        if(!disablingTimeIntervals.length) {
            disabledIntervalsPanelElm.html(disabledEventsNoTimeIntervalsText);
            return;
        }

        var html = disablingTimeIntervals.sort(function (a, b) {
            return Number(a.split('-')[0]) - Number(b.split('-')[0]);
        }).map(function (interval) {
            var pair = interval.split('-').map(t => Number(t));
            return '<div class="chip"><span>' + getHumanTimeFromMilliseconds(pair[0]) + '-' + getHumanTimeFromMilliseconds(pair[1]) +
                '</span><i class="material-icons close"  data-time-interval="' + interval + '">close</i> </div>';
        }).join('');

        disabledIntervalsPanelElm.html(html);

        $('i[data-time-interval]').click(function () {
            var interval = $(this).attr('data-time-interval');
            var idx = disablingTimeIntervals.indexOf(interval);
            if(idx !== -1) disablingTimeIntervals.splice(idx, 1);
            if(!disablingTimeIntervals.length) disabledIntervalsPanelElm.html(disabledEventsNoTimeIntervalsText);
        });
    }

    function filterSelectAll(importanceSelectState, groupsSelectState) {
        if(groupsSelectState === undefined) groupsSelectState = importanceSelectState;

        if(importanceSelectState !== null) importanceFilterElm.children('option').prop('selected', importanceSelectState);
        if(groupsSelectState !== null) counterGroupsFilterElm.children('option').prop('selected', groupsSelectState);

        M.FormSelect.init(document.querySelectorAll('select[data-filter-select]'), {});
    }

    function setEventsListHeight() {
        var windowHeight = $(window).height();
        var eventListHeight = windowHeight - 180;
        if(eventListHeight < 500) eventListHeight = 500;
        eventsListElm.css('maxHeight', eventListHeight);

        var tabContentHeight = windowHeight - 120;
        if(tabContentHeight < 400) tabContentHeight = 400;
        $('.tabs-content').css('height', tabContentHeight);
    }

    function drawEventsList() {
        setEventsListHeight();
        var importanceFilter = importanceFilterElm.val();
        var countersGroupsFilter = counterGroupsFilterElm.val();

        cfg.i=importanceFilter.join('-');
        cfg.g=countersGroupsFilter.join('-');
        setParametersToURL();

        var sortedEvents = Object.values(data.events).sort(function (a, b) {
            if (a.importance > b.importance) return 1;
            if (a.importance < b.importance) return -1;
            if(a.name > b.name) return 1;
            if(a.name < b.name) return -1;
            return 0;

        });

        var html = sortedEvents.map(function (event) {
            if(importanceFilter.indexOf(String(event.importance)) === -1 ||
                countersGroupsFilter.indexOf(String(event.groupID)) === -1) return '';

            var color = importanceList[event.importance].color;
            return '<a href="#!" class="collection-item black-text truncate tooltipped" style="background-color: ' +
                color + ';" id="' + event.counterID + '" data-events-list="' + color +
                '" data-tooltip="#' + String(event.counterID).slice(-5) + ' ' + escapeHtml(event.description) + '">' +
                escapeHtml(event.name.replace(/^[A-Z]: /, '')) + '</a>';
        }).join('');

        eventsListElm.html(html);

        M.Tooltip.init(document.querySelectorAll('[data-events-list]'), {
            enterDelay: 5000
        });

        var eventsElm = $('a[data-events-list]'), multipleSelect = false;

        eventsElm.click(function (e) {
            e.preventDefault();
            var elm = $(this);
            var selectedElms = $('a[data-events-list].active');
            var selectElm = true;

            if(e.ctrlKey || multipleSelect) {
                // if ctrl key is pressed and element already selected and number of selected elements are more then 1, unselect it
                if(elm.hasClass('active') && selectedElms.get().length > 1) {
                    elm.removeClass('active').css('backgroundColor', elm.attr('data-events-list')).removeClass('white-text').addClass('black-text');
                    selectElm = false; // don\'t select element again
                }
            } else {
                // unselect all selected elements
                selectedElms.removeClass('active').each(function () {
                    $(this).css('backgroundColor', $(this).attr('data-events-list')).removeClass('white-text').addClass('black-text');
                });
            }

            // select an element (if the element was not selected before and the ctrl key was not pressed)
            if(selectElm) {
                elm.addClass('active').css('backgroundColor', 'rgb(38, 166, 154)').removeClass('black-text').addClass('while-text');
            }
            cfg.cid = getSelectedCountersIDs().join('-');
            setParametersToURL();

            // get counters IDs for selected events
            var countersIDs = getSelectedCountersIDs();
            counterIDElm.val(countersIDs.join(','));

            if(!haveChangesBeenMade()) return drawEventInfo();
            showModal('modal-save-changes', function() { drawEventInfo() }, function(){});
        });

        eventsElm.mouseover(function () {
            $(this).css('backgroundColor', '#ddd');
        });

        eventsElm.mouseleave(function () {
            if($(this).hasClass('active')) $(this).css('backgroundColor', 'rgb(38, 166, 154)');
            else $(this).css('backgroundColor', $(this).attr('data-events-list'));
        });

        if(cfg.cid) {
            multipleSelect = true;
            cfg.cid.split('-').forEach(function(counterID) {
                $('a[data-events-list][id="' + counterID+'"]').trigger('click');
            });
            multipleSelect = false;

            // check that there are selected counters and return if there are selected counters
            if(getSelectedCountersIDs().length) return;
        }

        // if counters are not selected, select the first
        eventsListElm.children(':first-child').trigger('click');
    }

    function getSelectedCountersIDs() {
        return $.map($('a[data-events-list].active'), function(elm) {
            return Number($(elm).attr('id'));
        });
    }

    function drawEventInfo() {
        changesMade = [];

        drawHint();
        drawDisabled();
        drawSettings();

        setTimeout(function() {
            $('textarea.materialize-textarea').each(function() {
                M.textareaAutoResize($(this));
            });
        }, 500);
        M.updateTextFields();
        M.FormSelect.init(document.querySelectorAll('select[data-events-editor-select]'), {});
    }

    function drawSettings() {
        //if(!switchOnSettingsElm.is(':checked')) return;

        // get counters IDs for selected events
        var countersIDs = getSelectedCountersIDs();

        if(!countersIDs.length) return;
        if(countersIDs.length < 2) {
            var event = data.events[countersIDs[0]];
            var importance = event.importance
            $('[data-single-event-settings]').prop('disabled', false);
            counterNameElm.val(event.name);
            eventDescriptionElm.val(event.description);
            eventPronunciationElm.val(event.pronunciation || '');

            openCounterSettingsElm.prop('disabled', false);
            var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' + 'counter_settings';

            var urlParameters = {
                'a': encodeURIComponent(actionPath), // /action/objects-properties
                'cid': encodeURIComponent(countersIDs[0]),
            };

            if(objects.length) {
                var objectsNamesStr = objects.map(o => o.name).join(',');
                urlParameters.c = encodeURIComponent(objectsNamesStr); // selected objects
            }

            var url = '/?' + Object.keys(urlParameters).map(function (key) {
                return key + '=' + urlParameters[key];
            }).join('&');

            openCounterSettingsElm.attr('data-href', url);
        } else {
            importance = getSharedEventsValues(countersIDs, 'importance');

            $('[data-single-event-settings]').prop('disabled', true);
            counterNameElm.val('');
            eventDescriptionElm.val('');
            eventPronunciationElm.val('');

            openCounterSettingsElm.prop('disabled', true);
        }

        if(importance === 'null') importance = lowImportance;
        eventImportanceElm.val(importance);
        eventDurationElm.val(getSharedEventsValues(countersIDs, 'duration') || '');
        eventTaskOnProblemElm.val(getSharedEventsValues(countersIDs, 'problemTaskID') || '');
        eventTaskOnSolvedElm.val(getSharedEventsValues(countersIDs, 'solvedTaskID') || '');
        counterGroupsElm.val(getSharedEventsValues(countersIDs, 'groupID'));
        var keepHistory = getSharedEventsValues(countersIDs,'keepHistory');
        keepHistoryElm.val(keepHistory === null ? '' : keepHistory);

        var counterDisabled = getSharedEventsValues(countersIDs,'counterDisabled');
        if(counterDisabled === null) {
            counterDisabledCBElm.prop('checked', false).prop('indeterminate', true);
            counterDisabledCBSharedElm.val(0);
        }
        else {
            counterDisabledCBElm.prop('checked', !!counterDisabled).prop('indeterminate', false);
            counterDisabledCBSharedElm.val(1);
        }

        var taskCondition = getSharedEventsValues(countersIDs,'taskCondition');
        if(taskCondition === null) {
            taskConditionCBElm.prop('checked', false).prop('indeterminate', true);
            taskConditionCBSharedElm.val(0);
        } else {
            taskConditionCBElm.prop('checked', !!taskCondition).prop('indeterminate', false);
            taskConditionCBSharedElm.val(1);
        }

        var debug = getSharedEventsValues(countersIDs,'debug');
        if(debug === null) {
            debugCBElm.prop('checked', false).prop('indeterminate', true);
            debugCBSharedElm.val(0);
        } else {
            debugCBElm.prop('checked', !!debug).prop('indeterminate', false);
            debugCBSharedElm.val(1);
        }

        getDebugInfo();

        var counterDescription = getSharedEventsValues(countersIDs,'counterDescription');
        counterDescriptionElm.val(counterDescription);
        counterDescriptionSharedElm.val(counterDescription === null ? 0 : 1);
    }

    function getDebugInfo() {
        $.post(serverURL, {
            func: 'getAllCounters'
        }, function (rows) {
            var countersWithDebug = [], num = 1;
            rows.forEach(function (row) {
                if(row.debug) {
                    countersWithDebug.push('<a style="color:yellow" href="/?a=%2Factions%2Fcounter_settings&cid=' +
                        row.id + '" target="_blank">' + (num++) + '. #' + String(row.id).slice(-5) + ' ' +
                        escapeHtml(row.name) + '</a><br>');
                }
            });

            var showCountersWithDebugElm = $('#showCountersWithDebug');
            if(countersWithDebug.length > 9 && !debugCBElm.is(':checked')) debugCBElm.prop('disabled', true);
            else debugCBElm.prop('disabled', false);

            showCountersWithDebugElm.unbind('click').click(function (e) {
                e.preventDefault();
                if(!countersWithDebug.length) M.toast({html: 'No counters with debug mode enabled', displayLength: 1000});
                else {
                    M.toast({html: '<span><span>Counters list with debug mode enabled:</span><br>' +
                            countersWithDebug.join('') +
                            '</span><button class="btn-flat toast-action" onClick="M.Toast.dismissAll();">X</button>',
                        displayLength: 10000}    );
                }
            });
        });
    }

    function getSharedEventsValues(initCountersIDs, name) {
        if(initCountersIDs.length === 1) return data.events[initCountersIDs[0]][name];

        var pos, sharedData = null, countersIDs = initCountersIDs.slice();

        for(var counterID in data.events) {
            var event = data.events[counterID];
            if((pos = countersIDs.indexOf(event.counterID)) !== -1) {
                countersIDs.splice(pos, 1);
                if(sharedData !== null && event[name] !== sharedData) return null;
                sharedData = event[name];
            }
        }

        return sharedData;
    }

    function drawDisabled() {
        //if(!switchOnDisableCBElm.is(':checked')) return;

        var disabled = mergeDisabled();

        disableUntilDateElm.val('');
        disableUntilTimeElm.val('');
        disableCommentSubjectElm.val('');
        quillDisableComment.setText('');
        quillDisableCommentInit = quillDisableComment.getHtml();
        disablingTimeIntervals = [];
        disableTimeIntervalsElm.val('');
        drawTimeIntervals();

        if(!Object.keys(disabled).length) return;

        var sharedDisabled = getSharedDisabled(disabled);
        if(!sharedDisabled) return;

        if(sharedDisabled.disableUntil) {
            disableUntilDateElm.val(getDateString(sharedDisabled.disableUntil));
            var d = new Date(sharedDisabled.disableUntil);
            disableUntilTimeElm.val(String('0' + d.getHours() + ':' + '0' + d.getMinutes()).replace(/\d(\d\d)/g, '$1'));
        }
        if(sharedDisabled.intervals !== '-' && typeof sharedDisabled.intervals === 'string') {
            disablingTimeIntervals = sharedDisabled.intervals.split(';');
            disableTimeIntervalsElm.val(disablingTimeIntervals.join(';'));
            drawTimeIntervals();
        }
        disableCommentSubjectElm.val(sharedDisabled.subject || '');
        quillDisableComment.setText('');
        quillDisableComment.clipboard.dangerouslyPasteHTML(0,sharedDisabled.comment || '');
        quillDisableComment.setSelection(0, 0);
        quillDisableCommentInit = quillDisableComment.getHtml();
    }

    function drawHint() {
        //if(!switchOnHintCBElm.is(':checked')) return;

        // eventHints = data.events[<counterID>].hints <objects {objectID || 0 : {subject:.. comment:...},... }>
        var eventsHints = mergeEventsHints();
        //console.log('Merged: ', eventsHints)

        hintSubjectElm.val('');
        quillHint.setText('');
        quillHintInit = quillHint.getHtml();

        cfg.l = linkHintsToObjectsCbElm.is(':checked') ? 1 : 0;
        setParametersToURL();

        if(!Object.keys(eventsHints).length) return;

        if(!cfg.l) {
            if(eventsHints[0]) {
                hintSubjectElm.val(eventsHints[0].subject || '');
                quillHint.setText('');
                quillHint.clipboard.dangerouslyPasteHTML(0,eventsHints[0].comment || '');
                quillHint.setSelection(0, 0);
                quillHintInit = quillHint.getHtml();
            }
            return;
        }

        var sharedHint = getSharedHint(eventsHints);
        //console.log('Shared: ', sharedHint)
        if(!sharedHint) return;
        hintSubjectElm.val(sharedHint.subject || '');
        quillHint.setText('');
        quillHint.clipboard.dangerouslyPasteHTML(0,sharedHint.comment || '');
        quillHint.setSelection(0, 0);
        quillHintInit = quillHint.getHtml();
    }

    /*
    get shared hint for several selected objects
     */
    function getSharedHint(eventHints) {
        if(!eventHints || typeof eventHints !== 'object') return null;

        // no objects were selected
        if(!objects.length) return eventHints[0];

        // one object was selected
        if(objects.length === 1) return eventHints[objects[0].id] || null;


        var sharedSubject, sharedComment, eventsObjectsIDs = Object.keys(eventHints).map(objectID => Number(objectID));
        for(var i = 0; i < objects.length; i++) {
            var objectID = objects[i].id;

            // no hint for object
            if(eventsObjectsIDs.indexOf(objectID) === -1) return null;

            if(sharedSubject === undefined) sharedSubject = eventHints[objectID].subject;
            if(sharedSubject !== eventHints[objectID].subject) sharedSubject = null;

            if(sharedComment === undefined) sharedComment = eventHints[objectID].comment;
            if(sharedComment !== eventHints[objectID].comment) sharedComment = null;

            if(sharedComment === null && sharedSubject === null) return null;

        }

        return {
            subject: sharedSubject,
            comment: sharedComment
        }
    }
    /*
    Merge hints from multiple selected events
    return object: { <objectID>: {subject:..., comment:..}, ... }
     */
    function mergeEventsHints() {
        var eventsHints = {},
            countersIDs = getSelectedCountersIDs();

        countersIDs.forEach(function(counterID) {
            var event = data.events[counterID];
            //console.log('CID ', counterID, ': ', event.hints)

            if(!event || !event.hints) return;
            for(var objectID in event.hints) {
                if(eventsHints[objectID] === undefined) {
                    eventsHints[objectID] = {
                        count: 1,
                        subject: event.hints[objectID].subject,
                        comment: event.hints[objectID].comment,
                    }
                    continue;
                } else ++eventsHints[objectID].count;

                if(eventsHints[objectID].subject !== null &&
                    eventsHints[objectID].subject !== event.hints[objectID].subject
                ) {
                    eventsHints[objectID].subject = null;
                }

                if(eventsHints[objectID].comment !== null &&
                    eventsHints[objectID].comment !== event.hints[objectID].comment
                ) {
                    eventsHints[objectID].comment = null;
                }
            }
        });

        var objectsNum = countersIDs.length;
        for(var objectID in eventsHints) {
            if(eventsHints[objectID].count !== objectsNum ||
                (eventsHints[objectID].subject === null && eventsHints[objectID].comment === null)) {
                delete eventsHints[objectID];
            }
        }

        return eventsHints;
    }

    /*
    get shared disabled for several selected objects
     */
    function getSharedDisabled(disabled) {
        if(!disabled || typeof disabled !== 'object') return null;

        // no objects were selected
        if(!objects.length) return disabled[0];

        // one object was selected
        if(objects.length === 1) return disabled[objects[0].id] || null;


        var sharedSubject, sharedComment, sharedDisableUntil, sharedIntervals,
            eventsObjectsIDs = Object.keys(disabled).map(objectID => Number(objectID));
        for(var i = 0; i < objects.length; i++) {
            var objectID = objects[i].id;

            // no disabled for object
            if(eventsObjectsIDs.indexOf(objectID) === -1) return null;

            if(sharedDisableUntil === undefined) sharedDisableUntil = disabled[objectID].disableUntil;
            if(sharedDisableUntil !== disabled[objectID].disableUntil) sharedDisableUntil = null;

            if(sharedIntervals === undefined) sharedIntervals = disabled[objectID].intervals;
            if(sharedIntervals !== disabled[objectID].intervals) sharedIntervals = '-';

            if(sharedSubject === undefined) sharedSubject = disabled[objectID].subject;
            if(sharedSubject !== disabled[objectID].subject) sharedSubject = null;

            if(sharedComment === undefined) sharedComment = disabled[objectID].comment;
            if(sharedComment !== disabled[objectID].comment) sharedComment = null;

            if(sharedDisableUntil === null && sharedIntervals === '-' &&
                sharedComment === null && sharedSubject === null) return null;

        }

        return {
            disableUntil: sharedDisableUntil,
            intervals: sharedIntervals,
            subject: sharedSubject,
            comment: sharedComment
        }
    }

    /*
    Merge disabled from multiple selected events
    return object: { <objectID>: {disableUntil:.., intervals:.., subject:..., comment:..}, ... }
     */
    function mergeDisabled() {
        var disabled = {},
            countersIDs = getSelectedCountersIDs();

        countersIDs.forEach(function(counterID) {
            var event = data.events[counterID];
            //console.log('CID ', counterID, ': ', event.disabled)

            if(!event || !event.disabled) return;
            for(var objectID in event.disabled) {
                if(disabled[objectID] === undefined) {
                    disabled[objectID] = {
                        count: 1,
                        disableUntil: event.disabled[objectID].disableUntil,
                        intervals: event.disabled[objectID].intervals,
                        subject: event.disabled[objectID].subject,
                        comment: event.disabled[objectID].comment,
                    }
                    continue;
                } else ++disabled[objectID].count;

                if(disabled[objectID].disableUntil !== null &&
                    disabled[objectID].disableUntil !== event.disabled[objectID].disableUntil
                ) {
                    disabled[objectID].disableUntil = null;
                }

                if(disabled[objectID].intervals !== '-' &&
                    disabled[objectID].intervals !== event.disabled[objectID].intervals
                ) {
                    disabled[objectID].intervals = '-';
                }

                if(disabled[objectID].subject !== null &&
                    disabled[objectID].subject !== event.disabled[objectID].subject
                ) {
                    disabled[objectID].subject = null;
                }

                if(disabled[objectID].comment !== null &&
                    disabled[objectID].comment !== event.disabled[objectID].comment
                ) {
                    disabled[objectID].comment = null;
                }
            }
        });

        var objectsNum = countersIDs.length;
        for(var objectID in disabled) {
            if(disabled[objectID].count !== objectsNum ||
                (disabled[objectID].disableUntil === null && disabled[objectID].intervals === '-' &&
                    disabled[objectID].subject === null && disabled[objectID].comment === null)) {
                delete disabled[objectID];
            }
        }

        return disabled;
    }

    /*
    intervalStr: [1117-1135, 1418-1430, 1420-1428, 1700-1800, 0930-0935, 0935-0943, 1015-1030, 1020-1045, 1040-1045, 1043-1050, 1100-1110, 1115-1120];
    return [930-943, 1015-1050, 1100-1110, 1115-1135, 1418-1430, 1700-1800];
     */
    function clearIntervals(initIntervals) {
        if(!Array.isArray(initIntervals) || !initIntervals.length) return initIntervals;

        var intervals = initIntervals.map(function (interval) {
            var fromTo = interval.split('-');
            return {
                from: Number(fromTo[0]),
                to: Number(fromTo[1])
            };
        }).sort(function (a,b) {
            return a.from - b.from;
        });

        if(intervals.length < 2) return initIntervals;

        var newIntervals = [], newInterval = intervals[0];
        //console.log('sorted intervals:\n', intervals);

        for(var i = 0; i < intervals.length; i++) {
            var nextInterval = intervals[i+1]/*, interval = newInterval*/;
            //console.log('comp:', newInterval, nextInterval);
            if(nextInterval && newInterval.to >= nextInterval.from) {
                newInterval = {
                    from: newInterval.from,
                    to: newInterval.to < nextInterval.to ? nextInterval.to : newInterval.to
                };
                //console.log(newInterval, '=', interval, nextInterval, intervals[i], '=>', intervals[i+2]);
            } else {
                newIntervals.push(newInterval);
                //console.log('add:', newInterval, intervals[i], '=>', intervals[i+1]);
                newInterval = nextInterval;
            }
        }

        return newIntervals.map(function (interval) {
            return interval.from + '-' + interval.to;
        });
    }

    function getHumanTimeFromMilliseconds(milliseconds) {
        var h = Math.floor(milliseconds / 3600000);
        var m = Math.floor((milliseconds - h * 3600000) / 60000);
        //var s = Math.floor(milliseconds % 60000 );
        return String('0' + h + ':0' + m /*+ ':0' + s*/).replace(/0(\d\d)/g, '$1');
    }

    /*
        returned date string in format DD MonthName, YYYY
        date: date object (new Date())
     */
    function getDateString(timestamp) {
        var date = timestamp ? new Date(timestamp) : new Date();

        return date.getDate() + ' ' + data.monthNames[date.getMonth()] + ', ' + date.getFullYear();
    }

    /*
        Converting time string in format HH:MM to ms

        timeStr: time string in format HH:MM
        return time in ms
     */
    function getTimeFromStr(timeStr) {
        if(!timeStr) return;
        var timeParts = timeStr.match(/^(\d\d?):(\d\d?)$/);
        if(timeParts === null) return;
        return Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000;
    }

    /*
        Converting date string in format DD MonthName, YYYY to ms

        dateStr: date string in format DD MonthName, YYYY
        return time from 1.1.1970 in ms
     */
    function getDateTimestampFromStr(dateStr) {
        if(!dateStr) return;
        var dateParts = dateStr.match(/^(\d\d?)\s([^,]+),\s(\d\d\d\d)$/);
        if(dateParts === null) return;
        var monthNum = data.monthNames.indexOf(dateParts[2]);
        return new Date(Number(dateParts[3]), monthNum, Number(dateParts[1])).getTime();
    }


    function getParametersFromURL() {
        cfg = {};
        // external function from init.js
        getActionParametersFromBrowserURL(function(actionParametersFromURL) {
            actionParametersFromURL.forEach(function (param) {
                cfg[param.key] = param.val;
            });
        });
    }

    function setParametersToURL() {
        var params = [];
        for(var param in cfg) {
            params.push({
                key: param,
                val: cfg[param],
            });
        }
        // it is an external function, which was exported from public/javascripts/init.js
        setActionParametersToBrowserURL(params);
    }

})(jQuery); // end of jQuery name space