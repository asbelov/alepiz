/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 10.04.2022, 16:15:07
*/
function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

function callbackBeforeExec(callback) {
    JQueryNamespace.beforeExec(callback);
}

function callbackAfterExec(data, callback) {
    JQueryNamespace.afterExec(data, callback);
}

var JQueryNamespace = (function ($) {
    $(function () {
        importExportTabSelectorElm = $('#importExportTabSelector');
        init(); // Will run after finishing drawing the page
    });

    var serverURL = parameters.action.link+'/ajax'; // path to ajax
    var objects = parameters.objects; // initialize the variable "objects" for the selected objects on startup
    var importExportEditor;
    var importExportTabSelectorElm;

    return {
        onChangeObjects: _onChangeObjects,
        beforeExec: _beforeExec,
        afterExec: _afterExec
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
    }

    function _beforeExec(callback) {
        importExportEditor.save();
        callback();
    }

    function _afterExec(data, callback) {
        callback();
    }

    function init() {
        importExportEditor = javaScriptEditor({parentID: 'importExportJSONEditor', jsonMode: true});

        $('#importExportTabSelector').click(function() {
            setTimeout(function() {
                importExportEditor.init();
                if(!$('#importExportJSONEditor').val()) {
                    generateJSON();
                }
            }, 100);
        });

        $('#getDataFromObjectBtn').click(generateJSON);

        $('#exportObjectBtn').click(function () {
            importExportEditor.save();
            var objectsDataStr = $('#importExportJSONEditor').val();

            try {
                var objectsData = checkData(objectsDataStr);
            } catch(e) {
                log.error('Error in object data: ', e.message);
                return;
            }

            var fileName = objectsData.length === 1 ? objectsData[0].name : 'ALEPIZ_objectsData';
            saveText(objectsDataStr, fileName);
        });

        $("#importObjectBtn").on('change', load);
    }

    function checkData(objectsDataStr) {
        var objectsData = JSON.parse(objectsDataStr);
        if(!objectsData) throw new Error('Object data is empty');

        return objectsData;
    }

    function saveText(text, fileName) {
        var a = document.createElement('a');
        a.setAttribute('href', 'data:application/json;charset=utf-8,'+ encodeURIComponent(text));
        a.setAttribute('download', fileName);
        a.click();
    }

    // Load btn
    function readTextFile(file, callback) {
        var rawFile = new XMLHttpRequest();
        rawFile.overrideMimeType("application/json");
        rawFile.open("GET", file, true);
        rawFile.onreadystatechange = function() {
            if (rawFile.readyState === 4 && rawFile.status === 200) {
                callback(rawFile.responseText);
            }
        }
        rawFile.send(null);
    }

    function load(e, callback){
        var file =  e.target.files[0];
        var path = (window.URL || window.webkitURL).createObjectURL(file);
        readTextFile(path, function(objectDataStr) {
            try {
                checkData(objectDataStr)
            } catch (e) {
                log.error('Error in object data: ', e.message);
            }
            importExportEditor.setValue(objectDataStr);
            if(typeof callback === 'function') callback(objectDataStr);
        });
    }

    function generateJSON() {

        importExportEditor.setValue('[]');
        importExportEditor.save();


        var objectsIDs = objects.map(o => o.id);
        // objects = [{id:, name:, description:, sortPosition:, color:, disabled:}, ...]
        // properties = [{id:..., objectID:..., name:..., value:..., description:..., mode:...}, ...]
        // counters = [{id:.., name:.., unitID:..., collector:..., sourceMultiplier:..., groupID:..., OCID:..., objectID:..., objectName:..., objectDescription:..}, ...]
        // interactions:
        //          [{
        //                  name1: <objName1>, description1: <objDescription1>, id1: <id1>,
        //                  name2: <objName2>, description2: <objDescription2>, id2: <id2>,
        //                  type: <interactionType1>
        //           },
        //           {...},...]
        // interaction types: 0 - include; 1 - intersect, 2 - exclude
        $.post(serverURL, {func: 'getObjectParameters', IDs: objectsIDs.join(',')}, function(data) {
            if(!data || !Array.isArray(data.objects)) return;

            var objectsJSON = data.objects.map(param => {

                var objectJSON = {
                    name: param.name,
                    description: param.description,
                    sortPosition: param.sortPosition,
                    color: param.color,
                    disabled: param.disabled,
                };

                var properties = data.properties
                    .filter(prop => prop.objectID === param.id)
                    .map(prop => {
                        return {
                            name: prop.name,
                            value: prop.value,
                            description: prop.description,
                            mode: prop.mode,
                        }
                    });

                if(properties.length) objectJSON.properties = properties;

                var interactions = data.interactions
                    .filter(interact => interact.id1 === param.id || interact.id2 === param.id)
                    .map(interact => {
                        return {
                            name1: interact.name1,
                            name2: interact.name2,
                            type: interact.type,
                        }
                    });

                if(interactions.length) objectJSON.interactions = interactions;

                var counters = data.counters
                    .filter(counter => counter.objectID === param.id)
                    .map(counter => counter.name);

                if(counters.length) objectJSON.counters = counters;

                return objectJSON;
            });

            importExportEditor.setValue(JSON.stringify(objectsJSON, null, 4));
            importExportEditor.save();
        });
    }



})(jQuery); // end of jQuery name space