/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 14.01.2016.
 */

// Objects selector:
// initialized in 'select' or 'input' tag

// Attributes
// title - title of objects selector
// class="objects-selector" - if set, then objects selector element initialize automatically when page drawing
// id - used for prefixes of IDs for internal objects, and, if title not specified, for a title
// description - description of objects selector
// no-border=1 - remove border and shadow around element for embedding in other elements
// get-objects-from-additional-objects-list=1 - by default objects selector getting objects from main objects list
//              in navigation menu. If you want, that objects selector getting objects from additional objects list,
//              set this attribute
// add-custom-object=<name> - show button for adding custom object to objects list. <name> must be a common name of the custom objects.
//          if name contain 'variable', then add custom object as variable. It's mean, that you can add only one custom object to object list
//          and if any objects are present in objects list, you will get error
//      f.e. add-custom-object="variable" will be add button "ADD VARIABLE". All custom objects will have ID = 0
// tag 'option' - used for initialize objects in objects selector if object selector was initialized using 'select' tag:
//              value - object id
//              text of 'option' - name of object
// if select initialized using 'input' tag you can put data to input value as JSON string, f.e. '[{id:<object1 ID>, name:<object1 name>}, ....]'

// functions (jQuery plugins)
// .objectsSelector([objects], [callback]) - initialize objects selector and/or set objects to objects selector. Parameters is
//      not required.
//      [objects] - array of objects [{id: objectID1, name: objectName1}, {id: objectID2, name: objectName2} ....].
//          if first element of array is a string, then don't remove previous objects from panel, f.e.
//          ['do not remove previous objects', {id: objectID1, name: objectName1}, {id: objectID2, name: objectName2} ....].
//          if array of objects is undefined or null, then initialize objects selector from tag <option>
//      [callback(<jQuery objects>)] - callback is a function. It will be called, when objects selector contents is changed.
//          previous callback will be unbinding from events
//          Callback is not not called when initialize objects selector.
//          <jQuery objects> - is a jQuery object reference to <select>,
//          f.e. if <select id="selector1" class="objects-selector">, then <jQuery objects> = $('#selector1')
//
// .clearObjectsSelector() - clear objects panel from objects
// Examples:

// Automatically init objects selector with title "Objects selector" with initial
// objects with IDs 1,2,7 and names Object1, Object2, Object5.
// Objects selector init automatically, because it has class with name "objects-selector"
//
// <select title="Objects selector" id="object-selector1" class="objects-selector" multiple>
//      <option value="1" selected>Object1</option>
//      <option value="2" selected>Object2</option>
//      <option value="7" selected>Object5</option>
// </select>
// or also will work without properties "multiple" and "selected"
// <select title="Objects selector" id="object-selector1" class="objects-selector">
//      <option value="1">Object1</option>
//      <option value="2">Object2</option>
//      <option value="7">Object5</option>
// </select>



// Automatically init objects selector with title "My objects selector", created from ID and
// description "This is my objects list"
//
// <select id="my-objects-selector" class="objects-selector" description "This is my objects list"></select>

// Automatically init objects selector with title "Objects selector" and id "objects-selector"
// then get objects IDs array to objectsIDsArray.
// getting objects IDs from element with id "objects-selector", because id of select element is not set.
//
// <select class="objects-selector"></select>
// <script>
//  var objectsIDsArray = $('#objects-selector").val();
// </script>

// Init objects selector from JS with title "My new objects selector", created from ID
// then get objects IDs array to objectsIDsArray.
//
// <select id="my-new-objects-selector">
// <script>
//  $('#my-new-objects-selector").objectsSelector();
//  var objectsIDsArray = $('#my-new-objects-selector").val();
// </script>

// Init objects selector from JS and set initial objects to it.
//
// <select id="my-objects-selector" title="Selector">
// <script>
//  $('#my-objects-selector").objectsSelector([{id: 1, name: object1Name}, {id: 2, name: object2Name]);
// </script>

