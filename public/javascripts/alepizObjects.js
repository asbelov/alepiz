/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizObjectsNamespace = (function($) {

    var objectsListElm,
        objectsListTabElm,
        selectAllObjBtnElm,
        filterExpressionEditorElm,
        searchObjectsElm,
        searchActionsElm,
        searchFiltersElm,
        searchObjectsAddElm,
        filterCounterElm,
        filterCounterContainerElm,
        objectsTabSwitchElm,
        filterTabSwitchElm,
        objectCounterElm,
        walletElm,
        walletCounterElm,
        walletIconElm,
        objectGroupIconCrossOutElm,
        searchIconElm,

        objectsTooltipInstances,

        useGlobalSearch = false,
        prevSearchStrLength = 0,
        minSearchStrLength = 2,
        timeWhenNoObjectsWereFound = 0,
        redrawObjectsInProgress = false,
        /** used for get data about objects when used object grouping
         * @type {Object.<objectID: Object>}
         * @example
         * {
         *      <id1>: {id, name, description, sortPosition, color, disabled, created},
         *      <id2>: {id, name, description, ...},
         *      ...
         * }
         */
        currentObjects = {},

        /** used for saving to the wallet (when pressed to the object counter) selected objects
         * @type {Object.<objectID: objectName>}
         * @example
         * {
         *      <id1>: <name1>,
         *      <id2>: <name2>,
         *      ...
         * }
         */
        walletObjectsList = {},
        lastObjectDrawFunction = {
            func: createObjectsListByInteractions,
            search: false,
            param: [],
        },
        objectDrawFunctionBeforeSearch = {
            func: createObjectsListByInteractions,
            param: [],
        };


    function init () {
        initJQueryElements();
        initEvents();
    }

    function initJQueryElements() {
        objectsListElm = $('#objectsList');
        objectsListTabElm = $('#objectsListTab');
        selectAllObjBtnElm = $('#selectAllObjBtn');
        filterExpressionEditorElm = $('#filterExpressionEditor');
        searchObjectsElm = $('#searchObjects');
        searchActionsElm = $('#searchActions');
        searchFiltersElm = $('#searchFilters');
        searchObjectsAddElm = $('#searchObjectsAdd');
        filterCounterElm = $('#filterCounter');
        filterCounterContainerElm = $('#filterCounterContainer');
        objectsTabSwitchElm = $('#objectsTabSwitch');
        filterTabSwitchElm = $('#filterTabSwitch');
        objectCounterElm = $('#objectCounter');
        walletElm = $('#wallet');
        walletCounterElm = $('#walletCounter');
        walletIconElm = $('#walletIcon');
        objectGroupIconCrossOutElm = $('#objectGroupIconCrossOut');
        searchIconElm = $('#searchIcon');
    }

    function initEvents() {

        // Search objects when enter something in search string
        searchObjectsElm.keyup(function(e) {
            // When pressing Esc, clear search field ang go to the top of the object list
            var searchStr = searchObjectsElm.val();
            var searchStrAdd = searchObjectsAddElm.val();

            // Esc pressed in search string or search string is empty
            if(e.which === 27 || !searchStr.trim().length) {
                // if not empty, make it empty
                searchObjectsElm.val('');
                searchIconElm.removeClass('hide');
                if(searchStrAdd.trim().length) {
                    globalSearchObjects(searchStrAdd,function (isDrawObjects) {
                        if(!isDrawObjects) return;
                        alepizActionsNamespace.createActionsList(null, function () {
                            alepizMainNamespace.setBrowserHistory();
                            alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                        });
                    });
                } else {
                    if(e.which === 27) reDrawObjects(objectDrawFunctionBeforeSearch);
                    else reDrawObjects();
                }
                useGlobalSearch = false;
            } else {
                searchIconElm.addClass('hide');
                if(searchStrAdd.trim().length) {
                    globalSearchObjects(searchStrAdd, function (isDrawObjects) {
                        if(!isDrawObjects) return;
                        alepizActionsNamespace.createActionsList(null, function () {
                            alepizMainNamespace.setBrowserHistory();
                            alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                        });
                    });
                } else {
                    // switch form global search mode to filter mode
                    // if search string length < minSearchStrLength or < prevSearchStrLength
                    if(useGlobalSearch === true &&
                        (searchStr.length < minSearchStrLength || searchStr.length < prevSearchStrLength)) {
                        useGlobalSearch = false;
                        reDrawObjects(objectDrawFunctionBeforeSearch, function () {
                            // when find nothing, try to use globalSearch again
                            if(!filterObject() && searchStr.length >= minSearchStrLength) {
                                globalSearchObjects(searchStr,function (isDrawObjects) {
                                    if(!isDrawObjects) return;
                                    alepizActionsNamespace.createActionsList(null, function () {
                                        alepizMainNamespace.setBrowserHistory();
                                        alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                                    });
                                });
                            }
                        });
                    } if(useGlobalSearch === true || !filterObject()) {
                        globalSearchObjects(searchStr,function (isDrawObjects) {
                            if(!isDrawObjects) return;
                            alepizActionsNamespace.createActionsList(null, function () {
                                alepizMainNamespace.setBrowserHistory();
                                alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                            });
                        });
                    }
                }
            }

            prevSearchStrLength = searchStr.length;
        });

        searchObjectsAddElm.keyup(function (e) {
            var searchStrAdd = searchObjectsAddElm.val();
            if(e.which === 27) { // Esc pressed in search string
                // if not empty, make it empty
                searchObjectsAddElm.val('');
                reDrawObjects(objectDrawFunctionBeforeSearch);
            } else if(!searchStrAdd.trim().length) { // search string is empty
                reDrawObjects();
            } else {
                globalSearchObjects(searchStrAdd,function (isDrawObjects) {
                    if(!isDrawObjects) return;
                    alepizActionsNamespace.createActionsList(null, function () {
                        alepizMainNamespace.setBrowserHistory();
                        alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                    });
                });
                var checkedFiltersNum = alepizFiltersNamespace.getCheckedFilterNames().length;
                if(searchObjectsAddElm.val()) ++checkedFiltersNum;
                filterCounterContainerElm.removeClass('hide');
                filterCounterElm.text(checkedFiltersNum);
                filterTabSwitchElm.text('FILTERS [' + checkedFiltersNum + ']');
            }
        });

        selectAllObjBtnElm.change(function() {
            //e.preventDefault();
            if($(this).is(':checked')) {
                $('input[data-object-name]').each(function () {
                    if(!$(this).parent().parent().parent().parent().hasClass('hide')) {
                        $(this).prop('checked', true);
                    }
                });
            } else {
                // I don't know why, but it's does not work
                //$('li:not(.hide) :input[objectName]').prop('checked', false);
                $('input[data-object-name]').each(function () {
                    if(!$(this).parent().parent().parent().parent().hasClass('hide')) {
                        $(this).prop('checked', false);
                    }
                });
            }
            setCheckedObjectCounter();
            alepizActionsNamespace.createActionsList(null, function () {
                alepizMainNamespace.setBrowserHistory();
                alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
            });
        });

        objectCounterElm.click(function () {
            walletCounterElm.text('');
            walletIconElm.text('download');
            walletElm.removeClass('hide');

            $('input[data-object-name]:checked').each(function() {
                var objectIDs = $(this).attr('id').split('-');
                objectIDs.forEach(id => {
                    if(currentObjects[id]) walletObjectsList[id] = currentObjects[id].name;
                    else walletObjectsList[id] = $(this).attr('data-object-name');
                });
            });

            // setTimeout is used for animation
            setTimeout(function () {
                walletIconElm.text('folder');
                walletCounterElm.text(Object.keys(walletObjectsList).length);
            }, 300);
        });

        walletElm.click(function () {
            walletCounterElm.text('');
            walletIconElm.text('drive_file_move_rtl');

            // setTimeout is used for animation
            setTimeout(function() {
                createObjectsList(null, Object.values(walletObjectsList),
                    function (isDrawObjects) {

                    if(!isDrawObjects) return;
                    alepizActionsNamespace.createActionsList(null, function () {
                        alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                        alepizMainNamespace.setBrowserHistory();
                    });
                });
                walletObjectsList = {};
                // setTimeout is used for animation
                setTimeout(function () {
                    walletElm.addClass('hide');
                }, 300);
            }, 300);
        });
    }


    // run one of createObjectsList(), createObjectsListByInteractions(), globalSearchObjects() function
    function reDrawObjects(objectDrawFunction, callback) {
        if(!objectDrawFunction) objectDrawFunction = lastObjectDrawFunction;
        if(redrawObjectsInProgress) {
            redrawObjectsInProgress = objectDrawFunction;
            redrawObjectsInProgress.callback = callback;
            return;
        }
        redrawObjectsInProgress = true;
        // !!!! there are not objects names when used object grouping
        var checkedElementNames = $('input[data-object-name]:checked').get().map(function (elm) {
            return $(elm).attr('data-object-name');
        });

        var param = objectDrawFunction.param.slice();
        param.push(function(isDrawObjects) {
            if(isDrawObjects && checkedElementNames.length) {
                checkedElementNames.forEach(function (name) {
                    $('input[data-object-name="' + name + '"]').prop('checked', true);
                });

                alepizActionsNamespace.createActionsList(null, function () {
                    alepizMainNamespace.setBrowserHistory();
                    alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                });
            }
            setCheckedObjectCounter();
            if(typeof callback === 'function') callback();

            var objectDrawFunction = redrawObjectsInProgress;
            redrawObjectsInProgress = false;
            if(objectDrawFunction.func) reDrawObjects(objectDrawFunction, objectDrawFunction.callback);
        });
        objectDrawFunction.func.apply(this, param);
    }


    // try to search objects, when searching actions and no actions are found
    function runSearchObjectsWhenNoActionFound(searchActionStr) {
        var tabInstance = M.Tabs.getInstance(document.getElementById('tabs'));
        tabInstance.select('objectsListTab');
        reDrawObjects();
        setTimeout(function () { searchObjectsElm.focus() }, 200);
        if(searchActionStr) {
            searchObjectsElm.val(searchActionStr);
            if(!searchObjectsAddElm.val().length) useGlobalSearch = true;
            searchObjectsElm.trigger('keyup');
        }
    }

    function filterObject() {
        return filterList(searchObjectsElm.val(), objectsListElm, 'data-object-name');
    }

    function filterList(initSearchStr, listElm, objectNameAttr) {

        var listRows = listElm.find('li');
        if (!initSearchStr.length) {
            listRows.removeClass('hide');
            return;
        }

        var searchStrRE = '(.*' + initSearchStr.
            replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&'). // escape regExp symbols except *
            replace(/[&|]\**[&|]/, '&'). // replace '|*&' or '&*|' to '&', don't ask why
            replace(/\*+/g, '.*'). // replace '*' characters to '.*'
            replace(/_/g, '.'). // replace '_' characters to '.'
            replace(/\s*[|\r\n]+\s*/g, '.*)|(.*').// replace spaces around and '|', '\r', '\n' characters to '.*)|(.*'
            replace(/\s*&+\s*/g, '.*)&(.*'). // replace spaces around and '&' characters to '.*)&(.*'
            replace(/^\s+/, '').replace(/\s+$/, '')  // remove forward and backward spaces characters
            +'.*)';

        try {
            var searchRE = new RegExp(searchStrRE, 'ig');
        } catch (e) {
            console.log('Error creating regExp from object search string:', initSearchStr, '->',
                searchStrRE, ':', e.message);
            return;
        }

        // try to find the search string in the names of the current objects and hide the objects that do
        // not match the search string
        var numberOfFoundedObjects = 0;
        $('input[' + objectNameAttr + ']').closest('li').removeClass('hide');
        listRows.find('input[' + objectNameAttr + ']').each(function () {
            var objectName = $(this).attr(objectNameAttr);
            if (!searchRE.test(objectName) && !$(this).is(':checked')) {
                $(this).closest('li').addClass('hide');
            } else numberOfFoundedObjects++;
            searchRE.lastIndex = 0;
        });

        // nothing was not filtered. show all objects
        if (!numberOfFoundedObjects) listRows.removeClass('hide');

        return numberOfFoundedObjects;
    }

    function globalSearchObjects(searchStr, callback) {

        if(!searchStr) searchStr = searchObjectsElm.val();

        // begin global search only after print 2 characters
        if(searchStr.length < minSearchStrLength) {
            useGlobalSearch = false;
            if(typeof callback === 'function') callback();
            return;
        }

        var searchStrAdd = searchObjectsAddElm.val();
        if(!searchStrAdd.length) useGlobalSearch = true;

        // if active tab for objects
        // replace new string to "+"
        // set first object to @search for correct search request processing in createFilterMenu
        $.post('/mainMenu', {
            f: 'searchObjects',
            searchStr: searchStr.replace(/[\r\n]+/g, '|'),
            filterNames: alepizFiltersNamespace.getCheckedFilterNames().join(','),
            filterExpression: alepizFiltersNamespace.getFilterExpression(),
        }, function(objects) {
            // objects: [{name: objectName1, description: objectDescription1, id: objectID1, color: <color>:<shade>, disabled: <1|0>},...]

            if((!objects || !objects.length) && Date.now() - timeWhenNoObjectsWereFound > 4000) {
                timeWhenNoObjectsWereFound = Date.now();
                //M.toast({html: 'No objects found or too many objects found', displayLength: 3000});
            }
            var isDrawObjects = drawObjectsList(objects);
            if(searchStrAdd.length) filterObject();

            if(!lastObjectDrawFunction.search) objectDrawFunctionBeforeSearch = lastObjectDrawFunction;
            lastObjectDrawFunction = {
                func: globalSearchObjects,
                search: true,
                param: [searchStr],
            };

            setCheckedObjectCounter();
            if(typeof callback === 'function') callback(isDrawObjects);
        });
    }

    // Creating objects list

    // uncheckedObjectsNames: array of objects names for process of their interaction result and draw a new objects list
    // selectedObjectsNames: array of selected objects names
    // callback()
    function createObjectsList(uncheckedObjectNames, checkedObjectNames, callback) {

        // if parameters were not set, get checked and unchecked object lists from the URL
        if(!uncheckedObjectNames && !checkedObjectNames) {
            var parametersFromURL = getParametersFromURL();
            checkedObjectNames = parametersFromURL.checkedObjectsNames;
            uncheckedObjectNames = parametersFromURL.uncheckedObjectsNames;
        }

        // create object list without duplicates
        var objectNames = {};
        if(Array.isArray(uncheckedObjectNames)) uncheckedObjectNames.forEach(function (o) { objectNames[o] = false; });
        if(Array.isArray(checkedObjectNames)) checkedObjectNames.forEach(function (o) { objectNames[o] = true; });

        if(!Object.keys(objectNames).length) return goToTop(callback);

        var objectNamesStr = Object.keys(objectNames).join(',');

        $.post('/mainMenu', {
                f: 'getObjectsByName',
                name: objectNamesStr,
                filterNames: alepizFiltersNamespace.getCheckedFilterNames().join(','),
                filterExpression: alepizFiltersNamespace.getFilterExpression(),
            },
            // objects: [{id:.., name:.., description:.., color: <color>:<shade>}, {..}, ...]
            function(objects) {
                if(objects && objects.length) {
                    if (Array.isArray(checkedObjectNames) && checkedObjectNames.length) {
                        /*
                         Add to all objects of "objects" array property "selected":
                         true if object name is present in checkedObjectNames array or "selected":
                         false if not present
                         */
                        objects.forEach(function (obj) {
                            obj.selected = checkedObjectNames.indexOf(obj.name) !== -1;
                        });
                    }
                } // else M.toast({html: 'Objects "' + objectNamesStr + '" are not found or filtered out', displayLength: 3000});

                //objects: [{name: objectName1, description: objectDescription1, id: objectID1, selected: <true|false>, color: <color>:<shade>, disabled: <1|0>},...]
                var isDrawObjects = drawObjectsList(objects);
                filterObject();

                lastObjectDrawFunction = {
                    func: createObjectsList,
                    search: false,
                    param: [null, null],
                };

                setCheckedObjectCounter();
                if(typeof(callback) === 'function') return callback(isDrawObjects);
            }
        );
    }

    // Creating filtered objects list

    // checkedObjectsNames: array of objects names for process of their interaction result and draw a new objects list
    // selectedObjectsNames: array of selected objects names
    // callback()
    function createObjectsListByInteractions(parentObjectNames, isClearObjectListWhenObjectNotFound, callback) {

        var objectsNamesStr = Array.isArray(parentObjectNames) && parentObjectNames.length ?
            parentObjectNames.join(',') : '';

        $.post('/mainMenu', {
                f: 'filterObjectsByInteractions',
                name: objectsNamesStr,
                filterNames: alepizFiltersNamespace.getCheckedFilterNames().join(','),
                filterExpression: alepizFiltersNamespace.getFilterExpression(),
            },
            // objects: [{id:.., name:.., description:..}, {..}, ...]
            function(objects) {
                if(!isClearObjectListWhenObjectNotFound && (!objects || !objects.length)) {
                    if(typeof(callback) === 'function') callback();
                    return;
                }

                //objects: [{name: objectName1, description: objectDescription1, id: objectID1, selected: <true|false>, color: <color>:<shade>, disabled: <1|0>},...]
                var isDrawObjects = drawObjectsList(objects);
                filterObject();
                lastObjectDrawFunction = {
                    func: createObjectsListByInteractions,
                    search: false,
                    param: [parentObjectNames, true],
                };

                setCheckedObjectCounter();
                if(typeof(callback) === 'function') return callback(isDrawObjects);
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
    function drawObjectsList(objects) {
        var html = '';

        if(objects && objects.length) {
            var elements = groupingObjects(objects);
            html = elements.sort(function(a,b) {
                if(a.sortPosition > b.sortPosition) return 1;
                if(a.sortPosition < b.sortPosition) return -1;
                if(a.name.toUpperCase() > b.name.toUpperCase()) return 1;
                if(a.name.toUpperCase() < b.name.toUpperCase()) return -1;
                return 0;
            }).map(function (obj) {
                var id = Array.isArray(obj.id) ? obj.id.join('-') : obj.id;
                return ('\
<li>\
        <a class="tooltipped row ' + (obj.cnt ? 'group' : 'object') +
                    '" data-object-list data-position="right" data-tooltip="' +
                    escapeHtml(obj.description ? obj.name + ': ' + obj.description : obj.name) + '">\
            <div class="col s2 object-checkbox">\
                <label>\
                    <input type="checkbox" id="' + id + '" data-object-name="' + obj.name + '"' +
                    (obj.selected || (obj.cnt && obj.cnt === obj.selectedObjects) ? ' checked' : '') +
                    ' data-object-type="' + (obj.cnt ? 'group' : 'object') + '"/>\
                    <span></span>\
                </label>\
            </div>\n\
            <div class="col s9 truncate object-label' + (obj.disabled ? ' italic' : '') +
                    getCSSClassForObjectColor(obj) + '" data-object-id="' + id + '">' + escapeHtml(obj.name) +
                    (obj.cnt ? ' [' + obj.cnt + ']' : '') + '</div>\
        </a>\
</li>');
            }).join('');
        }


        // don't redraw objects list if previous objects list html is the same with current
        if(previousHTMLWithObjectList === html) return;

        previousHTMLWithObjectList = html;

        if(objectsTooltipInstances && objectsTooltipInstances.length) {
            objectsTooltipInstances.forEach(function (instance) {
                instance.destroy();
            });
        }
        $('div.material-tooltip').remove();

        objectsListElm.html(html);
        objectsTooltipInstances = M.Tooltip.init(document.querySelectorAll('a[data-object-list]'), {
            enterDelay: 500
        });

        // click at an object checkbox
        $('input[data-object-name]').click(function () {
            setCheckedObjectCounter();
            alepizActionsNamespace.createActionsList(null, function () {
                alepizMainNamespace.setBrowserHistory();
                alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
            });
        });

        // click at an object
        $('div[data-object-id]').click(function(eventObject){
            // set checkbox of current object checked
            var currentObjectID = $(eventObject.target).attr('data-object-id');
            $('#'+currentObjectID).prop('checked', true);

            if(!useGlobalSearch) searchObjectsElm.val('');

            // create new objects list
            createObjectsListByInteractions(getSelectedObjectNames(), false,
                function (isDrawObjects) {
                if(!isDrawObjects) return;
                alepizActionsNamespace.createActionsList(null, function () {
                    alepizDrawActionNamespace.redrawIFrameDataOnChangeObjectsList();
                    alepizMainNamespace.setBrowserHistory();
                });
            });

            // don't execute default action for this event
            eventObject.preventDefault();
        });

        return true;
    }

    function groupingObjects(objects) {
        currentObjects = {};
        objects.forEach(obj => { currentObjects[obj.id] = obj });
        if(!objectGroupIconCrossOutElm.hasClass('hide')) return objects;

        var groups = alepizMainNamespace.getObjectGroups();

        var objectGroups = {};
        objects.forEach(obj => {
            var isObjectInGroup = false;
            for(var i = 0; i < groups.length; i++) {
                groups[i].RE.lastIndex = 0;
                if(groups[i].RE.test(obj.name)) {
                    isObjectInGroup = true;
                    var groupName = groups[i].name;
                    if(!objectGroups[groupName]) {
                        objectGroups[groupName] = {
                            name: groupName,
                            cnt: 1,
                            selectedObjects: obj.selected ? 1: 0,
                            objects: [obj],
                            sortPosition: groups[i].sortPosition || obj.sortPosition,
                            description: groups[i].description,
                            color: groups[i].color,
                            id: [obj.id],
                        }
                    } else {
                        objectGroups[groupName].cnt++;
                        if(obj.selected) objectGroups[groupName].selectedObjects++;
                        objectGroups[groupName].objects.push(obj);
                        objectGroups[groupName].id.push(obj.id);
                        if(!groups[i].sortPosition && obj.sortPosition < objectGroups[groupName].sortPosition) {
                            objectGroups[groupName].sortPosition = obj.sortPosition;
                        }
                    }
                    break;
                }
            }
            if(!isObjectInGroup) objectGroups[obj.name] = obj;
        });

        return Object.values(objectGroups);
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
        if( !/^(lighten)|(darken)|(accent)-[1-4]$/.test(shade)) return ' ' + color + '-text';

        return ' ' + color + '-text text-' + shade;
    }

    function getSelectedObjectNames() {
        var objectNames = [];
        $('input[data-object-name]:checked').each(function() {
            $(this).attr('id').split('-').forEach(id => {
                objectNames.push(currentObjects[id].name)
            });
        });
        return objectNames;
    }

    function getSelectedObjects() {
        var objects = [];
        $('input[data-object-name]:checked').each(function() {
            $(this).attr('id').split('-').forEach(id => {
                objects.push({
                    id: Number(id),
                    name: currentObjects[id].name,
                });
            });
        });
        return objects;
    }

    function getUnselectedObjectNames() {
        var objectNames = [];
        $('input[data-object-name]:not(:checked)').each(function() {
            $(this).attr('id').split('-').forEach(id => {
                objectNames.push(currentObjects[id].name)
            });
        });
        return objectNames;
    }

    function setCheckedObjectCounter(objectNames) {
        var checkedObjectNames = Array.isArray(objectNames) ? objectNames : getSelectedObjectNames()
        var checkedObjectNum = typeof objectNames === 'number' ? objectNames : checkedObjectNames.length;
        var uncheckedObjectNum = getUnselectedObjectNames().length;
        if(checkedObjectNum) {
            objectCounterElm.removeClass('hide');
            objectCounterElm.text(checkedObjectNum);
            if(!uncheckedObjectNum) selectAllObjBtnElm.prop('checked', true);
        } else {
            objectCounterElm.addClass('hide');
            selectAllObjBtnElm.prop('checked', false);
        }
        lastObjectDrawFunction.checkedObjectNames = checkedObjectNames;
    }

    function goToTop(callback) {
        // go to the top
        searchObjectsElm.val('');
        searchObjectsAddElm.val('');
        createObjectsListByInteractions(null, true, callback);
    }

    return {
        init: init,
        createObjectsList: createObjectsList,
        createObjectsListByInteractions: createObjectsListByInteractions,
        globalSearchObjects: globalSearchObjects,
        getSelectedObjectNames: getSelectedObjectNames,
        getSelectedObjects: getSelectedObjects,
        getUnselectedObjectNames: getUnselectedObjectNames,
        runSearchObjectsWhenNoActionFound: runSearchObjectsWhenNoActionFound,
        goToTop: goToTop,
        reDrawObjects: reDrawObjects,
        filterList: filterList,
    }
})(jQuery);