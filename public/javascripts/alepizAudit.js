/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizAuditNamespace = (function($) {
    var modalLogWindowsInstance;

    var lastLogRecordIDs = {};
    var logTimer;
    var closeLogWindowsTimeout = 30; // close log window after 30 minutes


    function init () {
        $('#logWindowBtn').click(function() {
            if (!alepizActionLogViewerNamespace.getLogRecordsNum()) {
                M.toast({
                    html: 'No log records were found. Please run the action before',
                    displayLength: 5000
                });
                setTimeout(closeLogWindow, 1000);
                return;
            }
            openLogWindow();
        });

        modalLogWindowsInstance = M.Modal.init(document.getElementById('modal-log-window'), {
            onCloseEnd: function () {clearInterval(logTimer);}
        });
    }

    //  Open log window, start retrieving log, auto close log window after 30 minutes
    function openLogWindow() {
        if(!alepizMainNamespace.getSessionIDs().length) {
            M.toast({html: 'No actions are running in this window. Please run any action before', displayLength: 5000});
            return;
        }
        // Auto close log window after 30 min after  last show log window
        autoCloseLogWindow(closeLogWindowsTimeout);
        // Run getLastLogRecords() only if it is not running or not updated more than 1 minutes
        //if(retrievingLogRecordsInProgress === 0 || (Date.now() - retrievingLogRecordsInProgress) > 60000) {
        //getLastLogRecords(force);
        //}
        clearInterval(logTimer);
        logTimer = setInterval(function () {
            var sessionIDs = alepizMainNamespace.getSessionIDs();
            alepizActionLogViewerNamespace.getLastLogRecords(sessionIDs, lastLogRecordIDs, getActionName);
        }, 1000);
        modalLogWindowsInstance.open();
    }

    function getActionName(actionID) {
        var actionConf = alepizActionsNamespace.getActionConf(actionID);
        return actionConf ? actionConf.name : '';
    }

    // Close log window, and set flag for stopping retrieving log records
    function closeLogWindow() {
        clearInterval(logTimer);
        modalLogWindowsInstance.close();
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

    /**
     * Print a message that the action is completed
     *
     * @param returnedObj the object returned from the server after the action is finished. if typeof returnedObj is
     *  not an object then return
     * @param {number} returnedObj.sessionID new sessionID
     * @param {string} returnedObj.actionID action directory
     * @param {string} returnedObj.actionName action name
     * @param {string|undefined} returnedObj.actionError action error or undefined
     */
    function printMessageThatActionFinished(returnedObj) {

        if(typeof returnedObj !== 'object') return;
        alepizActionLogViewerNamespace.processLogRecords({'lastRecord': [{
            lastID: -1,
            timestamp: Date.now(),
            sessionID: returnedObj.oldSessionID,
            actionID: returnedObj.actionID,
            level: returnedObj.actionError ? 'E' : 'I',
            // xxxThe for procession message in coloringLogMessage(message)
            message: 'xxxThe "' + returnedObj.actionName + '" action was finished ' +
                (returnedObj.actionError ? ('with error: ' + returnedObj.actionError) : 'successfully.'),
        }]}, lastLogRecordIDs, getActionName);
    }

    return {
        init: init,
        openLogWindow: openLogWindow,
        printMessageThatActionFinished: printMessageThatActionFinished,
    }
})(jQuery);