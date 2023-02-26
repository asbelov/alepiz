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
    var bodyElm,
        auditBodyElm,
        actionListElm,
        sessionTableHeaderElm,
        sessionTableBodyElm,
        sessionTableFirstRowTDElms,
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
        alepizActionLogViewerNamespace.init($('#actionLog'));
        getSessions(firstSessionID);
        initResizer();
        initEvents();
    }

    function initEvents() {
        //actionListElm.scroll(scrollSessions);
    }

    function initResizer() {
        // Query the element
        const resizer = document.getElementById('resizer');
        const actionListJSElm = resizer.previousElementSibling;
        const actionLogJSElm = resizer.nextElementSibling;
        let actionListHeight = 0;
        let actionLogHeight = 0
        let actionListWidth = 0;
        const direction = resizer.getAttribute('data-direction') || 'horizontal';

        //var auditBodyHeight = $(window).height() - auditBodyElm.offset().top - 10
        let auditBodyHeight = $(window).height() - auditBodyElm.scrollTop() - 10
        auditBodyElm.height(auditBodyHeight);
        actionListHeight = Math.round(auditBodyHeight * 0.70)
        actionListElm.height(actionListHeight);
        let actionListHeightPercent = actionListJSElm.getBoundingClientRect().height / auditBodyHeight;

        actionLogHeight =
            (auditBodyHeight - actionListHeight - resizer.getBoundingClientRect().height - 50) * 100 /
            auditBodyHeight;
        actionLogJSElm.style.height = `${actionLogHeight}%`;

        $(window).resize(function () {
            auditBodyHeight = $(window).height() - auditBodyElm.scrollTop() - 10
            auditBodyElm.height(auditBodyHeight);
            actionListHeight = Math.round(auditBodyHeight * actionListHeightPercent)
            actionListElm.height(actionListHeight);

            actionLogHeight =
                (auditBodyHeight - actionListHeight - resizer.getBoundingClientRect().height - 50) * 100 /
                auditBodyHeight;
            actionLogJSElm.style.height = `${actionLogHeight}%`;

            sessionTableTHElms.each(function (idx) {
                sessionTableFirstRowTDElms.eq(idx).css({width: $(this).width()});
            });
        });

        resizer.style.cursor = direction === 'horizontal' ? 'em-resize' : 'ns-resize';

        // The current position of mouse
        let x = 0;
        let y = 0;

        const mouseDownHandler = function (e) {
            x = e.clientX;
            y = e.clientY;

            actionListHeight = actionListJSElm.getBoundingClientRect().height;
            actionLogHeight = actionLogJSElm.getBoundingClientRect().height;
            actionListWidth = actionListJSElm.getBoundingClientRect().width;

            document.body.style.cursor = direction === 'horizontal' ? 'em-resize' : 'ns-resize';

            // Attach the listeners to `document`
            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        const mouseMoveHandler = function (e) {
            // How far the mouse has been moved
            const dx = e.clientX - x;
            const dy = e.clientY - y;

            switch (direction) {
                case 'vertical':
                    const h = (actionListHeight + dy) * 100 / resizer.parentNode.getBoundingClientRect().height;
                    if (h > 10 && h < 90) {
                        actionListJSElm.style.height = `${h}%`;
                        const h1 = (actionLogHeight - dy) * 100 / resizer.parentNode.getBoundingClientRect().height;
                        actionLogJSElm.style.height = `${h1}%`;
                    }
                    actionListHeightPercent = actionListJSElm.getBoundingClientRect().height / auditBodyHeight;
                    break;
                case 'horizontal':
                default:
                    const w = (actionListWidth + dx) * 100 / resizer.parentNode.getBoundingClientRect().width;
                    if(w > 10 && w < 90) actionListJSElm.style.width = `${w}%`;
                    break;
            }

            actionListJSElm.style.userSelect = 'none';
            actionListJSElm.style.pointerEvents = 'none';

            actionLogJSElm.style.userSelect = 'none';
            actionLogJSElm.style.pointerEvents = 'none';
        };

        const mouseUpHandler = function () {
            document.body.style.removeProperty('cursor');

            actionListJSElm.style.removeProperty('user-select');
            actionListJSElm.style.removeProperty('pointer-events');

            actionLogJSElm.style.removeProperty('user-select');
            actionLogJSElm.style.removeProperty('pointer-events');

            // Remove the handlers of `mousemove` and `mouseup`
            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);
        };

// Attach the handler
        resizer.addEventListener('mousedown', mouseDownHandler);
    }

    function getSessions(firstID) {
        $.post(serverURL, {
            func: 'getSessions',
            firstID: JSON.stringify(firstID),
        }, function(sessions) {
            if(Array.isArray(sessions)) { // print result returned from ajax
                printSessions(sessions);
            } else {
                console.log('Result from ajax: ', sessions); // debug result returned from ajax
            }
        });
    }

    function printSessions(sessions) {
        var sortedSessionIDs = sessions.sort(function (a, b) {
            return b.startTimestamp - a.startTimestamp
        });

        var tableHeadHtml = '<table class="bordered highlight" style="table-layout:fixed;">' +
            '<thead id="sessionTableHeader" style="background-color: white; width: 100%"><tr>' +
            '<th style="width: 5%">&nbsp;</th>' +
            '<th style="width: 5%">Started</th>' +
            '<th style="width: 5%">Finished</th>' +
            '<th style="width: 10%">User</th>' +
            '<th style="width: 10%">Action</th>' +
            '<th style="width: 35%">Description</th>' +
            '<th style="width: 20%">Error</th>' +
            '<th style="width: 10%">Objects</th>' +
            '</tr></thead></table>';

        $('#actionListHead').html(tableHeadHtml);

        var tableHTML = '<table class="bordered highlight" style="table-layout:fixed;" id="sessionTable">' +
            '<tbody id="sessionTableBody">';

        tableHTML += sortedSessionIDs.map(function (row) {
            var taskDescription = row.taskID ? '#' + row.taskID + ': ' + row.taskSubject : '&nbsp;';
            actions[row.actionID] = row.actionName;
             return '<tr style="cursor:pointer" data-session-id="' + row.sessionID + '"">' +
                 '<td>' + taskDescription  +
                 '</td><td>' +
                 (row.startTimestamp ?
                      (new Date(row.startTimestamp)).toLocaleString()
                        .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '') :
                      '-') +
                 '</td><td>' +
                 (row.stopTimestamp ?
                      (new Date(row.stopTimestamp)).toLocaleString()
                          .replace(/\D\d\d\d\d/, '').replace(/:\d\d$/, '') :
                      '-') +
                 '</td><td>' + row.userName +
                 '</td><td>' + row.actionName +
                 '</td><td>' + (row.description || '') +
                 '</td><td class="red-text">' + (row.error || '') +
                 '</td><td>' + row.objects.map(obj => obj.name).join(',<br/>') || ''+
                 '</td><td class="hide">' + row.userID +
                 '</td></tr>';
        }).join('') + '</tbody></table>';
        //console.log(sessions);

        actionListElm.html(tableHTML);
        sessionTableHeaderElm = $('#sessionTableHeader');
        sessionTableBodyElm = $('#sessionTableBody');

        // settings for the correct display of the floating header
        sessionTableFirstRowTDElms = sessionTableBodyElm.children('tr:first').find('td');
        sessionTableTHElms = sessionTableHeaderElm.find('th')
        sessionTableTHElms.each(function (idx) {
            sessionTableFirstRowTDElms.eq(idx).css({width: $(this).width()});
        });

        $('[data-session-id]').click(function () {
            var sessionID = Number($(this).attr('data-session-id'));
            alepizActionLogViewerNamespace.getLastLogRecords([sessionID], {},
                function (actionID) {
                    return actions[actionID];
                });
        });
    }

})(jQuery); // end of jQuery name space