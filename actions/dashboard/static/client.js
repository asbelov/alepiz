/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/*
* Created on Fri Mar 23 2018 12:48:16 GMT+0700 (Новосибирское стандартное время)
*/


function callbackBeforeExec(callback) {
    JQueryNamespace.checkBeforeExec(callback)
}

function callbackAfterExec(data, callback) {
    JQueryNamespace.runAfterExec(data, callback);
}

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

var JQueryNamespace = (function ($) {
    $(function () {
        init();
    });

    // path to ajax
    var serverURL = parameters.action.link+'/ajax';
    var bodyElm,
        eventsFilterElm,
        reloadElm,
        reloadIconElm,
        historyEventsHeaderElm,
        historyCommentedEventsHeaderElm,
        currentEventsHeaderElm,
        disabledEventsHeaderElm,
        removeIntervalsElm,
        timeIntervalsElm,
        enableEventsElm,
        disabledEventsControlElm,
        hintDialogInstance,
        hintElm,
        prevCommentDialogElm,
        createMessageElm,
        soundIconElm,
        pronunciations = parameters.action.pronunciation,
        updateInterval = parameters.action.updateInterval * 1000 || 30000,
        prevEvents = {},
        lastAction,
        lastTemplate,
        collapsibleInstance,
        quill,
        subjectElm,
        rcptChipElm,
        rcptChipsInstances,
        emailValidateRE = /^(([^<>()\[\].,;:\s@"]+(\.[^<>()\[\].,;:\s@"]+)*)|(".+"))@(([^<>()[\].,;:\s@"]+\.)+[^<>()[\].,;:\s@"]{2,})$/i,
        lastUpdateElm,
        updateTimeElm,
        messageTopImportance,
        maxMessageImportance = 0,
        commentsFromInstance,
        commentsToInstance,
        objects = parameters.objects,
        hintCache = {},
        eventsData = {},
        maxEventsNumberInTable = 500,
        gettingDataInProgress = 0;

    var getDataForHistoryEvents = false;
    var getDataForCurrentEvents = false;
    var getDataForDisabledEvents = false;

    jQuery.expr[':'].icontains = function(a, i, m) {
        return jQuery(a).text().toUpperCase()
            .indexOf(m[3].toUpperCase()) >= 0;
    };

    Quill.prototype.getHtml = function () {
        return this.container.querySelector('.ql-editor').innerHTML;
    };

    return {
        checkBeforeExec: checkBeforeExec,
        runAfterExec: runAfterExec,
        onChangeObjects: onChangeObjects
    };

    function init() {

        bodyElm = $('body');
        eventsFilterElm = $('#eventsFilter');
        rcptChipElm = $('#rcpt_chips');
        reloadElm = $('#reload');
        reloadIconElm = $('#reload i:first-child');
        subjectElm = $('#subject');
        createMessageElm = $('#createMessage');
        hintElm = $('#hint');
        lastUpdateElm = $('#lastUpdate');
        updateTimeElm = $('#updateTime');
        removeIntervalsElm = $('#removeTimeIntervals');
        timeIntervalsElm = $('#timeIntervalsForRemove');
        enableEventsElm = $('#enableEvents');
        disabledEventsControlElm = $('#disabledEventsControl');

        historyEventsHeaderElm = $('#historyEvents').find('div.collapsible-header');
        currentEventsHeaderElm = $('#currentEvents').find('div.collapsible-header');
        disabledEventsHeaderElm = $('#disabledEvents').find('div.collapsible-header');
        historyCommentedEventsHeaderElm = $('#historyCommentedEvents').find('div.collapsible-header');

        soundIconElm = $('#soundIcon');

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
        // add 15 minutes to current time
        //setUntilDateTimeControl(15);

        M.Datepicker.init(document.getElementById('disableUntilDate'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
        });

        commentsFromInstance = M.Datepicker.init(document.getElementById('commentsFrom'), {
            firstDay: 1,
            format: 'dd mmmm, yyyy',
            setDefaultDate: true,
            defaultDate: new Date(Date.now() - 604800000), // 7 days in ms
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
            if(getDateTimestampFromStr($('#disableUntilDate').val()) + getTimeFromStr($('#disableUntilTime').val()) < Date.now()) {
                var now = new Date();
                if(now.getHours() < 3) now.setDate(now.getDate() + 1);
                now.setHours(5, 0, 0, 0);
                // calc minutes to next day 5:00
                setUntilDateTimeControl(Math.round(Math.floor((now.getTime() - Date.now()) / 60000) + 1));
                // add 15 minutes to current time
                //setUntilDateTimeControl(15);
            }
        });

        collapsibleInstance = M.Collapsible.init(document.getElementById('collapsible'), {
            accordion: false, // A setting that changes the collapsible behavior to expandable instead of the default accordion style
            inDuration: 0, // default 300
            outDuration: 0, // default 300
            onOpenEnd: function(el) {  // Callback for Collapsible open
                setTimeout(function() {
                    if($(el).find('tbody').find('tr').get().length === 1)
                        $(el).find('tbody').html('<tr><td colspan="10" style="text-align: center;">Updating information...</td></tr>');

                    if ($(el).attr('id') === 'currentEvents' ||
                        $(el).attr('id') === 'historyEvents' ||
                        $(el).attr('id') === 'disabledEvents' ) startUpdate();
                    else if($(el).attr('id') === 'historyCommentedEvents') getAndDrawCommentsTable();
                    eventsFilterElm.focus();
                }, 500);
            },

            onCloseEnd: function(el) {  // Callback for Collapsible close
                if($(el).attr('id') === 'currentEvents') getDataForCurrentEvents = false;
                if($(el).attr('id') === 'historyEvents') getDataForHistoryEvents = false;
                if($(el).attr('id') === 'disabledEvents') getDataForDisabledEvents = false;
                eventsFilterElm.focus();
            }
        });
        startUpdate();

        $('#composeMessage').click(composeMessage);

        $('#clearMessage').click(function() {
            lastAction = null;
            quill.setText('');
            subjectElm.val('').focus();
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

        $('a[uncheckSelected]').click(function (e) {
            e.stopPropagation(); // prevent collapse

            var checkedCheckboxesElm = $(this).closest('li').find('input[selectEventCheckbox]:checked');

            if(!checkedCheckboxesElm.length) { // select all
                $(this).closest('li').find('tr:not(.hide)').find('input[selectEventCheckbox]').trigger('click');
                return;
            }

            checkedCheckboxesElm.trigger('click');

            if(!$('input[selectEventCheckbox]:checked').length) {

                if(quill.getLength() < 2) {
                    startUpdate();
                }
            }
        });

        $('a#reloadComments').click(function (e) {
            if(!$('#historyCommentedEvents').hasClass('active')) return;
            e.stopPropagation(); // prevent collapse
            getAndDrawCommentsTable();
        });


        $('#showEditor').click(function (e) {
            e.stopPropagation(); // prevent collapse
            if(createMessageElm.hasClass('hide')) {
                createMessageElm.removeClass('hide');
                if(!createMessageElm.hasClass('active')) collapsibleInstance.open(0);
            } else {
                createMessageElm.addClass('hide');
            }
        });

        $('#commentsFrom').click(function (e) {
            e.stopPropagation(); // prevent collapse
        });

        $('#commentsTo').click(function (e) {
            e.stopPropagation(); // prevent collapse
        });

        $('#sound').click(function (e) {
            e.stopPropagation(); // prevent collapse

            if(soundIconElm.text() === 'volume_up') {
                soundIconElm.text('volume_off');
                soundIconElm.addClass('red-text');
            } else {
                soundIconElm.text('volume_up');
                soundIconElm.removeClass('red-text');
                new Audio(parameters.action.link + '/static/beep.wav').play();
            }
        });

        $(document).keyup(function (e) {
            if (e.which === 27) { // Esc
                startUpdate();
                //if(reloadIconElm.text() === 'pause') startUpdate();
                //else stopUpdate();
            }
            if(e.altKey) {
                if (e.which === 49) { // message editor on '1'
                    if (createMessageElm.hasClass('hide')) {
                        createMessageElm.removeClass('hide');
                        if (!createMessageElm.hasClass('active')) collapsibleInstance.open(0);
                    } else {
                        createMessageElm.addClass('hide');
                    }
                } else if (e.which === 50) { // history events on alt+2'
                    collapsibleInstance.close(0);
                    collapsibleInstance.open(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.close(4);
                } else if (e.which === 51) { // current events on alt+'3'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.open(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.close(4);
                } else if (e.which === 52) { // disabled events on alt+'4'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.open(3);
                    collapsibleInstance.close(4);
                } else if (e.which === 53) { // commented events on alt+'5'
                    collapsibleInstance.close(0);
                    collapsibleInstance.close(1);
                    collapsibleInstance.close(2);
                    collapsibleInstance.close(3);
                    collapsibleInstance.open(4);
                }
            }
        });

        quill = new Quill('#editor', {
            placeholder: 'Compose new message',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline', 'strike', 'clean'],        // toggled buttons
                    ['blockquote', 'code-block'],

                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'script': 'sub'}, { 'script': 'super' }],      // superscript/subscript
                    [{ 'indent': '-1'}, { 'indent': '+1' }],          // outdent/indent

                    [{ 'size': ['small', false, 'large', 'huge'] }],  // custom dropdown
                    [{ 'header': [1, 2, 3, 4, 5, 6, false] }],

                    [{ 'color': [] }, { 'background': [] }],          // dropdown with defaults from theme
                    [{ 'font': [] }],
                    [{ 'align': [] }],
                    ['link', 'image']                                // remove formatting button
                ]
            },
            theme: 'snow'
        });

        quill.on('editor-change', function() {
            // set messageTopImportance to undefined when editor is empty
            if(quill.getLength() < 2) messageTopImportance = undefined;
        });

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

        // set focus to event filter when focus is not on recipients, subject or message editor
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

        if(parameters.action.messageTemplates.length) {
            var messageButtonsElm = $('#messageButtons');
            parameters.action.messageTemplates.forEach(function(template) {

                var buttonElm = $('<div data-tooltip="' + template.tip +
                    '" class="tooltipped chip" style="cursor:pointer">' +  template.name+ '</div>');

                messageButtonsElm.append(buttonElm);

                if(template.default) applyTemplate(template);

                buttonElm.click(function (e) {
                    e.stopPropagation();
                    applyTemplate(template);
                })
            });
        }


        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {
            enterDelay: 2000
        });

        setInterval(getDataByAjax, updateInterval);
    }

    function ajaxError (jqXHR, exception) {
        bodyElm.css("cursor", "auto");
        var msg = '';
        if (jqXHR.status === 0) {
            msg = 'Not connect.\n Verify Network.';
        } else if (jqXHR.status === 404) {
            msg = 'Requested page not found. [404]';
        } else if (jqXHR.status === 500) {
            msg = 'Internal Server Error [500].';
        } else if (exception === 'parsererror') {
            msg = 'Requested JSON parse failed.';
        } else if (exception === 'timeout') {
            msg = 'Time out error.';
        } else if (exception === 'abort') {
            msg = 'Ajax request aborted.';
        } else {
            msg = 'Uncaught Error.\n' + jqXHR.responseText;
        }
        M.toast({html: 'Web server error: ' + msg});
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
            if(parameters.action.replyTo) $('#replyTo').val(parameters.action.replyTo);
            var messageBody = quill.getHtml();
            // remove first 2 new lines and add better style to <p>
            if(addCommentElm.val()) {
                messageBody = '<p style=\'margin: 0 0 .0001pt 0; font-family: "Calibri","sans-serif";font-size: 13pt;font-weight: bold;\'>' + addCommentElm.val() + '</p>' + messageBody.replace(/^<p><br><\/p>/i, '');
                addCommentElm.val('');
            }
            $('#message').val(messageBody.replace(/^<p><br><\/p><p><br><\/p>/i, '').replace(/<p>/gi, '<p style=\'margin: 0 0 .0001pt 0; font-family: "Calibri","sans-serif"; font-size: 13pt\'>'));

            if($('#disableEvents').is(':checked')) {
                var dateUntil = getDateTimestampFromStr($('#disableUntilDate').val());
                var timeUntil = getTimeFromStr($('#disableUntilTime').val());

                if (dateUntil && timeUntil) var disableUntil = dateUntil + timeUntil;
                else return callback(new Error('Please set date and time for disabled event'));

                if(disableUntil > Date.now()) $('#disableUntil').val(disableUntil);
                else return callback(new Error('Please set the limit of date and time for disabled event more then current time'));

                var timeStrFrom = $('#disableTimeIntervalFrom').val();
                var timeStrTo = $('#disableTimeIntervalTo').val();
                var timeIntervalFrom = getTimeFromStr(timeStrFrom);
                var timeIntervalTo = getTimeFromStr(timeStrTo);

                if(timeIntervalFrom !== undefined && timeIntervalTo !== undefined) {
                    if (timeIntervalTo > timeIntervalFrom)
                        $('#disableTimeInterval').val(String(timeIntervalFrom) + '-' + String(timeIntervalTo));
                    else {
                        return callback(new Error('Please set correct time interval: last time less then first time: ' +
                            timeStrFrom + ' - ' + timeStrTo));
                    }
                } else {
                    if(timeStrFrom || timeStrTo) {
                        return callback(new Error('Please set correct time interval: ' + timeStrFrom + ' - ' + timeStrTo));
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

    function runAfterExec (data, callback) {
        lastAction = null;
        subjectElm.val('');
        quill.setText('');
        applyTemplate(lastTemplate);
        if (createMessageElm.hasClass('active')) collapsibleInstance.close(0);
        $('input[type=checkbox]:checked').prop('checked', false);
        $('#addAsComment').prop('checked', true);
        setDisabledEventsControlPanel();
        startUpdate();
        eventsFilterElm.focus();
        callback();
    }

    function setUntilDateTimeControl(addMinutes) {
        var now = new Date();
        now.setMinutes(now.getMinutes() + addMinutes);
        $('#disableUntilDate').val(getDateString(now));
        $('#disableUntilTime').val(String('0' + now.getHours() + ':' + '0' + now.getMinutes()).replace(/\d(\d\d)/g, '$1'));
    }

    function applyTemplate (template) {
        var _maxMessageImportance = template.importance !== undefined ? Number(template.importance) : 0;
        if(messageTopImportance !== undefined && _maxMessageImportance > messageTopImportance) {
            M.toast({html: 'Can\'t use template. Importance of added events is higher then allowed in template', displayLength: 5000});
            return;
        }
        maxMessageImportance = _maxMessageImportance;

        if(template.subject) {
            var prevSubject = subjectElm.val() || '';
            if(prevSubject) { // remove template subjects from subject
                parameters.action.messageTemplates.forEach(function (t) {
                    if(!t || !t.subject) return;
                    if (prevSubject.indexOf(t.subject + ' ') !== -1) prevSubject = prevSubject.replace(t.subject + ' ', '');
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
        // saying "update paused" and exit
        if(Date.now() - gettingDataInProgress < 300000 /*gettingDataInProgress*/ || (
            !getDataForHistoryEvents && !getDataForCurrentEvents && !getDataForDisabledEvents)
        ) {
            if(soundIconElm.text() === 'volume_up') {
                try {
                    new Audio(parameters.action.link + '/static/beep.wav').play();
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance('Update paused'));
                } catch (e) {
                }
            }
            return;
        }
        bodyElm.css("cursor", "progress");
        gettingDataInProgress = Date.now();

        var objectsIDs = objects.map(function (object) {
            return object.id;
        });

        var startUpdateTime = new Date();
        lastUpdateElm.text('Start update at ' + startUpdateTime.toLocaleString().replace(/\.\d\d\d\d,/, ''));

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
            success: function (result) { //{history: [..], current: [...], disabled: [...]}
                if (!result) {
                    bodyElm.css("cursor", "auto");
                    gettingDataInProgress = 0;
                    var lastUpdateTime = new Date();
                    lastUpdateElm.text('No data at ' + lastUpdateTime.toLocaleString().replace(/\.\d\d\d\d,/, ''));
                    updateTimeElm.text(' (' + Math.round((lastUpdateTime - startUpdateTime) / 10) / 100 + 'sec)');
                    if (typeof callback === 'function') callback();
                    return;
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
                $('#hintComment').html(hint.text);
                hintDialogInstance.open();
            });
        });

        $('div.chip[commentIDForEvents]').click(function() {
            bodyElm.css("cursor", "progress");
            $.ajax({
                type: 'POST',
                timeout: 180000,
                url: serverURL,
                data: {
                    func: 'getCommentedEventsList',
                    objectsIDs: objectsIDs.join(','),
                    commentID: $(this).attr('commentIDForEvents')
                },
                error: ajaxError,
                success: function (rows) {
                    if (!rows) $('#hintComment').text('Can\'t find events list for this comment');
                    else {
                        $('#hintComment').html('\
<table class="bordered highlight responsive-table">\
    <thead>\
        <tr>\
            <th var="EVENT_UD" class="hide"></th>\
            <th var="OCID" class="hide"></th>\
            <th var="COUNTER_NAME" class="hide"></th>\
            <th var="OBJECT_NAME">Object</th>\
            <th var="EVENT_DESCRIPTION">Description</th>\
            <th var="IMPORTANCE" class="hide">Importance</th>\
            <th var="START_TIME">From</th>\
            <th var="END_TIME">To</th>\
            <th var="DURATION">Duration</th>\
            <th var="LAST_TIME">Last time</th>\
            <th>Actions</th>\
            <th>Select</th>\
        </tr>\
    </thead>\
    <tbody id="historyEventsTableForCommentedEvents">\
        <tr>\
            <td colspan="12" style="text-align: center;">Waiting for initializing...</td> \
        </tr>\
    </tbody>\
</table>');
                        drawHistoryEventsTable(rows, $('#historyEventsTableForCommentedEvents'));
                    }
                    hintDialogInstance.open();
                    addHintClickEvent();
                    bodyElm.css("cursor", "auto");
                }
            });
        });

        $('div.chip[data-OCIDForHistory]').click(function() {
            bodyElm.css("cursor", "progress");
            $.ajax({
                type: 'POST',
                timeout: 60000,
                url: serverURL,
                data: {
                    func: 'getHistoryData',
                    OCID: $(this).attr('data-OCIDForHistory')
                },
                error: ajaxError,
                success: function (rows) {
                    if (!rows) $('#hintComment').text('History data not found');
                    else {
                        $('#hintComment').html('\
<table class="bordered highlight responsive-table">\
    <thead>\
        <tr>\
            <th var="EVENT_UD" class="hide"></th>\
            <th var="OCID" class="hide"></th>\
            <th var="COUNTER_NAME" class="hide"></th>\
            <th var="OBJECT_NAME">Object</th>\
            <th var="EVENT_DESCRIPTION">Description</th>\
            <th var="IMPORTANCE" class="hide">Importance</th>\
            <th var="START_TIME">From</th>\
            <th var="END_TIME">To</th>\
            <th var="DURATION">Duration</th>\
            <th var="LAST_TIME">Last time</th>\
            <th>Actions</th>\
            <th>Select</th>\
        </tr>\
    </thead>\
    <tbody id="historyEventsTableForHistoryData">\
        <tr>\
            <td colspan="12" style="text-align: center;">Waiting for initializing...</td> \
        </tr>\
    </tbody>\
</table>');
                        drawHistoryEventsTable(rows, $('#historyEventsTableForHistoryData'));
                    }
                    hintDialogInstance.open();
                    addHintClickEvent();
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
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: 'getComments',
                from: commentsFromInstance.date.getTime(),
                to: commentsToInstance.date.getTime(),
                objectsIDs: objectsIDs.join(',')
            },
            error: ajaxError,
            success: function (comments) {
                if (comments) {
                    drawHistoryCommentedEventsTable(comments);
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
                $('#hintComment').html(comment.text);
                hintDialogInstance.open();
            });
        });
    }

    function setDisabledEventsControlPanel(elm) {

        var disabledEventsCheckedElms = $('input[disabledEventCheckBox]:checked');
        var disabledEventsCheckedCnt = disabledEventsCheckedElms.get().length;

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
                var eventID = Number(disabledEventsCheckedElms.attr('disabledEventCheckBox'));
                for (var i = 0; i < eventsData.disabled.length; i++) {
                    if (eventsData.disabled[i].id === eventID) {
                        if (eventsData.disabled[i] && eventsData.disabled[i].disableUntil) {
                            var disableUntil = new Date(eventsData.disabled[i].disableUntil);
                            $('#disableUntilDate').val(getDateString(disableUntil));
                            $('#disableUntilTime').val(String('0' + disableUntil.getHours() + ':' + '0' + disableUntil.getMinutes()).replace(/\d(\d\d)/g, '$1'));
                        }
                        if(eventsData.disabled && eventsData.disabled[i] && eventsData.disabled[i].disableIntervals) {
                            var intervals = eventsData.disabled[i].disableIntervals.split(';').map(function (interval) {
                                return '<option value="' + interval + '">' + getTimeFromTimeInterval(interval) + '</option>';
                            });

                            //if (intervals.length) timeIntervalsElm.append('<option disabled>Choose time intervals</option>' + intervals.join(''));
                            if (intervals.length) {
                                removeIntervalsElm.prop('disabled', false);
                                timeIntervalsElm.prop('disabled', false);
                                timeIntervalsElm.append(intervals.join(''));
                            }
                        }
                        break;
                    }
                }
            }
        }
        M.FormSelect.init(timeIntervalsElm[0], {});

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

        var from = ('0' + Math.floor(fromTo[0] / 3600000) + ':0' + Math.floor((fromTo[0] - Math.floor(fromTo[0] / 3600000) * 3600000) / 60000)).replace(/\d(\d\d)/g, '$1');
        var to = ('0' + Math.floor(fromTo[1] / 3600000) + ':0' + Math.floor((fromTo[1] - Math.floor(fromTo[1] / 3600000) * 3600000) / 60000)).replace(/\d(\d\d)/g, '$1');

        return from + '-' + to;
    }


    // multiple select or unselect events with same counter name
    // elm is a checkBox
    function multipleSelectElmWithCtrl(clickedCheckboxElm) {
        var counterID = clickedCheckboxElm.attr('counterID');

        // there is a new changed state of checkbox after click
        var newCheckedProp = clickedCheckboxElm.is(':checked');

        // find all inputs in the current table (tbody) with attribute counterID whth equal <counterID> of selected checkbox
        // and revert they checked property
        clickedCheckboxElm.closest('tbody').find('input[counterID="' + counterID+ '"]').prop('checked', newCheckedProp);
    }

    function multipleSelectOnClickWithShift(elm) {
        var upElements = [], downElements = [], elementsForSelect;
        var trElm = elm.closest('tr');

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
            success: function (row) {
                if (!row) return;

                var disabledTimeIntervals = '';
                if (row.disableUntil && row.disableIntervals) {
                    var intervals = row.disableIntervals.split(';'),
                        lastMidnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime(); // last midnight

                    disabledTimeIntervals = ', time intervals: ' + intervals.map(function (interval) {
                        var fromTo = interval.split('-');
                        var from = new Date(lastMidnight + Number(fromTo[0])).toLocaleTimeString().replace(/:\d\d$/, '');
                        var to = new Date(lastMidnight + Number(fromTo[1])).toLocaleTimeString().replace(/:\d\d$/, '');
                        return from + '-' + to;
                    }).join('; ');
                }

                var user = row.user ? "<p class='margin-0'>Created by: " + row.user + '</p>' : '';
                var recipients = row.recipients ? "<p class='margin-0'>Message was sending to: " + row.recipients + '</p>' : '';
                var text = '<p>' + row.comment + '</p>';
                var time = row.timestamp ? "<p class='margin-0'>Date: " + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</p>' : '';
                var disabledUntil = row.disableUntil ? '<p class="margin-0">Event will be disabled until ' + new Date(row.disableUntil).toLocaleString() + disabledTimeIntervals + '</p>' : '';

                bodyElm.css("cursor", "auto");
                callback({
                    subject: row.subject,
                    text: text + user + recipients + disabledUntil + time
                });
            }
        });
    }

    function drawHistoryEventsTable(result, elm) {
        var tablePartHTML = '';

        if (!result || !result.length) tablePartHTML = '<tr><td colspan="12" style="text-align: center;">No history events</td></tr>';
        else {
            result.forEach(function (row, idx) {
                if(idx > maxEventsNumberInTable) return;

                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var style = row.endTime ? '' : 'font-weight:bold;';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectHistoryEvent_'+ row.id+':checked').length ? ' checked' : '';
                var hintLink = row.hintID ? '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var historyLink = '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ';

                tablePartHTML += '\
<tr historyEventsRow OCID="' + row.OCID + '" importance="' +row.importance+ '" bgcolor="' + color + '" ' +
                    'style="cursor: pointer;' + style + '">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td>' + row.objectName + '</td>\
    <td>' + floatToHuman(row.eventDescription ? row.eventDescription : row.counterName) + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' + (row.startTime ? new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.endTime ? new Date(row.endTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.startTime ? getHumanTime((row.endTime ? row.endTime : Date.now()) - row.startTime) : '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime) + hintLink + historyLink +
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

        if(!elm) elm = $('#historyEventsTable');
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
                    }).catch(error => {
                        //console.log('Autoplay was prevented. Show a "Play" button so that user can start playback.');
                    });
                }
                if(Date.now() - startTime > updateInterval - 10000) {
                    tooManyEventsSpoken = true;
                    var msg = 'About ' + events.length - Object.keys(newEvents).length - Object.keys(prevEvents).length + ' new events will not be spoken';
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

        if (!result || !result.length) tablePartHTML = '<tr><td colspan="11" style="text-align: center;">No events</td></tr>';
        else {
            result.forEach(function (row) {
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectCurrentEvent_'+ row.id+':checked').length ? ' checked' : '';
                var hintLink = row.hintID ? '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var commentLink = row.commentID ? '<div class="chip small-chip" commentID="' + row.commentID +'" OCID="' + row.OCID +'">info</div> ' : '';
                var historyLink = '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ';

                tablePartHTML += '\
<tr currentEventsRow OCID="' + row.OCID + '" importance="' +row.importance+ '" bgcolor="' + color + // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                    '" style="cursor: pointer;">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td>' + row.objectName + '</td>\
    <td>' + floatToHuman(row.eventDescription ? row.eventDescription : row.counterName) + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' + (row.startTime ? new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.startTime ? getHumanTime(Date.now() - row.startTime) : '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime) +
                    commentLink + hintLink + historyLink +
                    '</td>\
                    <td preventCheckboxCheck>\
                        <label>\
                            <input type="checkbox" selectEventCheckbox counterID="' + row.counterID + '" id="selectCurrentEvent_'+ row.id+'"' + isChecked + '/>\
            <span></span>\
        </label>\
    </td>\
</tr>';
            });
            speakUpNewEvents(result);
        }

        $('#eventsTable').html(tablePartHTML);
    }

    function drawDisableEventsTable(result) {
        var tablePartHTML = '';

        if (!result || !result.length) tablePartHTML = '<tr><td colspan="15" style="text-align: center;">No disabled events</td></tr>';
        else {
            result.forEach(function (row) {
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var style = row.endTime ? '' : 'font-weight:bold;';
                var importanceText = importance ? importance.text : row.importance;
                var isChecked = $('input#selectDisabledEvent_' + row.id + ':checked').length ? ' checked' : '';
                var hintLink = row.hintID ? '<div class="chip small-chip" hintID="' + row.hintID +'">hint</div> ' : '';
                var commentLink = row.commentID ? '<div class="chip small-chip" commentID="' + row.commentID +'" OCID="' + row.OCID +'">info</div> ' : '';
                var historyLink = '<div class="chip small-chip" data-OCIDForHistory="' + row.OCID +'">history</div> ';

                if(row.disableIntervals) { // remove same intervals
                    var disableIntervalsObj = {};
                    row.disableIntervals.split(';').forEach(function(interval) {
                        disableIntervalsObj[getTimeFromTimeInterval(interval)] = true;
                    });

                    var disableIntervals = Object.keys(disableIntervalsObj).join(' ');
                } else disableIntervals = '';

                tablePartHTML += '\
<tr disabledEventsRow OCID="' + row.OCID + '" importance="' + row.importance + '" bgcolor="' + color +
                    '" style="cursor: pointer;' + style + '">\
    <td class="hide">' + row.id + '</td>\
    <td class="hide">' + row.OCID + '</td>\
    <td class="hide" counterName>' + row.counterName + '</td>\
    <td>' + row.objectName + '</td>\
    <td>' + floatToHuman(row.eventDescription ? row.eventDescription : row.counterName) + '</td>\
    <td class="hide">' + importanceText + '</td>\
    <td>' + (row.startTime ? new Date(row.startTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + (row.endTime ? new Date(row.endTime).toLocaleString().replace(/\.\d\d\d\d,/, '') : '-') + '</td>\
    <td>' + new Date(row.disableUntil).toLocaleString().replace(/\.\d\d(\d\d),/, '.$1') + '</td>\
    <td>' + disableIntervals + '</td>\
    <td>' + row.disableUser + '</td>\
    <td preventCheckboxCheck class="small-padding">' +
                    makeActionLinks(row.objectName, row.parentOCID, row.startTime, row.endTime) +
                    commentLink + hintLink + historyLink +
                    '</td>\
                    <td preventCheckboxCheck>\
                        <label>\
                            <input type="checkbox" selectEventCheckbox counterID="' + row.counterID + '" disabledEventCheckBox="'+ row.id + '" id="selectDisabledEvent_' + row.id + '"' + isChecked + '/>\
            <span></span>\
        </label>\
    </td>\
</tr>';
            });
        }

        $('#disabledEventsTable').html(tablePartHTML);
    }

    function drawHistoryCommentedEventsTable(result) {
        var tablePartHTML = '';

        if (!result.length) tablePartHTML = '<tr><td colspan="8" style="text-align: center;">No commented events</td></tr>';
        else {
            result.forEach(function (row) {
                var importance = getHumanImportance(row.importance);
                // use bgcolor attribute for instead style for possible to change color of the row on mouse over
                var color = importance ? importance.color : 'auto';
                var commentLink = '<div class="chip small-chip" commentID="' + row.id +'">info</div> ';
                var eventLink = '<div class="chip small-chip" commentIDForEvents="' + row.id +'">events&nbsp;:' + row.eventsCount + '</div> ';

                tablePartHTML += '\
<tr historyCommentedEventsRow importance="' + row.importance + '" bgcolor="' + color +'">\
    <td class="hide">' + row.id + '</td>\
    <td><div class="comment-body"><p class="comment-header">' + row.subject + '</p>' + row.comment +'</div></td>\
    <td>' + row.user +'</td>\
    <td>' + (row.recipients || '-') + '</td>\
    <td>' + new Date(row.timestamp).toLocaleString().replace(/\.\d\d\d\d,/, '') + '</td>\
    <td preventCheckboxCheck class="small-padding">' + commentLink + eventLink + '</td>\
</tr>';
            });
        }

        $('#historyCommentedEventsTable').html(tablePartHTML);
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
        return [   [Math.floor(seconds / 31536000), function(y) { return y === 1 ? y + 'year ' : y + 'years ' }],
            [Math.floor((seconds % 31536000) / 86400), function(y) { return y === 1 ? y + 'day ' : y + 'days ' }],
            [Math.floor(((seconds % 31536000) % 86400) / 3600), function(y) { return y + (y === 1 ? 'hour ' : 'hours ' )}],
            [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), function(y) {return y + 'min '}],
            [(((seconds % 31536000) % 86400) % 3600) % 60, function(y) {return y + 'sec'}]
        ].map(function(level) {
            return level[0] ? level[1](level[0]) : '';
        }).join('').replace(/^([^ ]+ [^ ]+) ?.*$/, '$1').replace(/(\.\d\d)\d*/, '$1 ').trim() || '0 sec';
    }

    function floatToHuman(str) {
        return str.replace(/(\d+\.\d\d)\d+/g, '$1');
    }

    function getHumanImportance(importance) {
        if(parameters.action.importance &&
            parameters.action.importance[importance] &&
            parameters.action.importance[importance].text) return parameters.action.importance[importance];
    }

    function composeMessage() {

        lastAction = $('input[name="action"]:checked').attr('id');
        var template = parameters.action.actionsMessageTemplates[lastAction];
        if(!template) template = parameters.action.actionsMessageTemplates.addAsComment;
        var func = lastAction.indexOf('addAsHint') === 0 ? 'getHint' : 'getComment';

        var variables = {}, objectsNames = {}, countersNames = {};
        var maxImportance;

        var checkedEventsElms = [];
        if(!template.tables) checkedEventsElms = $('table').find('input[selectEventCheckbox]:checked').get();
        else {
            template.tables.forEach(function (tableID) {
                Array.prototype.push.apply(checkedEventsElms, $('#' + tableID).find('input[selectEventCheckbox]:checked').get())
            })
        }

        if(!checkedEventsElms.length) {
            M.toast({html: 'Please select events before compose message', displayLength: 2000});
            return;
        }

        var infoIDs = [];

        checkedEventsElms.forEach(function(elm) {
            var trElm = $(elm).closest('tr');
            var importance = Number(trElm.attr('importance'));
            if(maxImportance === undefined || importance < maxImportance) maxImportance = importance;

            var tdElements = trElm.find('td').get(), variablesInRow = {};

            trElm.closest('table').find('th').get().forEach(function(thElm, idx) {
                var name = $(thElm).attr('var');
                if(name) variablesInRow[name] = $(tdElements[idx]).text();
            });

            if(!variablesInRow.END_TIME) variablesInRow.END_TIME = 'NOW';
            var interval = variablesInRow.START_TIME + ' - ' + variablesInRow.END_TIME + ' (' + variablesInRow.DURATION + ')';

            if(!variables[variablesInRow.OCID]) {
                variables[variablesInRow.OCID] = {
                    objectName: variablesInRow.OBJECT_NAME,
                    counterName: variablesInRow.COUNTER_NAME,
                    eventDescription: variablesInRow.EVENT_DESCRIPTION,
                    action: ($(elm).closest('tbody#disabledEventsTable').length ? 'ENABLE' : 'DISABLE'),
                    disableIntervals: [interval]
                };
                objectsNames[variablesInRow.OBJECT_NAME] = true;
                countersNames[variablesInRow.COUNTER_NAME] = true;
            } else {
                // don't add repeated event text, only add intervals for this event
                variables[variablesInRow.OCID].disableIntervals.push(interval);
                // variables[variablesInRow.OCID].eventDescription += '\n\n' + variablesInRow.EVENT_DESCRIPTION;
                variables[variablesInRow.OCID].eventDescription = variablesInRow.EVENT_DESCRIPTION;
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

        if(maxMessageImportance === undefined || maxImportance < maxMessageImportance) {
            M.toast({html: 'Can\'t compose message. Importance of selected events is higher then allowed in message template', displayLength: 5000});
            return;
        }

        if(template.bodyHeader) {
            var messageBody = template.bodyHeader;
            messageBody = messageBody.replace('%:DISABLE_UNTIL:%', $('#disableUntilTime').val() + ' ' + $('#disableUntilDate').val());

            var disableTimeIntervalFrom = $('#disableTimeIntervalFrom').val();
            var disableTimeIntervalTo = $('#disableTimeIntervalTo').val();
            if(disableTimeIntervalFrom && disableTimeIntervalTo)
                var newTimeInterval = disableTimeIntervalFrom + '-' + disableTimeIntervalTo;
            else newTimeInterval = '00:00-23:59';
            messageBody = messageBody.replace('%:NEW_DISABLE_TIME_INTERVAL:%', newTimeInterval);
        } else messageBody = '';

        Object.keys(variables).forEach(function (OCID) {
            var str = template.eventTemplate;
            str = str.replace('%:OBJECT_NAME:%', variables[OCID].objectName);
            str = str.replace('%:COUNTER_NAME:%', variables[OCID].counterName);
            str = str.replace('%:EVENT_DESCRIPTION:%', variables[OCID].eventDescription);
            str = str.replace('%:ACTION:%', variables[OCID].action);
            str = str.replace('%:EVENT_TIME:%', variables[OCID].disableIntervals.reverse().join(template.intervalsDivider));

            messageBody += str;
        });

        var subject = template.subject;
        if(subject) {
            var objectsList = Object.keys(objectsNames).join(', ');
            if (template.objectsListLength && objectsList.length > template.objectsListLength) {
                objectsList = objectsList.substr(0, template.objectsListLength - 7);
                objectsList += '... (' + Object.keys(objectsNames).length + ')';
            }

            var countersList = Object.keys(countersNames).join('; ');
            if (template.countersListLength && countersList.length > template.countersListLength) {
                countersList = countersList.substr(0, template.countersListLength - 7);
                countersList += '... (' + Object.keys(countersNames).length + ')';
            }

            subject = subject.replace('%:OBJECTS_LIST:%', objectsList);
            subject = subject.replace('%:COUNTERS_LIST:%', countersList);

            subjectElm.val(subjectElm.val() + subject);
            M.updateTextFields();
        }

        quill.focus();
        var range = quill.getSelection();
        if(!range) var index = 0;
        else index = range.index;

        if(infoIDs.length > 1) prevCommentDialogElm.open();
        else if(infoIDs.length === 1) {
            makeHint(func, infoIDs[0], function(info) {
                messageBody += '\n_________________________\nPrevious information:\n\n' +
                    'Subject: ' + info.subject + '\n\n' +
                    info.text.replace(/(<\/p>)|(<br.?>)/ig, '\n').replace(/<[^>]+>/g, '').replace(/\n\n+/gm, '\n').trim() +
                    '\n_________________________\n';
                quill.insertText(index, messageBody, {}, "user");
            });
            return;
        }

        quill.insertText(index, messageBody, {}, "user");

        if(messageTopImportance === undefined || maxImportance < messageTopImportance) messageTopImportance = maxImportance;
    }

    function makeURLForDataBrowser(objectName, parentOCID, startTime, endTime) {
        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/data_browser';

        var urlParameters = {
            't': encodeURIComponent(startTime - 900000 + '-' + (endTime ? endTime + 900000 : Date.now())), // timestamps in ms
            'l': encodeURIComponent(parentOCID), // show graph for this OCID with align to left
            'n': '0', // don't autoupdate
            'a': encodeURIComponent(actionPath), // /action/data-browser
            'c': encodeURIComponent(objectName), // selected object
        };

        return '/?' + Object.keys(urlParameters).map(function(key) {
            return key + '=' + urlParameters[key];
        }).join('&');
    }

    function makeURLForAction(actionID, objectName) {
        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/' + actionID;

        var urlParameters = {
            'a': encodeURIComponent(actionPath), // /action/objects-properties
            'c': encodeURIComponent(objectName), // selected object
        };

        return '/?' + Object.keys(urlParameters).map(function(key) {
            return key + '=' + urlParameters[key];
        }).join('&');
    }

    function makeActionLinks(objectName, parentOCID, startTime, endTime) {
        var actions = parameters.action.actions;

        if(!Array.isArray(actions) || !actions.length) return '';

        var links = actions.map(function (action) {
            if(!action.ID || !action.name) return '';

            if(action.ID === 'data_browser') {
                return '<div class="chip small-chip"><a href="' +
                    makeURLForDataBrowser(objectName, parentOCID, startTime, endTime) + '" target="_blank">' +
                    action.name + '</a></div>'
            }

            return '<div class="chip small-chip"><a href="' +
                makeURLForAction(action.ID, objectName) + '" target="_blank">' +
                action.name + '</a></div>';
        });

        return links.join('');
    }

    function createFilteredEventTable() {

        var searchStr = eventsFilterElm.val();
        var rows = $("tbody").find("tr").addClass('hide');
        if (searchStr.length) {
            rows.find("input[selectEventCheckbox]:checked").closest('tr').removeClass('hide');
            rows.filter(":icontains('" + searchStr + "')").removeClass('hide');
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
        if($('#historyEvents').hasClass('active')) getDataForHistoryEvents = true;
        if($('#currentEvents').hasClass('active')) getDataForCurrentEvents = true;
        if($('#disabledEvents').hasClass('active')) getDataForDisabledEvents = true;
        historyEventsHeaderElm.removeClass('red');
        currentEventsHeaderElm.removeClass('red');
        disabledEventsHeaderElm.removeClass('red');
        historyCommentedEventsHeaderElm.removeClass('red');
        getDataByAjax();
    }

    /*
        returned date string in format DD MonthName, YYYY
        date: date object (new Date())
     */
    function getDateString(date) {
        if(!date) date = new Date();

        return date.getDate() + ' ' + parameters.action.monthNames[date.getMonth()] + ', ' + date.getFullYear();
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
        var monthNum = parameters.action.monthNames.indexOf(dateParts[2]);
        return new Date(Number(dateParts[3]), monthNum, Number(dateParts[1])).getTime();
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

})(jQuery); // end of jQuery name space