/*
 * Copyright © 2023. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var alepizActionLogViewerNamespace = (function($) {
    var collapsibleInstance,
        logLastUpdateElm,
        logBodyElm;

    var retrievingLogRecordsInProgress = 0;
    var maxLogRecords = 200;
    var timeout = 60000;

    function init (parentElm) {
        var html = '<div class="row"></div><div class="col s12 right-align" id="last-update"></div>' +
            '<div class="col s12"><div class="divider"></div></div>' +
            '<ul class="collapsible z-depth-0" id="collapsible-log-body"></ul>';

        parentElm.html(html);

        logBodyElm = $('#collapsible-log-body');
        logLastUpdateElm = $('#last-update');

        // return several instances
        collapsibleInstance = M.Collapsible.init(logBodyElm[0], {});
    }

    function getLastLogRecords(sessionIDs, lastLogRecordIDs, getActionName) {
        if(Date.now() - retrievingLogRecordsInProgress < timeout) return;

        retrievingLogRecordsInProgress = Date.now();

        logLastUpdateElm.text('Waiting for new data from ' + (new Date()).toLocaleString() + ', Received ' +
            logBodyElm.find('div.logRecord').length + ' log records, active sessions: ' + (sessionIDs.length - 1));
        //console.log('getLogRecords: ', lastLogRecordIDs, 'Sessions: ', sessionIDs.join(','));

        if(!lastLogRecordIDs || typeof lastLogRecordIDs !== 'object' || !Object.keys(lastLogRecordIDs).length) {
            logBodyElm.empty();
        }

        $.ajax('/mainMenu', {
            type: 'POST',
            data: $.param({
                f: 'getLogRecords',
                lastID: JSON.stringify(lastLogRecordIDs),
                sessionIDs: sessionIDs.join(','),
            }),
            success: function(recordsObj) { processLogRecords(recordsObj, lastLogRecordIDs, getActionName) },
            error: ajaxError,
            timeout: timeout - 10,
            cache: false
        });
    }

    function processLogRecords(recordsObj, lastLogRecordIDs, getActionName) {
        retrievingLogRecordsInProgress = 0;

        var mergedRecords = [];
        if(recordsObj && typeof recordsObj === 'object') {
            for(var hostPort in recordsObj) {
                var records = recordsObj[hostPort];
                if(!Array.isArray(records) || !records.length) continue;
                if(records[0].lastID !== -1) lastLogRecordIDs[hostPort] = Number(records[0].lastID);
                Array.prototype.push.apply(mergedRecords, records);
            }

            if(mergedRecords.length) {
                mergedRecords.sort(function (a, b) {
                    if (a.timestamp > b.timestamp) return 1;
                    if (a.timestamp < b.timestamp) return -1;
                    return 0;
                });
                //console.log(recordsObj, mergedRecords, lastLogRecordIDs)
                printLogRecords(mergedRecords, getActionName);

                var recordsElms = logBodyElm.find('div.logRecord');
                var recordsCnt = recordsElms.length;
                if(recordsCnt > maxLogRecords) {
                    for(var i = recordsCnt; i > maxLogRecords - 1; i--) {
                        var currentLogRecordElm = recordsElms.eq(i);
                        if(currentLogRecordElm.parent().children('div.logRecord').length !== 1) {
                            currentLogRecordElm.remove();
                        } else currentLogRecordElm.parent().parent().remove();
                    }
                }
                collapsibleInstance.destroy();
                collapsibleInstance = M.Collapsible.init(logBodyElm[0], {});
            }
        }

        logLastUpdateElm.text('Last update: ' + (new Date()).toLocaleString() + '; records: ' +
            logBodyElm.find('div.logRecord').length);
    }

    var logLevels = {S: 0, D: 1, I: 2, W: 3, E: 4};
    var logIcons = {S: 'book', D: 'bug_report', I: 'info', W: 'warning', E: 'explicit'};

    // Formatting and print log records to the log window
    //
    // records can be an array of objects:
    // {timestamp: <timestamp>, sessionID: xxx, level: D|I|W|E, actionID: <action dir name>,
    // message: <message, coloring using console color escape codes>}
    //
    function printLogRecords(records, getActionName) {

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

                var actionName =  getActionName(record.actionID);
                if(sessionContainerElm.length) {
                    recordsSortedBySessions[logSessionID] = {
                        actionName: actionName,
                        html: sessionContainerElm.find('div[id=' +logSessionID+ ']').html(),
                        logLevel: sessionContainerElm.attr('max-log-level'),
                        lines: 0,
                        firstTimeStr: sessionContainerElm.find('span[sessionID=' + logSessionID + ']').text()
                    };
                    sessionContainerElm.remove();
                } else {
                    recordsSortedBySessions[logSessionID] = {
                        actionName: actionName,
                        html: '',
                        logLevel: record.level,
                        lines: 0,
                        firstTimeStr: dateString
                    };
                }
            }

            var msgHtml = coloringLogMessage(record.message).split('\n').map(function (msgPart, idx) {
                if(!idx) return msgPart;
                var spacesCnt = msgPart.search(/\S/) + 1; // index of first non whitespace char
                return '<div style="padding:0 0 0 ' + spacesCnt + 'em;">' + msgPart + '</div>';
            }).join('\n');
            //console.log('rawMessage: ', record.message)
            //console.log('htmlMessage:', msgHtml)
            recordsSortedBySessions[logSessionID].html = '<div class="logRecord">' +
                '<div class="logIcon"><i class="material-icons">' + icon + '</i></div>' +
                '<div class="logDateStr"> ' + dateString +
                //                    '['+sessionID+']'+
                ':</div>' +
                '<span>' + msgHtml + '</span></div>' + recordsSortedBySessions[logSessionID].html;

            recordsSortedBySessions[logSessionID].lines++;
            if (logLevels[record.level] > logLevels[recordsSortedBySessions[logSessionID].logLevel])
                recordsSortedBySessions[logSessionID].logLevel = record.level;

            recordsSortedBySessions[logSessionID].lastTimeStr = dateString;
        });

        var html = '';
        sessionsOrder.reverse().forEach(function(logSessionID) {

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
                '&nbsp;[' + logSessionID + ']' +
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

    function ajaxError(jqXHR, exception) {
        retrievingLogRecordsInProgress = 0;
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
        M.toast({
            html: 'Web server error: ' + err + ' [status: ' + jqXHR.status +
                (exception ? '; exception: ' + exception : '')+ ']',
            displayLength: 5000
        });

    }

    function getLogRecordsNum() {
        return logBodyElm.find('div.logRecord').length
    }

    return {
        init: init,
        getLastLogRecords: getLastLogRecords,
        processLogRecords: processLogRecords,
        getLogRecordsNum: getLogRecordsNum,
    }
})(jQuery);
