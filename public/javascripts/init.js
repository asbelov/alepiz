/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 13.05.2017.
 */


var initJQueryNamespace = (function($){

    // run on document ready
    $(function() {
        // check for mobile device: if(isMobile) alert('This is mobile device!!!');
        isMobile = window.matchMedia("only screen and (max-width: 992px)").matches;

        initVariablesElm();
        initMaterializeElements();
        initEvents();
        initAuthorisationSystem();

        getParametersFromURL(function(parametersFromURL) {

            objectsInObjectsTab = objectsInAdditionalObjectsTab = {
                checked: parametersFromURL.checkedObjectsNames,
                checkedID: [],
                unchecked: parametersFromURL.uncheckedObjectsNames,
                uncheckedID: []
            };

            initObjectsFiltersTab();

            // for create top level objects list for additional objects list
            createFilteredObjectsList(null, function(){
                objectsInAdditionalObjectsTab = getObjectsFromObjectsList();

                initActionsAndObjectsListsFromBrowserURL(function() {
                    getActionHTMLAndShowActionButtons(false, drawAction);
                    objectsInObjectsTab = getObjectsFromObjectsList();

                    // redraw object list every 60 seconds
                    setInterval(function() {
                        // don't redraw object list when object list is not active
                        if(!getActiveObjectsList()) return;

                        getParametersFromURL(function (parametersFromURL) {
                            createObjectsList(parametersFromURL.uncheckedObjectsNames, parametersFromURL.checkedObjectsNames);
                        });

                        //var objectsNames = getObjectsFromObjectsList();
                        //createObjectsList(objectsNames.unchecked, objectsNames.checked);
                    }, 60000);
                });
            });
        });
    }); // end of document ready

    // global variables definition
    var isMobile, // if device is a mobile device, then true, else false. Init in document ready function $(function() {}) above

        // when recreate actions list, check for new HTML with actions list is equal to the previous HTML with actions list,
        // which saved into this variable. If both HTMLs are equal, then don't redraw actions list
        prevActionsListHTML,

        // Save checked objects names when click on object for redraw objects list after action execution
        prevCheckedObjectsNames = [],

        // if autocomplete function in actions search element is running now, this variable set to true, else set to false
        // it's needed for prevent multiple start autocomplete function
        isAutoCompleteRunning,

        // Maximum number of characters in URL
        // http://www.example.com/?property=value&property2=value return "property=value&property2=value" without "?"
        /*
        Browser     Address bar   document.location
                                  or anchor tag
        ------------------------------------------
        Chrome          32779           >64k
        Android          8192           >64k
        Firefox          >64k           >64k
        Safari           >64k           >64k
        IE11             2047           5120
        Edge 16          2047          10240

        URL Length (https://chromium.googlesource.com/chromium/src/+/master/docs/security/url_display_guidelines/url_display_guidelines.md)
        In general, the web platform does not have limits on the length of URLs (although 2^31 is a common limit).
        Chrome limits URLs to a maximum length of 2MB for practical reasons and to avoid causing denial-of-service problems in inter-process communication.
        On most platforms, Chrome’s omnibox limits URL display to 32kB (kMaxURLDisplayChars) although a 1kB limit is used on VR platforms.
        Ensure that the client behaves reasonably if the length of the URL exceeds any limits:
        Origin information appears at the start of the URL, so truncating the end is typically harmless.
        Rendering a URL as an empty string in edge cases is not ideal, but truncating poorly
        (or crashing unexpectedly and insecurely) could be worse.
        Attackers may use long URLs to abuse other parts of the system.
        DNS syntax limits fully-qualified hostnames to 253 characters and each label in the hostname to 63 characters,
        but Chromium's GURL class does not enforce this limit.
         */

        // is you want to change this parameter, change also lib/installService.js --max-http-header-size=32767 and your
        // service parameter
        maxUrlLength = 32767, // was 2083

        /*
         {
         checked: [objectName1, objectName2, ...],
         unchecked: [objectName3, objectName4, ...]
         }
         */
        objectsInObjectsTab,
        searchValForObjectsTab = '',
        objectsInAdditionalObjectsTab,
        searchValForAdditionalObjectsTab = '',
        additionalObjectsTabName = 'OBJECTS',

        // JQuery HTML DOM elements will defined at initVariablesElm() function
        bodyElm,
        logBodyElm,
        logLastUpdateElm,
        modalLogWindowsInstance,
        modalLogMessageElm,
        modalLogHeaderElm,
        loginBtnElm,
        objectsTabSwitchElm,
        additionalObjectsTabSwitchElm,
        actionsTabSwitchElm,
        filterTabSwitchElm,
        filterExpressionEditorElm,

        selectAllObjBtnElm,
        walletBtnElm,
        searchObjectsElm,
        searchActionsElm,
        searchActionsAutocompleteInstance,
        useGlobalSearch = false,
        minSearchStrLength = 2,
        prevSearchStrLength = 0,
        timeWhenNoObjectsWereFound = 0,

        runActionBtnElm,
        makeTaskBtnElm,

        objectsListElm,
        actionsListElm,

        actionsTooltipInstances,
        objectsTooltipInstances,
        filterTooltipInstances,
        sideNavInstance,
        modalLoginInstance,
        modalLogInstance,
        modalChangeObjectsFilterInstance,

        iframeDOMElm,

        sessionID,
        sessionsIDs = {},

        URL = '';

    var entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };

    function escapeHtml (string) {
        return String(string).replace(/[&<>"'`=\/]/g, function (s) {
            return entityMap[s];
        });
    }

    // set variables to JQuery HTML DOM elements
    function initVariablesElm() {
        bodyElm = $("body");
        logBodyElm = $('#collapsible-log-body');
        logLastUpdateElm = $('#last-update');
        modalLogMessageElm = $('#modalLogMessage');
        modalLogHeaderElm = $('#modalLogHeader');

        loginBtnElm = $('#loginBtn');

        objectsTabSwitchElm = $('#objectsTabSwitch');
        additionalObjectsTabSwitchElm = $('#additionalObjectsTabSwitch');
        actionsTabSwitchElm = $('#actionsTabSwitch');
        filterTabSwitchElm = $('#filterTabSwitch');
        filterExpressionEditorElm = $('#filterExpressionEditor');

        selectAllObjBtnElm = $('#selectAllObjBtn');
        walletBtnElm = $('#walletBtn');
        searchObjectsElm = $('#searchObjects');
        searchActionsElm = $('#searchActions');

        runActionBtnElm = $('#runActionBtn');
        makeTaskBtnElm = $('#makeTaskBtn');

        objectsListElm = $('#objectsList');
        actionsListElm = $('#actionsList');

        iframeDOMElm = document.getElementById('actionObject');
    }

    /*
        Initialising all Materialize JavaScript elements when rendering page
     */
    function initMaterializeElements(){
        // fix error, when overlay hide part of sideNav menu on mobile devices with a small width screens
        $('.button-collapse').click(function() {
            sideNavInstance.open();
            setTimeout(function(){ $('.drag-target').css({width: '30%'}); }, 50);
        });

        sideNavInstance = M.Sidenav.init(document.getElementById('slide-out'), {
            //menuWidth: 400, // Default is 300
            edge: 'left', // Choose the horizontal origin
            closeOnClick: false, // Closes side-nav on <a> clicks, useful for Angular/Meteor
            draggable: true // Choose whether you can drag to open on touch screens
        });

        modalLoginInstance = M.Modal.init(document.getElementById('modal-login'), {
            onOpenStart: function () {
                $('#changePasswordForm').addClass('hide');
                $('#newUserPass1').val('');
                $('#newUserPass2').val('');
            }
        });

        modalLogInstance = M.Modal.init(document.getElementById('modal-log'), {});

        modalLogWindowsInstance = M.Modal.init(document.getElementById('modal-log-window'), {
            onCloseEnd: stoppingRetrievingLog
        });

        modalChangeObjectsFilterInstance = M.Modal.init(document.getElementById('modal-change-objects-filter-expr'), {});

        M.Tabs.init(document.getElementById('tabs'), {});
        M.Collapsible.init(document.querySelectorAll('.collapsible'), {});

        /*
        Floating Action Button (FAB) control make possible open and close FAB menu on mouse over and on click
         */
        var actionBtnElm = $('#actionButton');
        var actionBtnInstance = M.FloatingActionButton.init(actionBtnElm[0], {
            hoverEnabled: false,
        });
        actionBtnElm.mouseover(function () {
            if(!actionBtnInstance.isOpen) actionBtnInstance.open();
        });
        actionBtnElm.mouseleave(function () {
            if(actionBtnInstance.isOpen) actionBtnInstance.close();
        });
        actionBtnElm.click(function () {
            if(!isMobile) {
                if (objectsTabSwitchElm.hasClass('active')) searchObjectsElm.focus();
                else searchActionsElm.focus();
            }
        });

        searchActionsElm.keydown(function (e) {
            if (e.keyCode === 13) return false;
        });

        if(!isMobile) searchActionsElm.focus();

        $('#searchTip').click(function (e) {
            e.preventDefault(); // prevent default
            M.toast({html:
                'Searching for actions is very simple. Start typing part of the action name for a hint<br/>' +
                'The search from objects is first performed among the objects that appear in the object list. If nothing is found, then we search among all the objects in the database<br/>' +
                '\"*\" wildcard matches any sequence of zero or more characters.<br/>' +
                '"_" wildcard matches any single character.<br/>' +
                '"|" used as logical OR.<br/>' +
                '"&" or new line used as logical AND.<br/>' +
                '"\\" - escape character for "*" and "_"', displayLength: 10000});
        });
    }

    /*
    return
    0 if active action tab switch
    1 if active objects list tab switch
    2 if active additional objects list tab switch
     */
    function getActiveObjectsList(){
        if(objectsTabSwitchElm.hasClass('active')) return 1;
        if(additionalObjectsTabSwitchElm.hasClass('active')) return 2;

        return 0;
    }

    function initObjectsList() {
        if(getActiveObjectsList() === 2) objectsInAdditionalObjectsTab = getObjectsFromObjectsList();

        searchValForAdditionalObjectsTab = searchObjectsElm.val();
        searchObjectsElm.val(searchValForObjectsTab);

        createObjectsList(objectsInObjectsTab.unchecked, objectsInObjectsTab.checked);

        objectsTabSwitchElm.text('').text('TO TOP');
        additionalObjectsTabSwitchElm.text(additionalObjectsTabName);
        searchActionsElm.addClass('hide');
        searchObjectsElm.removeClass('hide');
        if(!isMobile) searchObjectsElm.focus();
        walletBtnElm.removeClass('hide');
        selectAllObjBtnElm.removeClass('hide');
    }

    function getCheckedFilterNames() {
        return $('input[data-object-filter]:checked').map(function() {
            return $(this).attr('data-object-filter');
        }).get();
    }

    function getFilterExpression() {
        var expressionElms = filterExpressionEditorElm.find('div.chip[data-object-filter-expr-item]');
        if(!expressionElms.length) return '';

        var expression = expressionElms.map(function () {
            var exprItem = $(this).text();

            if (exprItem === 'AND') exprItem = ' && ';
            else if (exprItem === 'OR') exprItem = ' || ';
            else if (exprItem !== '(' && exprItem !== ')') exprItem = '%:' + exprItem + ':%';

            return exprItem;
        }).get();

        return expression.join('');
    }

    function initObjectsFiltersTab() {
        var objectsFilterElm = $('#objectsFilter');
        // filterNames: [{name:..., description:...}, {}...]
        $.post('/mainMenu', {f: 'getObjectsFilterNames'}, function(filterNames) {
            if(!filterNames || !filterNames.length) {
                objectsFilterElm.empty();
                filterTabSwitchElm.parent().addClass('hide');
                return;
            }

            filterTabSwitchElm.parent().removeClass('hide');
            objectsTabSwitchElm.text('OBJECTS');
            var checkedFilterNames = getCheckedFilterNames();

            var htmlTail = '<li id="changeFilterExpression" class="hide">' +
                '<a class="row object">' +
                    '<div class="col s11 truncate object-label blue-text right-align" ' +
                        'style="text-decoration: underline">Change filter expression</div>' +
                '</a></li>'

            var html = filterNames.map(function (filterObj) {
                var filterName = filterObj.name;
                var filterDescription = filterObj.description || '';
                var checked = checkedFilterNames.indexOf(filterName) === -1 ? '' : ' checked'
                return '<li data-object-filter-li>' +
                    '<a class="tooltipped row object" data-object-filter-list data-position="right" data-tooltip="' + filterDescription +'">' +
                    '<div class="col s1 object-checkbox">' +
                        '<label>' +
                            '<input type="checkbox" data-object-filter="' + filterName + '"' + checked +'/>' +
                            '<span></span>' +
                        '</label>' +
                    '</div>' +
                    '<div class="col s11 truncate object-label" data-object-filter-label>' + filterName +'</div>' +
                '</a></li>';
            }).join('\n');


            // remove old tooltips
            if(filterTooltipInstances && filterTooltipInstances.length) {
                filterTooltipInstances.forEach(function (instance) {
                    instance.destroy();
                });
            }
            $('div.material-tooltip').remove();

            objectsFilterElm.html(html + htmlTail);

            filterTooltipInstances = M.Tooltip.init(document.querySelectorAll('a[data-object-filter-list]'), {
                enterDelay: 500
            });

            var changeFilterExpressionElm = $('#changeFilterExpression');
            if(getCheckedFilterNames().length > 1) changeFilterExpressionElm.removeClass('hide');
            else changeFilterExpressionElm.addClass('hide');

            // change checked state of checkbox when click to the div with label
            $('div[data-object-filter-label]').click(function () {
                var checkBoxElm = $(this).parent().find('input[data-object-filter]');
                checkBoxElm.prop('checked', !checkBoxElm.is(':checked'));
            });

            // show or hide "Change filter expression" button
            $('li[data-object-filter-li]').click(function () {
                var filterNames = getCheckedFilterNames();
                if(filterNames.length) filterTabSwitchElm.addClass('red lighten-4');
                else filterTabSwitchElm.removeClass('red lighten-4');
                if(filterNames.length > 1) changeFilterExpressionElm.removeClass('hide');
                else changeFilterExpressionElm.addClass('hide');

                createObjectFilterExpressionForEditor(filterNames);
            });

            changeFilterExpressionElm.click(function () {
                modalChangeObjectsFilterInstance.open();
            });
        });
    }

    function createObjectFilterExpressionForEditor(filterNames) {

        if(!filterNames) return filterExpressionEditorElm.empty();
        var html = filterNames.map(filterName => {
            return '<div class="chip" data-filter-name data-object-filter-expr-item style="cursor: pointer">' + filterName + '</div>';
        }).join('<div class="chip" data-filter-operator data-object-filter-expr-item style="cursor: pointer">AND</div>');

        filterExpressionEditorElm.html(html);

        $('div[data-filter-operator]').click(function() {
            if($(this).text() === 'AND') $(this).text('OR');
            else $(this).text('AND');
        });


    }

    // init events
    function initEvents() {

        // A popstate event is dispatched to the window each time the active history entry changes between two history entries for the same document
        window.onpopstate = function() {
            URL = window.location.search.substring(1);
            initActionsAndObjectsListsFromBrowserURL(redrawIFrameDataOnChangeObjectsList)
        };

        runActionBtnElm.click(processIframeInputsData);
        makeTaskBtnElm.click(processIframeInputsData);

        $('#logWindowBtn').click(openLogWindow);

        objectsTabSwitchElm.click(function(){
            if($(this).hasClass('active')) { // if pressed "to top"
                // go to the top
                createFilteredObjectsList(null, function() {
                    setBrowserHistory();
                    redrawIFrameDataOnChangeObjectsList();
                });
                searchObjectsElm.val('');
            } else initObjectsList();
            //clearAdditionalObjectListInActionParameter();
        });

        additionalObjectsTabSwitchElm.click(function(){
            if($(this).hasClass('active')) { // if pressed "to top"
                // go to the top
                createFilteredObjectsList(null, redrawIFrameDataOnChangeAdditionalObjectsList);
                searchObjectsElm.val('');
            } else {
                if(getActiveObjectsList() === 1) objectsInObjectsTab = getObjectsFromObjectsList();

                searchValForObjectsTab = searchObjectsElm.val();
                searchObjectsElm.val(searchValForAdditionalObjectsTab);

                createObjectsList(objectsInAdditionalObjectsTab.unchecked, objectsInAdditionalObjectsTab.checked, redrawIFrameDataOnChangeAdditionalObjectsList);

                $(this).text('').text('TO TOP');
                objectsTabSwitchElm.text('OBJECTS');
                searchActionsElm.addClass('hide');
                searchObjectsElm.removeClass('hide');
                if(!isMobile) searchObjectsElm.focus();
                walletBtnElm.removeClass('hide');
                selectAllObjBtnElm.removeClass('hide');
            }
        });

        actionsTabSwitchElm.click(function() {
            if(getActiveObjectsList() === 1) {
                objectsInObjectsTab = getObjectsFromObjectsList();
                searchValForObjectsTab = searchObjectsElm.val();
            }
            else if(getActiveObjectsList() === 2) {
                objectsInAdditionalObjectsTab = getObjectsFromObjectsList();
                searchValForAdditionalObjectsTab = searchObjectsElm.val();
            }

            objectsTabSwitchElm.text('OBJECTS');
            additionalObjectsTabSwitchElm.text(additionalObjectsTabName);
            if(!actionsTabSwitchElm.hasClass('active')){

                searchObjectsElm.addClass('hide');
                searchActionsElm.removeClass('hide');
                if(!isMobile) searchActionsElm.focus();
                walletBtnElm.addClass('hide');
                selectAllObjBtnElm.addClass('hide');

                createActionsList();
            }
            // recreate action menu if it changed
            //createActionsMenu(null, null, true);
        });

        filterTabSwitchElm.click(initObjectsFiltersTab);

        // Search objects when enter something in search string
        searchObjectsElm.keyup(function(e){
            // When pressing Esc, clear search field ang go to the top of the object list
            if(e.which === 27) { // Esc pressed in search string
                // if not empty, make it empty
                searchObjectsElm.val('');
                $('ul#objectsList').find('li').removeClass('hide');
                useGlobalSearch = false;
            } else searchObjects();
        });

        // help button click
        $('#helpBtn').click(function (e) {
            e.preventDefault();  // prevent default

            var activeActionLink = $('li[action_link].active').attr('action_link');

            var helpWindowWidth = Math.floor(screen.width - screen.width / 3);
            var helpWindowsHeight = Math.floor(screen.height - screen.height / 3);
            var helpWindowLeft = (screen.width - helpWindowWidth) / 2;
            var helpWindowTop = (screen.height - helpWindowsHeight) / 2;
            var url = activeActionLink ? (activeActionLink + '/help/') : '/help/contents.pug';
            window.open(url, 'ALEPIZ help window',
        'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=' +
                helpWindowWidth + ', height=' + helpWindowsHeight + ', top=' + helpWindowTop + ', left=' + helpWindowLeft);
        });

        // reload button click
        $('#reloadBtn').click(reload);

        $('#selectAllObjBtn').click(function(){
            if(!$(this).attr('allChecked')) {
                // I don't know why, but it's does not work
                //$('li:not(.hide) :input[objectName]').prop('checked', true);
                $('input[objectName]').each(function () {
                    if(!$(this).parent().parent().parent().parent().hasClass('hide')) {
                        $(this).prop('checked', true);
                    }
                });
                $(this).attr('allChecked', '1');
                $(this).addClass('grey');
                redrawIFrameDataOnChangeObjectsList();
                setBrowserHistory();
            } else {
                // I don't know why, but it's does not work
                //$('li:not(.hide) :input[objectName]').prop('checked', false);
                $('input[objectName]').each(function () {
                    if(!$(this).parent().parent().parent().parent().hasClass('hide')) {
                        $(this).prop('checked', false);
                    }
                });
                $(this).attr('allChecked', '');
                $(this).removeClass('grey');
                redrawIFrameDataOnChangeObjectsList();
                setBrowserHistory();
            }
        });


        // not an array for remove equals objects
        var walletObjectsList = {};
        // wallet button click event processor
        walletBtnElm.click(function(){

            // create list of checked objects checkbox elements
            var checkedObjects = $('input[objectName]:checked');

            // if any of objects is checked, create array on checked object names
            if(checkedObjects.length) {
                $(this).addClass('grey');
                checkedObjects.each(function() {
                    walletObjectsList[Number($(this).attr('id'))] = $(this).attr('objectName');
                });
            } else {
                // create new objects list
                var objectsNames = Object.values(walletObjectsList);
                if(objectsNames.length){
                    // create objects list with all selected objects
                    createObjectsList(null, objectsNames, setBrowserHistory);
                    walletObjectsList = {};
                }
                $(this).removeClass('grey');

                prevCheckedObjectsNames = [];
            }
        });


        // When pressing Esc, clear search actions field
        searchActionsElm.keyup(function(e){
            if(e.which === 27) {
                $(this).val('');
                return;
            }

            // when nothing found in actions switch to objects tab and try to search objects
            var val = searchActionsElm.val();
            if(searchActionsAutocompleteInstance && val.length > searchActionsAutocompleteInstance.options.minLength + 1 &&
                !searchActionsAutocompleteInstance.count) {
                $(this).val('');
                var tabInstance = M.Tabs.getInstance(document.getElementById('tabs'));
                tabInstance.select('objectsList');
                initObjectsList();
                searchObjectsElm.val(val);
                prevSearchStrLength = val.length;
                useGlobalSearch = true;
                searchObjectsElm.trigger('keyup');
                objectsTabSwitchElm.addClass('active');
                redrawTabsIndicatorElm();
            }
        });
    }

    function reload() {
        initActionsAndObjectsListsFromBrowserURL(function() {
            getActionHTMLAndShowActionButtons(true, function(html){
                drawAction(html);
                setTimeout(redrawIFrameDataOnChangeObjectsList, 300);
            });
        });
    }

    function searchObjects(objects, callback) {
        if(objects) drawObjectsList(objects);

        var searchStr = searchObjectsElm.val();
        // do this before starting local search
        if(searchStr.length < minSearchStrLength) useGlobalSearch = false;

        if (searchStr.length && !useGlobalSearch) {
            // try to find search string in names of current objects and filter its
            var elementsWithSearchStrCount = 0;
            var rows = $('ul#objectsList').find('li').addClass('hide');
            rows.find("input[objectName]").each(function(index, elm) {
                if($(elm).attr('objectname').toUpperCase().indexOf(searchStr.toUpperCase()) !== -1) {
                    $(elm).closest('li').removeClass('hide');
                    ++elementsWithSearchStrCount;
                }
                if( $(elm).is(':checked')) $(elm).closest('li').removeClass('hide');
            });

            if(elementsWithSearchStrCount) {
                prevSearchStrLength = searchStr.length;
                if(typeof callback === 'function') callback();
                return;
            }
            if(prevSearchStrLength) {
                if(searchStr.length > prevSearchStrLength+1) prevSearchStrLength = 0;
                if(typeof callback === 'function') callback();
                return;
            }
            rows.removeClass('hide');
        }
        // begin global search only after print 2 characters
        if(searchStr.length < minSearchStrLength) {
            if(typeof callback === 'function') callback();
            return;
        }

        prevSearchStrLength = 0;
        useGlobalSearch = true;

        // if active tab for objects
        // replace new string to "+"
        // set first object to @search for correct search request processing in createFilterMenu
        $.post('/mainMenu', {
            f: 'searchObjects',
            searchStr: searchStr.replace(/[\r\n]+/g, '|'),
            filterNames: getCheckedFilterNames().join(','),
            filterExpression: getFilterExpression(),
        }, function(objects) {
            // objects: [{name: objectName1, description: objectDescription1, id: objectID1, color: <color>:<shade>, disabled: <1|0>},...]
            prevCheckedObjectsNames = [];

            if((!objects || !objects.length) && Date.now() - timeWhenNoObjectsWereFound > 4000) {
                timeWhenNoObjectsWereFound = Date.now();
                M.toast({html: 'No objects found or too many objects found', displayLength: 3000});
            }
            drawObjectsList(objects, setBrowserHistory);
            if(typeof callback === 'function') callback();
        });
    }

    // init objects list and action list from browser URL
    // callback(actionParameters), actionParameters: [{key: <key1>, val:<val1>}, {..}, ...]
    function initActionsAndObjectsListsFromBrowserURL(callback) {
        getParametersFromURL(function (parametersFromURL) {
            if(getActiveObjectsList() === 2) objectsInAdditionalObjectsTab = getObjectsFromObjectsList();
            createObjectsList(parametersFromURL.uncheckedObjectsNames, parametersFromURL.checkedObjectsNames, function() {
                createActionsList(parametersFromURL.activeActionLink, function(){

                    var activeActionLink = $('li[action_link].active').attr('action_link');
                    if(getActiveObjectsList() === 2) {
                        if(activeActionLink) {
                            createObjectsList(objectsInAdditionalObjectsTab.unchecked, objectsInAdditionalObjectsTab.checked, function () {
                                if (typeof callback === 'function') callback(parametersFromURL.actionParameters);
                            });
                            return;
                        }
                    }

                    if(!activeActionLink && !additionalObjectsTabSwitchElm.parent().hasClass('hide')) {
                        additionalObjectsTabSwitchElm.parent().addClass('hide');

                        // redraw tabs (was trigger)
                        redrawTabsIndicatorElm();
                    }

                    if(typeof callback === 'function') callback(parametersFromURL.actionParameters);
                });
            });
        });
    }

    function redrawTabsIndicatorElm() {
        var indicatorElm = $('li.indicator');

        if(getActiveObjectsList() === 1) {
            moveToRight();
            setTimeout(moveToRight, 500);
        } else {
            moveToLeft();
            setTimeout(moveToLeft, 500);
        }

        function moveToLeft() {
            indicatorElm.css('left', '0px').css('right', Math.round(objectsTabSwitchElm.width()) + 42);
        }

        function moveToRight() {
            indicatorElm.css('left', Math.round(actionsTabSwitchElm.width()) + 24).css('right', '0px');
        }

    }

    // setParametersToUrl - for simple search this function
    function setBrowserHistory() {

        setDocumentTitle();
        //if(getActiveObjectsList() === 2) return;

        var activeActionLink = $('li[action_link].active').attr('action_link');
        if(!activeActionLink) activeActionLink = '';

        // get parameters from URL
        // parametersFromURL.checkedObjectsNames = [name1, name2,..]; parametersFromURL.uncheckedObjectsNames = [name1, name2, ...];
        // parametersFromURL.activeActionLink = /action/link; parametersFromURL.actionParameters = [{key:.., val:..,}, {}, ...]
        getParametersFromURL(function (parametersFromURL) {
            // get checked and unchecked objects names form objects list elements or saved object list,
            // if additional objects tab is active
            // objectsNames.checked = [name1, name2, ...]; objectsNames.unchecked = [name1, name2, ..]
            if(getActiveObjectsList() === 1) var objectsNames = getObjectsFromObjectsList();
            else objectsNames = objectsInObjectsTab;

            // compare objects names in URL and from object list
            var objectListIsDifferent = false;
            if(objectsNames.checked.length + objectsNames.unchecked.length ===
                parametersFromURL.checkedObjectsNames.length + parametersFromURL.uncheckedObjectsNames.length) {

                var names = [], namesFromURL = [];
                Array.prototype.push.apply(names, objectsNames.checked);
                Array.prototype.push.apply(names, objectsNames.unchecked);
                Array.prototype.push.apply(namesFromURL, parametersFromURL.checkedObjectsNames);
                Array.prototype.push.apply(namesFromURL, parametersFromURL.uncheckedObjectsNames);

                for(var i = 0; i < names.length; i++) {
                    if(namesFromURL.indexOf(names[i]) === -1) {
                        objectListIsDifferent = true;
                        break;
                    }
                }
            } else objectListIsDifferent = true;

            var parameters = [];
            if(activeActionLink) {
                if(parametersFromURL.activeActionLink  === activeActionLink) {
                    // add action parameters
                    parameters = parametersFromURL.actionParameters.map(function(prm) {
                        return encodeURIComponent(prm.key) + '=' + encodeURIComponent(prm.val);
                    });
                }
                parameters.push('a='+encodeURIComponent(activeActionLink))
            }

            // use array because we don't known about existence of each URL parameter and if we concat strings
            // we can get strange result f.e.'http://localhost:3000/?&a=%2Factions%2Fobjects_creator&u=Servers%2CSystem%20objects'
            var URLArray = [];
            Array.prototype.push.apply(URLArray, parameters); // copy parameters array to URLArray
            if(objectsNames.unchecked.length) URLArray.push('u='+encodeURIComponent(objectsNames.unchecked.join(',')));
            if(objectsNames.checked.length) URLArray.push('c='+encodeURIComponent(objectsNames.checked.join(',')));

            URL = (URLArray.length ? URLArray.join('&') : '');

            // if length of URL more then some browsers are support, make URL from prev checked objects
            if(prevCheckedObjectsNames.length && document.title.length + URL.length > maxUrlLength) {
                URLArray = [];
                Array.prototype.push.apply(URLArray, parameters); // copy parameters array to URLArray
                URLArray.push('p='+encodeURIComponent(prevCheckedObjectsNames.join(',')));
                if(objectsNames.unchecked.length < objectsNames.checked.length) {
                    URLArray.push('u='+encodeURIComponent(objectsNames.unchecked.join(',')));
                } else if(objectsNames.checked.length) URLArray.push('c='+encodeURIComponent(objectsNames.checked.join(',')));
                URL = (URLArray.length ? URLArray.join('&') : '');

                // if length of URL again more then some browsers are support, make URL from prev checked objects
                if(document.title.length + URL.length > maxUrlLength) {
                    URLArray = [];
                    Array.prototype.push.apply(URLArray, parameters); // copy parameters array to URLArray
                    URLArray.push('p=' + encodeURIComponent(prevCheckedObjectsNames.join(',')));
                    URL = (URLArray.length ? URLArray.join('&') : '');
                }
            }

            if(document.title.length + URL.length >= maxUrlLength) {
                console.log('URL length more then ',  maxUrlLength, ': ', document.title + '?' + URL);
            }
            // replace last record in history if action and list of objects are not changed.
            // may be change only checked and unchecked objects in the list
            //if(!objectListIsDifferent && parametersFromURL.activeActionLink  === activeActionLink) {
            if(!objectListIsDifferent) {
                window.history.replaceState(null, document.title, '?' + (document.title.length + URL.length < maxUrlLength ? URL : window.location.search.substring(1)));
            } else {
                window.history.pushState(null, document.title, '?' + (document.title.length + URL.length < maxUrlLength ? URL : window.location.search.substring(1)));
            }
        });
    }

    /*
    Getting list of checked and unchecked objects names from objects list

    return {
        checked: [objectName1, objectName2, ...],
        unchecked: [objectName3, objectName4, ...],
        checkedID: [id1. id2, ...],
        uncheckedID: [id3, id4, ...]
    }
     */
    function getObjectsFromObjectsList() {
        var objectsNames = {
            checked: [],
            unchecked: [],
            checkedID: [],
            uncheckedID: []
        };

        $('input[objectName]').each(function() {
            var objectName = $(this).attr('objectName');
            var objectID = Number($(this).attr('id'));

            if($(this).is(':checked')) {
                objectsNames.checked.push(objectName);
                objectsNames.checkedID.push(objectID);
            }
            else {
                objectsNames.unchecked.push(objectName);
                objectsNames.uncheckedID.push(objectID);
            }
        });
        return objectsNames;
    }

    /*
    Set action parameters to the URL

    actionParameters: [{key: <key1>, val:<val1>}, {..}, ...]
     */

    function setActionParametersToBrowserURL(actionParameters) {
        if(!actionParameters || !$.isArray(actionParameters) || !actionParameters.length) return;
        actionParameters = actionParameters.filter(function(prm) {
            return ($.isPlainObject(prm) && prm.key && prm.key.toLowerCase() !== 'p' &&
                prm.key.toLowerCase() !== 'u' && prm.key.toLowerCase() !== 'c' && prm.key.toLowerCase() !== 'a');
        }).map(function(prm) {
            if(prm.val === undefined) prm.val = '';
            return (encodeURIComponent(prm.key) + '=' + encodeURIComponent(prm.val))
        });

        getParametersFromURL(function (parametersFromURL) {
            if(parametersFromURL.activeActionLink) {
                actionParameters.unshift('a='+encodeURIComponent(parametersFromURL.activeActionLink));
            }

            var parameters = [];
            if (parametersFromURL.uncheckedObjectsNames.length) {
                parameters.push('u=' + encodeURIComponent(parametersFromURL.uncheckedObjectsNames.join(',')));
            }
            if (parametersFromURL.checkedObjectsNames.length) {
                parameters.push('c=' + encodeURIComponent(parametersFromURL.checkedObjectsNames.join(',')));
            }

            if(document.title.length + parameters.join('&').length + actionParameters.join('&').length + 2 >= maxUrlLength &&
                (prevCheckedObjectsNames.length || parametersFromURL.parentObjectNames.length)) {

                parameters = [];
                if(prevCheckedObjectsNames.length) {
                    parameters.push('p=' + encodeURIComponent(prevCheckedObjectsNames.join(',')));
                } else {
                    parameters.push('p=' + encodeURIComponent(parametersFromURL.parentObjectNames.join(',')));
                }
                if(parametersFromURL.uncheckedObjectsNames.length < parametersFromURL.checkedObjectsNames.length) {
                    parameters.push('u=' + encodeURIComponent(parametersFromURL.uncheckedObjectsNames.join(',')));
                } else if (parametersFromURL.checkedObjectsNames.length) {
                    actionParameters.push('c=' + encodeURIComponent(parametersFromURL.checkedObjectsNames.join(',')));
                }
            }

            Array.prototype.push.apply(parameters, actionParameters);

            // checking for changes in parameter string
            if(parameters.join('&') === parametersFromURL) return;

            URL = parameters.join('&');
            if(document.title.length + URL.length >= maxUrlLength) {
                console.log('Can\'t save action parameters to URL: parameters length more then ',  maxUrlLength, '. ',
                    document.title + '?' + URL);
            }
            window.history.pushState(null, document.title, '?' + (document.title.length + URL.length < maxUrlLength ? URL : window.location.search.substring(1)));
        });
    }

    /*
    Getting parameters from URL

    return {
        checkedObjectsNames: array of checked objects names in objects list [name1, name2, ...]
        uncheckedObjectsNames: array of unchecked objects names in objects list [name3, name4, ...]
        activeActionLink: active action link "/action/link"
        actionParameters: array of action parameters [{key: <key1>, val: <val1>}, {..}, ...]
     }
     */
    function getParametersFromURL(callback) {
        // get action parameters from URL
        // http://www.example.com/?property=value&property2=value return "property=value&property2=value" without "?"
        /*
        Browser     Address bar   document.location
                                  or anchor tag
        ------------------------------------------
        Chrome          32779           >64k
        Android          8192           >64k
        Firefox          >64k           >64k
        Safari           >64k           >64k
        IE11             2047           5120
        Edge 16          2047          10240
         */
        var query = URL.length > maxUrlLength ? URL : window.location.search.substring(1);

        var actionParameters = [], uncheckedObjectsNames = [], checkedObjectsNames = [], activeActionLink = '',
            upLevelCheckedObjects = [];

        if (query) {
            query.split('&').forEach(function (parameter) {
                var pair = parameter.split('=');
                var key = decodeURIComponent(pair[0]);
                var val = pair[1] ? decodeURIComponent(pair[1]) : '';

                if (key === 'u') uncheckedObjectsNames = val.replace(/\s*,\s*/g, ',').split(',');
                else if (key === 'c') checkedObjectsNames = val.replace(/\s*,\s*/g, ',').split(',');
                else if (key === 'a') activeActionLink = val;
                else if (key === 'p') upLevelCheckedObjects = val.replace(/\s*,\s*/g, ',').split(',');
                else actionParameters.push({
                        key: key,
                        val: val
                    });
            });
        }

        if(typeof callback !== 'function') {
            return {
                activeActionLink: activeActionLink,
                actionParameters: actionParameters
            };
        }

        if (!upLevelCheckedObjects.length)
            return callback({
                checkedObjectsNames: checkedObjectsNames,
                uncheckedObjectsNames: uncheckedObjectsNames,
                activeActionLink: activeActionLink,
                actionParameters: actionParameters,
                parentObjectNames: upLevelCheckedObjects,
            });

        var objectsNamesStr = upLevelCheckedObjects.join(',');

        $.post('/mainMenu', {
            f: 'filterObjectsByInteractions',
            name: objectsNamesStr,
            filterNames: getCheckedFilterNames().join(','),
            filterExpression: getFilterExpression(),
        }, function (objects) {
            // objects: [{name: objectName1, description: objectDescription1, id: objectID1, color: <color>:<shade>, disabled: <1|0>},...]
            if (!objects || !objects.length) {
                if(objectsNamesStr) {
                    M.toast({html: 'No interactions detected with other objects for : ' +
                            objectsNamesStr, displayLength: 5000});
                }
            } else {
                if(!uncheckedObjectsNames.length || checkedObjectsNames.length) {
                    uncheckedObjectsNames = objects.filter(function (object) {
                        return checkedObjectsNames.indexOf(object.name) === -1;
                    }).map(function (object) {
                        return object.name;
                    })
                } else {
                    checkedObjectsNames = objects.filter(function (object) {
                        return uncheckedObjectsNames.indexOf(object.name) === -1;
                    }).map(function (object) {
                        return object.name;
                    });
                }
            }

            return callback({
                checkedObjectsNames: checkedObjectsNames,
                uncheckedObjectsNames: uncheckedObjectsNames,
                activeActionLink: activeActionLink,
                actionParameters: actionParameters,
                parentObjectNames: upLevelCheckedObjects,
            });
        });
    }

    // Creating filtered objects list

    // checkedObjectsNames: array of objects names for process of their interaction result and draw a new objects list
    // selectedObjectsNames: array of selected objects names
    // callback()
    function createFilteredObjectsList(checkedObjectsNames, callback) {

        if(checkedObjectsNames && checkedObjectsNames.length) var objectsNamesStr = checkedObjectsNames.join(',');
        else objectsNamesStr = '';

        $.post('/mainMenu', {
            f: 'filterObjectsByInteractions',
                name: objectsNamesStr,
                filterNames: getCheckedFilterNames().join(','),
                filterExpression: getFilterExpression(),
            },
            // objects: [{id:.., name:.., description:..}, {..}, ...]
            function(objects) {

                if(!objects || !objects.length) {
                    if(objectsNamesStr) {
                        M.toast({html: 'Not found interactions with another objects for object[s]: ' + objectsNamesStr, displayLength: 3000});
                    }
                    if(typeof(callback) === 'function') return callback();
                    return;
                }

                // objects: [{name: objectName1, description: objectDescription1, id: objectID1, color: <color>:<shade>, disabled: <1|0>},...]
                drawObjectsList(objects, callback);
            }
        );
    }

    // Creating objects list

    // uncheckedObjectsNames: array of objects names for process of their interaction result and draw a new objects list
    // selectedObjectsNames: array of selected objects names
    // callback()
    function createObjectsList(uncheckedObjectsNames, checkedObjectsNames, callback) {

        var objectsNames = uncheckedObjectsNames;
        if(!objectsNames || !objectsNames.length) objectsNames = checkedObjectsNames;
        else Array.prototype.push.apply(objectsNames, checkedObjectsNames); // add array 'checkedObjectsNames' to the end of array 'objectsNames'

        if(!objectsNames || !objectsNames.length) return createFilteredObjectsList(null, callback);

        var objectsNamesStr = objectsNames.join(',');

        $.post('/mainMenu', {
                f: 'getObjectsByName',
                name: objectsNamesStr,
                filterNames: getCheckedFilterNames().join(','),
                filterExpression: getFilterExpression(),
            },
            // objects: [{id:.., name:.., description:.., color: <color>:<shade>}, {..}, ...]
            function(objects){

                if(!objects || !objects.length) M.toast({html: 'Objects "' + objectsNamesStr +'" are not found in database', displayLength: 3000});
                else {

                    if (checkedObjectsNames && checkedObjectsNames.length) {
                        /*
                         Add to all objects of "objects" array property "selected": true if object name is present in checkedObjectsNames array or
                         "selected": false if not present
                         */
                        objects.forEach(function (obj) {
                            obj.selected = false;

                            for (var i = 0; i < checkedObjectsNames.length; i++) {
                                if (obj.name === checkedObjectsNames[i]) {
                                    obj.selected = true;
                                    break;
                                }
                            }
                        });
                    }
                }
                //objects: [{name: objectName1, description: objectDescription1, id: objectID1, selected: <true|false>, color: <color>:<shade>, disabled: <1|0>},...]
                searchObjects(objects, callback);
            }
        );
    }


    /*
    Draw objects list

    objects: [{name: objectName1, description: objectDescription1, id: objectID1, selected: <true|false>, color: <color>:<shade>, disabled: <1|0>},...]
    about color and shade look at http://materializecss.com/color.html
    callback()
     */
    var previousHTMLWithObjectList;
    function drawObjectsList(objects, callback) {
        var html = '';

        if(objects && objects.length) {
            html = objects.sort(function(a,b) {
                if(a.sortPosition > b.sortPosition) return 1;
                if(a.sortPosition < b.sortPosition) return -1;
                if(a.name.toUpperCase() > b.name.toUpperCase()) return 1;
                if(a.name.toUpperCase() < b.name.toUpperCase()) return -1;
                return 0;
            }).map(function (obj) {
                return ('\
<li>\n\
        <a class="tooltipped row object" object-in-list data-position="right" data-tooltip="' + escapeHtml(obj.description ? obj.name + ': ' + obj.description : obj.name) + '">\n\
            <div class="col s1 object-checkbox">\
                <label>\
                    <input type="checkbox" id="' + obj.id + '" objectName="' + obj.name + '" objectDescription="' + escapeHtml(obj.description) + '" ' + (obj.selected ? 'checked' : '') + '/>\n\
                    <span></span>\
                </label>\
            </div>\n\
            <div class="col s11 truncate object-label' + (obj.disabled ? ' italic' : '') + getCSSClassForObjectColor(obj) + '" objectID="' + obj.id + '">' + escapeHtml(obj.name) + '</div>\n\
        </a>\
</li>\n');
            }).join('');
        }

        //if (!isMobile) searchObjectsElm.focus();

        // don't redraw objects list if previous objects list html is the same with current
        if(previousHTMLWithObjectList === html){
            if(typeof(callback) === 'function') return callback();
            return;
        }

        previousHTMLWithObjectList = html;

        if(objectsTooltipInstances && objectsTooltipInstances.length) {
            objectsTooltipInstances.forEach(function (instance) {
                instance.destroy();
            });
        }
        $('div.material-tooltip').remove();

        objectsListElm.empty().append(html);
        objectsTooltipInstances = M.Tooltip.init(document.querySelectorAll('a[object-in-list]'), {
            enterDelay: 500
        });
        selectAllObjBtnElm.attr('allChecked', '');
        selectAllObjBtnElm.removeClass('grey');

        // click at an object checkbox
        $('input[objectName]').click(function () {
            if(getActiveObjectsList() === 1) {
                redrawIFrameDataOnChangeObjectsList();
                setBrowserHistory();
                objectsInObjectsTab = getObjectsFromObjectsList();
                //$('#brand-logo').text(objectsInObjectsTab.checked.join(', '));
            } else if(getActiveObjectsList() === 2) {
                redrawIFrameDataOnChangeAdditionalObjectsList();
                objectsInAdditionalObjectsTab = getObjectsFromObjectsList();
            }
            previousHTMLWithObjectList = undefined; // force drawing object list after changing
        });

        // click at an object
        $('div[objectID]').click(function(eventObject){
            // set checkbox of current object checked
            var currentObjectID = $(eventObject.target).attr('objectID');
            $('#'+currentObjectID).prop('checked', true);

            // create list of objects names
            var objectsNames = getObjectsFromObjectsList();

            // if any of objects is checked, create array with checked object names
            if(objectsNames.checked.length) {
                // create new objects list
                createFilteredObjectsList(objectsNames.checked, function(){
                    if(getActiveObjectsList() === 1) {
                        // saving checked object names for redraw object list when action is executed
                        prevCheckedObjectsNames = [];
                        Array.prototype.push.apply(prevCheckedObjectsNames, objectsNames.checked);
                        redrawIFrameDataOnChangeObjectsList();
                        setBrowserHistory();
                    } else if(getActiveObjectsList() === 2) redrawIFrameDataOnChangeAdditionalObjectsList();
                });
            }

            if(getActiveObjectsList() === 1) objectsInObjectsTab = getObjectsFromObjectsList();
            else if(getActiveObjectsList() === 2) objectsInAdditionalObjectsTab = getObjectsFromObjectsList();

            // don't execute default action for this event
            eventObject.preventDefault();
            previousHTMLWithObjectList = undefined; // force drawing object list after changing
        });

        if(typeof(callback) === 'function') return callback();
    }

    /*
    Check color and shade and return css classes for it
    look at http://materializecss.com/color.html

    obj: {color: <color>:<shade>}
    return ' '+color+'-text text-'+shade or
    return ' '+color+'-text' or
    return ''
     */
    function getCSSClassForObjectColor(obj) {

        if(!obj.color) return '';
        var colorAndShade = obj.color.split(':');

        var color = colorAndShade[0];
        if(!color) return '';

        color = color.toLowerCase();
        if( color !== 'red' &&
            color !== 'pink' &&
            color !== 'purple' &&
            color !== 'deep-purple' &&
            color !== 'indigo' &&
            color !== 'blue' &&
            color !== 'light-blue' &&
            color !== 'cyan' &&
            color !== 'teal' &&
            color !== 'green' &&
            color !== 'light-green' &&
            color !== 'lime' &&
            color !== 'yellow' &&
            color !== 'amber' &&
            color !== 'orange' &&
            color !== 'deep-orange' &&
            color !== 'brown' &&
            color !== 'grey' &&
            color !== 'blue-grey' &&
            color !== 'black' &&
            color !== 'white' &&
            color  !== 'transparent'
        ) return '';

        var shade = colorAndShade[1];
        if(!shade) return ' '+color+'-text';

        shade = shade.toLowerCase();
        if( !/^(lighten)|(darken)|(accent)-[1-4]$/.test(shade) && shade !== 'lighten-5') return ' '+color+'-text';

        return ' '+color+'-text text-'+shade;
    }

    // Getting selected objects
    // return array [{id: <objectID1>, name: <objectName1>}, {..}, ...]
    function getSelectedObjects() {
        return $.map($('input[objectName]:checked'), function(elm) {
            return {
                id: Number($(elm).attr('id')),
                name: $(elm).attr('objectName')
            };
        });
    }

    function createActionsList(activeActionLink, callback){
        if(!activeActionLink) activeActionLink = $('li[action_link].active').attr('action_link');

        if(getActiveObjectsList() === 1) var selectedObjects = getSelectedObjects();
        else selectedObjects = objectsInObjectsTab.checked.map(function(objectName) {
            return {name: objectName}
        });

        $.post('/mainMenu', {f: 'getActions', o: JSON.stringify(selectedObjects)}, function(actions) {

            var drawData = createHTMLWithActionsList(actions, activeActionLink, selectedObjects);
            // check for the new action menu is equal to the previous generated action menu
            // and redraw actions menu only if it changed
            var newActionsMenuHTML = drawData.html;
            if(newActionsMenuHTML === prevActionsListHTML){
                if(typeof callback !== 'function') return;
                return callback();
            }
            prevActionsListHTML = newActionsMenuHTML;

            if(actionsTooltipInstances && actionsTooltipInstances.length ){
                actionsTooltipInstances.forEach(function (instance) {
                    instance.destroy();
                });
            }
            $('div.material-tooltip').remove();

            actionsListElm.empty().append(newActionsMenuHTML);
            M.Collapsible.init(actionsListElm[0], {});
            actionsTooltipInstances = M.Tooltip.init(document.querySelectorAll('a.tooltipped'), {
                enterDelay: 200
            });

            // if no active action, draw empty action.
            if(!$('li[action_link].active').attr('action_link')) drawAction();

            searchActionsElm.val('');

            M.Autocomplete.init(searchActionsElm[0], {
                data: drawData.autocompleteData,
                limit: 20, // The max amount of results that can be shown at once. Default: Infinity.
                minLength: 2, // The minimum length of the input for the autocomplete to start. Default: 1.

                onAutocomplete: function(actionName) {

                    // prevent running multiple autocomplete function.
                    if(isAutoCompleteRunning) return;
                    isAutoCompleteRunning = true;

                    var activeActionLink = $('li[action_name="' + actionName + '"]').attr('action_link');
                    if(activeActionLink) {
                        createActionsList(activeActionLink, function () {
                            getActionHTMLAndShowActionButtons(false,function (html) {
                                drawAction(html);
                                isAutoCompleteRunning = false;
                            })
                        });
                    }
                }
            });

            searchActionsAutocompleteInstance = M.Autocomplete.getInstance(searchActionsElm[0]);

            $('li[action_link]').click(function(){
                // manually add class active to menu element, when clicked
                // it's not work automatically, when init menu by $('#actionsMenu.collapsible').collapsible();
                $('li[action_link].active').removeClass('active');
                $(this).addClass('active');
                setBrowserHistory();
                getActionHTMLAndShowActionButtons(false, drawAction);
                additionalObjectsTabSwitchElm.text(additionalObjectsTabName);
            });

            if(typeof callback === 'function') callback();
        });
    }

    /*
    Create html with actions list and object with actions list for autocomplete in search action element

    actions: array of objects with actions groups and actions properties
    activeActionLink: link to active action

    return {html: <string>, autocompleteData: {<name1>: <val1>, <name2>: <val2>, ...}}
     */
    function createHTMLWithActionsList(actions, activeActionLink, selectedObjects) {
        if(!actions) return {html: '', autocompleteData: {}};

        var html = '', searchActionsAutoCompleteData = {}; // {<name1>: <val1>, <name2>: <val2>, ...}

        for(var groupName in actions) {
            if(!actions.hasOwnProperty(groupName)) continue;

            var CSSClassForActiveGroup = '', htmlPart = [];
            for(var ID in actions[groupName]) {
                if(!actions[groupName].hasOwnProperty(ID)) continue;

                var action = actions[groupName][ID];

                if(action.donotShow) continue;

                var attributes = '';

                if('name' in action) attributes += ' action_name="'+action.name+'"';
                else continue;

                if('link' in action) attributes += ' action_link="'+action.link+'"';
                else continue;

                searchActionsAutoCompleteData[action.name] = null;

                if('execMethod' in action) attributes += ' action_method="' + action.execMethod + '"';

                if('timeout' in action) attributes += ' action_timeout="' + action.timeout + '"';

                if('cleanInputIDs' in action) attributes += ' action_cleanElm="' + action.cleanInputIDs.replace(/\s*[,;]\s*/g, ',') + '"';

                if('callbackBeforeExec' in action) attributes += ' action_callbackBeforeExec="' + action.callbackBeforeExec + '"';

                if('callbackAfterExec' in action) attributes += ' action_callbackAfterExec="' + action.callbackAfterExec + '"';

                if('onChangeObjectMenuEvent' in action) attributes += ' on_change_object_menu_event="' + action.onChangeObjectMenuEvent + '"';

                if('additionalObjectsListName' in action) attributes += ' additional_objects_list_name="' + action.additionalObjectsListName + '"';

                if('hideObjectsList' in action) attributes += ' hide_objects_list="' + action.hideObjectsList + '"';

                // if onChangeAdditionalObjectMenuEvent is enabled, then action developer can creating depend from additional objects list changing
                // and action can't work properly when init from browser URL, because list of additional objects don't save into the URL
                // it's switched off also at redrawIFrameDataOnChangeAdditionalObjectsList function
                //if('onChangeAdditionalObjectMenuEvent' in action) attributes += ' on_change_additional_object_menu_event="' + action.onChangeAdditionalObjectMenuEvent + '"';

                if('launcher' in action && 'rights' in action)
                    attributes += ' action_rights="' + (action.rights.run ? '1' : '0') + ',' + (action.rights.makeTask ? '1' : '0') + '"';

                var selectedObjectsStr = selectedObjects.length ? selectedObjects.map(function(obj) {
                    return obj.name;
                }).join(', ') : 'no objects selected';

                var tooltip = 'description' in action ? action.description + ': ' + selectedObjectsStr : selectedObjectsStr;
                if(tooltip.length > 200) tooltip = tooltip.substring(0, 200) + '...';

                if(activeActionLink === action.link) {
                    CSSClassForActiveGroup = ' active';
                    var CSSClassForActiveAction = ' active';
                } else CSSClassForActiveAction = '';

                htmlPart.push('\
<li '+ attributes +' class="tooltipped action' + CSSClassForActiveAction +'" data-position="right" data-tooltip="'+tooltip+'">\
<a class="truncate' + CSSClassForActiveAction +'">' + action.name + '</a>\
</li>');
            }

            if(!htmlPart.length) continue;
            html += '\
<li class="bold' + CSSClassForActiveGroup +'">\
<a class="collapsible-header row no-margin no-padding' + CSSClassForActiveGroup +'">\
<div class="col s1 no-padding"><i class="material-icons no-margin">arrow_drop_down</i></div>\
<div class="col s11 truncate">' + groupName + '</div>\
</a>\
<div class="collapsible-body"><ul>' + htmlPart.join('') +  '</ul></div>\
</li>';
        }

        return {
            html: html,
            autocompleteData: searchActionsAutoCompleteData
        };
    }


    /*
    getting HTML page for active action and show or hide runAction and makeTask buttons, according action user rights

    callback(html), where html is a string with HTML page for active action
     */
    function getActionHTMLAndShowActionButtons(reqForUpdate, callback){
        bodyElm.css("cursor", "wait");
        $(iframeDOMElm.contentWindow).find('body').css("cursor", "wait");

        var activeActionElm = $('li[action_link].active');
        var activeActionLink = activeActionElm.attr('action_link');
        additionalObjectsTabName = activeActionElm.attr('additional_objects_list_name');
        var hideObjectsList = activeActionElm.attr('hide_objects_list');

        if(additionalObjectsTabName){
            if(additionalObjectsTabSwitchElm.parent().hasClass('hide')) {
                additionalObjectsTabSwitchElm.text(additionalObjectsTabName);
                additionalObjectsTabSwitchElm.parent().removeClass('hide');
                M.Tabs.init(document.getElementById('tabs'), {});
            }
            redrawIFrameDataOnChangeAdditionalObjectsList();
        } else if(!additionalObjectsTabSwitchElm.parent().hasClass('hide')) {
            additionalObjectsTabSwitchElm.parent().addClass('hide');

            // redraw tabs (was trigger)
            redrawTabsIndicatorElm();
        }

        if(hideObjectsList){
            if(!objectsTabSwitchElm.parent().hasClass('hide')){
                objectsTabSwitchElm.parent().addClass('hide');
                M.Tabs.init(document.getElementById('tabs'), {});
            }
        } else if(objectsTabSwitchElm.parent().hasClass('hide')){
            objectsTabSwitchElm.parent().removeClass('hide');
            M.Tabs.init(document.getElementById('tabs'), {});
        }


        // if not selected any action, return
        if(!activeActionLink){
            bodyElm.css("cursor", "auto");
            if(typeof callback === 'function') callback();
            return;
        }

        // get action parameters
        getParametersFromURL(function(parametersFromURL) {
            var actionParameters = parametersFromURL.actionParameters;
            // for debugging
            //if(actionParameters.length) alert('Action parameters: ' + JSON.stringify(actionParameters));

            // hide "run action" and "make task" buttons
            runActionBtnElm.addClass('hide');
            makeTaskBtnElm.addClass('hide');
            getCheckedObjectsFromObjectsTab(function(_objects) {
                var objects = _objects.map(function (obj) {
                    return {
                        id: obj.id,
                        name: obj.name
                    }
                });

                // action: {html: ..., params: {...}}
                $.post(activeActionLink, {
                    o: JSON.stringify(objects),
                    actionUpdate: (reqForUpdate ? 1 : 0),
                    p: JSON.stringify(actionParameters)
                }, function(action) {
                    var rightsStr = activeActionElm.attr('action_rights');
                    if(rightsStr) { // rightsStr: "<1|0>,<1|0>", f.e. "1,0".
                        var allowRunAction = rightsStr[0]; //first character
                        var allowMakeTask = rightsStr[2]; // third character
                        if(allowRunAction === '1') runActionBtnElm.removeClass('hide'); // show "run action" button
                        if(allowMakeTask === '1') makeTaskBtnElm.removeClass('hide'); // show "make task" button
                    }

                    sessionID = action.params.sessionID;
                    sessionsIDs[sessionID] = true;

                    if(typeof callback === 'function') callback(action.html);
                });
            });
        });
    }

    function setDocumentTitle() {
        var title = $('li[action_link].active').attr('action_name') || 'ALEPIZ';
        var objectsNames = getObjectsFromObjectsList().checked, objectsNum = objectsNames ? objectsNames.length : 0;
        if(objectsNum) {
            var objectsStr = objectsNames.join('; ');
            if(objectsStr.length > 50) {
                objectsStr = objectsStr.substring(0, 50) + '...[' + objectsNum + ']';
            }
            title += ' (' + objectsStr + ')';
        }
        document.title = title;
    }

    /*
    Draw HTML page in iframe element and init javaScript objects in iframe document
    html: string with HTML page for drawing
     */
    function drawAction(html) {

        setDocumentTitle();
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
            } catch(err) { }
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
                '</script>'
                '</body></html>';
            sessionID = undefined;
        }

        try {
            iframeDOMElm.contentWindow.document.open();
            iframeDOMElm.contentWindow.document.write(html);
            iframeDOMElm.contentWindow.document.close();
        } catch(err) {
            console.error(err.stack);
        }

        // make possible to save action parameters into the URL from the action
        // function setActionParametersToBrowserURL(actionParameters)
        // actionParameters is array of [{key: <key1>, val:<val1>}, {..}, ...]
        try {
            iframeDOMElm.contentWindow.setActionParametersToBrowserURL = setActionParametersToBrowserURL;
        } catch (err) { }

        // make possible to get action parameters from the URL for the action
        // function getActionParameters()
        // return action parameters as array [{key: <key1>, val:<val1>}, {..}, ...]
        try {
            iframeDOMElm.contentWindow.getActionParametersFromBrowserURL = function(callback) {
                getParametersFromURL(function(parametersFromURL) {
                    return callback(parametersFromURL.actionParameters);
                });
            };
        } catch (err) { }

        // add an event handler for catch the scroll action page event inside the iframe
        setTimeout(function () {
            try {
                if (iframeDOMElm.contentWindow && typeof iframeDOMElm.contentWindow.onScrollIframe === 'function') {
                    iframeDOMElm.contentDocument.addEventListener('scroll', iframeDOMElm.contentWindow.onScrollIframe, false);
                }
            } catch(err) { }
        }, 2000);

        try {
            iframeDOMElm.contentWindow.getActionConfig = function(callback) {
                var activeActionLink = $('li[action_link].active').attr('action_link');
                $.post(activeActionLink, { func: 'getActionConfig' }, callback);
            }
        } catch (err) { }

        try {
            iframeDOMElm.contentWindow.setActionConfig = function(config, callback) {
                var activeActionLink = $('li[action_link].active').attr('action_link');
                //console.log('set:', config)
                $.post(activeActionLink, {
                    func: 'setActionConfig',
                    config: typeof config === 'object' ? JSON.stringify(config) : config.toString()
                }, callback);
            }
        } catch (err) { }

        ctrlEnter();
        setTimeout(ctrlEnter, 60000);
        bodyElm.css("cursor", "auto");

        // run task on Ctrl + Enter
        function ctrlEnter() {
            try {
                var iframeContentWindowElm = $(iframeDOMElm.contentWindow);
                iframeContentWindowElm.unbind('keydown', keyDown).keydown(keyDown);
                iframeContentWindowElm.unbind('keypress', keyPressAndKeyUp).keypress(keyPressAndKeyUp);
                iframeContentWindowElm.unbind('keyUp', keyPressAndKeyUp).keyup(keyPressAndKeyUp);
            } catch (err) {
            }
        }

        function keyDown(e) {
            if (runActionBtnElm.hasClass('hide')) return;
            if (e.keyCode === 13 && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                processIframeInputsData(true); // true - don't open a log window
                return false;
            }
        }

        function keyPressAndKeyUp(e) { // prevent submit event generation
            if (runActionBtnElm.hasClass('hide')) return;
            if (e.keyCode === 13 && e.ctrlKey) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        }
    }

    function redrawIFrameDataOnChangeObjectsList() {
        if(getActiveObjectsList() === 2) return redrawIFrameDataOnChangeAdditionalObjectsList();

        var activeActionElm = $('li[action_link].active');
        if(!activeActionElm.length) return drawAction();

        var activeActionLink = activeActionElm.attr('action_link');

        var onChangeObjectMenuEvent = activeActionElm.attr('on_change_object_menu_event');
        if (!onChangeObjectMenuEvent || onChangeObjectMenuEvent.toLowerCase() === 'fullreload') {
            return getActionHTMLAndShowActionButtons(false, drawAction);
        }

        var selectedObjects = getSelectedObjects();

        // recreate actions list
        createActionsList(activeActionLink, function() {
            activeActionLink = $('li[action_link].active').attr('action_link');
            // if no active action after redraw action list, draw empty action and return
            if(!activeActionLink) {
                if(!additionalObjectsTabSwitchElm.parent().hasClass('hide')) {
                    additionalObjectsTabSwitchElm.parent().addClass('hide');

                    // redraw tabs (was trigger)
                    redrawTabsIndicatorElm();

                    // show objects list again. it was hidden by $('ul.tabs').tabs(), I don't know why
                    //if(objectsTabSwitchElm.hasClass('active')) objectsListElm.css('display', 'block');
                }
                drawAction();
                setBrowserHistory();
                return;
            }

            // set parameters.objects value in iframe when change objects menu
            try {
                iframeDOMElm.contentWindow.parameters.objects = selectedObjects;
            } catch (err) {}

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
                }
                catch (err) {
                    reload();
                    console.error('Can\'t running callback "', callbackName, '" from embedded HTML document "', activeActionLink ,
                        '" after changing object list. Callback set into the action configuration file: ', err.stack);
                }
            }
        });
    }

    function redrawIFrameDataOnChangeAdditionalObjectsList() {
        if(getActiveObjectsList() === 1) return;

        var activeActionElm = $('li[action_link].active');
        var activeActionLink = activeActionElm.attr('action_link');

        if(!activeActionLink) return;

        var selectedAdditionalObjects = getSelectedObjects();
        var selectedObjects = [];
        if(objectsInObjectsTab.checkedID.length) {
            selectedObjects = objectsInObjectsTab.checked.map(function (objectName, idx) {
                return {
                    id: objectsInObjectsTab.checkedID[idx],
                    name: objectName
                }
            });
        }

        // set parameters.additionalObjects value in iframe when change objects menu
        try {
            if(selectedObjects.length) iframeDOMElm.contentWindow.parameters.objects = selectedObjects;
            iframeDOMElm.contentWindow.parameters.additionalObjects = selectedAdditionalObjects;
        } catch (err) {}
    }


    /*
     Getting checked objects from objects list, even if currently active additional objects list

     callback(objects),
     objects: [{id:.., name:.., description:.., color: <color>:<shade>}, {..}, ...]
     */
    function getCheckedObjectsFromObjectsTab(callback) {

        if(getActiveObjectsList() === 1) objectsInObjectsTab = getObjectsFromObjectsList();
        if(!objectsInObjectsTab.checked.length) return callback([]);

        var objectsNamesStr = objectsInObjectsTab.checked.join(',');

        $.post('/mainMenu', {
            f: 'getObjectsByName',
            name: objectsNamesStr,
            filterNames: getCheckedFilterNames().join(','),
            filterExpression: getFilterExpression(),
        }, callback);
        // objects: [{id:.., name:.., description:.., color: <color>:<shade>}, {..}, ...]
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
        var activeActionElm = $('li[action_name].active');

        // if button id attr is makeTaskBtn, then run action for makeTask, else execute action
        if(this.id === 'makeTaskBtn') var executionMode = 'makeTask';
        else executionMode = 'server';

        // else run action
        var actionCallback = activeActionElm.attr('action_callbackBeforeExec');
        // if callback function for action exist, then run callback at first and executing action
        // from callback function
        if (actionCallback) {
            try {
                iframeDOMElm.contentWindow[actionCallback](
                    function (err) {
                        if (err) return log.error(err.message);
                        return getInputDataAndExecServer(executionMode, dontOpenLogWindows);
                    }
                );
            }
            catch (err) {
                reload();
                console.error('Error running function "', actionCallback + '(..){....}": ', err.stack);
            }
            // without callback function for action executing action directly
        } else getInputDataAndExecServer(executionMode, dontOpenLogWindows);


        // execMode = 'server'|'makeTask'
        function getInputDataAndExecServer(execMode, dontOpenLogWindows) {
            // create object list again because active objects list can be on additional objects tab and this will be incorrect

            getCheckedObjectsFromObjectsTab(function(_objects){
                var objects = _objects.map(function(obj) {
                    return {
                        id: obj.id,
                        name: obj.name
                    }
                });

                var hideObjectsList = activeActionElm.attr('hide_objects_list');

                if(hideObjectsList) var valueList = [];
                else valueList = [{name: 'o', value: JSON.stringify(objects)}];

                // Only this way can show, is createResultValuesList() return error or not
                // don't touch it, even if you understand, what are you do
                var errorOnCreateValueList = false;
                $(iframeDOMElm).contents().find('input').each(createResultValuesList);
                $(iframeDOMElm).contents().find('select').each(createResultValuesList);
                $(iframeDOMElm).contents().find('textarea').each(createResultValuesList);
                if(errorOnCreateValueList) return;

                var execMethod = activeActionElm.attr('action_method') ? activeActionElm.attr('action_method').toUpperCase() : 'POST';
                if(execMethod !== 'GET' || execMethod !== 'POST') execMethod = 'POST';

                var ajaxUrl = activeActionElm.attr('action_link') + '_' + sessionID + '/'+execMode;
                var timeout = Number(activeActionElm.attr('action_timeout')) * 1000;
                $("body").css("cursor", "progress");
                if(dontOpenLogWindows !== true) openLogWindow('force');
                else M.toast({html: 'Executing action "' + activeActionElm.attr('action_name') + '"... Open log window for details', displayLength: 6000});

                $.ajax(ajaxUrl, {
                    type: execMethod,
                    data: $.param(valueList),
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

                function createResultValuesList(index, elm){
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
                            errorOnCreateValueList = true;
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
                                errorMessage = 'Error in parameter "'+name+'": length of "'+value+'" more then '+parameterLength;
                        }

                        log.error(errorMessage);
                        errorOnCreateValueList = true;
                        return;
                    }

                    valueList.push({name: name, value: value});
                    //console.log(index+': '+elm.tagName+': '+name+'='+value);
                }
            });
            //});
        }


        // Function processing result, returned by action
        //
        // returnObj = {
        //      data: <any data, for sending to the callbackAfterExec function at client side>
        //      message: <message, which displayed at the log modal window>
        //      sessionID: new sessionID
        // }
        function processingResult(returnObj) {
            if(returnObj.sessionID) {
                sessionID = returnObj.sessionID;
                sessionsIDs[sessionID] = true;
            }

            if(returnObj.actionError) log.error(returnObj.actionError);
            // reload objects list and actions
            reloadObjectsAndActionListsAfterActionExecution();

            var cleanElmIDs = activeActionElm.attr('action_cleanElm');
            if(cleanElmIDs) {
                cleanElmIDs.split(',').forEach(function(cleanElmID) {
                    try {
                        var elm = $(iframeDOMElm).contents().find('#'+cleanElmID);
                        if(!elm.length) return log.error('Can\'t clean element with ID: ', cleanElmID, ': element not exist');
                        if(elm.attr('type') === 'checkbox') elm.prop('checked', false);
                        else elm.val('');
                    } catch (err) {
                        reload();
                        console.error('Can\'t clean elements with IDs: ', cleanElmIDs, ': ', err.stack);
                    }
                })
            }

            var callbackName = activeActionElm.attr('action_callbackAfterExec');
            if (callbackName) {
                try {
                    var callback = iframeDOMElm.contentWindow[callbackName];
                    callback(returnObj, function (err) {
                        if (err) return log.error(err.message);
                    });
                    bodyElm.css("cursor", "auto");
                }
                catch (err) {
                    reload();
                    console.error('Error running callback on browser side after execution action. ',
                        'Callback name is: "', callbackName, '(data, callback)": ', err.message);
                }
            } else {
                bodyElm.css("cursor", "auto");
            }

        }
    }

    /*
    Reload object list at objects tab and additional objects tab after action executed.
    For objects list try to create objects list using previous objects interaction rules from previous step from browser history
    For additional objects list or if previous history is empty, try to create object list using objects ID and reload objects names from database
     */
        function reloadObjectsAndActionListsAfterActionExecution() {
            // if current objects list was created using interaction with another objects by clicking on the objects
            // then reload objects list by performing same filter with same objects interaction
            if(prevCheckedObjectsNames.length) {
                var postParameters = {
                    f: 'filterObjectsByInteractions',
                    name: prevCheckedObjectsNames.join(','),
                    filterNames: getCheckedFilterNames().join(','),
                    filterExpression: getFilterExpression(),
                }
            } else {
                var objectsIDs = [];
                Array.prototype.push.apply(objectsIDs, objectsInObjectsTab.checkedID);
                Array.prototype.push.apply(objectsIDs, objectsInObjectsTab.uncheckedID);

                postParameters = {
                    f: 'getObjectsByID',
                    IDs: objectsIDs.join(','),
                    filterNames: getCheckedFilterNames().join(','),
                    filterExpression: getFilterExpression(),
                }
            }

            $.post('/mainMenu', postParameters, function(objects) {
                // objects: [{id:..., name:..., description:..., sortPosition:..., color:.., disabled:..., color:...}, {...},...]

                if(!objects) objects = [];
                if(objects.length !== prevCheckedObjectsNames.length || !prevCheckedObjectsNames.length) {
                    var objectListIsChanged = true;
                } else {
                    objectListIsChanged = false;
                    for (var i = 0; i <= objects.length; i++) {
                        if (prevCheckedObjectsNames.indexOf(objects[i].name) === -1) {
                            objectListIsChanged = true;
                            break;
                        }
                    }
                }

                // object list is changed, create new objects list
                if(objectListIsChanged) {

                    var newObjectsInObjectsTab = {
                        checked: [],
                        checkedID: [],
                        unchecked: [],
                        uncheckedID: []
                    };

                    objects.forEach(function(object) {
                        if(objectsInObjectsTab.checkedID.indexOf(object.id) !== -1){
                            object.selected = true;
                            newObjectsInObjectsTab.checked.push(object.name);
                            newObjectsInObjectsTab.checkedID.push(object.id);
                        } else {
                            newObjectsInObjectsTab.unchecked.push(object.name);
                            newObjectsInObjectsTab.uncheckedID.push(object.id);
                        }
                    });

                    objectsInObjectsTab = newObjectsInObjectsTab;
                    if(getActiveObjectsList() === 1 || additionalObjectsTabSwitchElm.parent().hasClass('hide')) {
                        drawObjectsList(objects, function () {
                            redrawIFrameDataOnChangeObjectsList();
                            setBrowserHistory();
                        });
                    }
                }

                if(!additionalObjectsTabSwitchElm.parent().hasClass('hide')) {

                    if(getActiveObjectsList() === 2) objectsInAdditionalObjectsTab = getObjectsFromObjectsList();

                    objectsIDs = [];
                    Array.prototype.push.apply(objectsIDs, objectsInAdditionalObjectsTab.checkedID);
                    Array.prototype.push.apply(objectsIDs, objectsInAdditionalObjectsTab.uncheckedID);

                    $.post('/mainMenu', {
                        f: 'getObjectsByID',
                        IDs: objectsIDs.join(','),
                        filterNames: getCheckedFilterNames().join(','),
                        filterExpression: getFilterExpression(),
                    }, function (objects) {
                        var newObjectsInObjectsTab = {
                            checked: [],
                            checkedID: [],
                            unchecked: [],
                            uncheckedID: []
                        };

                        objects.forEach(function (object) {
                            if (objectsInAdditionalObjectsTab.checkedID.indexOf(object.id) !== -1) {
                                object.selected = true;
                                newObjectsInObjectsTab.checked.push(object.name);
                                newObjectsInObjectsTab.checkedID.push(object.id);
                            } else {
                                newObjectsInObjectsTab.unchecked.push(object.name);
                                newObjectsInObjectsTab.uncheckedID.push(object.id);
                            }
                        });

                        objectsInAdditionalObjectsTab = newObjectsInObjectsTab;

                        if(getActiveObjectsList() === 2) {
                            drawObjectsList(objects, function () {
                                redrawIFrameDataOnChangeObjectsList();
                                if(objectListIsChanged) setBrowserHistory();
                            });
                        }
                    });
                }
            });
        }


