/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 13.05.2015.
 */

function onChangeObjects(objects){
    JQueryNamespace.init(objects);
}


var JQueryNamespace = (function ($) {
    var serverURL = parameters.action.link+'/ajax';

    $(function () {
        init(parameters.objects);

        var colorSampleElm = $('#colorSample');

        $('#objectsNames').keyup(function () {
            colorSampleElm.text($(this).val() || 'OBJECT NAME');
        });

        colorPicker.init($('#colorPickerParent'), $('#shadePickerParent'), colorSampleElm);
        alepizIDPicker.init($('#alepizIDPickerParent'));

        M.FormSelect.init(document.querySelectorAll('select'), {});
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 200});

        $.post(serverURL, {func: 'getAlepizIDs'}, function(alepizIDs) {
            alepizIDPicker.seObjectServerRelation(alepizIDs);
        });
    });

    return { init: init };

    function init(objects) {
        var objectsNames = objects.length ? objects.map(function(obj){
            return '<li>' + escapeHtml(obj.name) + '</li>'
        }).join('') : 'NO GROUPS';
        $('#groupsDescription').html(objectsNames);
    }
})(jQuery); // end of jQuery name space