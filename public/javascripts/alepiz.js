/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


alepizMainNamespace = (function($) {

    $(function() {
        // check for mobile device: if(isMobile) alert('This is mobile device!!!');
        isMobile = window.matchMedia(isMobileQuery).matches;

        alepizDrawActionNamespace.init();
        alepizProcessActionNamespace.init();
        alepizFiltersNamespace.init();
        alepizActionsNamespace.init();
        alepizObjectsNamespace.init();
        alepizAuditNamespace.init();
        log.init();
        alepizAuthSystem.init();
        initJQueryElements();
        initEvents();
        initMaterializeElements();
        init();
    }); // end of document ready

    var // JQuery HTML DOM elements will be defined at initJQueryElements() function

        bodyElm,
        iframeContainerElm,
        sideNavLockIconElm,
        sideNavResizeIconElm,
        slideOutElm,
        sideNavMenuElm,
        searchObjectsElm,
        searchActionsElm,
        searchFiltersElm,
        searchIconElm,
        runActionBtnElm,
        makeTaskBtnElm,
        objectsTabElm,
        objectsTabSwitchElm,
        actionsTabSwitchElm,
        filterTabSwitchElm,
        objectsLabelElm,
        tabContainerElm,
        objectsListTabElm,
        actionsListElm,
        objectsFilterTabElm,
        objectCounterContainerElm,
        searchObjectsAddElm,
        selectAllObjectsElm,
        actionReloadBtnElm,
        resetFiltersBtnElm,
        objectGroupIconElm,
        objectGroupIconCrossOutElm;

    var
        tabInstance,
        sideNavInstance;

    var
        config = {},
        defaultConfig = {},
        themeColor,
        objectGroups = [],
        configID = '',
        // Mobile Devices <= 600px (.s)
        // Tablet Devices > 600px (.m)
        // Desktop Devices > 992px (.l)
        // Large Desktop Devices > 1200px (.xl)
        mobileScreenWidth = 992,
        isMobileQuery = 'only screen and (max-width: ' + mobileScreenWidth + 'px)',
        isMobile, // if device is a mobile device, then true, else false. Init in document ready function $(function() {}) above
        sessionsIDs = {},
        sessionID,
        lastFocusedSearchStringElm,
        maxMenuWidth = '600px',
        minMenuWidth = '400px',
        navBarHeight = 0,
        currentMenuWidth = minMenuWidth;

    function init() {
        $.post('/mainMenu', {f: 'getDefaultInterfaceConfiguration'}, function(_defaultInterfaceConfiguration) {
            defaultConfig = _defaultInterfaceConfiguration || {};

            configID = '/' + _defaultInterfaceConfiguration.actionDir + '/__AlepizMainMenuConfiguration';
            $.post(configID, { func: 'getActionConfig' }, function(_config) {
                config = _config;

                var customConfigID = '/' + _defaultInterfaceConfiguration.actionDir + '/__AlepizMainMenuCustomization';
                $.post(customConfigID, {func: 'getActionConfig'}, function (_customConfig) {
                    var customConfig = _customConfig;


                    var navBarLinksArray = typeof customConfig.navbarLinks === 'object' ? customConfig.navbarLinks :
                        defaultConfig.navbarLinks;
                    createNavBarLinks(navBarLinksArray);

                    // required for pad and more screen size
                    $('header').css('padding-left', currentMenuWidth);
                    $('main').css('padding-left', currentMenuWidth);
                    $('footer').css('padding-left', currentMenuWidth);

                    var unlockSideNav = config.unlockSideNav !== undefined ?
                        config.unlockSideNav : defaultConfig.unlockSideNav;
                    var maximizeSideNav = config.maximizeSideNav !== undefined ?
                        config.maximizeSideNav : defaultConfig.maximizeSideNav;
                    var groupingObjects = config.groupingObjects !== undefined ?
                        config.groupingObjects : defaultConfig.groupingObjects;
                    themeColor = customConfig.themeColor || defaultConfig.themeColor;
                    if(themeColor === 'random') themeColor = getRandomColor();

                    objectGroups = mergeGroups(customConfig, defaultConfig);

                    if (unlockSideNav || isMobile) sideNavLockIconElm.trigger('click');
                    if (maximizeSideNav && !isMobile) sideNavResizeIconElm.trigger('click');
                    if (groupingObjects || !objectGroups.length) objectGroupIconCrossOutElm.addClass('hide');
                    if (!objectGroups.length) objectGroupIconElm.addClass('hide');

                    var tabItem = config.tabItem || defaultConfig.tabItem;
                    if (tabItem === 'OBJECTS') tabInstance.select('objectsList');
                    else if (tabItem === 'ACTIONS') tabInstance.select('actionsList');
                    else if (tabItem === 'FILTERS') tabInstance.select('objectsFilterTab');

                    alepizFiltersNamespace.createObjectsFiltersTab(customConfig.objectFilter || [], function () {

                        var parametersFromURL = getParametersFromURL();
                        alepizObjectsNamespace.createObjectsList(parametersFromURL.uncheckedObjectsNames,
                            parametersFromURL.checkedObjectsNames, function () {

                                if (tabItem !== 'OBJECTS') {
                                    var checkedObjectsNum = alepizObjectsNamespace.getSelectedObjectNames().length;
                                    objectsTabSwitchElm.text('OBJECTS' + (checkedObjectsNum ? ' [' + checkedObjectsNum + ']' : ''));
                                }
                                alepizActionsNamespace.createActionsList(parametersFromURL.activeActionLink,
                                    function () {

                                        alepizDrawActionNamespace.getActionHTMLAndShowActionButtons(false,
                                            function (html) {

                                                alepizDrawActionNamespace.drawAction(html);
                                                setBrowserHistory();

                                                setTimeout(setFocusToSearchBar, 1000);


                                                // reload object list and draw object
                                                setInterval(alepizObjectsNamespace.reDrawObjects, 60000);
                                            });
                                    });
                            });
                    });
                });
            });
        });
    }

    function initJQueryElements() {
        bodyElm = $("body");
        iframeContainerElm = $('#iframeContainer');

        slideOutElm = $('#slide-out');
        sideNavMenuElm = $('#sidenav-menu');
        sideNavLockIconElm = $('#sideNavLockIcon');
        sideNavResizeIconElm = $('#sideNavResizeIcon');

        searchObjectsElm = lastFocusedSearchStringElm = $('#searchObjects');
        searchActionsElm = $('#searchActions');
        searchFiltersElm = $('#searchFilters');
        searchIconElm = $('#searchIcon');

        runActionBtnElm = $('#runActionBtn');
        makeTaskBtnElm = $('#makeTaskBtn');

        objectsTabElm = $('#objectsTab');
        objectsTabSwitchElm = $('#objectsTabSwitch');
        actionsTabSwitchElm = $('#actionsTabSwitch');
        filterTabSwitchElm = $('#filterTabSwitch');
        objectsLabelElm = $('#objectsLabel');
        tabContainerElm = $('#tabContainer');
        objectsListTabElm = $('#objectsListTab');
        actionsListElm = $('#actionsList');
        objectsFilterTabElm = $('#objectsFilterTab');
        objectCounterContainerElm = $('#objectCounterContainer');

        searchObjectsAddElm = $('#searchObjectsAdd');

        selectAllObjectsElm = $('#selectAllObjects');
        actionReloadBtnElm = $('#actionReloadBtn');
        resetFiltersBtnElm = $('#resetFiltersBtn');

        objectGroupIconElm = $('#objectGroupIcon');
        objectGroupIconCrossOutElm = $('#objectGroupIconCrossOut');
    }

    /*
    Initializing all Materialize JavaScript elements when rendering page
    */
    function initMaterializeElements() {
        sideNavInstance = M.Sidenav.init(document.getElementById('slide-out'), {
            //menuWidth: 400, // Default is 300
            edge: 'left', // Choose the horizontal origin
            closeOnClick: false, // Closes side-nav on <a> clicks, useful for Angular/Meteor
            draggable: true // Choose whether you can drag to open on touch screens
        });

        navBarHeight = $('.nav-wrapper').height();
        setIframeHeight();

        tabInstance = M.Tabs.init(document.getElementById('tabs'), {});

        // fix error, when overlay hide part of sideNav menu on mobile devices with a small width screens
        $('.button-collapse').click(function () {
            sideNavInstance.open();
            setTimeout(function () {
                $('.drag-target').css({width: '30%'});
            }, 50);
        });
    }

    function initEvents() {
        // after every mouse click set focus to the search bar
        bodyElm.click(setFocusToSearchBar);
        bodyElm.keyup(setFocusToSearchBar);

        // A popstate event is dispatched to the window each time the active history entry changes between two
        // history entries for the same document
        window.onpopstate = function() {
            initActionsAndObjectsListsFromBrowserURL(alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList);
        };

        $(window).on('resize', function() {
            isMobile = window.matchMedia(isMobileQuery).matches;
            if (isMobile || config.unlockSideNav) {
                $('header').css('padding-left', 0);
                $('main').css('padding-left', 0);
                $('footer').css('padding-left', 0);
            } else {
                $('header').css('padding-left', currentMenuWidth);
                $('main').css('padding-left', currentMenuWidth);
                $('footer').css('padding-left', currentMenuWidth);
            }

            setIframeHeight();
        });

        $('#openInNewWindow').click(function (e) {
            e.preventDefault();  // prevent default
            var url = '/?' + window.location.search.substring(1);
            window.open(url, '_blank').focus();
        });

        sideNavLockIconElm.click(function () {
            if(slideOutElm.hasClass('sidenav-fixed') || isMobile) {
                sideNavLockIconElm.text('code');
                slideOutElm.removeClass('sidenav-fixed');
                sideNavMenuElm.addClass('show-on-large');
                $('header').css('padding-left', 0);
                $('main').css('padding-left', 0);
                $('footer').css('padding-left', 0);
                sideNavInstance.destroy();
                sideNavInstance = M.Sidenav.init(document.getElementById('slide-out'), {
                    //menuWidth: 400, // Default is 300
                    edge: 'left', // Choose the horizontal origin
                    closeOnClick: false, // Closes side-nav on <a> clicks, useful for Angular/Meteor
                    draggable: true // Choose whether you can drag to open on touch screens
                });
                sideNavInstance.open();
                config.unlockSideNav = true;
            } else {
                sideNavLockIconElm.text('code_off');
                slideOutElm.addClass('sidenav-fixed');
                sideNavMenuElm.removeClass('show-on-large');
                $('header').css('padding-left', currentMenuWidth);
                $('main').css('padding-left', currentMenuWidth);
                $('footer').css('padding-left', currentMenuWidth);
                sideNavInstance.destroy();
                sideNavInstance = M.Sidenav.init(document.getElementById('slide-out'), {
                    //menuWidth: 400, // Default is 300
                    edge: 'left', // Choose the horizontal origin
                    closeOnClick: false, // Closes side-nav on <a> clicks, useful for Angular/Meteor
                    draggable: true // Choose whether you can drag to open on touch screens
                });
                config.unlockSideNav = false;
            }

            saveConfig();
        });

        slideOutElm.css('width', currentMenuWidth);
        var backgroundHeight = $('#backgroundImg').height() - 35;
        searchObjectsElm.css('max-height', backgroundHeight + 'px');
        sideNavResizeIconElm.click(function () {

            tabInstance.destroy();
            if(slideOutElm.width() <= Number(minMenuWidth.replace(/\D/g, '')) ) {
                currentMenuWidth = maxMenuWidth;
                objectCounterContainerElm.removeClass('hide');
                slideOutElm.css('width', currentMenuWidth);
                sideNavResizeIconElm.text('keyboard_arrow_left')
                objectsTabElm.removeClass('tab').addClass('hide');

                objectsLabelElm.removeClass('hide');

                tabContainerElm.removeClass('s10').addClass('s5');
                objectsListTabElm.removeClass('s12').addClass('s7').addClass('border-right');
                actionsListElm.removeClass('s12').addClass('s5');
                objectsFilterTabElm.removeClass('s12').addClass('s5');

                searchObjectsElm.parent().removeClass('s12 hide').addClass('s7');
                searchActionsElm.parent().removeClass('s12 hide no-padding').addClass('s5');
                searchFiltersElm.parent().removeClass('s12 no-padding').addClass('s5 hide');
                setFocusToSearchBar();

                tabInstance = M.Tabs.init(document.getElementById('tabs'), {});
                if(config.tabItem !== 'FILTERS') tabInstance.select('actionsList');
                else tabInstance.select('objectsFilterTab');

                selectAllObjectsElm.removeClass('hide');
                actionReloadBtnElm.addClass('hide');
                resetFiltersBtnElm.addClass('hide');

                config.maximizeSideNav = true;
            } else {
                currentMenuWidth = minMenuWidth;
                slideOutElm.css('width', currentMenuWidth);
                sideNavResizeIconElm.text('keyboard_arrow_right')
                objectsTabElm.addClass('tab').removeClass('hide');
                objectsLabelElm.addClass('hide');

                tabContainerElm.removeClass('s5').addClass('s10');
                objectsListTabElm.removeClass('s7').addClass('s12').removeClass('border-right');
                actionsListElm.removeClass('s5').addClass('s12');
                objectsFilterTabElm.removeClass('s5').addClass('s12');

                searchObjectsElm.parent().removeClass('s7 hide').addClass('s12');
                searchActionsElm.parent().removeClass('s5').addClass('s12 hide no-padding');
                searchFiltersElm.parent().removeClass('s5').addClass('s12 hide no-padding');
                setFocusToSearchBar();

                objectsTabSwitchElm.removeClass('active');
                tabInstance = M.Tabs.init(document.getElementById('tabs'), {});
                tabInstance.select('objectsListTab');
                config.tabItem = 'OBJECTS';

                objectsTabSwitchElm.text('TO TOP');
                config.maximizeSideNav = false;
            }
            var backgroundHeight = $('#backgroundImg').height() - 35;
            searchObjectsElm.css('max-height', backgroundHeight + 'px');
            searchFiltersElm.css('max-height', backgroundHeight + 'px');

            if (!isMobile && !config.unlockSideNav) {
                $('header').css('padding-left', currentMenuWidth);
                $('main').css('padding-left', currentMenuWidth);
                $('footer').css('padding-left', currentMenuWidth);
            }

            searchObjectsElm.keydown(function (e) {
                if(e.which === 9) {
                    if(filterTabSwitchElm.hasClass('active')) {
                        tabInstance.select('objectsFilterTab');
                        lastFocusedSearchStringElm = searchFiltersElm;
                        searchFiltersElm.focus();
                        searchFiltersElm.trigger('keyup');
                    } else {
                        tabInstance.select('actionsList');
                        lastFocusedSearchStringElm = searchActionsElm;
                        searchActionsElm.focus();
                        searchActionsElm.trigger('keyup');
                    }
                    return false;
                } else lastFocusedSearchStringElm = searchObjectsElm
            });
            searchObjectsElm.click(function () { lastFocusedSearchStringElm = searchObjectsElm});

            searchActionsElm.keydown(function (e) {
                if(e.which === 9) {
                    lastFocusedSearchStringElm = searchObjectsElm
                    alepizObjectsNamespace.runSearchObjectsWhenNoActionFound();
                } else lastFocusedSearchStringElm = searchActionsElm
            });
            searchActionsElm.click(function () { lastFocusedSearchStringElm = searchActionsElm});

            searchFiltersElm.keydown(function (e) {
                if(e.which === 9) {
                    lastFocusedSearchStringElm = searchObjectsElm
                    alepizObjectsNamespace.runSearchObjectsWhenNoActionFound();
                }
                else lastFocusedSearchStringElm = searchFiltersElm
            });
            searchFiltersElm.click(function () { lastFocusedSearchStringElm = searchFiltersElm});

            saveConfig();
        });

        objectsLabelElm.click(function() {
            alepizObjectsNamespace.goToTop(function (isDrawObjects) {
                if(!isDrawObjects) return;
                alepizActionsNamespace.createActionsList(null, function () {
                    alepizMainNamespace.setBrowserHistory();
                    alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                });
            })
        });

        objectsTabSwitchElm.click(function() {
            objectsTabSwitchElm.text('TO TOP');
            // if pressed "to top"
            if(objectsTabSwitchElm.hasClass('active')) {
                alepizObjectsNamespace.goToTop(function (isDrawObjects) {
                    if(!isDrawObjects) return;
                    alepizActionsNamespace.createActionsList(null, function () {
                        alepizMainNamespace.setBrowserHistory();
                        alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                    });
                });
            } else {
                searchActionsElm.parent().addClass('hide');
                searchFiltersElm.parent().addClass('hide');
                searchObjectsElm.parent().removeClass('hide');
                if(searchObjectsElm.val()) searchIconElm.addClass('hide');
                else searchIconElm.removeClass('hide');

                var checkedFiltersNum = alepizFiltersNamespace.getCheckedFilterNames().length;
                if(searchObjectsAddElm.val()) ++checkedFiltersNum;
                filterTabSwitchElm.text('FILTERS' + (checkedFiltersNum ? ' [' + checkedFiltersNum + ']' : ''));
                if(config.tabItem !== 'OBJECTS') {
                    config.tabItem = 'OBJECTS';
                    saveConfig()
                }
                searchObjectsElm.trigger('keydown');

                selectAllObjectsElm.removeClass('hide');
                actionReloadBtnElm.addClass('hide');
                resetFiltersBtnElm.addClass('hide');
            }
        });

        actionsTabSwitchElm.click(function() {
            var checkedObjectsNum = alepizObjectsNamespace.getSelectedObjectNames().length;
            objectsTabSwitchElm.text('OBJECTS' + (checkedObjectsNum ? ' [' + checkedObjectsNum + ']' : ''));
            var checkedFiltersNum = alepizFiltersNamespace.getCheckedFilterNames().length;
            if(searchObjectsAddElm.val()) ++checkedFiltersNum;
            filterTabSwitchElm.text('FILTERS' + (checkedFiltersNum ? ' [' + checkedFiltersNum + ']' : ''));

            if(!actionsTabSwitchElm.hasClass('active')) {
                if(currentMenuWidth === minMenuWidth) {
                    searchObjectsElm.parent().addClass('hide');
                    selectAllObjectsElm.addClass('hide');
                    actionReloadBtnElm.removeClass('hide');
                    resetFiltersBtnElm.addClass('hide');
                }
                searchFiltersElm.parent().addClass('hide');
                searchActionsElm.parent().removeClass('hide');
                if(searchActionsElm.val()) searchIconElm.addClass('hide');
                else searchIconElm.removeClass('hide');
            }
            alepizActionsNamespace.createActionsList();
            if(config.tabItem !== 'ACTIONS') {
                config.tabItem = 'ACTIONS';
                saveConfig();
            }
            searchActionsElm.trigger('click');
        });

        filterTabSwitchElm.click(function () {
            searchActionsElm.parent().addClass('hide');
            if(currentMenuWidth === minMenuWidth) {
                searchObjectsElm.parent().addClass('hide');
                selectAllObjectsElm.addClass('hide');
                actionReloadBtnElm.addClass('hide');
                resetFiltersBtnElm.removeClass('hide');
            }
            searchFiltersElm.parent().removeClass('hide');
            if(searchFiltersElm.val()) searchIconElm.addClass('hide');
            else searchIconElm.removeClass('hide');

            var checkedObjectsNum = alepizObjectsNamespace.getSelectedObjectNames().length;
            objectsTabSwitchElm.text('OBJECTS' + (checkedObjectsNum ? ' [' + checkedObjectsNum + ']' : ''));
            if(config.tabItem !== 'FILTERS') {
                config.tabItem = 'FILTERS';
                saveConfig();
            }
            searchFiltersElm.trigger('click');
        });

        resetFiltersBtnElm.click(function () {
            alepizFiltersNamespace.createObjectsFiltersTab([]);
            searchObjectsAddElm.val('').trigger('keyup');
        });

        actionReloadBtnElm.click(reload);


        objectGroupIconElm.click(function () {
            objectGroupIconCrossOutElm.toggleClass('hide');
            var selectedObjectIDs = alepizObjectsNamespace.getSelectedObjects().map(function (obj) { return String(obj.id); });
            config.groupingObjects = objectGroupIconCrossOutElm.hasClass('hide');
            saveConfig();
            alepizObjectsNamespace.reDrawObjects(null, function () {
                if(config.groupingObjects) {
                    $('input[data-object-type="group"]').each(function () {
                        var objectIDs = $(this).attr('id').split('-');
                        var isAllObjectsSelectedItGroup = true;
                        for(var i = 0; i < objectIDs.length; i++) {
                            if(selectedObjectIDs.indexOf(objectIDs[i]) === -1) isAllObjectsSelectedItGroup = false;
                        }
                        if(isAllObjectsSelectedItGroup) $(this).prop('checked', true);
                        else $(this).prop('checked', false);
                    });
                } else {
                    $('input[data-object-name]').each(function () {
                        var objectIDs = $(this).attr('id');
                        if(selectedObjectIDs.indexOf(objectIDs) !== -1) $(this).prop('checked', true);
                    });
                }
            });
        });
        objectGroupIconCrossOutElm.click(function () {
            objectGroupIconElm.trigger('click');
        });
    }

    function setFocusToSearchBar() {
        if(!isMobile && !alepizAuthSystem.authorizationInProgress() && !searchObjectsAddElm.is(':focus')) {
            if(currentMenuWidth === minMenuWidth) {
                if (!searchActionsElm.parent().hasClass('hide')) searchActionsElm.focus();
                else if (!searchObjectsElm.parent().hasClass('hide')) searchObjectsElm.focus();
                else if (!searchFiltersElm.parent().hasClass('hide')) searchFiltersElm.focus();
            } else {
                if (!lastFocusedSearchStringElm.hasClass('hide')) lastFocusedSearchStringElm.focus();
            }
        }
    }

    function setDocumentTitle(checkedObjectNames) {
        var title = $('li[data-action-name].active').attr('data-action-name') || 'ALEPIZ';
        if(!checkedObjectNames) checkedObjectNames = alepizObjectsNamespace.getSelectedObjectNames() || [];

        if(checkedObjectNames.length) {
            var objectsStr = checkedObjectNames.join('; ');
            if(objectsStr.length > 50) {
                objectsStr = objectsStr.substring(0, 50) + '...[' + checkedObjectNames.length + ']';
            }
            title += ' (' + objectsStr + ')';
        }
        document.title = title;
    }

    // setParametersToUrl - for simple search this function
    function setBrowserHistory() {
        setDocumentTitle();
        setThemeColor(document, themeColor);

        var activeActionLink = $('li[data-action-link].active').attr('data-action-link');
        if(!activeActionLink) activeActionLink = '';

        // get parameters from URL
        // parametersFromURL.checkedObjectsNames = [name1, name2,..]; parametersFromURL.uncheckedObjectsNames = [name1, name2, ...];
        // parametersFromURL.activeActionLink = /action/link; parametersFromURL.actionParameters = [{key:.., val:..,}, {}, ...]
        var parametersFromURL = getParametersFromURL();
        // get checked and unchecked objects names form objects list elements or saved object list,
        // if additional objects tab is active
        // checkedObjectsNames = [name1, name2, ...]; uncheckedObjectsNames = [name1, name2, ..]
        var checkedObjectNames = alepizObjectsNamespace.getSelectedObjectNames();
        var uncheckedObjectNames = alepizObjectsNamespace.getUnselectedObjectNames();

        var actionParameters = [];
        if(activeActionLink) {
            if(parametersFromURL.activeActionLink === activeActionLink) {
                // add action actionParameters
                actionParameters = parametersFromURL.actionParameters.map(function(prm) {
                    return encodeURIComponent(prm.key) + '=' + encodeURIComponent(prm.val);
                });
            }
            actionParameters.push('a='+encodeURIComponent(activeActionLink))
        }

        // use array because we don't know about existence of each URL parameter and if we concat strings
        // we can get strange result f.e.'http://localhost:3000/?&a=%2Factions%2Fobjects_creator&u=Servers%2CSystem%20objects'
        var URLArray = [];
        Array.prototype.push.apply(URLArray, actionParameters); // copy actionParameters array to URLArray
        if(uncheckedObjectNames.length) URLArray.push('u='+encodeURIComponent(uncheckedObjectNames.join(',')));
        if(checkedObjectNames.length) URLArray.push('c='+encodeURIComponent(checkedObjectNames.join(',')));

        var URL = URLArray.length ? '?' + URLArray.join('&') : '';

        if(checkedObjectNames.length + uncheckedObjectNames.length ===
            parametersFromURL.checkedObjectsNames.length + parametersFromURL.uncheckedObjectsNames.length) {
            var allObjects = checkedObjectNames.slice();
            Array.prototype.push.apply(allObjects, uncheckedObjectNames);

            var isObjectListsAreSimilar = allObjects.every(function (objectName) {
                return parametersFromURL.uncheckedObjectsNames.indexOf(objectName) !== -1 ||
                    parametersFromURL.checkedObjectsNames.indexOf(objectName) !== -1
            });
        }

        // for similar object list:
        // when only the action has changed or the names of the objects in the list are the same as the previous list
        // of objects (not comparing checked and unchecked objects), replace the previous entry in the history
        if(isObjectListsAreSimilar) window.history.replaceState(null, document.title, URL);
        else window.history.pushState(null, document.title, URL);
    }

    function saveConfig() {
        $.post(configID, {
            func: 'setActionConfig',
            config: JSON.stringify(config)
        });
    }

    function initActionsAndObjectsListsFromBrowserURL(callback) {
        var parametersFromURL = getParametersFromURL();
        alepizObjectsNamespace.createObjectsList(parametersFromURL.uncheckedObjectsNames,
            parametersFromURL.checkedObjectsNames, function () {
            alepizActionsNamespace.createActionsList(parametersFromURL.activeActionLink, function () {
                if(typeof callback === 'function') callback(parametersFromURL.actionParameters);
            });
        });
    }

    function reload() {
        initActionsAndObjectsListsFromBrowserURL(function() {
            alepizDrawActionNamespace.getActionHTMLAndShowActionButtons(true, function(html){
                alepizDrawActionNamespace.drawAction(html);
                setTimeout(alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList, 300);
            });
        });
    }

    function createNavBarLinks(navBarLinksArray) {
        if(!Array.isArray(navBarLinksArray)) return;
        var navbarLinks = {};
        var html = navBarLinksArray.map(function (link) {
            if(!link.name || typeof link.name !== 'string') return '';

            var url = typeof link.URL === 'string' ? link.URL : '#';
            var target = link.openInNewWindow ? ' target="_blank"' : ''
            navbarLinks[link.name] = link;
            return '<li class="hide-on-med-and-down"><a href="' + url + '" data-navbar-link="' + link.name +
                '"' + target + '>' +
            escapeHtml(link.name) + '</a></li>';
        });

        $('#navBarLinks').html(html);

        $('a[data-navbar-link]').click(function (e) {
            var linkName = $(this).attr('data-navbar-link');
            if(!navbarLinks[linkName]) return;

            if(Array.isArray(navbarLinks[linkName].parentObjects)) {
                var objectDrawFunction = {
                    func: alepizObjectsNamespace.createObjectsListByInteractions,
                    search: false,
                    param: [navbarLinks[linkName].parentObjects, true],
                }
            } else if(typeof navbarLinks[linkName].searchStr === 'string') {
                objectDrawFunction = {
                    func: alepizObjectsNamespace.globalSearchObjects,
                    search: false,
                    param: [navbarLinks[linkName].searchStr],
                }
            } else if(Array.isArray(navbarLinks[linkName].checkedObjectNames) ||
                Array.isArray(navbarLinks[linkName].uncheckedObjectNames)) {

                var checkedObjectNames = Array.isArray(navbarLinks[linkName].checkedObjectNames) ?
                    navbarLinks[linkName].checkedObjectNames : null;
                var uncheckedObjectNames = Array.isArray(navbarLinks[linkName].uncheckedObjectNames) ?
                    navbarLinks[linkName].uncheckedObjectNames : null;

                objectDrawFunction = {
                    func: alepizObjectsNamespace.createObjectsList,
                    search: false,
                    param: [uncheckedObjectNames, checkedObjectNames],
                }
            } else return;
            e.preventDefault();
            alepizFiltersNamespace.createObjectsFiltersTab(navbarLinks[linkName].filters, function () {
                alepizObjectsNamespace.reDrawObjects(objectDrawFunction);
            });
        });
    }

    function setIframeHeight() {
        var windowHeight = window.innerHeight;
        iframeContainerElm.height(windowHeight - navBarHeight);
    }

    function mergeGroups(config, defaultConfig) {
        var objectGroups = [], objectNames = {};
        if(!Array.isArray(config.objectGroups)) config.objectGroups = [];
        if(!Array.isArray(defaultConfig.objectGroups)) defaultConfig.objectGroups = [];

        config.objectGroups.forEach(mergeGroup);
        defaultConfig.objectGroups.forEach(mergeGroup);

        return objectGroups;

        function mergeGroup(group) {
            var newGroupObj = {};
            if(typeof group.name !== 'string' || !group.name || typeof group.re !== 'string' || !group.re) {
                return console.error('Error in parameters for grouping objects (name or re):', group);
            }
            if(objectNames[group.name.toUpperCase()]) return;

            try {
                newGroupObj.RE = new RegExp(group.re, "gi");
            } catch (err) {
                console.error('Can\'t compile RegExp for grouping objects', group, ':', err.message);
                return;
            }
            for(var key in group) newGroupObj[key] = group[key];
            objectGroups.push(newGroupObj);
            objectNames[group.name.toUpperCase()] = true;
        }
    }

    function getRandomColor() {
        var letters = '0123456789ABCDEF'.split('');
        var color = '#';
        for (var i = 0; i < 6; i++ ) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    return {
        setBrowserHistory: setBrowserHistory,
        reload: reload,
        getConfig: function () { return config; },
        getObjectGroups: function () { return objectGroups; },
        saveConfig: saveConfig,
        getSessionID: function () { return sessionID; },
        setSessionID: function (_sessionID) { sessionsIDs[_sessionID] = true; sessionID = _sessionID},
        getSessionIDs: function () { return Object.keys(sessionsIDs); },
        getThemeColor: function () { return themeColor; },
    }

})(jQuery); // end of jQuery name space