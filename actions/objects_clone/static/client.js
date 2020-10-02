/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function callbackBeforeExec(callback) {
    if(!$('#sourceObjectsIDs').val()) return callback(new Error('Source objects are not selected'));
    if(!$('#cloneToObjectsIDs').val()) return callback(new Error('Destination objects are not selected'));
    callback()
}

var JQueryNamespace = (function ($) {
    $(function () {
        objects = parameters.objects;
        disabledCBElm = $('#disabledCB');
        disabledElm = $('#disabled');
        objectsOrderElm = $('#objectsOrder');
        init();
        initEvents();
    });

    var serverURL = parameters.action.link+'/ajax';
    var disabledCBElm;
    var disabledElm;
    var objectsOrderElm;
    var defaultValueForDisabled;

    function init() {
        $('#sourceObjectsIDs').objectsSelector(null, function() {
            var objectsIDs = $('#sourceObjectsIDs').val();

            if(!objectsIDs || !objectsIDs.length) return;

            $.post(serverURL, {func: 'getInteractions', ids: objectsIDs.join(',')}, function(interactionsQueryResult) {
                // interactionsQueryResult:
                //          [{
                //                  name1: <objName1>, description1: <objDescription1>, id1: <id1>,
                //                  name2: <objName2>, description2: <objDescription2>, id2: <id2>,
                //                  type: <interactionType1>},
                //                  {...},...]
                // interaction types: 0 - include; 1 - intersect, 2 - exclude

                if(!interactionsQueryResult || !interactionsQueryResult.length) return;

                var interactionTypes = {
                    0: 'Include ',
                    1: 'Intersect with ',
                    2: 'Exclude ',
                    100: 'Included in ',
                    101: 'Intersect with ',
                    102: 'Excluded from '
                };

                var interactions = {};
                interactionsQueryResult
                    .sort(function(a,b) {
                        return (objectsIDs.indexOf(b.id1) === -1 ? a.name1.localeCompare(b.name1) : a.name2.localeCompare(b.name2))
                    }).forEach(function(interaction) {

                    if(objectsIDs.indexOf(interaction.id1) !== -1) {
                        interactions[interactionTypes[interaction.type] + interaction.name2] = interaction.id2;
                        if(objectsIDs.indexOf(interaction.id2) !== -1)
                            interactions[interactionTypes[interaction.type] + interaction.name1] = interaction.id1;

                    } else {
                        interactions[interactionTypes[interaction.type + 100] + interaction.name1] = interaction.id1;
                    }
                });

                //$('#interactingObjects').text(Object.keys(interactions).join('; '));

                $('#interactingObjects').empty().append(Object.keys(interactions).map(function(name) {
                    return '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" interactionObjectID="' +  interactions[name] + '" id="interactionID-' + interactions[name] + '" checked disabled="disabled" />\
    <span>' + name + '</span></label>\
</div>';
                }))
            });

            $.post(serverURL, {func: 'getCounters', ids: objectsIDs.join(',')}, function(countersQueryResult) {
                var counters = {};

                countersQueryResult
                    .sort(function(a,b) {return a.name.localeCompare(b.name)})
                    .forEach(function (counter) {

                        counters[counter.name] = '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" counterID="' +  counter.id + '" id="counterID-' + counter.id + '" checked disabled="disabled" />\
    <span>' + counter.name + '</span></label>\
</div>';
                    });

                $('#counters').empty().append(Object.values(counters).join(''));
            });

            $.post(serverURL, {func: 'getProperties', ids: objectsIDs.join(',')}, function(propertiesQueryResult) {
                var properties = {};

                propertiesQueryResult
                    .sort(function(a,b) {return a.name.localeCompare(b.name)})
                    .forEach(function (property) {

                        var description = property.description ? ' (' +property.description+ ')' : '';

                        properties[property.name] = '\
<div style="margin-top:0.7em">\
    <label><input type="checkbox" propertyID="' +  property.id + '" id="propertyID-' + property.id + '" checked disabled="disabled" />\
    <span>' + property.name + description + '</span></label>\
</div>';
                    });

                $('#properties').empty().append(Object.values(properties).join(''));
            });

            $.post(serverURL, {func: 'getTemplatesParameters', ids: objectsIDs.join(',')}, function(objectsProperties) {
                //objectsProperties = [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:.., disabled:...}, {...},...]

                if(!objectsProperties.length) return;

                var disabled = objectsProperties[0].disabled, sortPosition = objectsProperties[0].sortPosition, description = objectsProperties[0].description;

                for(var i = 1; i < objectsProperties.length; i++) {
                    var obj = objectsProperties[i];
                    if(disabled !== obj.disabled) disabled = undefined;
                    if(sortPosition !== obj.sortPosition) sortPosition = undefined;
                    if(description !== obj.description) description = undefined;
                    if(description === undefined && sortPosition === undefined && disabled === undefined) break;
                }

                var objectsDescriptionElm = $('#objectsDescription');

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
            });

        });

        M.FormSelect.init(objectsOrderElm[0], {});
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
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
                $('input[counterID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('input[counterID]').removeAttr('disabled');
            }
        });

        $('#cloneAllInteractions').click(function() {
            if($(this).is(':checked')) {
                $('input[interactionObjectID]').prop('checked', true).attr('disabled', 'disabled');

            } else {
                $('input[interactionObjectID]').removeAttr('disabled');
            }
        });

        $('#cloneAllProperties').click(function() {
            if($(this).is(':checked')) {
                $('input[propertyID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('input[propertyID]').removeAttr('disabled');
            }
        });

        var isCloneInteractionElm = $('#isCloneInteractions');
        var isCloneCountersElm = $('#isCloneCounters');
        var isClonePropertiesElm = $('#isCloneProperties');
        isCloneCountersElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllCounters').prop('checked', true).removeAttr('disabled');
                $('input[counterID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllCounters').prop('checked', false).attr('disabled', 'disabled');
                $('input[counterID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        isCloneInteractionElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllInteractions').prop('checked', true).removeAttr('disabled');
                $('input[interactionObjectID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllInteractions').prop('checked', false).attr('disabled', 'disabled');
                $('input[interactionObjectID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        isClonePropertiesElm.click(function() {
            if($(this).is(':checked')) {
                $('#cloneAllProperties').prop('checked', true).removeAttr('disabled');
                $('input[propertyID]').prop('checked', true).attr('disabled', 'disabled');
            } else {
                $('#cloneAllProperties').prop('checked', false).attr('disabled', 'disabled');
                $('input[propertyID]').prop('checked', false).attr('disabled', 'disabled');
            }
        });

        $('#cloneToObjectsIDs').objectsSelector(parameters.objects);
        $('#upLevelObjectsIDs').objectsSelector();
    }

})(jQuery); // end of jQuery name space