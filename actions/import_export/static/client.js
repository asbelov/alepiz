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
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
    }

    function _beforeExec(callback) {
        importExportEditor.save();
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

        $('#checkDependenciesBtn').click(function() {
            importExportEditor.save();
            var objectsDataStr = $('#importExportJSONEditor').val();

            try {
                var objectsData = checkData(objectsDataStr);
            } catch(e) {
                log.error('Error in object data: ', e.message);
                return;
            }
            checkDependencies(objectsData)
        })

        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});

        generateJSON();
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

    function load(e, callback) {
        var file =  e.target.files[0];
        var path = (window.URL || window.webkitURL).createObjectURL(file);
        $(e.target).val(''); // to be able to open the same file multiple times
        readTextFile(path, function(objectDataStr) {
            try {
                var objectsData = checkData(objectDataStr)
            } catch (e) {
                return log.error('Error in object data: ', e.message);
            }
            checkDependencies(objectsData, callback);
        });
    }

    function generateJSON() {

        importExportEditor.setValue('[]');
        importExportEditor.save();


        var objectsIDs = objects.map(o => o.id);
        if(!objectsIDs.length) return;
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

            var externalObjectNames = [], externalCounterNames = [];
            var externalObjectsNamesForCheck = {}, externalCountersNamesForCheck = {};
            var objectsNames = data.objects.map(obj => obj.name);
            var objectsJSON = data.objects.map(param => {

                var objectJSON = {
                    name: param.name,
                    description: param.description,
                    sortPosition: param.sortPosition,
                    color: param.color,
                    disabled: param.disabled,
                };

                if(!$('#skipProperties').is(':checked')) {
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

                    if (properties.length) objectJSON.properties = properties;
                }

                if(!$('#skipInteractions').is(':checked')) {
                    var interactions = data.interactions
                        .filter(interact => interact.id1 === param.id || interact.id2 === param.id)
                        .map(interact => {
                            if(objectsNames.indexOf(interact.name1) !== -1 || objectsNames.indexOf(interact.name2) !== -1) {
                                var name = objectsNames.indexOf(interact.name1) === -1 ? interact.name1 : interact.name2;
                                if(!externalObjectsNamesForCheck[name]) {
                                    externalObjectNames.push({
                                        where: 'interactions',
                                        name: name,
                                        id: objectsNames.indexOf(interact.name1) === -1 ? interact.id1 : interact.id2,
                                    });
                                    externalObjectsNamesForCheck[name] = 1;
                                }
                            }
                            return {
                                name1: interact.name1,
                                name2: interact.name2,
                                type: interact.type,
                            }
                        });

                    if (interactions.length) objectJSON.interactions = interactions;
                }

                if(!$('#skipLinkedCounters').is(':checked')) {
                    var counters = data.counters
                        .filter(counter => counter.objectID === param.id)
                        .map(counter => {
                            if(!externalCountersNamesForCheck[counter.name]) {
                                externalCounterNames.push({
                                    where: 'linked counters',
                                    name: counter.name,
                                    id: counter.id,
                                });
                                externalCountersNamesForCheck[counter.name] = 1;
                            }
                            return counter.name
                        });

                    if (counters.length) objectJSON.counters = counters;
                }

                return objectJSON;
            });

            importExportEditor.setValue(JSON.stringify(objectsJSON, null, 4));
            importExportEditor.save();

            if(!externalObjectNames.length && !externalCounterNames.length) {
                M.toast({html: 'Successfully generating JSON from objects', displayLength: 2000});
            } else {
                $('#modalExportExternalEntitiesList').html(
                    (externalObjectNames.length > 1 ? (
                    '<li>All objects: <b>' + '<a href="/?a=%2Factions%2Fimport_export&c=' +
                        encodeURIComponent(externalObjectNames.map(o => o.name).join(',')) +
                        '" target="_blank">"' + escapeHtml(externalObjectNames.map(o => o.name).join(', ')) +
                    '"</a></b></li>') : '') +
                    externalObjectNames.map(obj => {
                        return '<li>object:&nbsp;&nbsp; <b>' + '<a href="/?a=%2Factions%2Fimport_export&c=' +
                            encodeURIComponent(obj.name) +
                            '" target="_blank">"' + escapeHtml(obj.name) + '"</a> (#' + String(obj.id).slice(-5) +
                            ')</b> for ' + obj.where + '</li>';
                    }).join('') +
                    externalCounterNames.map(counter => {
                        return '<li>counter: <b>' +
                            (counter.id ?
                                '<a href="/?a=%2Factions%2Fcounter_settings&cid=' + counter.id +
                                '" target="_blank">"' + escapeHtml(counter.name) +
                                '"</a> (#' + String(counter.id).slice(-5) + ')' :
                                '<span class="red-text">Not selected</span>') +
                            '</b> for ' + counter.where + '</li>';
                    }).join('')
                )
                var modalExportExternalEntitiesInfoInstance =
                    M.Modal.init(document.getElementById('modalExportExternalEntitiesInfo'));
                modalExportExternalEntitiesInfoInstance.open();
            }
        });
    }

    function checkDependencies(objectsData, callback) {

        if(!Array.isArray(objectsData) || !objectsData.length) {
            M.toast({html: 'Object data not found in editor', displayLength: 3000});
            return;
        }

        var externalObjectNames = {}, externalCounterNames = {};

        objectsData.forEach(objectData => {
            if($('#skipProperties').is(':checked')) delete objectData.properties;
            if($('#skipInteractions').is(':checked')) delete objectData.interactions;
            if($('#skipLinkedCounters').is(':checked')) delete objectData.counters;

            if(Array.isArray(objectData.interactions) && objectData.interactions.length) {
                objectData.interactions.forEach(intersection => {
                    if(objectData.name) {
                        if (intersection.name1 && objectData.name.toUpperCase() !== intersection.name1.toUpperCase()) {
                            externalObjectNames[intersection.name1] = 0;
                        }
                        if (intersection.name2 && objectData.name.toUpperCase() !== intersection.name2.toUpperCase()) {
                            externalObjectNames[intersection.name2] = 0;
                        }
                    }
                });
            }

            if(Array.isArray(objectData.counters) && objectData.counters.length) {
                objectData.counters.forEach(counter => externalCounterNames[counter] = 0);
            }
        });

        $.post(serverURL, {
            func: 'getObjectsByNames',
            objectNames: Object.keys(externalObjectNames).join('\r'),
        }, function (rows) {
            // select * from objects where name like ...
            rows.forEach(row => {
                externalObjectNames[row.name] = row.id;
            });

            $.post(serverURL, {
                func: 'getCountersByNames',
                counterNames: Object.keys(externalCounterNames).join('\r'),
            }, function (rows) {
                // SELECT name, id FROM counters WHERE name IN (...
                rows.forEach(row => {
                    externalCounterNames[row.name] = row.id;
                });

                var unresolvedObjects = [], unresolvedCounters = [];

                for(var objectName in externalObjectNames) {
                    if(!externalObjectNames[objectName]) {
                        unresolvedObjects.push({
                            where: 'interactions',
                            name: objectName,
                        });
                    }
                }

                for(var counterName in externalCounterNames) {
                    if(!externalCounterNames[counterName]) {
                        unresolvedCounters.push({
                            where: 'linked counters',
                            name: counterName,
                        });
                    }
                }

                importExportEditor.setValue(JSON.stringify(objectsData, null, 4));

                if(!unresolvedObjects.length && !unresolvedCounters.length) {
                    M.toast({html: 'Successfully checking JSON data. No errors found', displayLength: 2000});
                    if(typeof callback === 'function') callback(objectDataStr);
                } else {
                    $('#modalImportEntitiesNotFoundList').html(
                        unresolvedObjects.map(o => {
                            return '<li>object: <b>"' + escapeHtml(o.name) + '"</b> for ' + o.where + '</li>';
                        }).join('') +
                        unresolvedCounters.map(o => {
                            return '<li>counter: <b>"' + escapeHtml(o.name) + '"</b> for ' + o.where + '</li>';
                        }).join('')
                    );

                    var modalImportEntitiesNotFoundInfoInstance =
                        M.Modal.init(document.getElementById('modalImportEntitiesNotFoundInfo'));
                    modalImportEntitiesNotFoundInfoInstance.open();

                    $('#modalImportEntitiesNotFoundOkBtn').click(function () {
                        if(typeof callback === 'function') callback(objectDataStr);
                    });
                }
            });
        });
    }
})(jQuery); // end of jQuery name space