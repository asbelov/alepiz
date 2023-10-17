/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizProcessActionNamespace = (function($) {

    var bodyElm,
        runActionFloatingBtnElm,
        runActionBtnElm,
        runActionSmallBtnElm,
        makeTaskBtnElm,
        makeTaskFloatingBtnElm,
        runActionIconElm,
        makeTaskIconElm,
        iframeDOMElm,
        sessionIDs = {};

    function init() {
        bodyElm = $("body");
        runActionFloatingBtnElm = $('#runActionFloatingBtn');
        runActionBtnElm = $('#runActionBtn');
        runActionSmallBtnElm = $('#runActionSmallBtn');
        makeTaskBtnElm = $('#makeTaskBtn');
        makeTaskFloatingBtnElm = $('#makeTaskFloatingBtn');
        runActionIconElm = $('[data-run-action-icon]');
        makeTaskIconElm = $('[data-make-task-icon]');
        iframeDOMElm = document.getElementById('actionObject');

        // Floating Action Button (FAB) control make possible open and close FAB menu on mouse over and on click
        M.FloatingActionButton.init(runActionFloatingBtnElm[0], {
            hoverEnabled: true,
        });

        M.FloatingActionButton.init(makeTaskFloatingBtnElm[0], {
            hoverEnabled: true,
        });

        runActionBtnElm.click(processIframeInputsData);
        runActionSmallBtnElm.click(processIframeInputsData);
        makeTaskBtnElm.click(processIframeInputsData);
        makeTaskFloatingBtnElm.click(processIframeInputsData);
    }

    function initActionBtn() {
        var activeAction = alepizActionsNamespace.getActiveActionConf();

        runActionFloatingBtnElm.addClass('hide');
        makeTaskBtnElm.addClass('hide');
        runActionSmallBtnElm.addClass('hide');
        makeTaskFloatingBtnElm.addClass('hide');

        if(!activeAction) return;
        //console.log(activeAction.rights)
        if(activeAction.launcher) {
            // show "run action" button as main
            if (activeAction.rights.run && (!activeAction.swapActionControlBtn ||
                (activeAction.swapActionControlBtn && !activeAction.rights.makeTask))) {

                runActionFloatingBtnElm.removeClass('hide');
                if (activeAction.rights.makeTask) makeTaskBtnElm.removeClass('hide');
            // show "make task" buttons as main
            } else if (activeAction.rights.makeTask) {
                makeTaskFloatingBtnElm.removeClass('hide');
                if (activeAction.rights.run) runActionSmallBtnElm.removeClass('hide');
            }
        }
    }

    /*
    Processing "click" event for runAction and makeTask button:
    * running callback before action execution if specified
    * collecting data from form elements with tags "input", "select" and "textarea"
    * validate collecting data according attributes "validator"=<regExp> and length=<integer>
    * sending data to the launcher and waiting for the result of action execution
    * running callback after action execution if specified
    * show result of action execution
    */
    function processIframeInputsData(e){
        // prevent to start the function from the parent button
        if(e) e.stopPropagation();

        var activeAction = alepizActionsNamespace.getActiveActionConf();

        // if button id attr is makeTask*Btn, then run action for makeTask, else execute action
        var executionMode = this.id === 'makeTaskBtn' || this.id === 'makeTaskFloatingBtn' ? 'makeTask' : 'server';

        // run action or make task btn animation
        if(executionMode === 'server') runActionIconElm.text('downhill_skiing');
        else makeTaskIconElm.text('task_alt');
        setTimeout(function () {
            if(executionMode === 'server') runActionIconElm.text('play_arrow');
            else makeTaskIconElm.text('playlist_add');
        }, 500);

        var callbackBeforeExec = activeAction.callbackBeforeExec;
        // if callback function for action exist, then run callback at first and executing action
        // from callback function
        if (callbackBeforeExec) {
            var callbackBeforeExecFunc = iframeDOMElm.contentWindow[callbackBeforeExec];
            if(!callbackBeforeExecFunc) {
                callbackBeforeExecFunc = function (callback) {
                    callback (new Error('Error running callbackBeforeExec on browser side before execution action.' +
                        'Callback: ' + callbackBeforeExecFunc + '(callback): not a function'));
                }
            }
            try {
                callbackBeforeExecFunc(
                    function (err) {
                        if (err) return log.error(err.message);
                        return getInputDataAndExecServer(executionMode);
                    }
                );
            } catch (err) {
                alepizMainNamespace.reload();
                console.error('Error running callbackBeforeExec on browser side before execution action.',
                    'Callback: ' + callbackBeforeExecFunc + '(callback): ', err.stack);
            }
            // without callback function for action executing action directly
        } else getInputDataAndExecServer(executionMode);


        // executionMode = 'server'|'makeTask'
        function getInputDataAndExecServer(executionMode) {
            var objects = alepizObjectsNamespace.getSelectedObjects();

            var actionParam = [{name: 'o', value: JSON.stringify(objects)}];

            // Only this way can show, is createActionParam() return error or not
            // don't touch it, even if you understand, what are you doing
            var errorOnCreateActionParam = false;
            $(iframeDOMElm).contents().find('input').each(createActionParam);
            $(iframeDOMElm).contents().find('select').each(createActionParam);
            $(iframeDOMElm).contents().find('textarea').each(createActionParam);
            if(errorOnCreateActionParam) return;

            var execMethod = activeAction.execMethod ? activeAction.execMethod.toUpperCase() : 'POST';
            if(execMethod !== 'GET' || execMethod !== 'POST') execMethod = 'POST';

            var sessionID = alepizMainNamespace.getSessionID();
            if(sessionIDs[sessionID]) {
                sessionID = createUniqueID('ALEPIZ' + String(Date.now()));
                alepizMainNamespace.setSessionID(sessionID);
                console.log('Creating new sessionID ', sessionID);
            }

            var ajaxUrl = activeAction.link + '_' + sessionID + '/' + executionMode;
            var timeout = Number(activeAction.timeout) * 1000;
            $("body").css("cursor", "progress");

            if(executionMode === 'makeTask') {
                M.toast({
                    html: 'The action "' + activeAction.name + '" has been added in a new task',
                    displayLength: 6000
                });
            } else {
                // when the function processIframeInputsData(e) was not started as argument to the onclick event handler
                if(e === undefined) {
                    M.toast({
                        html: 'Executing action "' + activeAction.name + '"... Open log window for details',
                        displayLength: 6000
                    });
                } else alepizAuditNamespace.openLogWindow();
            }

            if(executionMode === 'server') sessionIDs[sessionID] = true;
            $.ajax(ajaxUrl, {
                type: execMethod,
                data: $.param(actionParam),
                success: processingResult,
                timeout: timeout,
                cache: false
                //                    dataType: 'json'
                // I don't understand why, but it's convert json data to json in json
                //                    converters: {
                //                        'text json': function(message) {
                //                            return {"message": message};
                //                        }
                //                    }
            });

            function createActionParam(index, elm) {
                if(elm.name) var name = elm.name;
                else name = elm.id;
                if(!name) return;

                // all radio button in one group has a same names and mast have a different values
                // we skip all 'unchecked' radio, and at last get only checked radio with value
                if(elm.type === 'radio' && !elm.checked) return;

                // for checkbox: if it unchecked, then set empty value
                if(elm.type === 'checkbox' && !elm.checked) var value = '';
                else value = $(elm).val();

                var validator = elm.getAttribute('validator');
                if(validator) {
                    try {
                        var re = new RegExp(validator, 'i');
                        var validationResult = re.test(value);
                    } catch (err) {
                        log.error('Can\'t create regular expression /', validator, '/i for validate result: ', err.stack);
                        errorOnCreateActionParam = true;
                        return;
                    }
                } else validationResult = true;

                var parameterLength = elm.getAttribute('length') ? Number(elm.getAttribute('length')) : null;
                if(!validationResult || (parameterLength && value.length > parameterLength)) {
                    var errorMessage = elm.getAttribute('validatorError');
                    if(!errorMessage) {
                        if(!validationResult)
                            errorMessage = 'Error in parameter "'+name+'": "'+value+'" not matched with "'+validator+'"';
                        else
                            errorMessage = 'Error in parameter "'+name+'": length of "'+value+'" more than '+parameterLength;
                    }

                    log.error(errorMessage);
                    errorOnCreateActionParam = true;
                    return;
                }

                actionParam.push({name: name, value: value});
                //console.log(index+': '+elm.tagName+': '+name+'='+value);
            }
        }


        // processing result, returned by action
        //
        // returnObj = {
        //      data: <any data, for sending to the callbackAfterExec function at client side>
        //      sessionID: new sessionID
        //      actionError: err.message or ''
        // }
        function processingResult(returnedObj) {
            if(returnedObj.sessionID) alepizMainNamespace.setSessionID(returnedObj.sessionID);

            if(returnedObj.actionError) log.error(returnedObj.actionError);
            alepizAuditNamespace.printMessageThatActionFinished(returnedObj);

            var cleanElmIDs = activeAction.cleanInputIDs ? activeAction.cleanInputIDs.replace(/\s*[,;]\s*/g, ',') : null;
            if(cleanElmIDs) {
                cleanElmIDs.split(',').forEach(function(cleanElmID) {
                    try {
                        var elm = $(iframeDOMElm).contents().find('#'+cleanElmID);
                        if(!elm.length) return log.error('Can\'t clean element with ID: ', cleanElmID, ': element not exist');
                        if(elm.attr('type') === 'checkbox') elm.prop('checked', false);
                        else elm.val('');
                    } catch (err) {
                        alepizMainNamespace.reload();
                        console.error('Can\'t clean elements with IDs: ', cleanElmIDs, ': ', err.stack);
                    }
                });
            }

            var callbackAfterExec = activeAction.callbackAfterExec;
            if (callbackAfterExec) {
                var callbackAfterExecFunc = iframeDOMElm.contentWindow[callbackAfterExec];
                if(!callbackAfterExecFunc) {
                    callbackAfterExecFunc = function (res, callback) {
                        callback (new Error('Error running callbackAfterExec on browser side after execution action.' +
                            'Callback: ' + callbackAfterExec + '(data, callback): not a function'));
                    }
                }
                try {

                    callbackAfterExecFunc(returnedObj.result, function (err) {
                        if (err) return log.error(err.message);
                        reloadObjectsAndActionListsAfterActionExecution()
                    });
                    bodyElm.css("cursor", "auto");
                } catch (err) {
                    alepizMainNamespace.reload();
                    console.error('Error running callbackAfterExec on browser side after execution action.',
                        'Callback: ', callbackAfterExec, '(data, callback): ', err.message);
                }
            } else {
                reloadObjectsAndActionListsAfterActionExecution();
                bodyElm.css("cursor", "auto");
            }
        }
    }

/*
Reload object list at objects tab after action executed.
*/
    function reloadObjectsAndActionListsAfterActionExecution() {
        alepizObjectsNamespace.reDrawObjects(null, function () {
            alepizActionsNamespace.createActionsList(null, function () {
                alepizMainNamespace.setBrowserHistory();
            });
        });
    }

    function createUniqueID (str, seed = 0) {
        var h1 = 0xdeadbeef ^ seed,
            h2 = 0x41c6ce57 ^ seed;
        for (var i = 0, ch; i < str.length; i++) {
            ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }

        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }



    return {
        init: init,
        initActionBtn: initActionBtn,
        processIframeInputsData: processIframeInputsData,
    }

})(jQuery);