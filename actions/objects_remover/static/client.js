/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function onChangeObjects(objects){
    JQueryNamespace.init(objects);
}

var objects = parameters.objects;
var maxObjectsCnt = 10000;

function callbackBeforeExec(callback) {

    if(!objects.length) return callback(new Error('Objects for removing are not set'));

    var modalDeleteConfirmInstance = M.Modal.init(document.getElementById('modalDeleteConfirm'), {dismissible: false});
    modalDeleteConfirmInstance.open();

    $('#modalDeleteConfirmNo').unbind('click').click(function(){
        callback(new Error('Delete operation is canceled'));
    });

    $('#modalDeleteConfirmYes').unbind('click').click(function(){
        callback();
    });
}


var JQueryNamespace = (function ($) {
    $(function () {
        objectsNamesInObjectsListElm = $('#objectsNamesInObjectsList');
        objectsNamesInModalDialogElm = $('#objectsNamesInModalDialog');
        deleteWithChildrenElm = $('#deleteWithChildren');

        init(parameters.objects);
        deleteWithChildrenElm.click(getObjects);
        M.FormSelect.init(document.getElementById('objectsOrder'), {});
    });

    // path to ajax
    var serverURL = parameters.action.link+'/ajax',
        objectsNamesInObjectsListElm,
        objectsNamesInModalDialogElm,
        deleteWithChildrenElm,

        parentObjectsNamesStr,
        objectNamesStr;

    return { init: init };

    function init(_objects) {
        objects = _objects;

        if(objects.length > 10) deleteWithChildrenElm.prop('checked', false);
        else deleteWithChildrenElm.prop('checked', true);

        getObjects();
    }

    function getObjects() {
        $('body').css("cursor", "progress");
        objectsNamesInObjectsListElm.text('loading objects list...');

        if(!deleteWithChildrenElm.is(':checked')) return showObjects(objects);
        $.post(serverURL, {func: 'getChildObjects', objects: JSON.stringify(objects), maxObjectsCnt: maxObjectsCnt}, showObjects);
    }

    function showObjects(objects) {
        if (!objects || !objects.length) {
            objectsNamesInObjectsListElm.text('No objects are loaded from database');
            return;
        }

        var objectsCount = objects.length;

        if(objectsCount >= maxObjectsCnt) {
            objects.splice(0, maxObjectsCnt);
            var suffix = '... (more ' + objectsCount+ ' objects)';
        } else suffix = ' (' + objectsCount+ ' objects)';

        objectNamesStr = objects.map(function(obj){ return obj.name}).join(', ') + suffix;
        objectsNamesInObjectsListElm.text(objectNamesStr);
        objectsNamesInModalDialogElm.text(objectNamesStr);

        $('body').css("cursor", "auto");
    }

})(jQuery); // end of jQuery name space