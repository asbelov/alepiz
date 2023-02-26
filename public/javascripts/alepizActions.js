/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var alepizActionsNamespace = (function($) {
    var activeActionLink, // "/actions/<actionID>"
        prevActionsListHTML = '',
        actionsTooltipInstances,
        actionsListElm,
        searchActionsElm,
        searchObjectsElm,
        searchFiltersElm,
        searchIconElm,
        objectsTabElm,
        searchActionsAutocompleteInstance,
        actionsConf = {},
        // if autocomplete function in actions search element is running now, this variable set to true, else set to false
        // it's needed for prevent multiple start autocomplete function
        isAutoCompleteRunning;

    function init () {

        initJQueryElements();
        initMaterializeElements();
        initEvents();
    }

    function initJQueryElements() {
        actionsListElm = $('#actionsList');
        searchActionsElm = $('#searchActions');
        searchObjectsElm = $('#searchObjects');
        searchFiltersElm = $('#searchFilters');
        searchIconElm = $('#searchIcon');
        objectsTabElm = $('#objectsTab');
    }

    function initMaterializeElements() {
        searchActionsAutocompleteInstance = M.Autocomplete.init(searchActionsElm[0], {
            data: {},
            limit: 20, // The max amount of results that can be shown at once. Default: Infinity.
            minLength: 2, // The minimum length of the input for the autocomplete to start. Default: 1.
            onAutocomplete: function (actionName) {

                // prevent running multiple autocomplete function.
                if (isAutoCompleteRunning) return;
                isAutoCompleteRunning = true;

                var initActiveActionLink = $('li[data-action-name="' + actionName + '"]').attr('data-action-link');
                if (initActiveActionLink) {
                    createActionsList(initActiveActionLink, function () {
                        alepizDrawActionNamespace.getActionHTMLAndShowActionButtons(false,function (html) {
                            alepizDrawActionNamespace.drawAction(html);
                            alepizMainNamespace.setBrowserHistory();
                            isAutoCompleteRunning = false;
                        });
                    });
                }
            }
        });

        M.Collapsible.init(document.querySelectorAll('.collapsible'), {});
    }

    function initEvents() {
        var prevSearchActionStr = '';
        searchActionsElm.keydown(function (e) {
            if (e.keyCode === 13) return false;
            if (e.which === 27) {
                $(this).val('');
                searchIconElm.removeClass('hide');
                return;
            }

            // when nothing found in actions switch to object tab and try to search objects
            var searchActionStr = $(this).val();
            if (!searchActionStr.length) searchIconElm.removeClass('hide');
            else searchIconElm.addClass('hide');

            // when pressed not character key and string length not increased
            if(prevSearchActionStr.length >= searchActionStr.length) {
                prevSearchActionStr = searchActionStr;
                return;
            }
            prevSearchActionStr = searchActionStr;

            if (searchActionsAutocompleteInstance &&
                searchActionStr.length >= searchActionsAutocompleteInstance.options.minLength &&
                !searchActionsAutocompleteInstance.count) {
                $(this).val('');
                prevSearchActionStr = '';
                alepizObjectsNamespace.runSearchObjectsWhenNoActionFound(searchActionStr);
            }
        });
    }

    function createActionsList(initActiveActionLink, callback) {
        var checkedObjectNames = alepizObjectsNamespace.getSelectedObjectNames();
        if(initActiveActionLink) activeActionLink = initActiveActionLink;
        $.post('/mainMenu', {f: 'getActions', o: JSON.stringify(checkedObjectNames)}, function(actionsLayout) {

            var drawData = createHTMLWithActionsList(actionsLayout, checkedObjectNames);
            if(drawData.html === prevActionsListHTML) {
                if(typeof callback !== 'function') return;
                return callback();
            }
            prevActionsListHTML = drawData.html;

            searchActionsAutocompleteInstance.updateData(drawData.autocompleteData);
            if(actionsTooltipInstances && actionsTooltipInstances.length ) {
                actionsTooltipInstances.forEach(function (instance) {
                    instance.destroy();
                });
            }
            $('div.material-tooltip').remove();

            actionsListElm.html(drawData.html);
            M.Collapsible.init(actionsListElm[0], {});
            actionsTooltipInstances = M.Tooltip.init(document.querySelectorAll('a.tooltipped'), {
                enterDelay: 200
            });

            searchActionsElm.val('');
            searchIconElm.removeClass('hide');

            $('li[data-action-link]').click(function() {
                // manually add class active to menu element, when clicked
                // it's not work automatically, when init menu by $('#actionsMenu.collapsible').collapsible();
                $('li[data-action-link].active').removeClass('active');
                $(this).addClass('active');
                activeActionLink = $(this).attr('data-action-link');
                alepizDrawActionNamespace.getActionHTMLAndShowActionButtons(false,function (html) {
                    alepizDrawActionNamespace.drawAction(html);
                    alepizMainNamespace.setBrowserHistory();
                });
            });

            if(typeof callback === 'function') callback();
        });
    }

    function createHTMLWithActionsList(actionsLayout, checkedObjectNames) {
        if (!actionsLayout) return {html: '', autocompleteData: {}};

        var html = '', searchActionsAutoCompleteData = {}; // {<name1>: <val1>, <name2>: <val2>, ...}

        for(var groupName in actionsLayout) {
            var CSSClassForActiveGroup = '', htmlPart = [];
            for(var ID in actionsLayout[groupName]) {
                var action = actionsLayout[groupName][ID];
                if(!action || !action.name || !action.link) continue;

                actionsConf[action.link] = action;

                searchActionsAutoCompleteData[action.name] = null;

                var checkedObjectsStr = checkedObjectNames.length ? checkedObjectNames.join(', ') : 'no objects selected';

                var tooltip = 'description' in action ? action.description + ': ' + checkedObjectsStr : checkedObjectsStr;
                if(tooltip.length > 200) tooltip = tooltip.substring(0, 200) + '...';

                if(activeActionLink === action.link) {
                    CSSClassForActiveGroup = ' active';
                    var CSSClassForActiveAction = ' active';
                } else CSSClassForActiveAction = '';

                htmlPart.push('\
<li class="tooltipped action' + CSSClassForActiveAction + '" data-action-link="' + action.link +
                    '" data-action-name="' + action.name + '" data-position="right" data-tooltip="' + tooltip + '">\
<a class="truncate action' + CSSClassForActiveAction + '">' + escapeHtml(action.name) + '</a>\
</li>');
            }

            if(!htmlPart.length) continue;
            html += '\
<li class="' + CSSClassForActiveGroup +' action-group">\
<a class="collapsible-header row no-margin no-padding' + CSSClassForActiveGroup +'">\
<div class="col no-padding"><i class="material-icons no-margin action-group-icon">arrow_drop_down</i></div>\
<div class="col truncate action-group">' + escapeHtml(groupName) + '</div>\
</a>\
<div class="collapsible-body"><ul>' + htmlPart.join('') +  '</ul></div>\
</li>';
        }

        return {
            html: html,
            autocompleteData: searchActionsAutoCompleteData
        };
    }

    return {
        init: init,
        createActionsList: createActionsList,
        getActiveActionConf: function () {
            return actionsConf[activeActionLink];
        },
        getActionConf: function (actionID) {
            var actionLink = activeActionLink.replace(/[^\\/]+$/, '') + actionID;
            return actionsConf[actionLink];
        }
    }

})(jQuery);