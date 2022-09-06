/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


alepizFiltersNamespace = (function($) {
    var filterTabSwitchElm,
        objectsTabSwitchElm,
        filterExpressionEditorElm,
        objectsFilterElm,
        searchObjectsElm,
        searchActionsElm,
        searchFiltersElm,
        searchObjectsAddElm,
        objectsTabElm,
        filterCounterContainerElm,
        filterCounterElm,
        filterEditIconElm,
        searchIconElm,
        filterTooltipInstances,
        modalChangeObjectsFilterInstance;

    function init () {
        initJQueryElements();
        initMaterializeElements();
        initEvents();
    }

    function initJQueryElements() {
        objectsFilterElm = $('#objectsFilter');
        objectsTabSwitchElm = $('#objectsTabSwitch');
        filterTabSwitchElm = $('#filterTabSwitch');
        filterExpressionEditorElm = $('#filterExpressionEditor');
        searchObjectsElm = $('#searchObjects');
        searchActionsElm = $('#searchActions');
        searchFiltersElm = $('#searchFilters');
        searchObjectsAddElm = $('#searchObjectsAdd');
        objectsTabElm = $('#objectsTab');
        filterCounterContainerElm = $('#filterCounterContainer');
        filterCounterElm = $('#filterCounter');
        filterEditIconElm = $('#filterEditIcon');
        searchIconElm = $('#searchIcon');
    }

    function initMaterializeElements() {
        modalChangeObjectsFilterInstance = M.Modal.init(
            document.getElementById('modal-change-objects-filter-expr'), {});
    }

    function initEvents() {
        filterCounterElm.click(function() {
            var checkedFilterNames = getCheckedFilterNames();
            if(!checkedFilterNames || checkedFilterNames.length < 2) return;
            modalChangeObjectsFilterInstance.open();
        });

        filterEditIconElm.click(function() {
            var checkedFilterNames = getCheckedFilterNames();
            if(!checkedFilterNames || checkedFilterNames.length < 2) return;
            modalChangeObjectsFilterInstance.open();
        });

        // Search objects when enter something in search string
        searchFiltersElm.keyup(function(e) {
            // When pressing Esc, clear search field ang go to the top of the object list
            var searchStr = searchFiltersElm.val();
            if(e.which === 27 || !searchStr.length) { // Esc pressed in search string or search string is empty
                // if not empty, make it empty
                searchFiltersElm.val('');
                searchIconElm.removeClass('hide');
                filterFilterList();
            } else {
                searchIconElm.addClass('hide');
                filterFilterList(searchStr);
            }
        });

        // find it at alepizObjects.js
        //searchObjectsAddElm.keyup(function () {})
    }

    function createObjectsFiltersTab(filter, callback) {
        // filterNames: [{name:..., description:...}, {}...]
        $.post('/mainMenu', {f: 'getObjectsFiltersConfig'}, function(filterConfig) {
            if(!filterConfig || !filterConfig.length) {
                objectsFilterElm.empty();
                if(typeof callback === 'function') callback();
                return;
            }
            var checkedFilterNames = filter || getCheckedFilterNames();
            var html = filterConfig.map(function (filterObj) {
                var filterName = filterObj.name;
                var filterDescription = filterObj.description || '';
                var checked = checkedFilterNames.indexOf(filterName) !== -1 ||
                    (filter && filterObj.checked) ? ' checked' : '';

                return '<li data-object-filter-li>' +
                    '<a class="tooltipped row object" data-object-filter-list data-position="right" data-tooltip="' + filterDescription +'">' +
                    '<div class="col s2 object-checkbox">' +
                    '<label>' +
                    '<input type="checkbox" data-object-filter="' + filterName + '"' + checked +'/>' +
                    '<span></span>' +
                    '</label>' +
                    '</div>' +
                    '<div class="col s9 truncate object-label" data-object-filter-label>' + filterName +'</div>' +
                    '</a></li>';
            }).join('\n');


            // remove old tooltips
            if(filterTooltipInstances && filterTooltipInstances.length) {
                filterTooltipInstances.forEach(function (instance) {
                    instance.destroy();
                });
            }
            $('div.material-tooltip').remove();

            objectsFilterElm.html(html);

            filterTooltipInstances = M.Tooltip.init(document.querySelectorAll('a[data-object-filter-list]'), {
                enterDelay: 500
            });


            // change checked state of checkbox when click to the div with label
            $('div[data-object-filter-label]').click(function () {
                var checkBoxElm = $(this).parent().find('input[data-object-filter]');
                checkBoxElm.prop('checked', !checkBoxElm.is(':checked'));
                clickOnFilter();
                alepizObjectsNamespace.reDrawObjects(null,function() {
                    if(objectsFilterElm.hasClass('active')) {
                        var checkedObjectNum = alepizObjectsNamespace.getSelectedObjectNames().length;
                        objectsTabSwitchElm.text('OBJECTS' + (checkedObjectNum ? ' [' + checkedObjectNum + ']' : ''));
                    }
                });
            });

            // click on checkbox
            $('li[data-object-filter-li]').change(function () {
                clickOnFilter();
                alepizObjectsNamespace.reDrawObjects(null,function() {
                    if(objectsFilterElm.hasClass('active')) {
                        var checkedObjectNum = alepizObjectsNamespace.getSelectedObjectNames().length;
                        objectsTabSwitchElm.text('OBJECTS' + (checkedObjectNum ? ' [' + checkedObjectNum + ']' : ''));
                    }
                });
            });

            clickOnFilter(filter);
            if(typeof callback === 'function') callback();
        });
    }

    function filterFilterList(initSearchStr) {
        if (!initSearchStr) initSearchStr = searchFiltersElm.val();
        else searchFiltersElm.val(initSearchStr);

        return alepizObjectsNamespace.filterList(initSearchStr, objectsFilterElm, 'data-object-filter');
    }

    function getCheckedFilterNames() {
        return $('input[data-object-filter]:checked').map(function() {
            return $(this).attr('data-object-filter');
        }).get();
    }

    function getFilterExpression(saveFilterMode) {
        var expressionElms = filterExpressionEditorElm.find('div.chip[data-object-filter-expr-item]');
        if(!expressionElms.length) return '';

        var expression = expressionElms.map(function () {
            var exprItem = $(this).text();
            if(saveFilterMode) return exprItem;

            if (exprItem === 'AND') exprItem = ' && ';
            else if (exprItem === 'OR') exprItem = ' || ';
            else if (exprItem !== '(' && exprItem !== ')') exprItem = '%:' + exprItem.toUpperCase() + ':%';

            return exprItem;
        }).get();

        return saveFilterMode ? expression : expression.join('');
    }

    function createObjectFilterExpressionForEditor(checkedFilterNames) {

        var html = checkedFilterNames.map(filterItem => {
            var type = ['AND', 'OR', '(', ')'].indexOf(filterItem) === -1 ? 'name' : 'operator';
            return '<div class="chip" data-filter-' + type + ' data-object-filter-expr-item style="cursor: pointer">' +
                filterItem + '</div>';
        }).join('');

        filterExpressionEditorElm.html(html);

        $('div[data-filter-operator]').click(function() {
            if($(this).text() === 'AND') $(this).text('OR');
            else $(this).text('AND');
            var config = alepizMainNamespace.getConfig();
            var filter = getFilterExpression(true);
            if(config.objectFilter !== filter) {
                config.objectFilter = filter;
                alepizMainNamespace.saveConfig();
            }
        });
    }

    function clickOnFilter(filter) {
        var checkedFilterNames = getCheckedFilterNames();
        if(!filter || !Array.isArray(filter) || !filter.length) {
            filter = checkedFilterNames.length ? checkedFilterNames.join('\rAND\r').split('\r') : [];
        }
        createObjectFilterExpressionForEditor(filter);
        var config = alepizMainNamespace.getConfig();
        // when initializing filters config is not initialized
        if('objectFilter' in config && config.objectFilter !== filter) {
            config.objectFilter = filter;
            alepizMainNamespace.saveConfig();
        }
        if(!checkedFilterNames || !checkedFilterNames.length) {
            filterCounterContainerElm.addClass('hide');
            filterTabSwitchElm.text('FILTERS');
        } else {
            var checkedFiltersNum = checkedFilterNames.length;
            if(searchObjectsAddElm.val()) ++checkedFiltersNum;
            filterCounterContainerElm.removeClass('hide');
            filterCounterElm.text(checkedFiltersNum);
            filterTabSwitchElm.text('FILTERS [' + checkedFiltersNum + ']');
        }
    }

    return {
        init: init,
        createObjectsFiltersTab: createObjectsFiltersTab,
        getCheckedFilterNames: getCheckedFilterNames,
        getFilterExpression: getFilterExpression,
    }
})(jQuery);