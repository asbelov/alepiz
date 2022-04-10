/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function callbackBeforeExec(callback) {
    if(!$('#sourceObjectsIDs').val()) return callback(new Error('Source objects are not selected'));
    if(!$('#cloneToObjectsIDs').val()) return callback(new Error('Destination objects are not selected'));
    callback()
}

(function ($) {
    $(function () {
        objects = parameters.objects;
        disabledCBElm = $('#disabledCB');
        disabledElm = $('#disabled');
        objectsOrderElm = $('#objectsOrder');
        objectsDescriptionElm = $('#objectsDescription');
        init();
        initEvents();
    });

    var serverURL = parameters.action.link+'/ajax';
    var disabledCBElm;
    var disabledElm;
    var objectsOrderElm;
    var objectsDescriptionElm;
    var defaultValueForDisabled;
    var objectsInteractions, objectsCountersLinkage, objectsProperties, objectsParameters;

    function init() {
        $('#sourceObjectsIDs').objectsSelector(parameters.objects, initSourceObjects);
        initSourceObjects();

        M.FormSelect.init(objectsOrderElm[0], {});
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
    }

    function initSourceObjects() {
        objectsInteractions = objectsCountersLinkage = objectsProperties = objectsParameters = undefined;
        var objectsIDs = $('#sourceObjectsIDs').val();

        // objects were not selected
        if(!objectsIDs || !objectsIDs.length) {
            drawInteractions();
            drawCounters();
            drawObjectsProperties();
            drawObjectParameters();
            return;
        }

        $.post(serverURL, {func: 'getInteractions', ids: objectsIDs.join(',')}, drawInteractions);
        $.post(serverURL, {func: 'getCounters', ids: objectsIDs.join(',')}, drawCounters);
        $.post(serverURL, {func: 'getProperties', ids: objectsIDs.join(',')}, drawObjectsProperties);
        $.post(serverURL, {func: 'getTemplatesParameters', ids: objectsIDs.join(',')}, drawObjectParameters);
    }

    function initEvents() {
        // checkbox element return only 1 or undefined.
        // for return undefined when set to default value or 1 or 0 when set to a new value I use this code
        disabledCBElm.click(function () {
            if($(this).is(':checked')) {
                if(defaultValueForDisabled === 0) disabledElm.val(1);
                else disabledElm.val(undefined);
            } else {
                if(defaultValueForDisabled === 1) disabledElm.val(0);
                else disabledElm.val(undefined);
            }
        });

        $('#cloneAllCounters').click(function() {
            if($(this).is(':checked')) {
                $('input[data-counterID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('input[data-counterID]').removeAttr('disabled');
            }
        });

        $('#cloneAllInteractions').click(function() {
            if($(this).is(':checked')) {
                $('input[data-interactionObjectID]').prop('checked', true).attr('disabled', 'disabled');

            } else {
                $('input[data-interactionObjectID]').removeAttr('disabled');
            }
        });

        $('#cloneAllProperties').click(function() {
            if($(this).is(':checked')) {
                $('input[data-propertyID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('input[data-propertyID]').removeAttr('disabled');
            }
        });

        var isCloneInteractionElm = $('#isCloneInteractions');
        var isCloneCountersElm = $('#isCloneCounters');
        var isClonePropertiesElm = $('#isCloneProperties');
        isCloneCountersElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllCounters').prop('checked', true).removeAttr('disabled');
                $('input[data-counterID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllCounters').prop('checked', false).attr('disabled', 'disabled');
                $('input[data-counterID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        isCloneInteractionElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllInteractions').prop('checked', true).removeAttr('disabled');
                $('input[data-interactionObjectID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllInteractions').prop('checked', false).attr('disabled', 'disabled');
                $('input[data-interactionObjectID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        isClonePropertiesElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllProperties').prop('checked', true).removeAttr('disabled');
                $('input[data-propertyID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllProperties').prop('checked', false).attr('disabled', 'disabled');
                $('input[data-propertyID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        $('#cloneToObjectsIDs').objectsSelector();
        $('#upLevelObjectsIDs').objectsSelector();
    }

    function drawInteractions(_objectsInteractions) {
        // objectsInteractions:
        //          [{
        //                  name1: <objName1>, description1: <objDescription1>, id1: <id1>,
        //                  name2: <objName2>, description2: <objDescription2>, id2: <id2>,
        //                  type: <interactionType1>
        //           },
        //           {...},...]
        // interaction types: 0 - include; 1 - intersect, 2 - exclude

        var interactions = {};
        if(_objectsInteractions && _objectsInteractions.length) {
            var interactionTypes = {
                0: 'Include ',
                1: 'Intersect with ',
                2: 'Exclude ',
                100: 'Included in ',
                101: 'Intersect with ',
                102: 'Excluded from '
            };
            objectsInteractions = _objectsInteractions;
            var objectsIDs = $('#sourceObjectsIDs').val();

            objectsInteractions
                .sort(function (a, b) {
                    return (objectsIDs.indexOf(b.id1) === -1 ? a.name1.localeCompare(b.name1) : a.name2.localeCompare(b.name2))
                }).forEach(function (interaction, idx) {

                if (objectsIDs.indexOf(String(interaction.id1)) !== -1) {
                    interactions[interactionTypes[interaction.type] + interaction.name2] = {
                        id: interaction.id2,
                        idx: idx,
                    };
                    if (objectsIDs.indexOf(String(interaction.id2)) !== -1) {
                        interactions[interactionTypes[interaction.type] + interaction.name1] = {
                            id: interaction.id1,
                            idx: idx,
                        };
                    }
                } else {
                    interactions[interactionTypes[interaction.type + 100] + interaction.name1] = {
                        id: interaction.id1,
                        idx: idx,
                    };
                }
            });
        }

        $('#interactingObjects').html(Object.keys(interactions).map(function(name) {
            return '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" data-interactionObjectID="' +  interactions[name].idx + '" id="interactionID-' + interactions[name].id + '" checked disabled="disabled" />\
    <span>' + name + '</span></label>\
</div>';
        }).join(''));
    }

    function drawCounters(_objectsCountersLinkage) {
        var counters = {};

        if(_objectsCountersLinkage && _objectsCountersLinkage.length) {
            objectsCountersLinkage = _objectsCountersLinkage;
            objectsCountersLinkage
                .sort(function (a, b) {
                    return a.name.localeCompare(b.name)
                })
                .forEach(function (counter, idx) {

                    counters[counter.name] = '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" data-counterID="' + idx + '" id="counterID-' + counter.id + '" checked disabled="disabled" />\
    <span>' + counter.name + '</span></label>\
</div>';
                });
        }

        $('#counters').html(Object.values(counters).join(''));
    }

    function drawObjectsProperties(_objectsProperties) {
        var properties = {};

        if(_objectsProperties && _objectsProperties.length) {
            objectsProperties = _objectsProperties;

            objectsProperties
                .sort(function (a, b) {
                    return a.name.localeCompare(b.name)
                })
                .forEach(function (property, idx) {

                    var description = property.description ? ' (' + property.description + ')' : '';

                    properties[property.name] = '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" data-propertyID="' + idx + '" id="propertyID-' + property.id + '" checked disabled="disabled" />\
    <span>' + property.name + description + '</span></label>\
</div>';
                });
        }

        $('#properties').html(Object.values(properties).join(''));
    }

    function drawObjectParameters(_objectsParameters) {
        //objectsParameters = [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:.., disabled:...}, {...},...]

        if(_objectsParameters && _objectsParameters.length) {
            objectsParameters = _objectsParameters;

            var disabled = objectsParameters[0].disabled, sortPosition = objectsParameters[0].sortPosition,
                description = objectsParameters[0].description;

            for (var i = 1; i < objectsParameters.length; i++) {
                var obj = objectsParameters[i];
                if (disabled !== obj.disabled) disabled = undefined;
                if (sortPosition !== obj.sortPosition) sortPosition = undefined;
                if (description !== obj.description) description = undefined;
                if (description === undefined && sortPosition === undefined && disabled === undefined) break;
            }
        }

        if(disabled === 1) {
            defaultValueForDisabled = 1;
            disabledCBElm.prop('checked', "1");
        }
        else {
            defaultValueForDisabled = 0;
            disabledCBElm.prop('checked', "");
        }

        if(sortPosition) objectsOrderElm.val(sortPosition);
        else objectsOrderElm.val(0);

        if(description) objectsDescriptionElm.val(description);
        else objectsDescriptionElm.val('');

        M.updateTextFields();
        M.FormSelect.init(objectsOrderElm[0], {});
    }

})(jQuery); // end of jQuery name space