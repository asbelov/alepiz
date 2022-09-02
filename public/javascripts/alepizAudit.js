/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizAuditNamespace = (function($) {
    var modalLogWindowsInstance,
        logLastUpdateElm,
        logBodyElm;

    function init () {
        logLastUpdateElm = $('#last-update');
        logBodyElm = $('#collapsible-log-body');

        $('#logWindowBtn').click(openLogWindow);

        modalLogWindowsInstance = M.Modal.init(document.getElementById('modal-log-window'), {
            onCloseEnd: stoppingRetrievingLog
        });
    }

    var continueRetrievingLog = 0;
    var logTimer;
    var retrievingLogRecordsInProgress = 0;
    var closeLogWindowsTimeout = 30; // close log window after 30 minutes
    var maxLogRecords = 200;
    //  Open log window, start retrieving log, auto close log window after 30 minutes
    function openLogWindow(force) {
        if(!alepizMainNamespace.getSessionIDs().length) {
            M.toast({html: 'No actions are running in this window. Please run any action before', displayLength: 5000});
            return;
        }
        // this flag locked exit from getLastLogRecords()
        continueRetrievingLog = Date.now();
        // Auto close log window after 30 min after  last show log window
        autoCloseLogWindow(closeLogWindowsTimeout);
        // Run getLastLogRecords() only if it is not running or not updated more than 1 minutes
        //if(retrievingLogRecordsInProgress === 0 || (Date.now() - retrievingLogRecordsInProgress) > 60000) {
        //getLastLogRecords(force);
        //}
        clearInterval(logTimer);
        logTimer = setInterval(getLastLogRecords, 1000, force);
        modalLogWindowsInstance.open();
    }

    // Close log window, and set flag for stopping retrieving log records
    function closeLogWindow() {
        stoppingRetrievingLog();
        modalLogWindowsInstance.close();
        clearInterval(logTimer);
    }

    // used for set variables, for stopping retrieving log from server
    // it used in two places of the code, don't remove this function
    function stoppingRetrievingLog() {
        continueRetrievingLog = 0;
        //clearTimeout(logTimer);
    }

    // Auto close log window after timeout, which set at the last time when calling this function
    var autoCloseTimeout;
    function autoCloseLogWindow(timeout) {
        if(!autoCloseTimeout) {
            autoCloseTimeout = timeout;
            autoCloseWaiter();
        } else autoCloseTimeout = timeout;

        function autoCloseWaiter() {
            setTimeout(function () {
                if (--autoCloseTimeout) autoCloseWaiter();
                else closeLogWindow();
            }, 60000);
        }
    }

    // start retrieving last log records, until continueRetrievingLog set to true
    var lastLorRecordID = 0, timeout = 60000;
    function getLastLogRecords(force, callback) {
        if(!continueRetrievingLog || Date.now() - retrievingLogRecordsInProgress < timeout) return;

        retrievingLogRecordsInProgress = Date.now();

        logLastUpdateElm.text('Starting update: ' + (new Date()).toLocaleString() + '; records: ' +
            logBodyElm.find('div.logRecord').length + '...');
        $.ajax('/mainMenu', {
            type: 'POST',
            data: $.param({
                f: 'getLogRecords',
                lastID: lastLorRecordID,
                sessionsIDs: alepizMainNamespace.getSessionIDs().join(',')
            }),
            success: processLogRecords,
            error: ajaxError,
            timeout: timeout - 10,
            cache: false
        });

        function ajaxError(/*jqXHR, exception*/) {
            /*
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

             */
            retrievingLogRecordsInProgress = 0;
        }

        //$.post('/mainMenu', {f: 'getLogRecords', lastID: lastLorRecordID, sessionsIDs: Object.keys(sessionsIDs).join(',')}, function(records){
        function processLogRecords(records) {
            if(records && $.isArray(records) && records.length) {

                if (records[0] && records[0].lastID) {
                    lastLorRecordID = Number(records[0].lastID);
                    records.splice(0, 1); // remove first element with lastLogRecordID information

                    // we got unsorted array of records
                    records.sort(function (a, b) {
                        if (a.timestamp > b.timestamp) return 1;
                        if (a.timestamp < b.timestamp) return -1;
                        return 0;
                    });

                    printLogRecords(records);

                    var recordsElms = logBodyElm.find('div.logRecord');
                    var recordsCnt = recordsElms.length;
                    if(recordsCnt > maxLogRecords) {
                        for(var i = recordsCnt; i > maxLogRecords - 1; i--) {
                            var currentLogRecordElm = recordsElms.eq(i);
                            if(currentLogRecordElm.parent().children('div.logRecord').length !== 1) currentLogRecordElm.remove();
                            else currentLogRecordElm.parent().parent().remove();
                        }
                    }

                }
                M.Collapsible.init(logBodyElm[0], {});
            } else if(lastLorRecordID === 0 && !force) {
                M.toast({html: 'Log records not found. Please run any action before', displayLength: 5000});
                retrievingLogRecordsInProgress = 0;
                closeLogWindow();
            }

            logLastUpdateElm.text('Last update: ' + (new Date()).toLocaleString() + '; records: ' +
                logBodyElm.find('div.logRecord').length);

            /*
            if(continueRetrievingLog) {
                clearTimeout(logTimer);
                logTimer = setTimeout(getLastLogRecords, 1000);
            } else retrievingLogRecordsInProgress = 0;
             */

            retrievingLogRecordsInProgress = 0;
            if(typeof callback === 'function') callback();
        }
    }

    var logLevels = {S: 0, D: 1, I: 2, W: 3, E: 4};
    var logIcons = {S: 'book', D: 'bug_report', I: 'info', W: 'warning', E: 'explicit'};

    // Formatting and print log records to the log window
    //
    // records can be an array of objects:
    // {timestamp: <unix timestamp>, sessionID: xxx, level: S|D|I|W|E, actionName: <full action name>,
    // message: <message, coloring using console color escape codes>}
    //
    function printLogRecords(records) {

        var recordsSortedBySessions = {}, sessionsOrder = [];

        records.forEach(function(record) {
            var now = new Date(Number(record.timestamp));
            var month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            var dateString =
                [month[now.getMonth()],String(now.getDate()).replace(/^(\d)$/, '0$1'),[
                    String(now.getHours()).replace(/^(\d)$/, '0$1'),
                    String(now.getMinutes()).replace(/^(\d)$/, '0$1'),
                    String(now.getSeconds()).replace(/^(\d)$/, '0$1')
                ].join(':')].join(' ')+'.' + String('00' + now.getMilliseconds()).replace(/^0*?(\d\d\d)$/,
                    '$1');

            var logSessionID = record.sessionID;
            var icon = logIcons[record.level];

            if(recordsSortedBySessions[logSessionID] === undefined) {

                sessionsOrder.push(logSessionID);
                var sessionContainerElm = $('li[sessionID=' + logSessionID + ']');

                if(sessionContainerElm.length) {
                    recordsSortedBySessions[logSessionID] = {
                        actionName: record.actionName,
                        html: sessionContainerElm.find('div[id=' +logSessionID+ ']').html(),
                        logLevel: sessionContainerElm.attr('max-log-level'),
                        lines: 0,
                        firstTimeStr: sessionContainerElm.find('span[sessionID=' + logSessionID + ']').text()
                    };
                    sessionContainerElm.remove();
                } else {
                    recordsSortedBySessions[logSessionID] = {
                        actionName: record.actionName,
                        html: '',
                        logLevel: record.level,
                        lines: 0,
                        firstTimeStr: dateString
                    };
                }
            }

            var msgHtml = coloringLogMessage(record.message).split('\r').map(function (msgPart, idx) {
                if(!idx) return msgPart;
                var spacesCnt = msgPart.search(/\S/) + 1; // index of first non whitespace char
                return '<div style="padding:0 0 0 ' + spacesCnt + 'em;">' + msgPart + '</div>';
            }).join('\n');

            recordsSortedBySessions[logSessionID].html = '<div class="logRecord">' +
                '<div class="logIcon"><i class="material-icons">' + icon + '</i></div>' +
                '<div class="logDateStr"> ' + dateString +
                //                    '['+sessionID+']'+
                ':</div><span>' + msgHtml + '</span></div>' + recordsSortedBySessions[logSessionID].html;

            recordsSortedBySessions[logSessionID].lines++;
            if (logLevels[record.level] > logLevels[recordsSortedBySessions[logSessionID].logLevel])
                recordsSortedBySessions[logSessionID].logLevel = record.level;

            recordsSortedBySessions[logSessionID].lastTimeStr = dateString;
        });

        var html = '';
        sessionsOrder.reverse().forEach(function(logSessionID){

            var logLevel = recordsSortedBySessions[logSessionID].logLevel;
            var icon = logIcons[logLevel];
            var actionName = recordsSortedBySessions[logSessionID].actionName;
            var firstTimeStr = recordsSortedBySessions[logSessionID].firstTimeStr;
            var lastTimeStr = recordsSortedBySessions[logSessionID].lastTimeStr;

            html += '<li sessionID="' + logSessionID + '" max-log-level="' + logLevel + '" class="active">' +
                '<div class="collapsible-header">' +
                '<i class="material-icons" sessionID="' + logSessionID + '">' + icon + '</i><b>' + actionName + '</b>' +
                '. Session starting at&nbsp;<span sessionID="' + logSessionID + '">' + firstTimeStr +
                '</span>, finished at&nbsp;' + lastTimeStr +
                ', new records: ' + recordsSortedBySessions[logSessionID].lines +
                //                    '['+sessionID+']' +
                '</div><div class="collapsible-body" id="' + logSessionID + '">' +
                recordsSortedBySessions[logSessionID].html + '</div></li>';
        });

        logBodyElm.prepend(html);
    }

    // this classes set in index.jade
    var colorCodes = {
        '': 'logColorDefault',
        '01m': 'logColor01m',
        '30m': 'logColor30m',
        '31m': 'logColor31m',
        '32m': 'logColor32m',
        '33m': 'logColor33m',
        '34m': 'logColor34m',
        '35m': 'logColor35m',
        '36m': 'logColor36m',
        '37m': 'logColor37m',
        '38m': 'logColor38m'
    };

    function coloringLogMessage(message) {
        //console.log('Message: ', message);
        var messageParts = message
            .replace(/.\[\d\d?m(.\[\d\d?m)/gm, '$1')
            .replace(/.\[(\dm)/gm, '<clrd>0$1')
            .replace(/.\[(\d\dm)/gm, '<clrd>$1')
            .split('<clrd>'); // 0x1b = 27 = ←: Esc character
        //console.log('Message parts: ', messageParts.length);
        return  messageParts.map(function(data){
            var colorClass = colorCodes[data.slice(0, 3)];
            var part = data.slice(3);
            //console.log('colorCode: "'+colorCode+'"='+colorCodes[colorCode]+', part: "'+ part+'"\n');
            if(!part) return '';
            part = part.replace(/</gm, '&lt;').replace(/>/gm, '&gt;');
            if(!colorClass) return '<span>'+part+'</span>';
            return '<span class="'+colorClass+'">'+part+'</span>';
        }).join('');
    }

    return {
        init: init,
        openLogWindow: openLogWindow,
    }
})(jQuery);