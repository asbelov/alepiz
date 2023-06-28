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
        iframeDOMElm;

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
        //console.log(activeAction.rights)
        // show "run action" button
        if(activeAction.launcher && activeAction.rights.run && !activeAction.swapActionControlBtn) {
            runActionFloatingBtnElm.removeClass('hide');
        }

        // show one of "make task" buttons
        if(activeAction.launcher && (activeAction.rights.makeTask || activeAction.swapActionControlBtn)) {
            if(activeAction.launcher && activeAction.rights.run && !activeAction.swapActionControlBtn) {
                makeTaskBtnElm.removeClass('hide');
            } else {
                makeTaskFloatingBtnElm.removeClass('hide');
                if(activeAction.swapActionControlBtn) runActionSmallBtnElm.removeClass('hide');
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
    function processIframeInputsData(dontOpenLogWindows){
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
                        return getInputDataAndExecServer(executionMode, dontOpenLogWindows);
                    }
                );
            } catch (err) {
                alepizMainNamespace.reload();
                console.error('Error running callbackBeforeExec on browser side before execution action.',
                    'Callback: ' + callbackBeforeExecFunc + '(callback): ', err.stack);
            }
            // without callback function for action executing action directly
        } else getInputDataAndExecServer(executionMode, dontOpenLogWindows);


        // executionMode = 'server'|'makeTask'
        function getInputDataAndExecServer(executionMode, dontOpenLogWindows) {
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

            var ajaxUrl = activeAction.link + '_' + alepizMainNamespace.getSessionID() + '/' + executionMode;
            var timeout = Number(activeAction.timeout) * 1000;
            $("body").css("cursor", "progress");

            if(executionMode === 'makeTask') {
                M.toast({
                    html: 'The action "' + activeAction.name + '" has been added in a new task',
                    displayLength: 6000
                });
            } else {
                if(dontOpenLogWindows === true) {
                    M.toast({
                        html: 'Executing action "' + activeAction.name + '"... Open log window for details',
                        displayLength: 6000
                    });
                } else alepizAuditNamespace.openLogWindow();
            }

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


        // Function processing result, returned by action
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


    return {
        init: init,
        initActionBtn: initActionBtn,
        processIframeInputsData: processIframeInputsData,
    }

})(jQuery);