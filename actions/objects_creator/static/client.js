/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 13.05.2015.
 */

function onChangeObjects(objects){
    JQueryNamespace.init(objects);
}


var JQueryNamespace = (function ($) {
    $(function () {

        init(parameters.objects);
        M.FormSelect.init(document.getElementById('objectsOrder'), {});
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 200});
    });

    return { init: init };

    function init(objects) {
        var objectsNames = objects.length ? objects.map(function(obj){ return obj.name}).join(', ') : 'NO GROUPS';
        $('#groupsDescription').text(objectsNames);
    }
})(jQuery); // end of jQuery name space