//====================================================================================================================
//============================================== AUTHORISATION SYSTEM ================================================
//====================================================================================================================
    function initAuthorisationSystem() {

        var userNameElm = $('#userName'),
            userPassElm = $('#userPass'),
            newPass1Elm = $('#newUserPass1'),
            newPass2Elm = $('#newUserPass2');
        // set focus on a login field after login dialog initialize
        loginBtnElm.click(function(){ setTimeout(function(){ userNameElm.focus() }, 500 ) });

        // set focus to password field on press enter or tab on a user field
        // or close modal for esc
        userNameElm.keypress(function(e) {
            if(e.which === 13 || e.which === 9) userPassElm.focus();
            if(e.which === 27) modalLoginInstance.close();
        });
        // try to login in when press enter on a password field
        // or close modal for esc
        userPassElm.keypress(function(e) {
            if($('#changePasswordForm').hasClass('hide')) {
                if(e.which === 13) {
                    login();
                    modalLoginInstance.close();
                }
            } else if(e.which === 13 || e.which === 9) newPass1Elm.focus();

            if(e.which === 27) modalLoginInstance.close();
        });

        newPass1Elm.keypress(function(e) {
            if(e.which === 13 || e.which === 9) newPass2Elm.focus();
            if(e.which === 27) modalLoginInstance.close();
        });

        newPass2Elm.keypress(function(e) {
            if(e.which === 13) {
                login();
                modalLoginInstance.close();
            }
            if(e.which === 27) modalLoginInstance.close();
            var newPass = newPass1Elm.val();
            if(!newPass) return false;
        });

        newPass2Elm.keyup(function () {
            var newPass = newPass1Elm.val();
            if(newPass !== newPass2Elm.val()) newPass2Elm.addClass('red-text');
            else newPass2Elm.removeClass('red-text');
        });

        $('#changePasswordBtn').click(function () {
            $('#changePasswordForm').toggleClass('hide');
        });

        // try to login in when click on LOGIN button
        $('#login').click(function(eventObject){
            eventObject.preventDefault();
            login();
        });
        // logout when pressed LOGOUT button
        $('#logout').click(function(eventObject){
            eventObject.preventDefault();
            logout();
        });

        $.post('/mainMenu', {f: 'getCurrentUserName'}, function(userName) {
            if(userName && userName.length) { // userName is a string or empty array [], when login as guest

                M.toast({html: 'Entering as "'+userName+'"', displayLength: 3000});
                loginBtnElm.removeClass('grey-text').attr('data-tooltip', 'Login as '+userName);
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 2000
                });

            } else M.toast({html: 'Entering as "GUEST", please login first', displayLength: 3000});
        });

        function login() {
            var user = userNameElm.val(), pass = userPassElm.val(), newPass = newPass1Elm.val();
            if(newPass !== newPass2Elm.val()) {
                M.toast({html: 'New entered passwords don\'t match', displayLength: 5000});
                return;
            }

            if(newPass && !pass) {
                M.toast({html: 'Please enter your old password before changing', displayLength: 5000});
                return;
            }

            if(!user || !pass) {
                M.toast({html: 'Please enter your user name and password for login', displayLength: 5000});
                return;
            }

            $.post('/mainMenu', {
                f: 'login', user: user,
                pass: pass,
                newPass: newPass,
            }, function(userName) {

                if(!userName){
                    M.toast({html: 'User name or password are incorrect', displayLength: 4000});
                    setTimeout(function () { location.reload() }, 4000);
                    return;
                }

                if (newPass) M.toast({
                    html: 'Password successfully changed for user ' + userName,
                    displayLength: 5000,
                });

                loginBtnElm.removeClass('grey-text').attr('data-tooltip', 'Login as '+userName);
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 500
                });

                userPassElm.val('');
                setTimeout(function () { location.reload(); }, 3000);
            });
        }

        // send logout command to server, clear User name and password field, set grey color for login icon
        // and set tooltip for it as 'login as guest'
        function logout(){
            $.post('/mainMenu', {f: 'logout'}, function() {
                userPassElm.val('');
                userNameElm.val('');
                loginBtnElm.addClass('grey-text').attr('data-tooltip', 'Login as GUEST');
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 2000
                });

                setTimeout(function () { location.reload() }, 2000);
            });
        }
    }

