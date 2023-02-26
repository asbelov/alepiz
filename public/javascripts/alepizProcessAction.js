/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizProcessActionNamespace = (function($) {

    var bodyElm,
        runActionFloatingBtn,
        runActionBtn,
        makeTaskBtnElm,
        makeTaskFloatingBtnElm,
        iframeDOMElm;

    function init() {
        bodyElm = $("body");
        runActionFloatingBtn = $('#runActionFloatingBtn');
        runActionBtn = $('#runActionBtn');
        makeTaskBtnElm = $('#makeTaskBtn');
        makeTaskFloatingBtnElm = $('#makeTaskFloatingBtn');
        iframeDOMElm = document.getElementById('actionObject');

        // Floating Action Button (FAB) control make possible open and close FAB menu on mouse over and on click
        M.FloatingActionButton.init(runActionFloatingBtn[0], {
            hoverEnabled: true,
        });

        runActionBtn.click(processIframeInputsData);
        makeTaskBtnElm.click(processIframeInputsData);
        makeTaskFloatingBtnElm.click(processIframeInputsData);
    }

    function initActionBtn() {
        var activeAction = alepizActionsNamespace.getActiveActionConf();

        runActionFloatingBtn.addClass('hide');
        makeTaskBtnElm.addClass('hide');
        makeTaskFloatingBtnElm.addClass('hide');

        // show "run action" button
        if(activeAction.launcher && activeAction.rights.run) runActionFloatingBtn.removeClass('hide');

        // show one of "make task" buttons
        if(activeAction.launcher && activeAction.rights.makeTask) {
            if(activeAction.launcher && activeAction.rights.run) makeTaskBtnElm.removeClass('hide');
            else makeTaskFloatingBtnElm.removeClass('hide');
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

        // else run action
        var callbackBeforeExec = activeAction.callbackBeforeExec;
        // if callback function for action exist, then run callback at first and executing action
        // from callback function
        if (callbackBeforeExec) {
            try {
                iframeDOMElm.contentWindow[callbackBeforeExec](
                    function (err) {
                        if (err) return log.error(err.message);
                        return getInputDataAndExecServer(executionMode, dontOpenLogWindows);
                    }
                );
            }
            catch (err) {
                alepizMainNamespace.reload();
                console.error('Error running function "', callbackBeforeExec + '(..){....}": ', err.stack);
            }
            // without callback function for action executing action directly
        } else getInputDataAndExecServer(executionMode, dontOpenLogWindows);


        // execMode = 'server'|'makeTask'
        function getInputDataAndExecServer(execMode, dontOpenLogWindows) {
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

            var ajaxUrl = activeAction.link + '_' + alepizMainNamespace.getSessionID() + '/'+execMode;
            var timeout = Number(activeAction.timeout) * 1000;
            $("body").css("cursor", "progress");
            if(dontOpenLogWindows !== true) alepizAuditNamespace.openLogWindow();
            else {
                M.toast({
                    html: 'Executing action "' + activeAction.name + '"... Open log window for details',
                    displayLength: 6000
                });
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
                try {
                    iframeDOMElm.contentWindow[callbackAfterExec](returnedObj, function (err) {
                        if (err) return log.error(err.message);
                        reloadObjectsAndActionListsAfterActionExecution()
                    });
                    bodyElm.css("cursor", "auto");
                }
                catch (err) {
                    alepizMainNamespace.reload();
                    console.error('Error running callback on browser side after execution action.',
                        'Callback name is:', callbackAfterExec, '(data, callback):', err.message);
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