// Automatically init objects selector and set initial objects to it from JS.
// Also call callback, when objects added or remover from objects selector
//
// <select id="my-objects-selector" title="Selector" class="objects-selector">
// <script>
//  $('#my-objects-selector").objectsSelector([{id: 1, name: object1Name}, {id: 2, name: object2Name], onChange);
//
// function onChange(){
//      var objectsIDs = $('#my-objects-selector").val();
//      alert(objectsIDs);
// }
// </script>


(function ($) {
    $(function () {
        $('.objects-selector').each(initObjectsSelector);
    });

    var _callback = {}, objects = {};

    // jQuery plugin.
    // objects - array of objects [{id: object1ID, name: object1Name}, {id: object2ID, name: object2Name, ...]
    // callback will be called when objects will be added or removed into the objects selector
    $.fn.objectsSelector = function(objects, callback){
        return this.each(function(i, elm){
            initObjectsSelector(i, elm, objects, callback);
        })
    };

    // clear panel from objects
    $.fn.clearObjectSelector = function(){
        return this.each(function(i, elm){
            $('#' + $(elm).attr('id') + '-objects-panel').empty();
            $(elm).empty();
            $(elm).val('');
        })
    };

    // init object selector
    // initObjects - array of objects [{id: object1ID, name: object1Name}, {id: object2ID, name: object2Name, ...]
    // initCallback will be called when added or removes objects in objects selector
    function initObjectsSelector(index, elm, initObjects, initCallback) {

        var id = $(elm).attr('id');
        // If id for selected element is not defined, then use "objects-selector" as id
        if(!id){
            id = 'objects-selector';
            $(elm).attr('id', id);
        }

        objects[id] = Array.isArray(initObjects)? initObjects.map(obj => { return {id: Number(obj.id), name: obj.name} }) : null;
        var elmTag = $(elm).prop("tagName"); // 'SELECT' or 'INPUT' etc

        // for each objects selector set own callback
        if(typeof(initCallback) === "function") _callback[id] = initCallback;

        var prefixID = id + '-';
        var maxObjects = 20;
        var activePage = 1;

        // Check for existing objects selector
        // If objects selector element with id="id+'-objects-panel'" not exist, then init object selector
        var objectsPanelElm = $('#'+prefixID+'objects-panel');
        if(!objectsPanelElm.length) {

            var title = $(elm).attr('title');
            // If title is not set, then try to create it from id
            // Set first character in upper case, other characters in lower case and replace all '-' and '_' to spaces
            if (title === undefined) {
                title = String(prefixID.charAt(0).toUpperCase() + prefixID.slice(1).toLowerCase()).replace(/[-_]/g, ' ');
                $(elm).attr('title', title);
            }

            var description = $(elm).attr('description');
            var noBorder = $(elm).attr('no-border');
            var customObjectClassName = $(elm).attr('add-custom-object');
            var variableMode = customObjectClassName ? customObjectClassName.toUpperCase().indexOf('VARIABLE') !== -1 : false;
            var useAdditionalObjectsList = $(elm).attr('get-objects-from-additional-objects-list');
            if(description) description = '<p>'+description+'</p>';
            else description = '';

            $(elm).prop('multiple', 'multiple').addClass('hide').after(
                '<div class="card'+(noBorder ? ' z-depth-0':'')+'">' +
                    '<div class="card-content'+(noBorder ? ' no-padding':'')+'">' +
                        '<span class="card-title black-text">' + title + '</span>' + description +
                        '<div class="input-field row" id="' + prefixID + 'objects-panel"></div>' +
                    '</div>' +
                    '<div class="card-action">' +
                        '<a href="#!" id="' + prefixID + 'add-selected-objects">Add selected objects</a>' +
                        (customObjectClassName ? '<a href="#!" id="' + prefixID + 'add-custom-object">Add ' + customObjectClassName + '</a>' : '') +
                        '<a href="#!" id="' + prefixID + 'remove-all-objects">Remove all objects</a>' +
                    '</div>' +
                '</div>'
            );

            objectsPanelElm = $('#'+prefixID+'objects-panel');

            $('#' + prefixID + 'remove-all-objects').unbind('click').click(function () {
                objectsPanelElm.empty();
                // clear select element
                if(elmTag === 'SELECT') $(elm).empty().val([]);
                else $(elm).empty().val('');
                objects[id] = [];
                initPagination(1);
                if(typeof(_callback[id]) === "function") _callback[id]($('#'+id));
            });

            $('#' + prefixID + 'add-selected-objects').unbind('click').click(function () {
                if(useAdditionalObjectsList) {
                    if (Array.isArray(parameters.additionalObjects)) addObjectsToPanel(parameters.additionalObjects.slice(), _callback[id]);
                } else {
                    if (Array.isArray(parameters.objects)) addObjectsToPanel(parameters.objects.slice(), _callback[id]);
                }
            });

            $('#' + prefixID + 'add-custom-object').unbind('click').click(function () {
                // variable mode
                //if(variableMode && objectsPanelElm.has('a').length) {
                if(variableMode && objects[id] && objects[id].length) {
                        M.toast({html: 'Please remove all other objects from object list before add a new variable', displayLength: 5000});
                } else addCustomObject(_callback[id]);
            });
        }

        // if objects defined and has length, then try to draw it in objects selector and skip objects,
        // defined in HTML "option" tags
        if(objects[id]){
            if(objects[id].length){
                if(typeof(objects[id][0]) === 'string') objects[id].shift();
                else objectsPanelElm.empty(); // !!! need to reload elm props after create it
            }
        } else { // else try to draw objects, defined in HTML "option" tags
            if(elmTag === 'SELECT') {
                objects[id] = $(elm).children('option').map(function (i, optionElm) {
                    var objectID = $(optionElm).attr('value');
                    if (!objectID) return;
                    var objectName = $(optionElm).text();
                    return {
                        id: Number(objectID),
                        name: objectName
                    }
                }).get();
            } else {
                try {
                    objects[id] = JSON.parse($(elm).val()).map(obj => { return {id: Number(obj.id), name: obj.name} });
                } catch (e) {
                    objects[id] = [];
                }
            }
        }

        if (objects[id] && objects[id].length) {
            objects[id] = objects[id].sort(function (a, b) {
                if(a.name.toUpperCase() < b.name.toUpperCase()) return -1;
                if(a.name.toUpperCase() > b.name.toUpperCase()) return 1;
                return 0;
            });

            addObjectsToPanel(null, function() {
                initPagination(1);
            });
        }

        function initPagination(initPage) {

            var paginationElm = $('.pagination');
            if(paginationElm.length) paginationElm.remove();

            if(objects[id].length < maxObjects) return printObjects();

            var lastPageNumber = Math.ceil(objects[id].length / maxObjects);
            if(initPage > lastPageNumber) initPage = lastPageNumber;

            var pagesHTML = '';
            for(var i = 1; i <= lastPageNumber; i++) {
                var pageClass = i === initPage ? 'active' : 'waves-effect';
                pagesHTML += '<li class="' + pageClass+ '"><a href="#!" id="' + prefixID + 'page' + i + '" pages="' + prefixID + '">' + i + '</a></li>';
            }
            objectsPanelElm.after('<ul class="pagination" id="' + prefixID + 'pagination">' +
                '<li class="disabled"><a href="#!" id="' + prefixID + 'left-page"><i class="material-icons">chevron_left</i></a></li>' +
                pagesHTML +
                '<li class="waves-effect"><a href="#!"  id="' + prefixID + 'right-page"><i class="material-icons">chevron_right</i></a></li>' +
                '</ul>');

            printObjects(initPage);

            // click on number
            $('a[pages="' +prefixID+ '"]').unbind('click').click(function() {
                var newActivePage = Number($(this).text());

                if(activePage === 1 && newActivePage !== 1)
                    $('#' + prefixID + 'left-page').parent().removeClass('disabled').addClass('waves-effect');

                if(newActivePage === 1)
                    $('#' + prefixID + 'left-page').parent().removeClass('waves-effect').addClass('disabled');

                if(activePage === lastPageNumber && newActivePage !== lastPageNumber)
                    $('#' + prefixID + 'right-page').parent().removeClass('disabled').addClass('waves-effect');

                if(newActivePage === lastPageNumber)
                    $('#' + prefixID + 'right-page').parent().removeClass('waves-effect').addClass('disabled');

                $('#' + prefixID + 'page' + activePage).parent().removeClass('active').addClass('waves-effect');
                $('#' + prefixID + 'page' + newActivePage).parent().removeClass('waves-effect').addClass('active');
                activePage = newActivePage;

                //console.log(activePage);
                printObjects(activePage);
            });

            // click on left
            $('#' + prefixID + 'left-page').unbind('click').click(function() {
                if(activePage === 1) return;
                if(activePage === lastPageNumber)
                    $('#' + prefixID + 'right-page').parent().removeClass('disabled').addClass('waves-effect');
                $('#' + prefixID + 'page' + activePage).parent().removeClass('active').addClass('waves-effect');
                $('#' + prefixID + 'page' + --activePage).parent().removeClass('waves-effect').addClass('active');
                if(activePage === 1) $(this).parent().addClass('disabled').removeClass('waves-effect');

                //console.log(activePage);
                printObjects(activePage);
            });

            // click on right
            $('#' + prefixID + 'right-page').unbind('click').click(function() {
                if(activePage === lastPageNumber) return;
                if(activePage === 1)
                    $('#' + prefixID + 'left-page').parent().removeClass('disabled').addClass('waves-effect');
                $('#' + prefixID + 'page' + activePage).parent().removeClass('active').addClass('waves-effect');
                $('#' + prefixID + 'page' + ++activePage).parent().removeClass('waves-effect').addClass('active');
                if(activePage === lastPageNumber) $(this).parent().addClass('disabled').removeClass('waves-effect');

                //console.log(activePage);
                printObjects(activePage);
            });
        }

        function printObjects(pageNum) {
            if(!pageNum) {
                var start = 0;
                var end = objects[id].length;
            } else {
                var lastPageNumber = Math.ceil(objects[id].length / maxObjects);
                start = (pageNum - 1) * maxObjects;
                end = pageNum * maxObjects;
                if(end > objects[id].length) end = objects[id].length;
                objectsPanelElm.empty();
            }

            for(var i = start; i < end; i++) appendObject(objects[id][i].id, objects[id][i].name);
        }

        function appendObject(objectID, objectName) {
            if(objectID === undefined || !objectName) {
                M.toast({html: 'Object ID or object name is not set', displayLength: 3000});
                return;
            }

            objectsPanelElm.append('<div class="chip mark-first-letter" ' + prefixID + 'object-id="' + objectID + '"><span>' +
                objectName + '</span><i class="close material-icons">close</i></div>');

            $('div[' + prefixID + 'object-id="'+ objectID+'"]').click(function() {
                for(var i = 0; i < objects[id].length; i++) {
                    if(String(objects[id][i].id) === $(this).attr(prefixID+'object-id')) {
                        if(elmTag === 'SELECT') {
                            $(elm).children('option[value="' + objects[id][i].id + '"]').remove();
                        } else {
                            try {
                                var elmData = JSON.parse($(elm).val()).filter(function (object) {
                                    return Number(object.id) !==  Number(objects[id][i].id);
                                });
                                $(elm).val(JSON.stringify(elmData));
                            } catch (e) {}
                        }
                        objects[id].splice(i, 1);
                        break;
                    }
                }
                if(elmTag === 'SELECT') $(elm).val(objects[id].length ? objects[id].map(function(object){ return object.id }): []);
                if(typeof _callback[id] === 'function') _callback[id]($('#'+id));
            });
        }

        function addCustomObject(callback) {

            var addCustomObjectDivInputElm = $('<div class="col s2"></div>'),
                addCustomObjectInputElm = $('<input type="text"/>'),
                addCustomObjectDivBtnElm = $('<div class="col s1"</div>'),
                addCustomObjectBtnAddElm = $('<a class="btn-floating"><i class="material-icons right">add</i></a>'),
                addCustomObjectBtnDelElm = $('<a class="btn-floating"><i class="material-icons right">delete</i></a>');

            objectsPanelElm.append(addCustomObjectDivInputElm.append(addCustomObjectInputElm)).append(addCustomObjectDivBtnElm.append(addCustomObjectBtnDelElm));

            addCustomObjectInputElm.focus();

            var prevValue;
            addCustomObjectInputElm.keyup(function() {
                var value = addCustomObjectInputElm.val();
                if(value && !prevValue) addCustomObjectDivBtnElm.empty().append(addCustomObjectBtnAddElm);
                else if(!value && prevValue) addCustomObjectDivBtnElm.empty().append(addCustomObjectBtnDelElm);
                prevValue = value;
            });

            addCustomObjectDivBtnElm.click(function() {
                var customObjectName = addCustomObjectInputElm.val();
                addCustomObjectDivInputElm.remove();
                addCustomObjectDivBtnElm.remove();

                if(customObjectName) {
                    customObjectName = customObjectName.replace(/^\s*(.+?)\s*$/, '$1');
                    if(variableMode && !/^%:.+:%$/.test(customObjectName))
                        customObjectName = '%:' + customObjectName.toUpperCase() + ':%';

                    addObjectsToPanel([{
                        id: customObjectName,
                        name: customObjectName
                    }], callback);
                }
            })
        }

        // add objects to objects selector.
        // objects - array of objects [{id: object1ID, name: object1Name}, {id: object2ID, name: object2Name, ...]
        //      or undefined on add all objects to the empty panel
        function addObjectsToPanel(newObjects, callback) {

            if(variableMode && newObject && newObjects[0] && !Number(newObjects[0].id)) {
                if(objects[id] && objects[id].length) {
                    M.toast({html: 'Trying to add variable "' +newObjects[0].id+ '" to list of objects. Please remove all objects', displayLength: 3000});
                    return;
                }
                if(newObjects.length) {
                    M.toast({html: 'Can\'t add variable "' +newObjects[0].id+ '" and objects together', displayLength: 3000});
                    return;
                }
            }

            // trying to add objects to variable
            if(variableMode && objects[id] && objects[id][0] && !Number(objects[id][0].id) && newObjects && newObjects.length) {
                M.toast({html: 'Can\'t use together objects and variable "' +objects[id][0].id+ '".', displayLength: 3000});
                return;
            }

            // no newObjects set. init mode
            if(!newObjects) {
                if(!objects[id] || !objects[id].length) return;
                var initMode = true; // add objects to the empty panel
                newObjects = objects[id];
                if(elmTag === 'SELECT') $(elm).empty().val([]);
                else $(elm).empty().val('');
            }

            for(var i=0, values = []; newObjects && i < newObjects.length; i++) {
                var newObject = newObjects[i];

                if(newObject.id === '' || newObject.name === '') { // skip error empty object
                    newObjects.splice(i--, 1);
                    continue;
                }

                if(objects[id] && objects[id].length && !initMode) {
                    var findDuplicateObject = false;
                    for (var j = 0; j < objects[id].length; j++) {
                        if(objects[id][j].id === newObject.id) {
                            findDuplicateObject = true;
                            newObjects.splice(i--, 1);
                            break;
                        }
                    }
                    if(findDuplicateObject) continue;
                }

                if(!initMode) appendObject(newObject.id, newObject.name);
                if(elmTag === 'SELECT') values.push('<option value="' + newObject.id + '" selected>' + newObject.name + '</option>');
                else values.push({
                    id: newObject.id,
                    name: newObject.name
                })
            }

            if(elmTag === 'SELECT') $(elm).append(values.join(''));
            else {
                var existingValues = $(elm).val() ? JSON.parse($(elm).val()) : null;
                if(existingValues && existingValues.length) Array.prototype.push.apply(existingValues, values);
                else existingValues = values;
                $(elm).val(JSON.stringify(existingValues));
            }

            if(!initMode) {
                if(!objects[id]) objects[id] = [];

                Array.prototype.push.apply(objects[id], newObjects);
                objects[id] = objects[id].sort(function (a, b) {
                    if(a.name.toUpperCase() < b.name.toUpperCase()) return -1;
                    if(a.name.toUpperCase() > b.name.toUpperCase()) return 1;
                    return 0;
                });
            }
            if(elmTag === 'SELECT') $(elm).val(objects[id].length ? objects[id].map(function(object){ return object.id }): []);
            if(typeof callback === 'function') callback($('#'+id));
        }
    }

})(jQuery); // end of jQuery name space