//====================================================================================================================
//=================================================== LOG PROCESSOR ==================================================
//====================================================================================================================
    var continueRetrievingLog = 0;
    var logTimer;
    var retrievingLogRecordsInProgress = 0;
    var closeLogWindowsTimeout = 30; // close log window after 30 minutes
    var maxLogRecords = 200;
    //  Open log window, start retrieving log, auto close log window after 30 minutes
    function openLogWindow(force) {
        if(!Object.keys(sessionsIDs).length) {
            M.toast({html: 'No actions are running in this window. Please run any action before', displayLength: 5000});
            return;
        }
        // this flag locked exit from getLastLogRecords()
        continueRetrievingLog = Date.now();
        // Auto close log window after 30 min after  last show log window
        autoCloseLogWindow(closeLogWindowsTimeout);
        // Run getLastLogRecords() only if it is not running or not updated more then 1 minutes
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

        logLastUpdateElm.text('Starting update: ' + (new Date()).toLocaleString() + '; records: ' + logBodyElm.find('div.logRecord').length + '...');
        $.ajax('/mainMenu', {
            type: 'POST',
            data: $.param({f: 'getLogRecords', lastID: lastLorRecordID, sessionsIDs: Object.keys(sessionsIDs).join(',')}),
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

            logLastUpdateElm.text('Last update: ' + (new Date()).toLocaleString() + '; records: ' + logBodyElm.find('div.logRecord').length);

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
                ].join(':')].join(' ')+'.' + String('00'+now.getMilliseconds()).replace(/^0*?(\d\d\d)$/, '$1');

            var sessionID = record.sessionID;
            var icon = logIcons[record.level];

            if(recordsSortedBySessions[sessionID] === undefined) {

                sessionsOrder.push(sessionID);
                var sessionContainerElm = $('li[sessionID=' + sessionID + ']');

                if(sessionContainerElm.length) {
                    recordsSortedBySessions[sessionID] = {
                        actionName: record.actionName,
                        html: sessionContainerElm.find('div[id=' +sessionID+ ']').html(),
                        logLevel: sessionContainerElm.attr('max-log-level'),
                        lines: 0,
                        firstTimeStr: sessionContainerElm.find('span[sessionID=' + sessionID + ']').text()
                    };
                    sessionContainerElm.remove();
                } else {
                    recordsSortedBySessions[sessionID] = {
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

            recordsSortedBySessions[sessionID].html = '<div class="logRecord">' +
                '<div class="logIcon"><i class="material-icons">' + icon + '</i></div>' +
                '<div class="logDateStr"> ' + dateString +
                //                    '['+sessionID+']'+
                ':</div><span>' + msgHtml + '</span></div>' + recordsSortedBySessions[sessionID].html;

            recordsSortedBySessions[sessionID].lines++;
            if (logLevels[record.level] > logLevels[recordsSortedBySessions[sessionID].logLevel])
                recordsSortedBySessions[sessionID].logLevel = record.level;

            recordsSortedBySessions[sessionID].lastTimeStr = dateString;
        });

        var html = '';
        sessionsOrder.reverse().forEach(function(sessionID){

            var logLevel = recordsSortedBySessions[sessionID].logLevel;
            var icon = logIcons[logLevel];
            var actionName = recordsSortedBySessions[sessionID].actionName;
            var firstTimeStr = recordsSortedBySessions[sessionID].firstTimeStr;
            var lastTimeStr = recordsSortedBySessions[sessionID].lastTimeStr;

            html += '<li sessionID="' + sessionID + '" max-log-level="' + logLevel + '" class="active">' +
                '<div class="collapsible-header">' +
                '<i class="material-icons" sessionID="' + sessionID + '">' + icon + '</i><b>' + actionName + '</b>' +
                '. Session starting at&nbsp;<span sessionID="' + sessionID + '">' + firstTimeStr +
                '</span>, finished at&nbsp;' + lastTimeStr +
                ', new records: ' + recordsSortedBySessions[sessionID].lines +
                //                    '['+sessionID+']' +
                '</div><div class="collapsible-body" id="' + sessionID + '">' +
                recordsSortedBySessions[sessionID].html + '</div></li>';
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


    // it mast be at the end, because before we initialising variables and execute commands
    return {
        log: function (level, args) {
            if(!args) return;

            //$.post('/log' + (sessionID ? '/' + String(sessionID) : '/0'), {level: level, args: JSON.stringify(args)}, openLogWindow);
            $.post('/log' + (sessionID ? '/' + String(sessionID) : '/0'), {level: level, args: JSON.stringify(args)}, function() {

                var header = getHumanLogLevel(level);
                modalLogHeaderElm.text(header.text).removeClass().addClass(header.color + '-text');

                if(level === 'E') {
                    var actionName = $('li[action_link].active').attr('action_name') || '';
                    if(actionName) actionName = 'An error occurred while executing action ' + actionName + ': ';
                    var message = actionName + '<span class="red-text">' +
                        escapeHtml(JSON.stringify(args).replace(/^\["Error: (.*?)\\n.*$/i, '$1')) +
                        '</span>';
                }
                else message = JSON.stringify(args);
                modalLogMessageElm.html(message);

                modalLogInstance.open();

                //want to close modal when press to Esc, but this not working with overlay and with modal too
                // only work after mouse click on overlay
                $('div.modal-overlay').keypress(function(e) {
                    if(e.which === 27) modalLogInstance.close();
                });
            });
        }
    };
})(jQuery); // end of jQuery name space

function getHumanLogLevel(level) {
    var humanLevel = '';
    if(level === 'S') humanLevel = { text: 'Silly', color: 'grey'};
    else if(level === 'D') humanLevel = { text: 'Debug', color: 'green'};
    else if(level === 'I') humanLevel = { text: 'Information', color: 'black'};
    else if(level === 'W') humanLevel = { text: 'Warning', color: 'blue'};
    else if(level === 'E') humanLevel = { text: 'Error', color: 'red'};
    else humanLevel = { text: 'Unknown', color: 'yellow'};

    return humanLevel;
}

var log = {
    silly:  function(){initJQueryNamespace.log('S', Array.prototype.slice.call(arguments))},
    debug:  function(){initJQueryNamespace.log('D', Array.prototype.slice.call(arguments))},
    info:   function(){initJQueryNamespace.log('I', Array.prototype.slice.call(arguments))},
    warn:   function(){initJQueryNamespace.log('W', Array.prototype.slice.call(arguments))},
    warning:function(){initJQueryNamespace.log('W', Array.prototype.slice.call(arguments))},
    error:  function(){initJQueryNamespace.log('E', Array.prototype.slice.call(arguments))}
};
