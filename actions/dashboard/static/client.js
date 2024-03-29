﻿/*
 * Copyright © 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
* Created on Fri Mar 23 2018 12:48:16 GMT+0700
*/


function callbackBeforeExec(callback) {
    JQueryNamespace.checkBeforeExec(callback)
}

function callbackAfterExec(parameterNotUsed, callback) {
    JQueryNamespace.runAfterExec(parameterNotUsed, callback);
}

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

var JQueryNamespace = (function ($) {
    $(function () {
        initElements();
        initElementsRestrictions(init);
    });

    /**
     * @name parameters
     * @global
     * @property {Object} action
     * @property {number} action.commentsInterval
     * @property {string} action.actionForSeveralObjects
     * @property {Array<{
     *     tip: string,
     *     name: string,
     *     importance: number
     *     subject: string,
     *     default: Object,
     *     autoApplyFor: Array<{
     *         actions: Array<string>,
     *         importance: Array<number>,
     *         objectNameRE: Array<string>,
     *         counterNameRE: Array<string>,
     *         startEventTimeLessMin: number,
     *         endEventTimeLessMin: number,
     *         eventDescriptionRE: Array<string>,
     *         counterNameRE: Array<string>,
     *         objectNameRE: Array<string>,
     *     }>,
     *     replyTo: string,
     *     recipients: Array<string>,
     * }>} action.messageTemplates
     * @property {Object.<{
     *     tables: Array,
     *     autoApplyFor: Array
     *     name: string,
     *     bodyHeader: string,
     *     hiddenData: Object,
     *     eventTemplate: string,
     *     intervalsDivider: string,
     *     subject: string,
     *     objectsListLength: number,
     *     countersListLength: number,
     * }>} action.actionsMessageTemplates
     * @property {{
     *     data: Array,
     *     onChipAdd: function,
     * }} action.rcptOptions
     * @property {string} replyTo
     * @property {Array} dayNames,
     * @property {Object} importance
     */

    /**
     * path to ajax
     * @type string
     */
    var serverURL = parameters.action.link + '/ajax';
    var bodyElm,
        eventsFilterElm,
        reloadElm,
        openInNewElm,
        reloadIconElm,
        historyEventsHeaderElm,
        historyCommentedEventsHeaderElm,
        currentEventsHeaderElm,
        disabledEventsHeaderElm,
        removeIntervalsElm,
        timeIntervalsElm,
        disableDaysOfWeekElm,
        enableEventsElm,
        disabledEventsControlElm,
        hintDialogInstance,
        hintElm,
        prevCommentDialogElm,
        createMessageElm,
        soundIconElm,
        importanceFilterElm,
        importanceFilterIconElm,
        importanceFilterDropDownElm,
        pronunciations = parameters.action.pronunciation,
        updateInterval = parameters.action.updateInterval * 1000 || 30000,
        prevEvents = {},
        lastAction,
        lastTemplate,
        defaultTemplate,
        collapsibleInstance,
        quill,
        subjectElm,
        rcptChipElm,
        replyToElm,
        rcptChipsInstances,
        emailValidateRE = /^(([^<>()\[\].,;:\s@"]+(\.[^<>()\[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{2,})$/i,
        lastUpdateElm,
        updateTimeElm,
        hiddenMessageDataElm,
        messageTopImportance,
        maxMessageImportance = 0,
        commentsFromInstance,
        commentsToInstance,
        objects = parameters.objects,
        hintCache = {},
        eventsData = {},
        maxEventsNumberInTable = 500,
        gettingDataInProgress = 0,
        updatePaused = 0,
        actionConfig = {},
        /**
         *
         * @type {{
         *     importanceFilter: Boolean,
         *     Message: {
         *         Historical: Boolean,
         *         Current: Boolean,
         *         Disabled: Boolean,
         *         Comments: Boolean,
         *         Solve: Boolean,
         *         Enable: Boolean,
         *         Disable: Boolean,
         *     },
         *     Historical: Boolean,
         *     Current: Boolean,
         *     Disabled: Boolean,
         *     Comments: Boolean,
         *     Sound: string,
         *     Hints: Boolean,
         *     Info: boolean,
         *     History: Boolean,
         *     Links: Boolean
         * }}
         */
        restrictions = {},
        actions = [],
        useHints = true,
        useInfo = true,
        useHistory = true,
        useLinks = true,
        importanceFilter = -1,
        templateSelectedManual = false;

    var getDataForHistoryEvents = false;
    var getDataForCurrentEvents = false;
    var getDataForDisabledEvents = false;

    jQuery.expr[':'].i_contains = function(a, i, m) {
        return jQuery(a).text().toUpperCase()
            .indexOf(m[3].toUpperCase()) >= 0;
    };

    /**
     * @external Quill
     * @see https://quilljs.com/docs/quickstart/
     */
    Quill.prototype.getHtml = function () {
        return this.container.querySelector('.ql-editor').innerHTML;
    };

    return {
        checkBeforeExec: checkBeforeExec,
        runAfterExec: runAfterExec,
        onChangeObjects: onChangeObjects
    };

    function initElements() {

        bodyElm = $('body');
        eventsFilterElm = $('#eventsFilter');
        rcptChipElm = $('#rcpt_chips');
        reloadElm = $('#reload');
        openInNewElm = $('#openInNew');
        reloadIconElm = $('#reload i:first-child');
        subjectElm = $('#subject');
        replyToElm = $('#replyTo');
        createMessageElm = $('#createMessage');
        hintElm = $('#hint');
        lastUpdateElm = $('#lastUpdate');
        updateTimeElm = $('#updateTime');
        removeIntervalsElm = $('#removeTimeIntervals');
        timeIntervalsElm = $('#timeIntervalsForRemove');
        disableDaysOfWeekElm = $('#disableDaysOfWeek')
        enableEventsElm = $('#enableEvents');
        disabledEventsControlElm = $('#disabledEventsControl');

        hiddenMessageDataElm = $('#hiddenMessageData');

        historyEventsHeaderElm = $('#historyEvents').find('div.collapsible-header');
        currentEventsHeaderElm = $('#currentEvents').find('div.collapsible-header');
        disabledEventsHeaderElm = $('#disabledEvents').find('div.collapsible-header');
        historyCommentedEventsHeaderElm = $('#historyCommentedEvents').find('div.collapsible-header');

        soundIconElm = $('#soundIcon');

        importanceFilterElm = $('#importanceFilter');
        importanceFilterIconElm = $('#importanceFilterIcon');
        importanceFilterDropDownElm = $('#importanceFilterDropDown');
    }

    function init() {

        if(objects.length) $('#filteredByObjects').removeClass('hide');

        hintDialogInstance = M.Modal.init(document.getElementById('hintDialog'), {
            inDuration: 0,
            outDuration: 0
        });
        prevCommentDialogElm = M.Modal.init(document.getElementById('prevCommentDialog'), {
            inDuration: 0,
            outDuration: 0
        });

        var now = new Date();
        if(now.getHours() > 3) now.setDate(now.getDate() + 1);
        now.setHours(5, 0, 0, 0);
        // calc minutes to next day 5:00
        setUntilDateTimeControl(Math.floor((now.getTime() - Date.now()) / 60000) + 1);

        M.Datepicker.init(document.getElementById('disableFromDate'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
        });

        M.Datepicker.init(document.getElementById('disableUntilDate'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
        });

        var commentsInterval =
            Number(parameters.action.commentsInterval) === parseInt(String(parameters.action.commentsInterval), 10) &&
            Number(parameters.action.commentsInterval) > 1 ? Number(parameters.action.commentsInterval) : 2;
        commentsFromInstance = M.Datepicker.init(document.getElementById('commentsFrom'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            defaultDate: new Date(Date.now() - (86400000 * commentsInterval)), // default is 2 days
            onClose: function() {
                // prevent change state of collapsible element
                if($('#historyCommentedEvents').hasClass('active')) collapsibleInstance.close(4);
                else collapsibleInstance.open(4);
                getAndDrawCommentsTable();
            }
        });

        commentsToInstance = M.Datepicker.init(document.getElementById('commentsTo'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            defaultDate: new Date(Date.now()),
            onClose: function() {
                // prevent change state of collapsible element
                if($('#historyCommentedEvents').hasClass('active')) collapsibleInstance.close(4);
                else collapsibleInstance.open(4);
                getAndDrawCommentsTable();
            }
        });

        M.Timepicker.init(document.getElementById('disableUntilTime'), {
            twelveHour: false,
            showClearBtn: false
        });

        M.Timepicker.init(document.getElementById('disableFromTime'), {
            twelveHour: false,
            showClearBtn: false
        });

        var daysOfWeek = parameters.action.dayNames.map(function (dayOfWeek, idx) {
            return '<option value="' + idx + '">' + dayOfWeek + '</option>';
        });
        disableDaysOfWeekElm.append(daysOfWeek.join(''));

        // When there are no rights, the materialize element cannot be initialized
        try { M.FormSelect.init(disableDaysOfWeekElm[0], {}); } catch(e) {}

        M.Timepicker.init(document.getElementById('disableTimeIntervalFrom'), {
            twelveHour: false,
            showClearBtn: true
        });

        M.Timepicker.init(document.getElementById('disableTimeIntervalTo'), {
            twelveHour: false,
            showClearBtn: true
        });

        var actionChangeDialogInstance = M.Modal.init(document.getElementById('actionChangeDialog'), {
            inDuration: 0,
            outDuration: 0
        });
        $('input[name="action"]').click(function() {
            if(lastAction && lastAction !== $(this).attr('id')) actionChangeDialogInstance.open();
        });

        $('#disableEvents').click(function () {
            if(getDateTimestampFromStr($('#disableUntilDate').val()) + getTimeFromStr($('#disableUntilTime').val()) <
                Date.now() ||
                getDateTimestampFromStr($('#disableFromDate').val()) + getTimeFromStr($('#disableFromTime').val()) <
                Date.now()
            ) {
                var now = new Date();
                if(now.getHours() < 3) now.setDate(now.getDate() + 1);
                now.setHours(5, 0, 0, 0);
                // calc minutes to next day at 5:00
                setUntilDateTimeControl(Math.round(Math.floor((now.getTime() - Date.now()) / 60000) + 1));
            }
        });

        collapsibleInstance = M.Collapsible.init(document.getElementById('collapsible'), {
            accordion: false, // A setting that changes the collapsible behavior to expandable instead of the default accordion style
            inDuration: 0, // default 300
            outDuration: 0, // default 300
            onOpenEnd: function(el) {  // Callback for Collapsible open
                setTimeout(function() {
                    if($(el).find('tbody').find('tr').get().length === 1) {
                        $(el).find('tbody')
                            .html('<tr><td colspan="10" style="text-align: center;">Updating information...</td></tr>');
                    }
                    if ($(el).attr('id') === 'currentEvents') {
                        actionConfig.openCurrent = true
                        startUpdate();
                    } else if ($(el).attr('id') === 'historyEvents') {
                        actionConfig.openHistorical = true
                        startUpdate();
                    } else if ($(el).attr('id') === 'disabledEvents') {
                        actionConfig.openDisabled = true
                        startUpdate();
                    } else if($(el).attr('id') === 'historyCommentedEvents') {
                        actionConfig.openCommented = true;
                        getAndDrawCommentsTable();
                    } else if($(el).attr('id') === 'createMessage') actionConfig.openMessage = true;

                    // function from init.js
                    setActionConfig(actionConfig);
                    eventsFilterElm.focus();
                }, 500);
            },

            onCloseEnd: function(el) {  // Callback for Collapsible close
                if($(el).attr('id') === 'currentEvents') {
                    actionConfig.openCurrent = false;
                    getDataForCurrentEvents = false;
                }
                if($(el).attr('id') === 'historyEvents') {
                    actionConfig.openHistorical = false;
                    getDataForHistoryEvents = false;
                }
                if($(el).attr('id') === 'disabledEvents') {
                    actionConfig.openDisabled = false;
                    getDataForDisabledEvents = false;
                }
                if($(el).attr('id') === 'createMessage') actionConfig.openMessage = false;
                if($(el).attr('id') === 'historyCommentedEvents') actionConfig.openCommented = false;

                // function from init.js
                setActionConfig(actionConfig);
                eventsFilterElm.focus();
            }
        });

        if(actionConfig.showMessageEditor) showMessageEditor();
        if(actionConfig.openMessage) collapsibleInstance.open(0);
        if(actionConfig.openHistorical) collapsibleInstance.open(1);
        if(actionConfig.openCurrent) collapsibleInstance.open(2);
        else if(actionConfig.openCurrent === false) collapsibleInstance.close(2);
        if(actionConfig.openDisabled) collapsibleInstance.open(3);
        if(actionConfig.openCommented) collapsibleInstance.open(4);

        startUpdate();

        $('#composeMessage').click(composeMessage);

        $('#clearMessage').click(function() {
            lastAction = null;
            quill.setText('');
            subjectElm.val('').focus();
            applyTemplate(lastTemplate);
        });

        rcptChipElm.keypress(function (e) {
            if (e.which === 9) {
                e.preventDefault();
                subjectElm.focus();
            }
        });

        subjectElm.keydown(function (e) {
            if (e.which === 9) {
                e.preventDefault();
                quill.focus();
            }
        });

        initSelectAll();

        $('a#reloadComments').click(function (e) {
            if(!$('#historyCommentedEvents').hasClass('active')) return;
            e.stopPropagation(); // prevent collapse
            getAndDrawCommentsTable();
        });


        $('#showEditor').click(function (e) {
            e.stopPropagation(); // prevent collapse
            if(createMessageElm.hasClass('hide')) {
                showMessageEditor();
                if(!createMessageElm.hasClass('active')) collapsibleInstance.open(0);
            } else hideMessageEditor();
        });

        $('#commentsFrom').click(function (e) {
            e.stopPropagation(); // prevent collapse
        });

        $('#commentsTo').click(function (e) {
            e.stopPropagation(); // prevent collapse
        });

        $('#sound').click(function (e) {
            e.stopPropagation(); // prevent collapse
            if(soundIconElm.text() === 'volume_up' && restrictions.Sound !== 'alwaysOn') soundOff()
            else soundOn();
        });

        if(!restrictions.importanceFilter) importanceFilterElm.addClass('hide');
        else {
            importanceFilterElm.removeClass('hide');
            var importanceHTML = '<li><a href="#" data-importance-filter="-1">Show all</a></li>';
            var lowerImportance = 0;

            Object.keys(parameters.action.importance).sort(function(max, min) {
                return max - min;
            }).forEach(function (importance) {
                importanceHTML += '<li><a href="#" data-importance-filter="' + importance +
                    '" data-importance-filter-color="' + parameters.action.importance[importance].color + '">' +
                    escapeHtml(parameters.action.importance[importance].text) + '</a></li>';
                lowerImportance = Number(importance);
            })

            importanceFilterDropDownElm.html(importanceHTML);
            M.Dropdown.init(document.querySelectorAll('.dropdown-trigger'), {
                coverTrigger: false,
                constrainWidth: false,
            });

            var defaultImportanceFilterColor = importanceFilterIconElm.css('color');
            importanceFilterElm.click(function (e) {
                e.stopPropagation();
            });
            $('[data-importance-filter]').click(function (e) {
                e.stopPropagation();
                if (!restrictions.importanceFilter) return;

                var newImportanceFilter = Number($(this).attr('data-importance-filter'));
                if(importanceFilter === newImportanceFilter) return;
                importanceFilter = newImportanceFilter;
                if (importanceFilter !== -1 && importanceFilter !== lowerImportance) {
                    importanceFilterIconElm.text('visibility_off');
                    importanceFilterIconElm.css('color', $(this).attr('data-importance-filter-color'));
                } else {
                    importanceFilterIconElm.text('visibility');
                    importanceFilterIconElm.css('color', defaultImportanceFilterColor);
                }
                startUpdate();
            });
        }

        $(document).keyup(function (e) {
            if (e.which === 27) { // Esc
                startUpdate();
                //if(reloadIconElm.text() === 'pause') startUpdate();
                //else stopUpdate();
            }
            if(e.altKey) {
                if (restrictions.Message && e.which === 49) { // message editor on '1'
                    if (createMessageElm.hasClass('hide')) {
                        createMessageElm.removeClass('hide');
                        if (!createMessageElm.hasClass('active')) collapsibleInstance.open(0);
                    } else {
                        createMessageElm.addClass('hide');
                    }
                } else if (restrictions.Historical && e.which === 50) { // history events on alt+2'
                    collapsibleInstance.close(0);
                    collapsibleInstance.open(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.close(4);
                } else if (restrictions.Current && e.which === 51) { // current events on alt+'3'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.open(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.close(4);
                } else if (restrictions.Disabled && e.which === 52) { // disabled events on alt+'4'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.open(3);
                    collapsibleInstance.close(4);
                } else if (restrictions.Comments && e.which === 53) { // commented events on alt+'5'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.open(4);
                }
            }
        });

        if(restrictions.Message) {
            quill = new Quill('#editor', {
                placeholder: 'Compose new message',
                modules: {
                    toolbar: [
                        ['bold', 'italic', 'underline', 'strike', 'clean'],        // toggled buttons
                        ['blockquote', 'code-block'],

                        [{'list': 'ordered'}, {'list': 'bullet'}],
                        [{'script': 'sub'}, {'script': 'super'}],      // superscript/subscript
                        [{'indent': '-1'}, {'indent': '+1'}],          // outdent/indent

                        [{'size': ['small', false, 'large', 'huge']}],  // custom dropdown
                        [{'header': [1, 2, 3, 4, 5, 6, false]}],

                        [{'color': []}, {'background': []}],          // dropdown with defaults from theme
                        [{'font': []}],
                        [{'align': []}],
                        ['link', 'image']                                // remove formatting button
                    ]
                },
                theme: 'snow'
            });

            quill.on('editor-change', function () {
                // set messageTopImportance to undefined when editor is empty
                if (quill.getLength() < 2) messageTopImportance = undefined;
            });
        }

        eventsFilterElm.click(function (e) {
            e.stopPropagation(); // prevent collapse
        });

        eventsFilterElm.keyup(function (e) {
            if (e.which === 27 && eventsFilterElm.val()) {
                e.stopPropagation();
                return eventsFilterElm.val('');
            }

            if(e.which === 35) { // End pressed - scroll to the end of historyEvents element
                var historyEventElm = $('#historyEvents');
                window.scrollTo(0, historyEventElm.offset().top + historyEventElm.outerHeight(true) - $(window).height() + 50);

            }

            if(e.which === 36) { // Home pressed - scroll to the eventsFilter input element
                window.scrollTo(0, $(this).offset().top - 50);
            }

            if(!eventsFilterElm.val().length) {
                startUpdate();
                //if(quill.getLength() < 2) startUpdate();
            } else stopUpdate();

            createFilteredEventTable();
        });

        // set focus to eventFilter when focus is not on recipients, subject or message editor
        eventsFilterElm.focus();
        /*
        $('body').click(function () {
            if(!$(document.activeElement).is('input') && !quill.hasFocus()) eventsFilterElm.focus();
        });
        */
        reloadElm.click(function (e) {
            e.stopPropagation(); // prevent collapse

            if(reloadIconElm.text() === 'play_arrow') stopUpdate();
            else startUpdate();
        });

        openInNewElm.click(function(e) {
            e.stopPropagation(); // prevent collapse
            var objectsNames = {};

            $('input[counterID]:checked').closest('tr').find('td[data-object-name]').each(function () {
                var objectName = $(this).attr('data-object-name');
                if(objectName) objectsNames[objectName] = true;
            });

            if(!Object.keys(objectsNames).length) return;

            var urlParameters = {
                'c': encodeURIComponent(Object.keys(objectsNames).join(',')), // selected objects
            };

            if(parameters.action.actionForSeveralObjects) {
                var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' +
                    parameters.action.actionForSeveralObjects;
                urlParameters.a = encodeURIComponent(actionPath); // /action/information
            }

            var url = '/?' + Object.keys(urlParameters).map(function(key) {
                return key + '=' + urlParameters[key];
            }).join('&');
            window.open(url, '_blank').focus();
        });

        if(parameters.action.messageTemplates.length) {
            var messageButtonsElm = $('#messageButtons');
            parameters.action.messageTemplates.forEach(function(template) {

                var buttonElm = $('<div data-tooltip="' + template.tip +
                    '" class="tooltipped chip" style="cursor:pointer">' +  template.name+ '</div>');

                messageButtonsElm.append(buttonElm);

                if(template.default) {
                    defaultTemplate = template;
                    applyTemplate(template);
                }

                buttonElm.click(function (e) {
                    e.stopPropagation();
                    applyTemplate(template);
                    templateSelectedManual = true;
                });

                if(Array.isArray(template.autoApplyFor)) {
                    template.autoApplyFor.forEach((condition) => {
                        condition.objectNameRE = convertReStr2Re(condition.objectNameRE);
                        condition.counterNameRE = convertReStr2Re(condition.counterNameRE);
                        condition.eventDescriptionRE = convertReStr2Re(condition.eventDescriptionRE);
                    });
                }
            });
        }

        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {
            enterDelay: 2000
        });

        setInterval(getDataByAjax, updateInterval);
    }

    function convertReStr2Re(reStrArr) {
        if(!Array.isArray(reStrArr)) return reStrArr;
        var reArray = [];
        reStrArr.forEach((reStr) => {
            try {
                reArray.push( new RegExp(reStr, 'ig'));
            } catch (err) {
                console.log('Can\'t make RE from', reStr, 'for', reStrArr, ':', err.message);
                M.toast({html: 'Can\'t make RE from' + reStr + 'for' + reStrArr + ':' + err.message, displayLength: 10000});
            }
        });
        return reArray;
    }

    function soundOff() {
        soundIconElm.text('volume_off');
        soundIconElm.addClass('red-text');
        if(actionConfig.sound !== false) {
            actionConfig.sound = false;

            // function from init.js
            setActionConfig(actionConfig);
        }
    }

    function soundOn() {
        soundIconElm.text('volume_up');
        soundIconElm.removeClass('red-text');
        if(actionConfig.sound !== true) {
            actionConfig.sound = true;

            // function from init.js
            setActionConfig(actionConfig);
        }
        try {
            new Audio(parameters.action.link + '/static/beep.wav').play().then(() => {});
            // use convertToSpeech() for able to change the phrase "Voice pronunciation of events enabled"
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(
                convertToSpeech('Voice pronunciation of events enabled')
            ));
        } catch (e) {
        }
    }

    function showMessageEditor() {
        createMessageElm.removeClass('hide');
        actionConfig.showMessageEditor = true;

        // function from init.js
        setActionConfig(actionConfig);
    }

    function hideMessageEditor() {
        createMessageElm.addClass('hide');
        actionConfig.showMessageEditor = false;

        // function from init.js
        setActionConfig(actionConfig);
    }

    function initElementsRestrictions(callback) {

        // function from init.js
        getActionConfig(function(config) {
            actionConfig = config;

            if(actionConfig.sound === false) soundOff();

            // res = {actions:[]..., restrictions: <>}
            $.post(serverURL, {func: 'getRestrictions'}, function(results) {
                if(!results || typeof results !== 'object' || !Object.values(results)[0]) {
                    console.error('Restrictions are not returned or error:', results);
                    return callback();
                }

                var res = Object.values(results)[0];
                actions = res.actions; // filter actions to display links only to actions allowed by the user

                restrictions = res.restrictions;
                if(!restrictions) {
                    alert('Can\'t get user restrictions');
                    return;
                }
                if(!restrictions.Historical) {
                    $('#historicalEventsLabel').remove();
                    var historyEventsElm = $('#historyEvents');
                    historyEventsElm.find('div.collapsible-header').click(function () {
                        return false;
                    })
                    historyEventsElm.find('div.collapsible-body').children().remove();
                    getDataForHistoryEvents = false;
                }
                if(!restrictions.Current) {
                    $('#currentEvents').remove();
                    getDataForCurrentEvents = false;
                }
                if(!restrictions.Disabled) {
                    $('#disabledEvents').remove();
                    getDataForDisabledEvents = false;
                }

                if(!restrictions.Comments) $('#historyCommentedEvents').remove();

                if(!restrictions.Message) {
                    $('#createMessage').children().remove();
                    $('#showEditor').remove();
                } else {
                    var actionRestrictions = restrictions.Message;
                    if(actionRestrictions.Comments === false) {
                        $('#addAsComment').prop('disabled', true).prop('checked', false);
                    }
                    if(actionRestrictions.Hints === false) {
                        $('#addAsHint').prop('disabled', true).prop('checked', false);
                        $('#addAsHintForObject').prop('disabled', true).prop('checked', false);
                    }
                    if(actionRestrictions.Solve === false) {
                        $('#solveProblem').prop('disabled', true).prop('checked', false);
                    }
                    if(actionRestrictions.Enable === false) {
                        $('#enableEvents').prop('disabled', true).prop('checked', false);
                        $('#removeTimeIntervals').prop('disabled', true);
                    }
                    if(actionRestrictions.Disable === false) {
                        $('#disableEvents').prop('disabled', true).prop('checked', false);
                        $('#disableUntilDate').prop('disabled', true);
                        $('#disableFromDate').prop('disabled', true);
                        $('#disableUntilTime').prop('disabled', true);
                        $('#disableFromTime').prop('disabled', true);
                        $('#disableDaysOfWeek').prop('disabled', true);
                        $('#disableTimeIntervalFrom').prop('disabled', true);
                        $('#disableTimeIntervalTo').prop('disabled', true);
                    }
                }

                if(!restrictions.Sound) $('#soundIcon').remove();

                if(!restrictions.Hints) useHints = false;
                if(!restrictions.Info) useInfo = false;
                if(!restrictions.History) useHistory = false;
                if(!restrictions.Links) useLinks = false;

                //console.log(restrictions);
                callback();
            });
        })
    }

    function initSelectAll() {
        $('a[uncheckSelected]').click(function (e) {
            e.stopPropagation(); // prevent collapse
            e.preventDefault();

            var checkedCheckboxesElm = $(this).closest('table').find('input[selectEventCheckbox]:checked');

            if(!checkedCheckboxesElm.length) { // select all
                $(this).closest('table').find('tr:not(.hide)').find('input[selectEventCheckbox]').trigger('click');
                return;
            }

            checkedCheckboxesElm.trigger('click');

            if(!$('input[selectEventCheckbox]:checked').length) {

                if(quill.getLength() < 2) {
                    startUpdate();
                }
            }
        });
    }

    function ajaxError (jqXHR, exception, callback) {
        bodyElm.css("cursor", "auto");
        var msg;
        if (jqXHR.status === 404) {
            msg = 'Requested page not found. [404]';
        } else if (jqXHR.status === 500) {
            msg = 'Internal Server Error [500].';
        } else if (exception === 'parsererror') {
            msg = 'Requested JSON parse failed.';
        } else if (exception === 'timeout') {
            msg = 'Time out error.';
        } else if (exception === 'abort') {
            msg = 'Ajax request aborted.';
        } else if (jqXHR.status === 0) {
            msg = 'Not connect. Verify Network.';
        } else {
            msg = 'Uncaught Error.\n' + jqXHR.responseText;
        }
        M.toast({
            html: 'Web server error: ' + msg + ' [status: ' + jqXHR.status +
                (exception ? '; exception: ' + exception : '')+ ']',
            displayLength: 5000
        });

        if(typeof callback === 'function') callback();
    }

    function onChangeObjects(_objects) {
        objects = _objects;
        if(objects.length) {
            $('#filteredByObjects').removeClass('hide');
        } else {
            $('#filteredByObjects').addClass('hide');
        }
        getDataByAjax();
    }

    function checkBeforeExec (callback) {
        if(!$('input[name="action"]').is(':checked') || !$('input[selectEventCheckbox]:checked').get().length) {
            return callback(new Error('No action or events selected. The action cannot be completed and will be canceled'));
        }

        var addCommentElm = $('#modalAdditionalComment');
        var sendMessageBtnElm = $('#modalSendMessage');
        var openEditorBtnElm = $('#modalOpenEditor');

        addCommentElm.unbind('keyup').keyup(function(e) {
            if(!modal) return; // when focus in the element, but modal was closed()
            if(e.which === 13) {
                whatDoWeDoDialogBtn = sendMessageBtnElm[0];
                modal.close();
            } else if(e.which === 27) {
                if(addCommentElm.val()) addCommentElm.val('');
                else {
                    whatDoWeDoDialogBtn = openEditorBtnElm[0];
                    modal.close();
                }
            }
        });

        if(quill.getLength() < 2 && !$('#enableEvents').is(':checked')) {
            if (createMessageElm.hasClass('hide')) createMessageElm.removeClass('hide');
            if (!createMessageElm.hasClass('active')) collapsibleInstance.open(0);
            composeMessage();
            var whatDoWeDoDialogBtn = null;
            var modal = M.Modal.init(document.getElementById('whatDoWeDoDialog'), {
                inDuration: 0,
                outDuration: 0,
                dismissible: false,
                onCloseStart: function() { addCommentElm.blur(); },
                onCloseEnd: function() {
                    if(!whatDoWeDoDialogBtn || $(whatDoWeDoDialogBtn).attr('id') === 'modalOpenEditor') {
                        quill.focus();
                        callback(new Error('Action canceled'));
                    } else continueCheck();
                }
            });
            openEditorBtnElm.unbind('click').click(function() { whatDoWeDoDialogBtn = this; });
            sendMessageBtnElm.unbind('click').click(function() { whatDoWeDoDialogBtn = this; });

            setTimeout(function() {
                modal.open();
                setTimeout(function() {
                    addCommentElm.focus();
                }, 200);
            }, 500);

            return;
        }

        continueCheck();

        function continueCheck() {
            var recipients = rcptChipsInstances.chipsData.map(function(obj) {
                return obj.tag;
            }).join(', ');
            $('#recipients').val(recipients);

            var messageBody = quill.getHtml();
            // remove first 2 new lines and add better style to <p>
            if(addCommentElm.val()) {
                messageBody =
                    '<p style=\'margin: 0 0 .0001pt 0; font-family: "Calibri","sans-serif";' +
                    'font-size: 13pt;font-weight: bold;\'>' + addCommentElm.val() + '</p>' +
                    messageBody.replace(/^<p><br><\/p>/i, '');
                addCommentElm.val('');
            }
            $('#message').val(messageBody
                .replace(/^<p><br><\/p><p><br><\/p>/i, '')
                .replace(/<p>/gi, '<p style=\'margin: 0 0 .0001pt 0; font-family: "Calibri","sans-serif"; ' +
                    'font-size: 13pt\'>'));

            if($('#disableEvents').is(':checked')) {
                var dateUntil = getDateTimestampFromStr($('#disableUntilDate').val());
                var timeUntil = getTimeFromStr($('#disableUntilTime').val());

                if (dateUntil && timeUntil) var disableUntil = dateUntil + timeUntil;
                else return callback(new Error('Please set date and time for the disabled event'));

                if(disableUntil > Date.now()) $('#disableUntil').val(disableUntil);
                else {
                    return callback(new Error(
                        'Please set a date and time limit for the disabled event later than the current time'));
                }

                var dateFrom = getDateTimestampFromStr($('#disableFromDate').val());
                var timeFrom = getTimeFromStr($('#disableFromTime').val());

                if (dateFrom && timeFrom) {
                    var disableFrom = dateFrom + timeFrom;

                    if(disableFrom < disableUntil) $('#disableFrom').val(disableFrom);
                    else {
                        return callback(new Error(
                            'Please set the start time before the end time of the disabled event'));
                    }
                }

                var timeStrFrom = $('#disableTimeIntervalFrom').val();
                var timeStrTo = $('#disableTimeIntervalTo').val();
                var timeIntervalFrom = getTimeFromStr(timeStrFrom);
                var timeIntervalTo = getTimeFromStr(timeStrTo);

                if(timeIntervalFrom !== 0 && timeIntervalTo !== 0) {
                    if (timeIntervalTo > timeIntervalFrom) {
                        $('#disableTimeInterval').val(String(timeIntervalFrom) + '-' + String(timeIntervalTo));
                    } else {
                        $('#disableTimeInterval').val(String(timeIntervalFrom) + '-86400000;0-' +
                            String(timeIntervalTo));
                    }
                } else {
                    if(timeStrFrom || timeStrTo) {
                        return callback(new Error('Please correct the time interval: ' +
                            timeStrFrom + ' - ' + timeStrTo));
                    }
                    $('#disableTimeInterval').val('');
                }
            }

            if(removeIntervalsElm.is(':checked')) {
                var timeIntervalsForRemove = $('#timeIntervalsForRemove').val();
                if(!timeIntervalsForRemove) return callback(new Error('Please select time intervals for remove'));
            }

            callback();
        }
    }

    function runAfterExec (parameterNotUsed, callback) {
        lastAction = null;
        if(restrictions.Message) {
            subjectElm.val('');
            quill.setText('');
            if(templateSelectedManual) templateSelectedManual = false;
            //else applyTemplate(lastTemplate);
            applyTemplate(defaultTemplate);
            if (createMessageElm.hasClass('active')) collapsibleInstance.close(0);
        }
        $('input[type=checkbox]:checked').prop('checked', false);
        if(restrictions.Message === true || (typeof restrictions.Message === 'object' && restrictions.Message.Comments)) {
            $('#addAsComment').prop('checked', true);
        }
        setDisabledEventsControlPanel();
        setTimeout(function () {
            eventsFilterElm.focus();
        }, 500);

        // waiting for making changes in database
        setTimeout(function () {
            startUpdate();
            callback();
        }, 1500);
    }

    function setUntilDateTimeControl(addMinutes) {
        var now = new Date();
        $('#disableFromDate').val(getDateString(now));
        $('#disableFromTime').val(String('0' + now.getHours() + ':' + '0' +
            now.getMinutes()).replace(/\d(\d\d)/g, '$1'));

        now.setMinutes(now.getMinutes() + addMinutes);
        $('#disableUntilDate').val(getDateString(now));
        $('#disableUntilTime').val(String('0' + now.getHours() + ':' + '0' +
            now.getMinutes()).replace(/\d(\d\d)/g, '$1'));
    }

    function applyTemplate (template) {
        var _maxMessageImportance = template.importance !== undefined ? Number(template.importance) : 0;
        if(messageTopImportance !== undefined && _maxMessageImportance > messageTopImportance) {
            M.toast({
                html: 'Can\'t use template. Importance of added events is higher than allowed in template',
                displayLength: 5000
            });
            return;
        }
        maxMessageImportance = _maxMessageImportance;

        if(template.subject) {
            var prevSubject = subjectElm.val() || '';
            if(prevSubject) { // remove template subjects from subject
                parameters.action.messageTemplates.forEach(function (t) {
                    if(!t || !t.subject) return;
                    if (prevSubject.indexOf(t.subject + ' ') !== -1) {
                        prevSubject = prevSubject.replace(t.subject + ' ', '');
                    }
                });
            }

            if(!prevSubject || prevSubject.toLowerCase().indexOf(template.subject.toLowerCase()) === -1)
                subjectElm.val(template.subject + ' ' +prevSubject);
            M.updateTextFields();
        }

        if(template.recipients && template.recipients.length) {
            parameters.action.rcptOptions.data = template.recipients.map(function (rcpt) {
                return {
                    tag: rcpt
                }
            });
        } else parameters.action.rcptOptions.data = [];

        if(template.replyTo) replyToElm.val(template.replyTo);
        else if(parameters.action.replyTo) replyToElm.val(parameters.action.replyTo);
        else replyToElm.val('');

        // e is a document.getElementById('rcpt_chips')
        parameters.action.rcptOptions.onChipAdd = function(e) {
            var lastChipNumber = ($(e).find('div.chip').length) - 1;
            var email = rcptChipsInstances.chipsData[lastChipNumber].tag;

            if (!emailValidateRE.test(email.toLowerCase())) {
                M.toast({html: 'You entered not valid email address: ' + email, displayLength: 10000});
                rcptChipsInstances.deleteChip(lastChipNumber);
            }
        };

        if(rcptChipsInstances) rcptChipsInstances.deleteChip();

        rcptChipsInstances = M.Chips.init(document.getElementById('rcpt_chips'), parameters.action.rcptOptions);
        subjectElm.focus();

        lastTemplate = template;
    }


    function getDataByAjax(callback) {
        // exit and say "update paused" after 5 minutes delay
        if(Date.now() - gettingDataInProgress < 300000 /*gettingDataInProgress*/ || (
            !getDataForHistoryEvents && !getDataForCurrentEvents && !getDataForDisabledEvents)
        ) {
            if(!updatePaused) updatePaused = Date.now();
            if(soundIconElm.text() === 'volume_up' && Date.now() - updatePaused > 300000) {
                try {
                    new Audio(parameters.action.link + '/static/beep.wav').play().then(() => {});
                    // use convertToSpeech() for able to change the phrase "Update paused"
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance(
                        convertToSpeech('Update paused')
                    ));
                } catch (e) {
                }
            }
            return;
        }
        bodyElm.css("cursor", "progress");
        gettingDataInProgress = Date.now();
        updatePaused = 0;

        var objectsIDs = objects.map(function (object) {
            return object.id;
        });

        var startUpdateTime = new Date();
        lastUpdateElm.text('Start update at ' +
            startUpdateTime.toLocaleString().replace(/\.\d\d\d\d,/, ''));

        $.ajax({
            type: 'POST',
            timeout: updateInterval - 3000,
            url: serverURL,
            data: {
                func: 'getEventsData',
                getDataForHistoryEvents: getDataForHistoryEvents ? '1' : '',
                getDataForCurrentEvents: getDataForCurrentEvents ? '1' : '',
                getDataForDisabledEvents: getDataForDisabledEvents ? '1' : '',
                objectsIDs: objectsIDs.join(','),
            },
            error: ajaxError,
            success: function (results) { //{history: [..], current: [...], disabled: [...]}
                //console.log(result)
                if (!results || typeof results !== 'object') {
                    bodyElm.css("cursor", "auto");
                    gettingDataInProgress = 0;
                    var lastUpdateTime = new Date();
                    lastUpdateElm.text('No data at ' +
                        lastUpdateTime.toLocaleString().replace(/\.\d\d\d\d,/, ''));
                    updateTimeElm.text(' (' + Math.round((lastUpdateTime - startUpdateTime) / 10) / 100 + 'sec)');
                    if (typeof callback === 'function') callback();
                    return;
                }

                var result = {
                    history: [],
                    current: [],
                    disabled: [],
                }

                for(var hostPort in results) {
                    var res = results[hostPort];
                    if(Array.isArray(res.history)) {
                        res.history.forEach(row => {
                            row.id = hostPort + ':' + row.id;
                            result.history.push(row);
                        });
                    }
                    if(Array.isArray(res.current)) {
                        res.current.forEach(row => {
                            row.id = hostPort + ':' + row.id;
                            result.current.push(row);
                        });
                    }
                    if(Array.isArray(res.disabled)) {
                        res.disabled.forEach(row => {
                            row.id = hostPort + ':' + row.id;
                            result.disabled.push(row);
                        });
                    }
                }

                hintCache = {};
                eventsData = result;

                var eventsNum = 0;
                if (getDataForHistoryEvents) {
                    drawHistoryEventsTable(result.history);
                    if (result.history && result.history.length) eventsNum += result.history.length;
                }
                if (getDataForCurrentEvents) {
                    drawCurrentEventsTable(result.current);
                    if (result.current && result.current.length) eventsNum += result.current.length;
                }
                if (getDataForDisabledEvents) {
                    drawDisableEventsTable(result.disabled);
                    if (result.disabled && result.disabled.length) eventsNum += result.disabled.length;
                }

                addEventHandlersToTables(objectsIDs);

                bodyElm.css("cursor", "auto");
                gettingDataInProgress = 0;
                lastUpdateTime = new Date();
                lastUpdateElm.text('Update ' + eventsNum + ' events at ' +
                    lastUpdateTime.toLocaleString().replace(/\.\d\d\d\d/, ''));
                updateTimeElm.text(' (' + Math.round((lastUpdateTime - startUpdateTime) / 10) / 100 + 'sec)');
                if (typeof callback === 'function') return callback();
            }
        });
    }

    function addEventHandlersToTables(objectsIDs) {
        createFilteredEventTable();
        makeEventsForDataBrowser();

        // click on row
        $('tr').click(function(e) {
            // prevent (remove) text selection if occurred when shift key pressed
            if(e.shiftKey) {
                if(document.selection && document.selection.empty) {
                    document.selection.empty();
                } else if(window.getSelection) {
                    var sel = window.getSelection();
                    sel.removeAllRanges();
                }
            }

            // send click event to checkbox
            var checkboxElm = $(this).find('input[selectEventCheckbox]');
            checkboxElm.trigger('click', e); // e - send ctrl and shift keys state to checkbox click event processor
        });

        // click on checkbox
        $('input[selectEventCheckbox]').click(function (e, e1) {
            if(e1) e = e1; // e1 returned if event occurred when click was on <TR> element (from trigger function)
            if(e.shiftKey) multipleSelectOnClickWithShift($(this));
            if(e.ctrlKey) multipleSelectElmWithCtrl($(this));

            setDisabledEventsControlPanel(this);
            if(this.checked) {
                stopUpdate();
            } else {
                if(eventsFilterElm.val()) createFilteredEventTable();
                if (!$('input[selectEventCheckbox]:checked').length) {

                    if (quill.getLength() < 2) {
                        startUpdate();
                    }
                }
            }
        });

        // don\'t change checkbox state when click on hint or info
        $('td[preventCheckboxCheck]').click(function(e) {
            e.stopPropagation();
        });

        addHintClickEvent();

        // show comment and disable info for event
        $('div.chip[commentID]').click(function() {
            var ID = $(this).attr('commentID');
            var OCID = $(this).attr('OCID');
            makeHint('getComment', OCID ? ID + ',' + OCID : ID, function(hint) {
                if(hint.subject) $('#hintSubject').text(hint.subject);
                else $('#hintSubject').text('');
                $('#hintComment').html(hint.text);
                hintDialogInstance.open();
            });
        });

        $('div.chip[data-commentIDForEvents]').click(function() {
            bodyElm.css("cursor", "progress");
            $.ajax({
                type: 'POST',
                timeout: 180000,
                url: serverURL,
                data: {
                    func: 'getCommentedEventsList',
                    objectsIDs: objectsIDs.join(','),
                    commentID: $(this).attr('data-commentIDForEvents')
                },
                error: ajaxError,
                success: function (results) {
                    $('#hintSubject').text('Event list');
                    if (!results || typeof results !== 'object') {
                        $('#hintComment').text('Can\'t find events list for this comment');
                    } else {
                        $('#hintComment').html('\
<table class="bordered highlight responsive-table">\
    <thead>\
        <tr>\
            <th var="EVENT_UD" class="hide"></th>\
            <th var="OCID" class="hide"></th>\
            <th var="COUNTER_NAME" class="hide"></th>\
            <th var="START_TIME_MS" class="hide"></th>\
            <th var="END_TIME_MS" class="hide"></th>\
            <th var="OBJECT_NAME">Object</th>\
            <th var="EVENT_DESCRIPTION">Description</th>\
            <th var="IMPORTANCE" class="hide">Importance</th>\
            <th var="START_TIME">From</th>\
            <th var="END_TIME">To</th>\
            <th var="DURATION">Duration</th>\
            <th var="LAST_TIME">Last time</th>\
            <th>Actions</th>\
            <th><a href="#" uncheckSelected>Select</a></th>\
        </tr>\
    </thead>\
    <tbody id="historyEventsTableForCommentedEvents">\
        <tr>\
            <td colspan="100" style="text-align: center;">Waiting for initializing...</td> \
        </tr>\
    </tbody>\
</table>');
                        var rows = [];
                        for(var hostPort in results) {
                            var res = results[hostPort];
                            if (Array.isArray(res)) {
                                res.forEach(row => {
                                    row.id = hostPort + ':' + row.id;
                                    rows.push(row);
                                });
                            }
                        }
                        drawHistoryEventsTable(rows, $('#historyEventsTableForCommentedEvents'));
                    }
                    hintDialogInstance.open();
                    addHintClickEvent();
                    initSelectAll();
                    addEventHandlersToTables(objectsIDs);
                    bodyElm.css("cursor", "auto");
                }
            });
        });

        $('div.chip[data-OCIDForHistory]').click(function() {
            var OCID = $(this).attr('data-OCIDForHistory');
            bodyElm.css("cursor", "progress");
            $.ajax({
                type: 'POST',
                timeout: 60000,
                url: serverURL,
                data: {
                    func: 'getHistoryData',
                    OCID: OCID,
                },
                error: ajaxError,
                success: function (results) {
                    $('#hintSubject').text('Event history');
                    $('#hintComment').html('\
<table class="bordered highlight responsive-table">\
    <thead>\
        <tr>\
            <th var="EVENT_UD" class="hide"></th>\
            <th var="OCID" class="hide"></th>\
            <th var="COUNTER_NAME" class="hide"></th>\
            <th var="START_TIME_MS" class="hide"></th>\
            <th var="END_TIME_MS" class="hide"></th>\
            <th var="OBJECT_NAME">Object</th>\
            <th var="EVENT_DESCRIPTION">Description</th>\
            <th var="IMPORTANCE" class="hide">Importance</th>\
            <th var="START_TIME">From</th>\
            <th var="END_TIME">To</th>\
            <th var="DURATION">Duration</th>\
            <th var="LAST_TIME">Last time</th>\
            <th>Actions</th>\
            <th><a href="#" uncheckSelected>Select</a></th>\
        </tr>\
    </thead>\
    <tbody id="historyEventsTableForHistoryData">\
        <tr>\
            <td colspan="100" style="text-align: center;">Waiting for initializing...</td> \
        </tr>\
    </tbody>\
</table>');
                    if(!results || typeof results !== 'object') {
                        console.error('Historical events are not returned or error:', results);
                        return;
                    }
                    var rows = [];
                    for(var hostPort in results) {
                        var res = results[hostPort];
                        if (Array.isArray(res)) {
                            res.forEach(row => {
                                row.id = hostPort + ':' + row.id;
                                rows.push(row);
                            });
                        }
                    }
                    drawHistoryEventsTable(rows, $('#historyEventsTableForHistoryData'));
                    hintDialogInstance.open();
                    addHintClickEvent();
                    initSelectAll();
                    addEventHandlersToTables(objectsIDs);
                    bodyElm.css("cursor", "auto");
                }
            });
        });
    }



    function getAndDrawCommentsTable() {
        bodyElm.css("cursor", "progress");
        var objectsIDs = objects.map(function (object) {
            return object.id;
        });
        // convert time to UTC for support different TZ in browser and server
        // for UTC+10 return -600 (minutes); convert from minutes to milliseconds
        var tzOffset = new Date().getTimezoneOffset() * 60000;
        $.ajax({
            type: 'POST',
            timeout: 60000,
            url: serverURL,
            data: {
                func: 'getComments',
                from: commentsFromInstance.date.getTime() + tzOffset,
                to: commentsToInstance.date.getTime() + tzOffset,
                objectsIDs: objectsIDs.join(',')
            },
            error: ajaxError,
            success: function (results) {
                if (results && typeof results === 'object') {
                    var rows = [];
                    for(var hostPort in results) {
                        var res = results[hostPort];
                        if (Array.isArray(res)) {
                            res.forEach(row => {
                                row.id = hostPort + ':' + row.id;
                                rows.push(row);
                            });
                        }
                    }
                    drawHistoryCommentedEventsTable(rows);
                    addEventHandlersToTables(objectsIDs);
                }
                bodyElm.css("cursor", "auto");
            }
        });
    }

    function addHintClickEvent() {
        // show hint for event
        $('div.chip[hintID]').click(function() {
            var ID = $(this).attr('hintID');
            makeHint('getHint', ID, function(comment) {
                if(comment.subject) $('#hintSubject').text(comment.subject);
                else $('#hintSubject').text('');
                $('#hintComment').html(comment.text);
                hintDialogInstance.open();
            });
        });
    }

    function setDisabledEventsControlPanel(elm) {

        var disabledEventsCheckedElms = $('input[disabledEventCheckBox]:checked');
        var disabledEventsCheckedCnt = disabledEventsCheckedElms.get().length;

        disableDaysOfWeekElm.val('');

        timeIntervalsElm.empty();
        removeIntervalsElm.prop('checked', false);
        removeIntervalsElm.prop('disabled', true);
        timeIntervalsElm.prop('disabled', true);

        if(elm && elm.checked) {
            if ($(elm).is('[disabledEventCheckBox]'))
                $('input[selectEventCheckbox]:checked').not('input[disabledEventCheckBox]').prop('checked', false);
            else {
                disabledEventsCheckedElms.prop('checked', false);
                disabledEventsCheckedCnt = 0;
            }
        }

        if(disabledEventsCheckedCnt === 1) {
            if(eventsData.disabled) {
                // disabledEventCheckBox = '127.0.0.1:10164:<eventID>
                var eventID = disabledEventsCheckedElms.attr('disabledEventCheckBox');
                for (var i = 0; i < eventsData.disabled.length; i++) {
                    console.log(eventsData.disabled[i], eventID)

                    if (eventsData.disabled[i].id === eventID) {
                        if (eventsData.disabled[i] && eventsData.disabled[i].disableUntil) {
                            if (eventsData.disabled[i].disableFrom) {
                                var disableFrom = new Date(eventsData.disabled[i].disableFrom);
                                $('#disableFromDate').val(getDateString(disableFrom));
                                $('#disableFromTime').val(String('0' + disableFrom.getHours() + ':' + '0' +
                                    disableFrom.getMinutes()).replace(/\d(\d\d)/g, '$1'));
                            }

                            var disableUntil = new Date(eventsData.disabled[i].disableUntil);
                            $('#disableUntilDate').val(getDateString(disableUntil));
                            $('#disableUntilTime').val(String('0' + disableUntil.getHours() + ':' + '0' +
                                disableUntil.getMinutes()).replace(/\d(\d\d)/g, '$1'));

                            if (eventsData.disabled[i].disableDaysOfWeek) {
                                disableDaysOfWeekElm.val(eventsData.disabled[i].disableDaysOfWeek.split(','))
                            }

                            if (eventsData.disabled[i].disableIntervals) {
                                var intervals = eventsData.disabled[i].disableIntervals.split(';').map(function (interval) {
                                    return '<option value="' + interval + '">' +
                                        getTimeFromTimeInterval(interval) +
                                        '</option>';
                                });

                                if (intervals.length) {
                                    removeIntervalsElm.prop('disabled', false);
                                    timeIntervalsElm.prop('disabled', false);
                                    timeIntervalsElm.append(intervals.join(''));
                                }
                            }
                        }

                        break;
                    }
                }
            }
        }
        // When there are no rights, the materialize element cannot be initialized
        try {
            M.FormSelect.init(disableDaysOfWeekElm[0], {});
            M.FormSelect.init(timeIntervalsElm[0], {});
        } catch(e) {}

        if(!disabledEventsCheckedCnt) {
            enableEventsElm.prop('checked', false);
            removeIntervalsElm.prop('checked', false);
            disabledEventsControlElm.addClass('hide');
        } else disabledEventsControlElm.removeClass('hide');
    }

    function getTimeFromTimeInterval(interval) {
        var fromTo = interval.split('-');
        //dd = h * 3600000 + m * 60000;
        //m = (dd - h*360000) / 60000

        var from = ('0' + Math.floor(fromTo[0] / 3600000) + ':0' +
            Math.floor((fromTo[0] - Math.floor(fromTo[0] / 3600000) * 3600000) / 60000))
            .replace(/\d(\d\d)/g, '$1');

        var to = ('0' + Math.floor(fromTo[1] / 3600000) + ':0' +
            Math.floor((fromTo[1] - Math.floor(fromTo[1] / 3600000) * 3600000) / 60000))
            .replace(/\d(\d\d)/g, '$1');

        return from + '-' + to;
    }


    /** Multiple select or unselect events with same counter name
     * @param {jQuery} clickedCheckboxElm - is a checkBox jquery elm
     */
    function multipleSelectElmWithCtrl(clickedCheckboxElm) {
        var counterID = clickedCheckboxElm.attr('counterID');

        // this is the new changed state of the checkbox after click
        var newCheckedProp = clickedCheckboxElm.is(':checked');

        // find all inputs in the current table (tbody) with attribute counterID with equal <counterID> of selected checkbox
        // and revert they checked property
        clickedCheckboxElm.closest('tbody').find('tr:not(.hide)').find('input[counterID="' + counterID+ '"]').prop('checked', newCheckedProp);
    }

    /** Multiple selection of several events in order (like selection when pressed Shift)
     * @param {jQuery} clickedCheckboxElm - is a checkBox jquery elm
     */
    function multipleSelectOnClickWithShift(clickedCheckboxElm) {
        var upElements = [], downElements = [], elementsForSelect;
        var trElm = clickedCheckboxElm.closest('tr');

        for(var upNearestTR = trElm.prev(), downNearestTR = trElm.next();
            upNearestTR.length || downNearestTR.length;
            upNearestTR = upNearestTR.prev('tr'), downNearestTR = downNearestTR.next('tr')
        ) {
            if(upNearestTR.length && !upNearestTR.hasClass('hide')) {
                if (upNearestTR.find('input[selectEventCheckbox]').is(':checked')) {
                    elementsForSelect = upElements;
                    //console.log('up: ', upNearestTR.find('input[selectEventCheckbox]').is(':checked'), upNearestTR.text());
                    break;
                }
                upElements.push(upNearestTR);
            }

            if(downNearestTR.length && !downNearestTR.hasClass('hide')) {
                if (downNearestTR.find('input[selectEventCheckbox]').is(':checked')) {
                    elementsForSelect = downElements;
                    //console.log('down: ', downNearestTR.find('input[selectEventCheckbox]').is(':checked'), downNearestTR.text());
                    break;
                }
                downElements.push(downNearestTR);
            }
        }

        if(!elementsForSelect) {
            if(upElements.length <= downElements.length) elementsForSelect = upElements;
            else elementsForSelect = downElements;
        }

        elementsForSelect.forEach(function (elm) {
            elm.find('input[selectEventCheckbox]').prop('checked', true);
        })
    }

    function makeHint (func, ID, callback) {
        bodyElm.css("cursor", "progress");
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: func,
                ID: ID
            },
            error: ajaxError,
            success: function (results) {

                if(!results || typeof results !== 'object' || !Object.values(results)[0]) return;
                var row = Object.values(results)[0];

                if (row.disableUntil) {
                    if (row.disableIntervals) {
                        var intervals = row.disableIntervals.split(';'),
                            // last midnight
                            lastMidnight =
                                new Date(new Date().setHours(0, 0, 0, 0)).getTime();

                        var disabledTimeIntervals = ', time intervals: ' + intervals.map(function (interval) {
                            var fromTo = interval.split('-');
                            var from = new Date(lastMidnight +
                                Number(fromTo[0])).toLocaleTimeString().replace(/:\d\d$/, '');
                            var to = new Date(lastMidnight +
                                Number(fromTo[1])).toLocaleTimeString().replace(/:\d\d$/, '');
                            return from + '-' + to;
                        }).join('; ');
                    } else disabledTimeIntervals = '';


                    if (row.disableDaysOfWeek) {
                        var disableDaysOfWeek = ' on' + row.disableDaysOfWeek.split(',')
                            .map(dayOfWeek => parameters.action.dayNames[Number(dayOfWeek)])
                            .join(',');
                    } else disableDaysOfWeek = '';

                    if (row.disableFrom) {
                        var disableFrom = new Date(row.disableFrom).toLocaleString();
                    } else disableFrom = 'Now'
                }

                var user = row.user ?
                    "<p class='margin-0'><strong>Created by: </strong>" + row.user + '</p>' : '';

                var recipients = row.recipients ?
                    "<p class='margin-0'><strong>Message was sending to:</strong> " + row.recipients + '</p>' : '';

                var text = '<p>' + (row.comment ?
                    row.comment.replace(/<ul>/gmi, '<ul class=browser-default>').replace(/<(h\d)>/gmi,
                        '<$1 style="font-size:2em">') : '') + '</p>';

                var time = row.timestamp ?
                    "<p class='margin-0'><strong>Date: </strong>" +
                    new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</p>' :
                    '';

                var disableTime = row.disableUntil ?
                    '<p class="margin-0"><strong>Event will be disabled from </strong>' + disableFrom + ' to ' +
                    new Date(row.disableUntil).toLocaleString() + disableDaysOfWeek + disabledTimeIntervals + '</p>' :
                    '';

                bodyElm.css("cursor", "auto");
                callback({
                    subject: row.subject,
                    text: text + '<br/><br/>' + user + recipients + disableTime + time
                });
            }
        });
    }

    function drawHistoryEventsTable(result, elm) {
        var tablePartHTML = '';

        if(!elm) {
            elm = $('#historyEventsTable');
            var skipFilterAttr = '';
        } else skipFilterAttr = ' data-skip-search-filter ';
        if (!result || !result.length) {
            tablePartHTML =
                '<tr><td colspan="100" style="text-align: center;">No historical events</td></tr>';
        } else {
            var maxWidth = Math.round((elm.width() * 0.2 > $(window).width() ? $(window).width() : elm.width()) * 0.5);
            result.sort((a, b) => b.startTime - a.startTime).forEach(function (row, idx) {
                if(idx > maxEventsNumberInTable) return;
                if(restrictions.importanceFilter && importanceFilter > -1 && row.importance > importanceFilter) return;

                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color.trim() : 'auto';
                var styleFontWeight = row.endTime ? '' : 'font-weight:bold;';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectHistoryEvent_'+ row.id+':checked').length ? ' checked' : '';
                var hintLink = useHints && row.hintID ? '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var historyLink = useHistory ? '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ' : '';

                tablePartHTML += '\
<tr historyEventsRow OCID="' + row.OCID + '" importance="' + row.importance + '" ' +
                    'onmouseover="this.style.backgroundColor=\'lightgrey\'" onmouseout="this.style.backgroundColor=\'' +
                    color + '\'" ' +
                    skipFilterAttr + 'style="cursor: pointer; background-color: ' + color + ';' + styleFontWeight + '">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td class="hide">' + row.startTime + '</td>\
    <td class="hide">' + row.endTime + '</td>\
    <td data-object-name="' + row.objectName +'">' + escapeHtml(row.objectName) + '</td>\
    <td style="max-width:'+maxWidth+'px;overflow-wrap: break-word;">' + floatToHuman(row.eventDescription ? row.eventDescription : row.counterName) + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' + (row.startTime ? new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.endTime ? new Date(row.endTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.startTime ? getHumanTime((row.endTime ? row.endTime : Date.now()) - row.startTime) : '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime, row.counterID) + hintLink + historyLink +
                    '</td>\
                    <td preventCheckboxCheck>\
                        <label>\
                            <input type="checkbox" selectEventCheckbox counterID="' + row.counterID + '" id="selectHistoryEvent_'+ row.id+'"' + isChecked+ '/>\
            <span></span>\
        </label>\
    </td>\
</tr>';
            });
        }

        elm.html(tablePartHTML);
    }

    function speakUpNewEvents(events) {
        var newEvents = {}, startTime = Date.now(), tooManyEventsSpoken = false;

        events.forEach(function(event) {
            newEvents[event.id] = true;
            if(prevEvents[event.id] || tooManyEventsSpoken || soundIconElm.text() !== 'volume_up') return;

            try {
                var audio = new Audio(parameters.action.link + '/static/beep.wav');
                var promise = audio.play();
                // required to prevent error in JS
                if (promise !== undefined) {
                    promise.then(_ => {
                        //console.log('Autoplay started!');
                    }).catch((/*error*/) => {
                        //console.log('Autoplay was prevented. Show a "Play" button so that user can start playback: ', error);
                    })
                }
                if(Date.now() - startTime > updateInterval - 10000) {
                    tooManyEventsSpoken = true;
                    var msg = 'About ' +
                        events.length - Object.keys(newEvents).length - Object.keys(prevEvents).length +
                        ' new events will not be spoken';
                } else {
                    if(event.pronunciation) msg = floatToHuman(event.pronunciation);
                    else msg = event.objectName + ': ' + floatToHuman(event.eventDescription ? event.eventDescription : event.counterName);
                }

                window.speechSynthesis.speak(new SpeechSynthesisUtterance(convertToSpeech(msg)));
            } catch(e) {}
        });
        prevEvents = newEvents;
    }

    function convertToSpeech(msg) {
        if(!pronunciations) return msg;

        for(var pronunciation in pronunciations) {
            try {
                var re = new RegExp(pronunciation, "ig");
            } catch (e) {
                continue;
            }
            msg = msg.replace(re, pronunciations[pronunciation]);
        }
        return msg;
    }

    function drawCurrentEventsTable(result) {
        var tablePartHTML = '';

        var eventsTableElm = $('#eventsTable');
        if (!result || !result.length) {
            tablePartHTML = '<tr><td colspan="100" style="text-align: center;">No events</td></tr>';
        } else {
            var maxWidth = Math.round($(window).width() * 0.5);
            result.sort((a, b) => b.startTime - a.startTime).forEach(function (row) {
                if(restrictions.importanceFilter && importanceFilter > -1 && row.importance > importanceFilter) return;
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectCurrentEvent_'+ row.id+':checked').length ? ' checked' : '';
                var hintLink = useHints && row.hintID ? '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var commentLink = useInfo && row.commentID ? '<div class="chip small-chip" commentID="' + row.commentID +'" OCID="' + row.OCID +'">info</div> ' : '';
                var historyLink = useHistory ? '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ' : '';

                // use bgcolor attribute instead style for save possible to change color of the row on mouse over
                tablePartHTML += '\
<tr currentEventsRow OCID="' + row.OCID + '" importance="' +row.importance+ '" ' +
                    'onmouseover="this.style.backgroundColor=\'lightgrey\'" onmouseout="this.style.backgroundColor=\'' +
                    color + '\'" ' + '" style="cursor: pointer; background-color: ' + color + ';">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td class="hide">' + row.startTime + '</td>\
    <td class="hide">' + row.endTime + '</td>\
    <td data-object-name="' + row.objectName +'">' + escapeHtml(row.objectName) + '</td>\
    <td style="max-width:'+maxWidth+'px;overflow-wrap: break-word;">' +
                    floatToHuman(row.eventDescription ? row.eventDescription : row.counterName) + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' +
        (row.startTime ? new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') +
        '</td>\
    <td>' + (row.startTime ? getHumanTime(Date.now() - row.startTime) : '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime, row.counterID) +
                    commentLink + hintLink + historyLink +
                    '</td>\
                    <td preventCheckboxCheck>\
                        <label>\
                            <input type="checkbox" selectEventCheckbox counterID="' + row.counterID +
                                '" id="selectCurrentEvent_'+ row.id+'"' + isChecked + '/>\
            <span></span>\
        </label>\
    </td>\
</tr>';
            });
            speakUpNewEvents(result);
        }

        eventsTableElm.html(tablePartHTML);
    }

    /**
     *
     * @param {Array<{
     *     id: number,
     *     OCID: number,
     *     eventsCount: number
     *     startTime: number,
     *     endTime: number,
     *     hintID: number,
     *     commentID: number
     *     importance: number,
     *     disableIntervals: string,
     *     disableDaysOfWeek: string,
     *     eventDescription: string,
     *     objectName: string,
     *     counterName: string,
     *     counterID: number,
     *     disableFrom: number
     *     disableUntil: number,
     *     parentOCID: number,
     *     subject: string,
     *     recipients: string,
     *     timestamp: number,
     *     disableUser: string,
     *     eventsCount; number,
     *
     * }>} result SQL query result
     */
    function drawDisableEventsTable(result) {
        var tablePartHTML = '';

        var disabledEventsTableElm = $('#disabledEventsTable');
        if (!result || !result.length) {
            tablePartHTML = '<tr><td colspan="100" style="text-align: center;">No disabled events</td></tr>';
        } else {
            var maxWidth = Math.round($(window).width() * 0.5);
            result.sort((a, b) => b.startTime - a.startTime).forEach(function (row) {
                if(restrictions.importanceFilter && importanceFilter > -1 && row.importance > importanceFilter) return;
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var styleFontWeight = row.endTime ? '' : 'font-weight:bold;';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectDisabledEvent_' + row.id + ':checked').length ? ' checked' : '';
                var hintLink = useHints && row.hintID ?
                    '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var commentLink = useInfo && row.commentID ?
                    '<div class="chip small-chip" commentID="' + row.commentID + '" OCID="' + row.OCID +
                    '">info</div> ' : '';
                var historyLink = useHistory ?
                    '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ' : '';

                if(row.disableIntervals) { // remove same intervals
                    var disableIntervalsObj = {};
                    row.disableIntervals.split(';').forEach(function(interval) {
                        disableIntervalsObj[getTimeFromTimeInterval(interval)] = true;
                    });

                    var disableIntervals = Object.keys(disableIntervalsObj).join(' ');
                } else disableIntervals = 'All time';

                if(row.disableDaysOfWeek) {
                    var disableDaysOfWeek = row.disableDaysOfWeek.split(',')
                        .map(dayOfWeek => parameters.action.dayNames[Number(dayOfWeek)])
                        .join(',');
                } else disableDaysOfWeek = 'All days';

                var eventDescription = floatToHuman(row.eventDescription ?
                    row.eventDescription : row.counterName);

                var startTime = row.startTime ?
                    new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-';

                var endTime = row.endTime ?
                    new Date(row.endTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-';

                var duration = row.startTime ?
                    getHumanTime((row.endTime ? row.endTime : Date.now()) - row.startTime) : '-';

                var disableFrom = row.disableFrom ?
                    new Date(row.disableFrom).toLocaleString().replace(/\.\d\d(\d\d),/, '.$1') :
                    'Now';

                var disableUntil = new Date(row.disableUntil)
                    .toLocaleString()
                    .replace(/\.\d\d(\d\d),/, '.$1');

                tablePartHTML += '\
<tr disabledEventsRow OCID="' + row.OCID + '" importance="' + row.importance + '" ' +
                    'onmouseover="this.style.backgroundColor=\'lightgrey\'" onmouseout="this.style.backgroundColor=\'' +
                    color + '\'" ' +
                    '" style="cursor: pointer; background-color: ' + color + ';' + styleFontWeight + '">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td class="hide">' + row.startTime + '</td>\
    <td class="hide">' + row.endTime + '</td>\
    <td data-object-name="' + row.objectName +'">' + escapeHtml(row.objectName) + '</td>\
    <td style="max-width:'+maxWidth+'px;overflow-wrap: break-word;">' + eventDescription + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' + startTime + '</td>\
    <td>' + endTime + '</td>\
    <td>' + duration + '</td>\
    <td>' + disableFrom + '</td>\
    <td>' + disableUntil + '</td>\
    <td>' + disableDaysOfWeek + '</td>\
    <td>' + disableIntervals + '</td>\
    <td>' +  escapeHtml(row.disableUser) + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime, row.counterID) +
                    commentLink + hintLink + historyLink +
                    '</td>\
                    <td preventCheckboxCheck>\
                        <label>\
                            <input type="checkbox" selectEventCheckbox counterID="' + row.counterID +
                    '" disabledEventCheckBox="'+ row.id + '" id="selectDisabledEvent_' + row.id + '"' + isChecked + '/>\
            <span></span>\
        </label>\
    </td>\
</tr>';
            });
        }

        disabledEventsTableElm.html(tablePartHTML);
    }

    /**
     *
     * @param {Array<{
     *     importance: number,
     *     id: number,
     *     subject: string,
     *     eventsCount: number,
     *     comment: string,
     *     user: string,
     *     recipients: string,
     *     timestamp: number,
     * }>} result
     */
    function drawHistoryCommentedEventsTable(result) {
        var tablePartHTML = '',
            historyCommentedEventsTableElm = $('#historyCommentedEventsTable'),
            maxWidth = Math.round($(window).width() * 0.5);

        if (!result.length) {
            tablePartHTML = '<tr><td colspan="100" style="text-align: center;">No commented events</td></tr>';
        } else {
            result.sort((a, b) => b.timestamp - a.timestamp).forEach(function (row) {
                if(restrictions.importanceFilter && importanceFilter > -1 && row.importance > importanceFilter) return;
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var commentLink = '<div class="chip small-chip" commentID="' + row.id +'">info</div> ';
                var eventLink = '<div class="chip small-chip" data-commentIDForEvents="' + row.id +
                    '">events&nbsp;:' + row.eventsCount + '</div> ';

                tablePartHTML += '\
<tr historyCommentedEventsRow importance="' + row.importance + '" ' +
                    'onmouseover="this.style.backgroundColor=\'lightgrey\'" onmouseout="this.style.backgroundColor=\'' +
                    color + '\'" style="cursor: pointer; background-color: ' + color + ';">\
    <td class="hide">' + row.id + '</td>\
    <td style="max-width:' + maxWidth +
                    'px;overflow-wrap: break-word;"><div class="comment-body"><p class="comment-header">' +
                    escapeHtml(row.subject) + '</p>' +
                    (row.comment ?
                        row.comment
                            .replace(/<ul>/gmi, '<ul class=browser-default>')
                            .replace(/<(h\d)>/gmi, '<$1 style="font-size:1em;line-height:2em;margin:0;">') :
                        '') +'</div></td>\
    <td>' + escapeHtml(row.user) +'</td>\
    <td>' + escapeHtml(row.recipients || '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' + commentLink + eventLink + '</td>\
</tr>';
            });
        }

        historyCommentedEventsTableElm.html(tablePartHTML);
    }


    /*
    0 ' = ' '0 sec'
    10.1232342 ' = ' '10.12 sec'
    0.87 ' = ' '0.87 sec'
    0.32 ' = ' '0.32 sec'
    345213123654123 ' = ' '10946636years 124days'
    12314234.232 ' = ' '142days 12hours'
    36582.98 ' = ' '10hours 9min'
    934 ' = ' '15min 34sec'
    3678.335 ' = ' '1hour 1min'
    86589 ' = ' '1day 3min'
     */
    function getHumanTime ( timestamp ) {
        var seconds = Math.round(timestamp / 1000);
        if (seconds <= 0) return '0sec';
        return [
            [Math.floor(seconds / 31536000), (y)=> y === 1 ? y + 'year ' : y + 'years ' ],
            [Math.floor((seconds % 31536000) / 86400), (y)=> y === 1 ? y + 'day ' : y + 'days ' ],
            [Math.floor(((seconds % 31536000) % 86400) / 3600), (y) => y + (y === 1 ? 'hour ' : 'hours ' ) ],
            [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), (y)=> y + 'min '],
            [(((seconds % 31536000) % 86400) % 3600) % 60, (y)=> y + 'sec']
        ].map(function(level) {
            return level[0] ? level[1](level[0]) : '';
        })
            .join('')
            .replace(/^([^ ]+ [^ ]+) ?.*$/, '$1')
            .replace(/(\.\d\d)\d*/, '$1 ')
            .trim() || '0 sec';
    }

    function floatToHuman(str) {
        return escapeHtml(str.replace(/( \d+\.\d\d)\d\d+([^._])/g, '$1$2'));
    }

    function getHumanImportance(importance) {
        if(parameters.action.importance &&
            parameters.action.importance[importance] &&
            parameters.action.importance[importance].text) return parameters.action.importance[importance];
    }

    function composeMessage() {

        lastAction = $('input[name="action"]:checked').attr('id');

        /**
         * @type {{
         *     tables: Array,
         *     autoApplyFor: Array
         *     name: string,
         *     bodyHeader: string,
         *     hiddenData: Object,
         *     eventTemplate: string,
         *     intervalsDivider: string,
         *     subject: string,
         *     objectsListLength: number,
         *     countersListLength: number,
         * }}
         */
        var template = parameters.action.actionsMessageTemplates[lastAction];
        if(!template) template = parameters.action.actionsMessageTemplates['addAsComment'];
        var func = lastAction.indexOf('addAsHint') === 0 ? 'getHint' : 'getComment';

        var variables = {}, objectsNames = {}, countersNames = {};
        var maxImportance;

        var checkedEventsElms = [];
        if(!template.tables) checkedEventsElms = $('table').find('input[selectEventCheckbox]:checked').get();
        else {
            template.tables.forEach(function (tableID) {
                Array.prototype.push.apply(checkedEventsElms, $('#' + tableID)
                    .find('input[selectEventCheckbox]:checked').get());
            })
        }

        if(!checkedEventsElms.length) {
            M.toast({html: 'Please select events before compose message', displayLength: 2000});
            return;
        }

        var infoIDs = [];

        var templatesForAutoApply = {};
        checkedEventsElms.forEach(function(elm) {
            var trElm = $(elm).closest('tr');
            var importance = Number(trElm.attr('importance'));
            if(maxImportance === undefined || importance < maxImportance) maxImportance = importance;

            var tdElements = trElm.find('td').get();
            /**
             *
             * @type {{
             *      START_TIME: string,
             *      END_TIME: string,
             *      START_TIME_MS: number,
             *      END_TIME_MS: number,
             *      OCID: number,
             *      DURATION: string,
             *      OBJECT_NAME: string,
             *      COUNTER_NAME: string,
             *      EVENT_DESCRIPTION: string,
             * }}
             */
            var variablesInRow = {};
            trElm.closest('table').find('th').get().forEach(function(thElm, idx) {
                var name = $(thElm).attr('var');
                if(name) variablesInRow[name] = $(tdElements[idx]).text();
            });
            if(!variablesInRow.END_TIME || variablesInRow.END_TIME === '-') variablesInRow.END_TIME = 'NOW';
            var interval = variablesInRow.START_TIME + ' - ' + variablesInRow.END_TIME + ' (' +
                variablesInRow.DURATION + ')';

            if(!variables[variablesInRow.OCID]) {
                variables[variablesInRow.OCID] = {
                    objectName: variablesInRow.OBJECT_NAME,
                    counterName: variablesInRow.COUNTER_NAME,
                    eventDescription: [variablesInRow.EVENT_DESCRIPTION],
                    //action: ($(elm).closest('tbody#disabledEventsTable').length ? 'ENABLE' : 'DISABLE'),
                    action: ($('#disableEvents').is(':checked')  ? 'DISABLE' :
                        ($('#enableEvents').is(':checked') ? 'ENABLE' : '')),
                    disableIntervals: [interval],
                };
                objectsNames[variablesInRow.OBJECT_NAME] = true;
                countersNames[variablesInRow.COUNTER_NAME] = true;

                parameters.action.messageTemplates.forEach(function(template) {
                    /*
                    autoApplyFor: [{
                        "actions": ["addAsComment", "disableEvents", "enableEvents"]
                        "importance": [0,1],
                        "objectNameRE": ["\\{[^\\}]+\\}$"],
                        "counterNameRE": [],
                        "eventDescriptionRE": [".*100Gb.*"]
                        "startEventTimeLessMin": 10,
                        "endEventTimeLessMin": 10
                    }, {...}, ...]
                    */

                    if(!Array.isArray(template.autoApplyFor)) return;
                    //console.log('template.autoApplyFor', template.autoApplyFor)
                    for(var i = 0; i < template.autoApplyFor.length; i++) {
                        /**
                         * @type {{
                         *      actions: Array<string>,
                         *      importance: Array<number>,
                         *      objectNameRE: Array<string>,
                         *      counterNameRE: Array<string>,
                         *      startEventTimeLessMin: number,
                         *      endEventTimeLessMin: number,
                         *      eventDescriptionRE: Array<string>,
                         *      counterNameRE: Array<string>,
                         *      objectNameRE: Array<string>,
                         * }}
                         */
                        var condition = template.autoApplyFor[i];

                        if(Array.isArray(condition.actions) && condition.actions.indexOf(lastAction) === -1) {
                            //console.log('condition.actions', condition.actions, lastAction)
                            continue;
                        }

                        if(Array.isArray(condition.importance) && condition.importance.indexOf(maxImportance) === -1) {
                            //console.log('condition.importance', condition.importance, maxImportance)
                            continue;
                        }

                        if(condition.startEventTimeLessMin && variablesInRow.START_TIME_MS &&
                            Date.now() - Number(condition.startEventTimeLessMin) * 60000 >
                            Number(variablesInRow.START_TIME_MS)
                        ) {
                            console.log('condition.startEventTimeLessMin', condition.startEventTimeLessMin,
                                variablesInRow.START_TIME_MS)
                            continue;
                        }

                        if(condition.endEventTimeLessMin && variablesInRow.END_TIME_MS &&
                            variablesInRow.END_TIME !== 'NOW' &&
                            Date.now() - Number(condition.endEventTimeLessMin) * 60000 >
                            Number(variablesInRow.END_TIME_MS)
                        ) {
                            //console.log('condition.endEventTimeLessMin', condition.endEventTimeLessMin,
                            // variablesInRow.END_TIME_MS)
                            continue;
                        }

                        if(Array.isArray(condition.objectNameRE)) {
                            for(var j = 0; j < condition.objectNameRE.length; j++) {
                                if(!condition.objectNameRE[j].test(variablesInRow.OBJECT_NAME)) {
                                    j = -1;
                                    break;
                                }
                            }
                            //console.log('condition.objectNameRE', condition.objectNameRE, variablesInRow.OBJECT_NAME, j)
                            if(j === -1) continue;
                        }

                        if(Array.isArray(condition.counterNameRE)) {
                            for(j = 0; j < condition.counterNameRE.length; j++) {
                                if(!condition.counterNameRE[j].test(variablesInRow.COUNTER_NAME)) {
                                    j = -1;
                                    break;
                                }
                            }
                            //console.log('condition.counterNameRE', condition.counterNameRE, variablesInRow.COUNTER_NAME, j)
                            if(j === -1) continue;
                        }

                        if(Array.isArray(condition.eventDescriptionRE)) {
                            for(j = 0; j < condition.eventDescriptionRE.length; j++) {
                                if(!condition.eventDescriptionRE[j].test(variablesInRow.EVENT_DESCRIPTION)) {
                                    j = -1;
                                    break;
                                }
                            }
                            //console.log('condition.eventDescriptionRE', condition.eventDescriptionRE,
                            // variablesInRow.EVENT_DESCRIPTION, j)
                            if(j === -1) continue;
                        }

                        templatesForAutoApply[template.name] = template;
                        break;
                    }
                });

            } else {
                // don't add repeated event text, only add intervals for this event
                variables[variablesInRow.OCID].disableIntervals.push(interval);
                // variables[variablesInRow.OCID].eventDescription += '\n\n' + variablesInRow.EVENT_DESCRIPTION;
                variables[variablesInRow.OCID].eventDescription.push(variablesInRow.EVENT_DESCRIPTION);
            }

            if(func === 'getHint'){
                var chipElm = trElm.find('div[hintID].chip');
                var id = chipElm.attr('hintID');
            } else if(func === 'getComment') {
                chipElm = trElm.find('div[commentID].chip');
                id = chipElm.attr('commentID');
            }
            if(id && infoIDs.indexOf(Number(id)) === -1) infoIDs.push(Number(id));
        });

        if(!templateSelectedManual) {
            //console.log('templatesForAutoApply', templatesForAutoApply)
            var templatesNames = Object.keys(templatesForAutoApply);
            templatesForAutoApply = Object.values(templatesForAutoApply);
            if (templatesForAutoApply.length) {
                if (templatesForAutoApply.length > 1) {
                    M.toast({
                        html: 'Multiple templates found for the current message (' + '"' +
                            templatesNames.join('", "') + '"' + '). Templates will not be applied',
                        displayLength: 5000
                    });
                } else {
                    if (JSON.stringify(templatesForAutoApply[0]) !== JSON.stringify(lastTemplate)) {
                        M.toast({
                            html: '<b>Attention!!! Message template was changed from "' + lastTemplate.name + '" to "' +
                                templatesNames[0] + '"</b>',
                            displayLength: 3000,
                        });
                    }
                    lastTemplate = templatesForAutoApply[0];
                }
            }
        }

        if(maxMessageImportance === undefined || maxImportance < maxMessageImportance) {
            M.toast({
                html: 'Can\'t compose message. Importance of selected events is higher than allowed in message template',
                displayLength: 5000
            });
            return;
        }

        if(template.bodyHeader) {
            var messageBody = template.bodyHeader;
            messageBody = messageBody.replace('%:DISABLE_UNTIL:%', $('#disableUntilTime').val() + ' ' +
                $('#disableUntilDate').val());

            messageBody = messageBody.replace('%:DISABLE_FROM:%', $('#disableFromTime').val() + ' ' +
                $('#disableFromDate').val());

            var disableDaysOfWeek = disableDaysOfWeekElm.val();
            if(disableDaysOfWeek.length) {
                var disableDaysOfWeekStr =
                    disableDaysOfWeek.map(dayOfWeek => parameters.action.dayNames[Number(dayOfWeek)]).join(',');
            } else disableDaysOfWeekStr = 'all days';
            messageBody = messageBody.replace('%:DISABLE_DAYS_OF_WEEK:%', disableDaysOfWeekStr);



            var disableTimeIntervalFrom = $('#disableTimeIntervalFrom').val();
            var disableTimeIntervalTo = $('#disableTimeIntervalTo').val();
            if(disableTimeIntervalFrom && disableTimeIntervalTo)
                var newTimeInterval = disableTimeIntervalFrom + '-' + disableTimeIntervalTo;
            else newTimeInterval = '00:00-23:59';
            messageBody = messageBody.replace('%:NEW_DISABLE_TIME_INTERVAL:%', newTimeInterval);
        } else messageBody = '';


        getObjectsProperties(Object.keys(variables), function(rows) {
            var props = {};

            if(Array.isArray(rows) && rows.length) {
                rows.forEach(function (row) {
                    //if (row.mode !== 0) return;
                    if (!props[row.OCID]) props[row.OCID] = {};
                    props[row.OCID][row.name] = row.value;
                });
            }

            var hiddenData = [];
            Object.keys(variables).forEach(function (OCID) {
                var hiddenDataPart = {};
                // template.hiddenData: <VARIABLE_NAME>: <Variable Name in hiddenData Object>,
                // f.e. {"ZABBIX_HOSTNAME": "ServerName", ...}
                var hiddenVariables = typeof template.hiddenData === 'object' ? template.hiddenData : {};

                var mainProps = {
                    OBJECT_NAME: variables[OCID].objectName,
                    COUNTER_NAME: variables[OCID].counterName,
                    EVENT_DESCRIPTION: variables[OCID].eventDescription.pop(),
                    ACTION: variables[OCID].action,
                    EVENT_TIME: variables[OCID].disableIntervals.pop(),
                    //EVENT_TIME: variables[OCID].disableIntervals.reverse().join(template.intervalsDivider
                };

                var str = template.eventTemplate;

                for(var name in mainProps) {
                    var re = new RegExp('%:' + name + ':%', 'gim');
                    str = str.replace(re, escapeHtml(mainProps[name]));
                    if(hiddenVariables[name]) hiddenDataPart[hiddenVariables[name]] = mainProps[name];
                }

                variables[OCID].eventDescription.forEach(function(eventDescription, idx) {
                    str += template.intervalsDivider
                        .replace('%:EVENT_DESCRIPTION:%', escapeHtml(eventDescription))
                        .replace('%:EVENT_TIME:%', variables[OCID].disableIntervals[idx]);
                });

                if(props[OCID]) {
                    for(name in props[OCID]) {
                        re = new RegExp('%:' + name + ':%', 'gim');
                        str = str.replace(re, escapeHtml(props[OCID][name]));
                        if(hiddenVariables[name]) hiddenDataPart[hiddenVariables[name]] = props[OCID][name];
                    }
                }

                str= str.replace(/%:.+?:%/gm, '');
                messageBody += str;
                if(Object.keys(hiddenDataPart).length) hiddenData.push(hiddenDataPart);
            });

            hiddenMessageDataElm.val(JSON.stringify(hiddenData));

            subjectElm.val('');
            applyTemplate(lastTemplate);

            var subject = template.subject;
            if(subject) {
                var objectsList = Object.keys(objectsNames).join(', ');
                if (template.objectsListLength && objectsList.length > template.objectsListLength) {
                    objectsList = objectsList.substring(0, template.objectsListLength - 7);
                    objectsList += '... (' + Object.keys(objectsNames).length + ')';
                }

                var countersList = Object.keys(countersNames).join('; ');
                if (template.countersListLength && countersList.length > template.countersListLength) {
                    countersList = countersList.substring(0, template.countersListLength - 7);
                    countersList += '... (' + Object.keys(countersNames).length + ')';
                }

                subject = subject.replace('%:OBJECTS_LIST:%', objectsList);
                subject = subject.replace('%:COUNTERS_LIST:%', countersList);

                subjectElm.val(subjectElm.val() + subject);
                M.updateTextFields();
            }

            quill.focus();

            if(infoIDs.length > 1) prevCommentDialogElm.open();
            else if(infoIDs.length === 1) {
                makeHint(func, infoIDs[0], function(info) {
                    messageBody += '<br/><br/>' +
                        '_________________________________________________________________________________________' +
                        '<br/><em>Previous information: ' +
                        (info.subject || '') + '</em><br/><br/>' + info.text;
                    quill.setText('');
                    quill.clipboard.dangerouslyPasteHTML(0, messageBody);
                    quill.setSelection(0, 0);
                    //quill.insertText(index, messageBody, {}, "user");
                });
                return;
            }

            quill.setText('');
            quill.clipboard.dangerouslyPasteHTML(0, messageBody);
            quill.setSelection(0, 0);
            //quill.insertText(index, messageBody, {}, "user");

            if(messageTopImportance === undefined || maxImportance < messageTopImportance) {
                messageTopImportance = maxImportance;
            }

        });
    }

    function getObjectsProperties(OCIDs, callback) {
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: 'getObjectsProperties',
                IDs: OCIDs.join(','),
            },
            error: function (jqXHR, exception) { ajaxError(jqXHR, exception, callback)},
            success: function(results) {
                if(!results || typeof results !== 'object' || !Object.values(results)[0]) return;
                var result = Object.values(results)[0];
                callback(result);
                /*
                if(!rows || !rows.length) return callback(text);

                rows.forEach(function (row) {
                    var re = new RegExp('%:' + row.name + ':%', 'gim');
                    text = text.replace(re, row.value);
                });

                 */
            }
        });
    }

    function makeURLForDataBrowser(objectName, OCIDs, startTime, endTime) {
        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/data_browser';

        if(!Array.isArray(OCIDs)) OCIDs = [OCIDs];


        var urlParameters = {
            't': encodeURIComponent(Number(startTime) - 900000 + '-' + (Number(endTime) ?
                Number(endTime) + 900000 : Date.now())), // timestamps in ms
            'l': encodeURIComponent(OCIDs.join('-')), // show graph for this OCID with align to left
            'n': '0', // don't auto update
            'y': '0--0-',
            'a': encodeURIComponent(actionPath), // /action/data-browser
            'c': encodeURIComponent(objectName), // selected object
        };

        return '/?' + Object.keys(urlParameters).map(function(key) {
            return key + '=' + urlParameters[key];
        }).join('&');
    }

    function makeURLForAction(actionID, objectName, counterID) {
        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' + actionID;

        var urlParameters = {
            'a': encodeURIComponent(actionPath), // /action/objects-properties
            'c': encodeURIComponent(objectName), // selected object
            'cid': encodeURIComponent(counterID),
        };

        return '/?' + Object.keys(urlParameters).map(function(key) {
            return key + '=' + urlParameters[key];
        }).join('&');
    }

    function makeActionLinks(objectName, parentOCID, startTime, endTime, counterID) {
        if(!useLinks) return '';

        if(!Array.isArray(actions) || !actions.length) return '';

        var links = actions.map(function (action) {
            if(!action.ID || !action.name) return '';

            if(action.ID === 'data_browser') {
                return '<div class="chip small-chip"><a href="' +
                    makeURLForDataBrowser(objectName, parentOCID, startTime, endTime) +
                    '" target="_blank" data-browser="' +
                    parentOCID + ',' + startTime + ',' + endTime + ',' + counterID + ',' + objectName + '">' +
                    action.name + '</a></div>'
            }

            return '<div class="chip small-chip"><a href="' +
                makeURLForAction(action.ID, objectName, counterID) + '" target="_blank">' +
                action.name + '</a></div>';
        });

        return links.join('');
    }

    function makeEventsForDataBrowser() {
        $('a[data-browser]').click(function (e) {
            var dataStr = $(this).attr('data-browser');
            if(!dataStr) return;
            var [parentOCID, startTime, endTime, counterID, objectName] = dataStr.split(',');
            if(!objectName || !counterID) return;

            e.preventDefault();
            $.ajax({
                type: 'POST',
                timeout: updateInterval - 3000,
                url: serverURL,
                data: {
                    func: 'getCounterVariables',
                    objectName: objectName,
                    counterID: counterID,
                },
                error: ajaxError,
                success: function (results) { //{.. OCID:...}
                    if(!results || typeof results !== 'object' || !Object.values(results)[0]) return;
                    var rows = Object.values(results)[0];

                    if(rows.actionError) console.log(rows.actionError);
                    if(!Array.isArray(rows)) rows = [];

                    var OCIDs = rows.map(row => row.OCID);
                    OCIDs.push(parentOCID);

                    e.preventDefault();
                    var url = makeURLForDataBrowser(objectName, OCIDs, startTime, endTime);
                    window.open(url, '_blank');
                }
            });
        })
    }

    function createFilteredEventTable() {

        var searchStr = eventsFilterElm.val();
        var rows = $("tbody").find("tr").addClass('hide');
        if (searchStr.length) {
            rows.find("input[selectEventCheckbox]:checked").closest('tr').removeClass('hide');
            rows.filter(":i_contains('" + searchStr + "')").removeClass('hide');
            rows.find("[data-skip-search-filter]").removeClass('hide');
        } else {
            rows.removeClass('hide');
        }
    }

    function stopUpdate() {
        reloadIconElm.text('pause');
        reloadIconElm.addClass('red-text');
        getDataForHistoryEvents = false;
        getDataForCurrentEvents = false;
        getDataForDisabledEvents = false;
        historyEventsHeaderElm.addClass('red');
        currentEventsHeaderElm.addClass('red');
        disabledEventsHeaderElm.addClass('red');
        historyCommentedEventsHeaderElm.addClass('red');
    }

    function startUpdate() {
        reloadIconElm.text('play_arrow');
        reloadIconElm.removeClass('red-text');
        if($('#historyEvents').hasClass('active') && restrictions.Historical) getDataForHistoryEvents = true;
        if($('#currentEvents').hasClass('active') && restrictions.Current) getDataForCurrentEvents = true;
        if($('#disabledEvents').hasClass('active') && restrictions.Disabled) getDataForDisabledEvents = true;
        historyEventsHeaderElm.removeClass('red');
        currentEventsHeaderElm.removeClass('red');
        disabledEventsHeaderElm.removeClass('red');
        historyCommentedEventsHeaderElm.removeClass('red');
        getDataByAjax();
    }

    /**
     * Convert Date to string in "DD MonthName, YYYY" format
     * @param {Date} date - date object (new Date())
     * @return {string} string in format DD MonthName, YYYY
     */
    function getDateString(date) {
        if(!date) date = new Date();

        return date.getDate() + ' ' + parameters.action.monthNames[date.getMonth()] + ', ' + date.getFullYear();
    }

    /**
     *  Convert date string in "DD MonthName, YYYY" format to ms
     *  @param {string} dateStr - date string in format DD MonthName, YYYY
     *  @return {number} time from 1.1.1970 in ms
     */
    function getDateTimestampFromStr(dateStr) {
        if(!dateStr) return Date.now();
        var dateParts = dateStr.match(/^(\d\d?)\s([^,]+),\s(\d\d\d\d)$/);
        if(dateParts === null) return Date.now();
        var monthNum = parameters.action.monthNames.indexOf(dateParts[2]);
        return new Date(Number(dateParts[3]), monthNum, Number(dateParts[1])).getTime();
    }


    /**
     * Convert time string in "HH:MM" format to ms
     * @param {string} timeStr - time string in format HH:MM
     * @return {number} time in ms
     */
    function getTimeFromStr(timeStr) {
        if(!timeStr) return 0;
        var timeParts = timeStr.match(/^(\d\d?):(\d\d?)$/);
        if(timeParts === null) return 0;
        return Number(timeParts[1]) * 3600000 + Number(timeParts[2]) * 60000;
    }

})(jQuery); // end of jQuery name space