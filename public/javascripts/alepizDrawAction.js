/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var alepizDrawActionNamespace = (function($) {

    var iframeDOMElm,
        bodyElm;

    function init () {
        iframeDOMElm = document.getElementById('actionObject');
        bodyElm = $("body");
    }

    /*
getting HTML page for active action and show or hide runAction and makeTask buttons, according action user rights

callback(html), where html is a string with HTML page for active action
 */
    function getActionHTMLAndShowActionButtons(reqForUpdate, callback){
        bodyElm.css("cursor", "wait");
        $(iframeDOMElm.contentWindow).find('body').css("cursor", "wait");

        var activeAction = alepizActionsNamespace.getActiveActionsConf();
        // if not selected any action, return
        if(!activeAction){
            bodyElm.css("cursor", "auto");
            if(typeof callback === 'function') callback();
            return;
        }

        var activeActionLink = activeAction.link;
        // get action parameters
        var parametersFromURL = getParametersFromURL();
        var actionParameters = parametersFromURL.actionParameters;
        // for debugging
        //if(actionParameters.length) alert('Action parameters: ' + JSON.stringify(actionParameters));

        var objectNames = alepizObjectsNamespace.getSelectedObjectNames();

        // action: {html: ..., params: {...}}
        $.post(activeActionLink, {
            o: objectNames.join(','),
            actionUpdate: (reqForUpdate ? 1 : 0),
            p: JSON.stringify(actionParameters)
        }, function(action) {

            alepizProcessActionNamespace.initActionBtn();
            var sessionID = action.params.sessionID;
            alepizMainNamespace.setSessionID(sessionID);

            if(typeof callback === 'function') callback(action.html);
        });
    }

    function redrawIFrameDataOnChangeObjectsList() {

        var activeAction = alepizActionsNamespace.getActiveActionsConf();
        if(!activeAction) return drawAction();

        var activeActionLink = activeAction.link;
        var onChangeObjectMenuEvent = activeAction.onChangeObjectMenuEvent;
        if (!onChangeObjectMenuEvent || onChangeObjectMenuEvent.toLowerCase() === 'fullreload') {
            return getActionHTMLAndShowActionButtons(false, drawAction);
        }

        var selectedObjects = alepizObjectsNamespace.getSelectedObjects();

        // if no active action after redraw action list, draw empty action and return
        if(!activeActionLink) {
            drawAction();
            return;
        }
        // set parameters.objects value in iframe when change objects menu
        try {
            iframeDOMElm.contentWindow.parameters.objects = selectedObjects;
        } catch (err) {
            console.error('Can\'t add list of the selected objects to the action frame for',
                activeActionLink, 'html page in iframe:', err.message, ':', selectedObjects);
        }

        if (onChangeObjectMenuEvent.toLowerCase().indexOf('callback:') === 0) {
            var callbackName = onChangeObjectMenuEvent.substring(String('callback:').length);
            // try to run callback function in iframe when change objects menu
            try {
                iframeDOMElm.contentWindow[callbackName](
                    selectedObjects,
                    function (err) {
                        if (err) log.error(err.message);
                    }
                );
            } catch (err) {
                console.error('Can\'t running callback', callbackName,
                    '(type:', typeof iframeDOMElm.contentWindow[callbackName], ') from embedded HTML document',
                    activeActionLink ,
                    'after changing object list. Callback set into the action configuration file.', err.stack);
            }
        }
    }

    /*
    Draw HTML page in iframe element and init javaScript objects in iframe document
    html: string with HTML page for drawing
    */
    function drawAction(html) {

        var activeAction = alepizActionsNamespace.getActiveActionsConf();
        var activeActionLink = html && activeAction ? activeAction.link : 'action not selected';

        // stopping all executed setTimeout setInterval functions in the action frame
        if(iframeDOMElm.contentWindow) {
            try {
                var setTimeoutHighestTimeoutId = iframeDOMElm.contentWindow.setTimeout(';');
                var setIntervalHighestTimeoutId = iframeDOMElm.contentWindow.setInterval(';');

                for (var i = 0; i < setTimeoutHighestTimeoutId; i++) {
                    iframeDOMElm.contentWindow.clearTimeout(i);
                }
                for (i = 0; i < setIntervalHighestTimeoutId; i++) {
                    iframeDOMElm.contentWindow.clearInterval(i);
                }
                //console.log('All timeouts are clearing: ', setTimeoutHighestTimeoutId, setIntervalHighestTimeoutId);
            } catch(err) {
                console.error('Can\'t stop all executed setTimeout() and setInterval() functions in the action frame ' +
                    'for', activeActionLink, 'html page in iframe:', err.message);
            }
        }

        if(!html) {
            html = '<html lang="en-US"><body style="background:#cccccc">' +
                '<div style="text-align: center; position: relative; top: 50%; transform: translateY(-50%); font-family: sans-serif;">' +
                '<a href="#!" style="color: #ee6e73; text-decoration: none" onclick="showHelpWindow()">' +
                '<h4 onmouseover="this.style.textDecoration=\'underline\';" onmouseout="this.style.textDecoration=\'none\';">' +
                'For help click here</h4></a>' +
                '</div>' +
                '<script>' +
                '   function showHelpWindow(/*e*/) {\n' +
                '            //e.preventDefault();  // prevent default\n' +
                '            var helpWindowWidth = Math.floor(screen.width - screen.width / 3);\n' +
                '            var helpWindowsHeight = Math.floor(screen.height - screen.height / 3);\n' +
                '            var helpWindowLeft = (screen.width - helpWindowWidth) / 2;\n' +
                '            var helpWindowTop = (screen.height - helpWindowsHeight) / 2;\n' +
                '            window.open(\'/help/install.pug#bookmark4\', \'ALEPIZ help window\',\n' +
                '        \'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=\' +\n' +
                '                helpWindowWidth + \', height=\' + helpWindowsHeight + \', top=\' + helpWindowTop + \', left=\' + helpWindowLeft);\n' +
                '        }' +
                '</script>' +
                '</body></html>';
            alepizMainNamespace.setSessionID(undefined);
        }
        try {
            iframeDOMElm.contentWindow.document.open();
            iframeDOMElm.contentWindow.document.write(html);
            iframeDOMElm.contentWindow.document.close();
        } catch(err) {
            console.error('Can\'t create action ',activeActionLink, 'html page in iframe:', err.nessage);
        }

        // make possible to save action parameters into the URL from the action
        // function setActionParametersToBrowserURL(actionParameters)
        // actionParameters is array of [{key: <key1>, val:<val1>}, {..}, ...]
        try {
            iframeDOMElm.contentWindow.setActionParametersToBrowserURL = setActionParametersToBrowserURL;
        } catch (err) {
            console.error('Can\'t add setActionParametersToBrowserURL() function to', activeActionLink, ':', err.message)
        }

        // make possible to get action parameters from the URL for the action
        // function getActionParameters()
        // return action parameters as array [{key: <key1>, val:<val1>}, {..}, ...]
        try {
            iframeDOMElm.contentWindow.getActionParametersFromBrowserURL = function(callback) {
                getParametersFromURL(function(parametersFromURL) {
                    return callback(parametersFromURL.actionParameters);
                });
            };
        } catch (err) {
            console.error('Can\'t add getActionParametersFromBrowserURL() function to', activeActionLink, ':', err.message)
        }

        // add an event handler for catch the scroll action page event inside the iframe
        iframeDOMElm.onload = function() {
            try {
                if (iframeDOMElm.contentWindow && typeof iframeDOMElm.contentWindow.onScrollIframe === 'function') {
                    iframeDOMElm.contentDocument.addEventListener('scroll',
                        iframeDOMElm.contentWindow.onScrollIframe, false);
                }
            } catch(err) {
                console.error('Can\'t add event handler to onScrollIframe() function for catch the scroll action page ' +
                    'event inside the iframe to', activeActionLink, ':', err.message)
            }
            addCtrlEnterEventHandler();
        }

        try {
            iframeDOMElm.contentWindow.getActionConfig = function(callback) {
                $.post(activeActionLink, { func: 'getActionConfig' }, callback);
            }
        } catch (err) {
            console.error('Can\'t add getConfig() function to', activeActionLink, ':', err.message)
        }

        try {
            iframeDOMElm.contentWindow.setActionConfig = function(config, callback) {
                //console.log('set:', config)
                $.post(activeActionLink, {
                    func: 'setActionConfig',
                    config: typeof config === 'object' ? JSON.stringify(config) : config.toString()
                }, callback);
            }
        } catch (err) {
            console.error('Can\'t add setConfig() function to ', activeActionLink, ':', err.message)
        }

        iframeDOMElm.contentWindow.log = log;

        setTimeout(addCtrlEnterEventHandler, 60000);
        bodyElm.css("cursor", "auto");

        // run task on Ctrl + Enter
        function addCtrlEnterEventHandler() {
            try {
                var iframeContentWindowElm = $(iframeDOMElm.contentWindow);
                iframeContentWindowElm.unbind('keydown', keyDown).keydown(keyDown);
                iframeContentWindowElm.unbind('keypress', keyPressAndKeyUp).keypress(keyPressAndKeyUp);
                iframeContentWindowElm.unbind('keyUp', keyPressAndKeyUp).keyup(keyPressAndKeyUp);

                bodyElm.unbind('keydown', keyDown).keydown(keyDown);
                bodyElm.unbind('keypress', keyPressAndKeyUp).keypress(keyPressAndKeyUp);
                bodyElm.unbind('keyUp', keyPressAndKeyUp).keyup(keyPressAndKeyUp);
            } catch (err) {
                console.error('Can\'t add Ctrl+Enter event for run action for',
                    activeActionLink, 'html page in iframe:', err.message);
            }
        }

        function keyDown(e) {
            if (!activeAction.rights.run) return;
            if (e.keyCode === 13 && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                // true - don't open a log window
                alepizProcessActionNamespace.processIframeInputsData(true);
                return false;
            }
        }

        function keyPressAndKeyUp(e) { // prevent submit event generation
            if (!activeAction.rights.run) return;
            if (e.keyCode === 13 && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }

    return {
        init: init,
        drawAction: drawAction,
        getActionHTMLAndShowActionButtons: getActionHTMLAndShowActionButtons,
        redrawIFrameDataOnChangeObjectsList: redrawIFrameDataOnChangeObjectsList,
    }

})(jQuery)