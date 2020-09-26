/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 28.07.2015.
 */

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

var editor = [];

function callbackBeforeExec(callback) {

    var counterIDSelectorElm = $('#counterIDSelector');
    if(Number(counterIDSelectorElm.val()) && $('#deleteCounter').prop("checked")) {

        var modalDeleteConfirmInstance = M.Modal.init(document.getElementById('modalDeleteConfirm'), {dismissible: false});
        modalDeleteConfirmInstance.open();
        //    $('deleteCounter').prop('checked', false);

        $('#modalDeleteConfirmNo').click(function(){
            callback(new Error('Delete operation is canceled'));
        });

        $('#modalDeleteConfirmYes').click(function(){
            $('#counterID').val(counterIDSelectorElm.val());

            callback();
        });
        return;
    }

    // Save JS editors content to textareas
    for(var i=0; i<editor.length; i++){
        try{  editor[i].save(); }
        catch(e) {}
    }

    JQueryNamespace.onSaveCounterWithNewName(callback);
}

function callbackAfterExec(counterID, callback) {

    // waiting while onChangeObjects with initCountersSelector() is executed for set returned counterID
    // to select#counterIDSelector element for a new counter
    setTimeout(function() {
        JQueryNamespace.initCountersSelector(counterID, callback);
    }, 2000);
}

var JQueryNamespace = (function ($) {
    $(function () {
        objects = parameters.objects;
        initObjectsSelector(objects);
        initCollectors();
        initCountersGroups();
        initCountersUnits();
        initObjectsLinkageTab();
        initVariablesDefinitionsTab();
        M.FormSelect.init(document.querySelectorAll('select'), {});
        M.Modal.init(document.getElementById('counterGroupsSettings'), {});
        M.Modal.init(document.getElementById('unitsSettings'), {});
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
        M.Tabs.init(document.getElementById('mainTabs'), {});
    });


    var serverURL = parameters.action.link+'/ajax';
    // do not set 0!!! in childServer.js we check 'if(variableNumber){...}' for undefined, NaN, '', null etc.
    var variableNumber = 1,
        updateEventNumber = 1,
        historyFunctionsHTML = '',
        historyFunctionsDescription = {},
        unitsParams = {},
        objects,
        selectedObjects = [],
        sharedCountersNames,
        notSharedSuffix = ' [NOT SHARED]';

    return {
        initCountersSelector: initCountersSelector,
        onChangeObjects: onChangeObjects,
        onSaveCounterWithNewName: onSaveCounterWithNewName
    };

    function initObjectsSelector(objects, callback) {
        var objectsSelectorElm = $('#objectsIDs'),
            filterGroupIDElm = $('#filterGroupID');

        // !!! objectsSelector callback will be called only when object selector is changed. It's not called when object selector is init
        objectsSelectorElm.objectsSelector(objects, function(selectElm) {
            selectedObjects = selectElm.children('option').map(function() {
                var val = $(this).val();
                if(val && Number(val) === parseInt(String(val), 10)) val = Number(val);

                return {
                    name: $(this).text(),
                    id: val
                }
            }).get();

            setCountersGroupsSelector(filterGroupIDElm, null, objectsSelectorElm.val().length ? 0 : 1, function() {
                initCountersSelector(null, callback);
            });
        });

        selectedObjects = objects || [];

        setCountersGroupsSelector(filterGroupIDElm, filterGroupIDElm.val(), objects.length ? 0 : 1, function(){
            initCountersSelector();
        });

        filterGroupIDElm.unbind('change').change(function() {
            initCountersSelector();
        });
    }

    function onChangeObjects(_objects) {
        objects = _objects;
        if($('#counterSettingsTab').hasClass('active')) initObjectsSelector(objects);
    }

    function initCountersSelector(initCounterID, callback) {
        var objectsIDs = $('#objectsIDs').val();

        $('#updateVariablesRef').val('');

        var counterSelectorElm = $('#counterIDSelector');
        var counterIDElm = $('#counterID');

        $('#tabPanel').unbind('click').click(function(){
            if(counterSelectorElm.val() && !$('a[href="#counterSettingsTab"]').hasClass('active')) {
                counterIDElm.val(counterSelectorElm.val());
            }
        });

        // get counters for selected objects from objects list
        $.post(serverURL, {
            func: 'getCountersForObjects',
            ids: objectsIDs.join(','),
            groupID: $('#filterGroupID').val()
        }, function (allCounters) {
            var counters = getSharedCounters(objectsIDs.length, allCounters);
            var selectHTML = '<option value="">New counter</option>';
            if(counters && counters.length) {
                selectHTML += counters.sort(function (a,b) {
                    var aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
                    if(aName > bName) return 1;
                    if(aName < bName) return -1;
                    if(aName === bName) return 0;
                }).map(function (counter) {
                    var selected = initCounterID === counter.id ? ' selected' : '';
                    return '<option value="' + counter.id + '"' + selected + '>' + escapeHtml(counter.name) + ' (#'+ counter.id + ')</option>';
                }).join('');
            }

            counterSelectorElm.html(selectHTML);

            // function initCountersSelector called any times, when you change object selection
            // from the left object menu. We mast unbind previous onchange events before bind new
            counterSelectorElm.unbind('change');
            counterSelectorElm.change(fillForm);

            if(counterIDElm.val()) counterSelectorElm.val(counterIDElm.val());
            if(!counterSelectorElm.val()) counterIDElm.val(''); // if select don't have same value with counterIDElm then remove value from counterIDElm

            M.FormSelect.init(counterSelectorElm[0], {});

            if(typeof callback === 'function') return callback();
        });
    }

    /*
        get array with shared counters for specific objects from all cpounters fro specific objects

        objectsCnt: count of objects
        countersArray: [{id: <counterID>, .....}, ]

        return sharedCounters: [{id: <counterID>, .....}, ]

     */
    function getSharedCounters(objectsCnt, countersArray) {
        if(!countersArray || !countersArray.length) return [];

        // remove objectID and other unused parameters
        if(objectsCnt === 0 || objectsCnt === 1) return countersArray.map(function (counter) {
            return {
                id: counter.id,
                name: counter.name
            }
        });

        var counters = {};
        countersArray.forEach(function (counter) {
            if(!counters[counter.id]) counters[counter.id] = [];
            // remove objectID and other unused parameters
            counters[counter.id].push({
                id: counter.id,
                name: counter.name
            });
        });

        var sharedCounters = [];
        for(var counterID in counters) {
            if(counters[counterID].length === objectsCnt) sharedCounters.push(counters[counterID][0]);
        }

        return sharedCounters;
    }

    function fillForm() {
        var counterID = this.value;
        var linkedObjectsIDsElm = $('#linkedObjectsIDs');
        $('#counterID').val(counterID); //set counter ID even if select "New counter" with empty value

        if(!counterID) {  // if selected a "New counter", leave counter parameters unchanged and return
            $('#name').focus();
            if(!linkedObjectsIDsElm.val().length && selectedObjects.length)
                linkedObjectsIDsElm.objectsSelector(selectedObjects, reloadCounterListForAllVariables);
            return;
        }

        $("body").css("cursor", "progress");
        $.post(serverURL, {func: 'getCounterByID', id: counterID}, function(counter) {
            if(!counter) return M.toast({html: 'Error while getting counter by ID '+counterID, displayLength: 5000});

            $('#name').val(counter.name);
            $('#keepHistory').val(counter.keepHistory);
            $('#keepTrends').val(counter.keepTrends);

            if(counter.description) $('#description').val(counter.description);
            else $('#description').val('');

            if(counter.disabled) $('#disabled').prop('checked', true);
            else $('#disabled').prop('checked', false);

            if(counter.debug) $('#debug').prop('checked', true);
            else $('#debug').prop('checked', false);

            if(counter.taskCondition) $('#taskCondition').prop('checked', true);
            else $('#taskCondition').prop('checked', false);


            initCollectors(counter.collectorID, counter.id);
            initCountersGroups(counter.groupID);
            initCountersUnits(counter.unitID, counter.sourceMultiplier);
            $('#objectsLinksPanel').empty();
            $.post(serverURL, {func: 'getCounterObjects', id: counterID}, function (objects) {
                linkedObjectsIDsElm.objectsSelector(objects, reloadCounterListForAllVariables);

                setVariablesDefinitionsTab(counterID, function() {
                    // add update events settings
                    $.post(serverURL, {func: 'getUpdateEvents', id: counterID}, function(updateEvents){
                        // array with one element will be returned by ajax simple as element, but not as array. convert it back to array
                        if(updateEvents.counterID) updateEvents = [updateEvents];

                        $('#updateEventsArea').empty();
                        if(updateEvents.length) addUpdateEvents(updateEvents);

                        M.updateTextFields();
                        $("body").css("cursor", "auto");

                        if(!sharedCountersNames) getSharedCountersNamesAndMarkNotSharedCounters();
                        else {
                            markNotSharedCounters($('select[objectID="0"]'));
                            markNotSharedCounters($('select[countersForHistoryVariables]'));
                        }
                    });
                })
            });

            // remove class 'active' from label elements, which input elements has not value
            // add class 'active' to label elements, which input elements has value
            $('input[type=text]').each(function() {
                if($(this).val()) $(this).next('label').addClass('active');
                else $(this).next('label').removeClass('active')
            });

            /*
            var inputTextElms = $('input[type=text]');
            // remove class 'active' from label elements, which input elements has not value
            inputTextElms.filter(function(){return !this.value}).next('label').removeClass('active');
            // add class 'active' to label elements, which input elements has value
            inputTextElms.filter(function(){return this.value}).next('label').addClass('active');
            */
        });
    }

    function initObjectsLinkageTab() {

        $('#linkedObjectsIDs').objectsSelector(selectedObjects.length ? selectedObjects : null, reloadCounterListForAllVariables);

        var modalAddUpdateEventConfirmInstance = M.Modal.init(document.getElementById('modalAddUpdateEventConfirm'), {dismissible: false});

        $('#modalAddUpdateEventConfirmYes').click(addUpdateEventOnClick);
        $('#addUpdateEvent').click(function() {
            if($('#activeCollector').val()) modalAddUpdateEventConfirmInstance.open();
            else addUpdateEventOnClick();

        });

        function addUpdateEventOnClick() {
            if(objects && objects.length)
                var updateEvents = objects.map(function(obj) {
                    return {
                        objectID: obj.id,
                        name: obj.name
                    }
                });
            else updateEvents = [{ objectID: 0}];

            addUpdateEvents(updateEvents, function() {
                // don\'t understand why, but it does not work without setTimeout
                setTimeout(function() {markNotSharedCounters($('select[objectID="0"]')); }, 500);
            });
        }
        $('a[href="#objectsLinksTab"]').click(function () {
            setTimeout(function() {
                $('[data-textarea-update-event]').each(function() {
                    M.textareaAutoResize($(this));
                });
            }, 1000);
        });
    }

    function getCountersForUpdateEventsObject(objectIDs, callback) {

        var getSharedCountersForObjects = function(objects, callback) { callback([])};
        var getCountersForObjects = function(objects, callback) { callback([])};

        var hasUpdateEventsGeneratedByThisObject = false;
        var externalObjectsIDs = [];

        objectIDs.forEach(function(objectID) {
            if(objectID) externalObjectsIDs.push(objectID);
            else hasUpdateEventsGeneratedByThisObject = true; // if objectID === 0 or null etc
        });

        if(hasUpdateEventsGeneratedByThisObject) {
            // some times it's a very big array and query will be very slow
            // use selected objects instead
            //var objectsIDsForThisObject = JSON.parse($('#linkedObjectsIDs').val()).map(function (object) {
            //             return object.id;
            //         }); // array of objects IDs
            //if(!objectsIDsForThisObject)  return M.toast({html: 'Please link one or more objects to a counter', displayLength: 20000});

            var objectsIDsForThisObject = $('#objectsIDs').val();
            if(!objectsIDsForThisObject)  return M.toast({html: 'Please select one or more objects', displayLength: 20000});

            getSharedCountersForObjects = function(objectsIDs, callback) {

                $.post(serverURL, {
                    func: 'getCountersForObjects',
                    ids: objectsIDs.join(',')
                }, function(allCounters) {
                    var counters = getSharedCounters(objectsIDs.length, allCounters);
                    if(!counters || !counters.length) M.toast({html: 'Objects, linked to a counter, don\'t have a shared counters', displayLength: 20000});

                    callback(counters);
                });
            }
        }

        if(externalObjectsIDs.length) {
            getCountersForObjects = function(objects, callback) {
                $.post(serverURL, {func: 'getCountersForObjects', ids: objects.join(',')}, function(counters) {
                    if(!counters || !counters.length) M.toast({html: 'Objects don\'t have a counters', displayLength: 20000});

                    callback(counters);
                });
            }
        }

        getCountersForObjects(externalObjectsIDs, function(countersForExternalObjects) {
            getSharedCountersForObjects(objectsIDsForThisObject, function(sharedCountersForLinkedObjects) {

                var counters = $.isArray(countersForExternalObjects) ? countersForExternalObjects : [];

                if($.isArray(sharedCountersForLinkedObjects)) counters.push.apply(counters, sharedCountersForLinkedObjects);

                callback(counters);
            })
        })
    }

    function createOptionsForSelectElmWithCounters(counters) {
        var countersHTML = {};

        counters.forEach(function (counter) {
            if(!counter.objectID) counter.objectID = 0;

            if(!countersHTML[counter.objectID]) countersHTML[counter.objectID] = '';
            countersHTML[counter.objectID] += '<option value="' + counter.id + '">' + counter.name + '</option>';
        });

        return countersHTML;
    }

    // updateEvents: [{counterID:.., counterName:..., expression:.., objectID: parentObjectID, name: objectName}, ...]
    function addUpdateEvents(updateEvents, callback) {

        if(!updateEvents) return;

        // counters: [{id:.., name:.., groupID:..., objectID: parentObjectID, objectName: parentObjectName}, ...]
        getCountersForUpdateEventsObject(updateEvents.map(function(updateEvent) { return updateEvent.objectID}), function (counters) {

            if(!counters || !counters.length) return;

            var countersHTML = createOptionsForSelectElmWithCounters(counters);

            updateEvents.forEach(function(updateEvent) {

                var updateEventID = 'updateEvent_'+updateEventNumber;

                updateEvent.expression = updateEvent.expression ? updateEvent.expression : '';
                updateEvent.objectID  = updateEvent.objectID ? updateEvent.objectID : 0;
                updateEvent.mode = updateEvent.mode === undefined ? 0 : updateEvent.mode;
                updateEvent.objectFilter = updateEvent.objectFilter ? updateEvent.objectFilter : '';
                if(!updateEvent.name) {
                    updateEvent.name = 'this object';
                    var thisObjectWarning = '<p class="col s12">Make sure that all linked objects contain the selected counter. Otherwise, the update event will not work for all objects.</p>';
                    var objectFilter = '';
                } else {
                    thisObjectWarning = '';
                    objectFilter = '<div class="input-field col s12">' +
                        '<input type="text" id="' + updateEventID + '_objectFilter" value="'+updateEvent.objectFilter+'"/>' +
                        '<label for="' + updateEventID + '_objectFilter">' +
                        'Regular expression for filtering dependent objects by object names. You can use variables only from the parent object. Variables will be replaced by values.' +
                        '</label>' +
                        '</div>';
                }

                var modeSelected = ['','','','']; modeSelected[updateEvent.mode] = ' selected';

                $('#updateEventsArea').append('\
<div class="card">\
    <input type="hidden" id="' +updateEventID+ '_objectID" value="' +updateEvent.objectID+ '"/>\
    <div class="card-content">\
        <div class="row">\
            <div class="col s11 card-title">Update event, generated by <u>'+ updateEvent.name +'</u></div>\
            <div class="col s1">\
                <a href="#!" class="secondary-content" removeObjectForUpdateEvent>\
                    <i class="material-icons">close</i>\
                </a>\
                <a href="#!" class="secondary-content" functionsHelpUpdateEvent>\
                    <i class="material-icons">help_outline</i>\
                </a>\
            </div>' + objectFilter + thisObjectWarning + '\
            <div class="input-field col s12 m12 l6">\
                <select id="' +updateEventID+ '_counterID" objectID="' + updateEvent.objectID+ '">' + countersHTML[updateEvent.objectID] + '</select>\
                <label>Counter</label>\
            </div>\
            <div class="input-field col s12 m12 l6">\
                <select id="' +updateEventID+ '_mode">\
                    <option value="0"' +modeSelected[0]+ '>Update each time when expression value is true</option>\
                    <option value="1"' +modeSelected[1]+ '>Update once when expression value is changed to true</option>\
                    <option value="2"' +modeSelected[2]+ '>Update once when expression value is changed to true and once when changed to false</option>\
                    <option value="3"' +modeSelected[3]+ '>Update each time when expression value is changed to true and once when changed to false</option>\
                    <option value="4"' +modeSelected[4]+ '>Update once when expression value is changed to false</option>\
                </select>\
                <label>Update mode</label>\
            </div>\
            <div class="col s12">If no expression, then update event will occurred each time, when parent counter will received a new value. \
It will happened independently form update mode settings \
            </div>\
            <div class="input-field col s12">\
                <textarea class="materialize-textarea" id="' +updateEventID+ '_expression" data-textarea-update-event>' + updateEvent.expression + '</textarea>\
                 <label for="' +updateEventID+ '_expression"> Logical expression </label>\
             </div>\
         </div>\
     </div>\
 </div>'
                );

                var updateEventSelectCounterElm = $('#' +updateEventID+ '_counterID');
                //var updateEventVal = updateEventSelectCounterElm.val();
                if(updateEvent.counterID) updateEventSelectCounterElm.val(updateEvent.counterID);
                if(!updateEventSelectCounterElm.val()) {
                    updateEventSelectCounterElm.append('<option value="' + updateEvent.counterID + '" selected>' + updateEvent.counterName + '</option>');
                    M.toast({html: 'Counter ' + updateEvent.counterName + '(#' +updateEvent.counterID+ ') is not linked to ' + updateEvent.name + ' and update event for this object is never occurred', displayLength: 10000});
                    //updateEventSelectCounterElm.val(updateEventVal);
                }

                updateEventNumber++;
            });

            M.FormSelect.init(document.querySelectorAll('select'), {});

            M.updateTextFields();

            $('a[removeObjectForUpdateEvent]').click(function() {
                $(this).parent().parent().parent().parent().remove();
            });

            $('a[functionsHelpUpdateEvent]').unbind('click').click(showFunctionDescription);

            if(typeof callback === 'function') return callback();
        });
    }

    function showFunctionDescription() {
        $.post(serverURL, {func: 'getFunctionsDescription'}, function(functionsDescription){
            var html = '<span>' + Object.keys(functionsDescription).sort().map(function(funcName) {
                    return '<span><span funcNameHelp="' + funcName+ '" style="cursor:pointer; color:yellow">' + funcName +
                        (funcName === 'arithmetical operators' ? '' : '()') + ': </span>' +
                        escapeHtml(functionsDescription[funcName].replace(/^(.+)[\w\W]*/m, '$1')) + '</span><br>';
                }).join('') +
                '</span><button class="btn-flat toast-action" onclick="M.Toast.dismissAll();">X</button>';

            M.Toast.dismissAll();
            M.toast({html: html, displayLength: 50000});

            $('span[funcNameHelp]').click(function() {
                var funcName = $(this).attr('funcNameHelp');
                var html = 'Function ' + escapeHtml(functionsDescription[funcName]).replace(/\n/g, '<br>') +
                    '<button class="btn-flat toast-action" onclick="M.Toast.dismissAll();">X</button>';

                M.Toast.dismissAll();
                M.toast({html: html, displayLength: 50000});
            });
        });
    }

    function initCollectors(activeCollectorID, counterID) {
        $.post(serverURL, {func: 'getCollectors'}, function(collectors){
            var collectorsSelectElm = $('#collectorID'), collectorHelpBtn = $('#collectorHelpBtn');
            collectorsSelectElm.empty();

            for(var collectorID in collectors) {
                if (!collectors.hasOwnProperty(collectorID) || !collectorID) continue;
                var collector = collectors[collectorID];

                if (!collector.name) var name = collectorID;
                else name = collector.name;

                if(activeCollectorID === collectorID || activeCollectorID === undefined){
                    var selected = ' selected';
                    activeCollectorID = '';

                    // calling async function without callback. It will be at the end of the loop
                    setCollectorParameters(collectorID, counterID);
                }
                else selected = '';

                collectorsSelectElm.append('<option value="' + collectorID + '"'+selected+'>' + name + '</option>')
            }

            // when change counter and reinit collector selector, this function called and add another
            // one change event to element. Unbind previous change event.
            // I try to rewrite this code, but unbind is really easy way
            collectorsSelectElm.unbind('change');
            collectorsSelectElm.change(function(e){setCollectorParameters(e.target.value)});

            collectorHelpBtn.unbind('click').click(function (e) {
                e.preventDefault();  // prevent default
                var helpWindowWidth = Math.floor(screen.width - screen.width / 3);
                var helpWindowsHeight = Math.floor(screen.height - screen.height / 3);
                var helpWindowLeft = (screen.width - helpWindowWidth) / 2;
                var helpWindowTop = (screen.height - helpWindowsHeight) / 2;
                var url = $(this).attr('href');
                window.open(url, 'ALEPIZ help window',
                    'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=' +
                    helpWindowWidth + ', height=' + helpWindowsHeight + ', top=' + helpWindowTop + ', left=' + helpWindowLeft);
            });

            M.FormSelect.init(collectorsSelectElm[0], {});

            // Be attention: This is an async function without callback at the end
            function setCollectorParameters(collectorID, counterID){
                if(!collectorID) return;

                collectorHelpBtn.attr('href', '/collectors/' + collectorID + '/help/');

                var collector = collectors[collectorID];
                if(!collector || !collector.parameters) return;

                var collectorParametersParentElm = $('#collectorParameters');
                collectorParametersParentElm.empty();

                // set hidden element #activeCollector to value of collector.active for sing is selected collector
                // is active. It's used for warning, when user try to set update event for active collector
                // Active collector usually updating using internal mechanism.
                $('#activeCollector').val(collector.active);

                if(counterID) var getCounterParameters = function(callback){
                    // callback(counterParameters); counterParameters: [{name:.., value:..}, ...]
                    $.post(serverURL, {func: 'getCounterParameters', id: counterID}, function(counterParameters){
                        callback(counterParameters)
                    });
                };
                else getCounterParameters = function(callback){ callback() };


                getCounterParameters(function(counterParameters) {

                    for (var parameterName in collector.parameters) {
                        if (!collector.parameters.hasOwnProperty(parameterName)) continue;

                        var parameter = collector.parameters[parameterName];

                        var rawValue = undefined, labelClass = '';
                        for(var i = 0; $.isArray(counterParameters) && i < counterParameters.length; i++) {
                            if(counterParameters[i].name.toLowerCase() === parameterName.toLowerCase()){
                                rawValue = counterParameters[i].value;
                                break;
                            }
                        }

                        if (rawValue === undefined || rawValue === null) {
                            if(parameter.default !== undefined) {
                                rawValue = parameter.default;
                                labelClass = ' class="active" ';
                            } else rawValue = '';
                        }

                        var value = escapeHtml(rawValue);

                        if (!parameter.type) parameter.type = 'textinput';
                        else parameter.type = parameter.type.toLowerCase();

                        if (parameter.type === 'javascripteditor') {
                            collectorParametersParentElm.append('<div class="col s12">' +
                                '<span>' + parameter.description + '</span>' +
                                '<textarea id="collectorParameter_' + parameterName+'">'+value+'</textarea></div>');
                            var editorNum = editor.length;
                            editor[editorNum] = javaScriptEditor({parentID: 'collectorParameter_' + parameterName});
                            if (value) editor[editorNum].setValue(rawValue);

                        } else if(parameter.type === 'jsoneditor') {
                            collectorParametersParentElm.append('<div class="col s12">' +
                                '<span>' + parameter.description + '</span>' +
                                '<textarea id="collectorParameter_' + parameterName+'">'+value+'</textarea></div>');
                            editorNum = editor.length;
                            editor[editorNum] = javaScriptEditor({
                                parentID: 'collectorParameter_' + parameterName,
                                jsonMode: true,
                                height: 100,
                            });
                            if (value) editor[editorNum].setValue(rawValue);
                        } else if (parameter.type === 'textinputlong') {
                            collectorParametersParentElm.append(
                                '<div class="input-field col s12">' +
                                '<input type="text" id="collectorParameter_' + parameterName + '" value="'+value+'"/>' +
                                '<label for="collectorParameter_' + parameterName + '"' + labelClass + '>' +
                                parameter.description +
                                '</label>' +
                                '</div>');
                        } else if (parameter.type === 'textinputpassword') {
                            collectorParametersParentElm.append(
                                '<div class="input-field col s12 m6 l4">' +
                                '<input type="password" class="validate" id="collectorParameter_' + parameterName + '" value="'+value+'"/>' +
                                '<label for="collectorParameter_' + parameterName + '"' + labelClass + '>' +
                                parameter.description +
                                '</label>' +
                                '</div>');
                        } else if (parameter.type === 'textinputmiddle') {
                            collectorParametersParentElm.append(
                                '<div class="input-field col s12 m6 l8">' +
                                '<input type="text" id="collectorParameter_' + parameterName + '" value="'+value+'"/>' +
                                '<label for="collectorParameter_' + parameterName + '"' + labelClass + '>' +
                                parameter.description +
                                '</label>' +
                                '</div>');
                        } else if (parameter.type === 'checkbox') {
                            collectorParametersParentElm.append(
                                '<p class="col s12 m6 l4">' +
                                '<label><input type="checkbox" id="collectorParameter_' + parameterName + '" ' + (value ? 'value="'+value+'" checked' : '') + '/>' +
                                '<span>' + parameter.description +
                                '</span></label>' +
                                '</p>');
                        } else if (parameter.type === 'textarea') {
                            collectorParametersParentElm.append(
                                '<div class="input-field col s12">' +
                                '<textarea id="collectorParameter_' + parameterName + '" class="materialize-textarea">' +
                                value + '</textarea>' +
                                '<label for="collectorParameter_' + parameterName + '"' + labelClass + '>' +
                                parameter.description +
                                '</label>' +
                                '</div>');
                        } else {
                            collectorParametersParentElm.append(
                                '<div class="input-field col s12 m6 l4">' +
                                '<input type="text" id="collectorParameter_' + parameterName + '" value="'+value+'"/>' +
                                '<label for="collectorParameter_' + parameterName + '"' + labelClass + '>' +
                                parameter.description +
                                '</label>' +
                                '</div>');
                        }
                    }
                    // add class 'active' to label elements, which input elements has value
                    $('input[type=text]').filter(function(){return this.value}).next('label').addClass('active');
                    M.textareaAutoResize($('textarea'));
                });
            }

        });
    }

    function initCountersGroups(activeGroupID) {
        $('#groupsEditBtn').click(function () {
            $('input[name=groupsAction]').prop('checked', false);
            $('#newGroupName').val('');
            // onclick event work only once, when it set at init time
            $('#applyGroupsChanges').unbind('click').click(applyChangesOnCounterGroups);
        });

        setCountersGroupsSelector($('#groupID'), activeGroupID);
    }

    // mode: 1 for default group
    function setCountersGroupsSelector(groupSelectorElm, activeGroupID, mode, callback) {
        //console.log('activeGroup: ', activeGroupID, 'mode: ', mode, 'groupSelectorElm: ', groupSelectorElm.attr('id'));
        $.post(serverURL, {func: 'getCountersGroups'}, function (groups) {
            if (!groups || !groups.length) return;

            if (mode === undefined) mode = 1;
            if(mode === 0) var selectHTML = '<option value="0" selected>All groups</option>';
            else selectHTML = '';

            groups.forEach(function (group) {
                if (mode && ((!activeGroupID && group.isDefault) || group.id === Number(activeGroupID))) var selected = ' selected';
                else selected = '';

                if (group.isDefault === 1) $('#defaultGroup').val(group.id);
                selectHTML += '<option value="' + group.id + '"' + selected + '>' + group.name + '</option>';
            });
            groupSelectorElm.html(selectHTML);
            M.FormSelect.init(groupSelectorElm[0], {});
            if (typeof(callback) === 'function') callback();
        });
    }

    function applyChangesOnCounterGroups() {
        var action = $('input[name=groupsAction]:checked').attr('id');

        var newGroup = $('#newGroupName').val();
        var groupSelectorElm = $('#groupID');
        var filterGroupIDElm = $('#filterGroupID');
        var groupID = groupSelectorElm.val();
        if (action === 'groupsActionNewGroup') {
            if (!newGroup) {
                M.toast({html: 'You did not enter a new counter group name for a creating a new group', displayLength: 20000});
            } else {
                $.post(serverURL, {func: 'addCounterGroup', group: newGroup});
            }
        } else if (action === 'groupsActionEditGroup') {
            if (!newGroup) {
                M.toast({html: 'You did not enter a new counter group name for editing group', displayLength: 500});
            } else {
                $.post(serverURL, {func: 'editCounterGroup', oldGroup: groupID, group: newGroup});
            }
        } else if (action === 'groupsActionSetDefault') {
            $.post(serverURL, {func: 'setDefaultCounterGroup', group: groupID, groupProp: 1});
        } else if (action === 'groupsRemoveGroup') {
            $.post(serverURL, {func: 'removeCounterGroup', group: groupID});
            groupID = null;
        }

        // waiting for changes
        setTimeout(function () {
            setCountersGroupsSelector(groupSelectorElm, groupID);
            setCountersGroupsSelector(filterGroupIDElm, groupID, $('#objectsIDs').val().length ? 0 : 1);
        }, 1000);
    }

    function initCountersUnits(activeUnitID, sourceMultiplierValue) {
        $('#unitsEditBtn').click(initUnitsEditor);

        $('#unitID').change(function () {
            setSourceMultiplier()
        });
        setCountersUnitsSelector(activeUnitID, function () {
            setSourceMultiplier(sourceMultiplierValue)
        });
    }

    function setSourceMultiplier(sourceMultiplierValue) {
        var unitID = $('#unitID').val();
        var unitSourceMultipliesElm = $('#sourceMultiplier');

        if (!unitsParams[unitID]) {
            return noneUnitSourceMultiplies('None');
        }

        var multiplies = unitsParams[unitID].multiplies;
        var prefixes = unitsParams[unitID].prefixes;
        var abbreviation = unitsParams[unitID].abbreviation;

        if (!multiplies.length) return noneUnitSourceMultiplies(abbreviation);

        if (!sourceMultiplierValue) var selected = ' selected';
        else selected = '';
        unitSourceMultipliesElm.prop('disabled', false).html('<option value="1"' + selected + '>' + abbreviation + ' (base)</option>');

        for (var i = 0; i < multiplies.length; i++) {
            if (unitsParams[unitID].onlyPrefixes) var unit = prefixes[i];
            else unit = prefixes[i] + abbreviation;
            if (Number(sourceMultiplierValue) === Number(multiplies[i])) selected = ' selected';
            else selected = '';
            unitSourceMultipliesElm
                .append('<option value="' + multiplies[i] + '"' + selected + '>' + unit + ' (' + multiplies[i] + abbreviation + ')</option>');
        }
        M.FormSelect.init(unitSourceMultipliesElm[0], {});
    }

    function noneUnitSourceMultiplies(abbreviation) {
        var unitSourceMultipliesElm = $('#sourceMultiplier');
        unitSourceMultipliesElm.prop('disabled', true).html('<option value="">' + abbreviation + '</option>');
        M.FormSelect.init(unitSourceMultipliesElm[0], {});
    }

    function setCountersUnitsSelector(activeUnitID, callback) {
        callback = (typeof callback === 'function') ? callback : function () {
        };

        var unitsSelectElm = $('#unitID');
        $.post(serverURL, {func: 'getCountersUnits'}, function (units) {
            if (!units || !units.length) return callback();

            unitsSelectElm.html('<option value="">None</option>');
            unitsParams = {};
            for (var i = 0; i < units.length; i++) {
                var unit = units[i];
                var multipliers = [];
                var prefixes = [];
                if (unit.multiplies && unit.prefixes) {
                    multipliers = unit.multiplies.replace(/\s*[,;]\s*/g, ',').split(',');
                    prefixes = unit.prefixes.replace(/\s*[,;]\s*/g, ',').split(',');
                    if (multipliers.length !== prefixes.length) {
                        M.toast({html: 'Count of multiplies(' + multiplies.length + ') are not equal to count of prefixes(' + prefixes.length + ') for unit ' + unit, displayLength: 5000});
                        continue;
                    }
                }
                unitsParams[unit.id] = {
                    abbreviation: unit.abbreviation,
                    multiplies: multipliers,
                    prefixes: prefixes,
                    onlyPrefixes: unit.onlyPrefixes
                };

                if (unit.id === activeUnitID) var selected = ' selected';
                else selected = '';
                unitsSelectElm.append('<option value="' + unit.id + '"' + selected + '>' + unit.name + '</option>');
            }
            noneUnitSourceMultiplies('None');
            M.FormSelect.init(unitsSelectElm[0], {});
            callback();
        });
    }

    function initUnitsEditor() {
        var unitID = $('#unitID').val();
        if (unitsParams[unitID]) {
            if (unitsParams[unitID].onlyPrefixes) var onlyPrefixes = true;
            else onlyPrefixes = false;

            $('#newUnitName').val('');
            $('#newUnitAbbreviation').val(unitsParams[unitID].abbreviation);
            $('#newUnitOnlyPrefixes').prop('checked', onlyPrefixes);
            $('#newUnitPrefixes').val(unitsParams[unitID].prefixes);
            $('#newUnitMultipliers').val(unitsParams[unitID].multiplies);

            $('#newUnitAbbreviationLabel').addClass('active');
            $('#newUnitPrefixesLabel').addClass('active');
            $('#newUnitMultipliersLabel').addClass('active');
        } else {
            $('#newUnitName').val('');
            $('#newUnitAbbreviation').val('');
            $('#newUnitOnlyPrefixes').prop('checked', false);
            $('#newUnitPrefixes').val('n, μ, m, K, M, G, T');
            $('#newUnitMultipliers').val('0.0000000001, 0.000001, 0.001, 1000, 1000000, 1000000000, 1000000000');

            $('#newUnitNameLabel').removeClass('active');
            $('#newUnitAbbreviationLabel').removeClass('active');
        }

        $('input[name=unitsAction]').prop('checked', false);

        // onclick event work only once, when it set at init time
        $('#applyUnitsChanges').unbind('click').click(applyChangesOnCounterUnits);
    }

    function applyChangesOnCounterUnits() {
        var action = $('input[name=unitsAction]:checked').attr('id');

        var newUnit = $('#newUnitName').val();
        var unitID = $('#unitID').val();
        var abbreviation = $('#newUnitAbbreviation').val();
        var prefixes = $('#newUnitPrefixes').val();
        var multiplies = $('#newUnitMultipliers').val();
        var onlyPrefixes = $('#newUnitOnlyPrefixes').is(':checked') ? 1 : 0;
        if (action === 'unitsActionNewUnit') {
            if (!newUnit) {
                M.toast({html: 'Please enter a new counter unit name for adding a new unit', displayLength: 20000});
            } else {
                $.post(serverURL, {
                    func: 'addCounterUnit',
                    unit: newUnit,
                    abbreviation: abbreviation,
                    prefixes: prefixes,
                    multiplies: multiplies,
                    onlyPrefixes: onlyPrefixes
                });
            }
        } else if (action === 'unitsActionEditUnit') {
            if (!newUnit) {
                M.toast({html: 'Please enter a new counter unit name for editing selected unit', displayLength: 20000});
            } else if (!unitID) {
                M.toast({html: 'Please select counter unit for editing', displayLength: 20000});
            } else {
                $.post(serverURL, {
                    func: 'editCounterUnit',
                    oldUnitID: unitID,
                    unit: newUnit,
                    abbreviation: abbreviation,
                    prefixes: prefixes,
                    multiplies: multiplies,
                    onlyPrefixes: onlyPrefixes
                });
            }
        } else if (action === 'unitsRemoveUnit') {
            if (!unitID) {
                M.toast({html: 'Please select counter unit for remove', displayLength: 20000});
            } else {
                $.post(serverURL, {func: 'removeCounterUnit', unit: unitID});
            }
        }
        setCountersUnitsSelector();
    }

    function initVariablesDefinitionsTab() {
        $('#addVariable').click(addVariable);
        $('#addVariableExpression').click(addVariableExpression);
        $.post(serverURL, {func: 'getHistoryFunctions'}, function (_historyFunctionsList) {
            if (!_historyFunctionsList || !$.isArray(_historyFunctionsList) || !_historyFunctionsList.length) historyFunctionsHTML = '';
            else {
                historyFunctionsHTML = _historyFunctionsList.map(function (func) {
                    historyFunctionsDescription[func.name] = func.description;

                    if (func.name === 'last') var selected = 'selected';
                    else selected = '';
                    return '<option value="' + func.name + '" ' + selected + '>' + func.name + '</option>';
                }).sort().join('');
            }
        });
        $('a[href="#variablesDefinitionsTab"]').click(function () {
            setTimeout(function() {
                $('[data-textarea-variable]').each(function() {
                    M.textareaAutoResize($(this));
                });
            }, 1000);
        });

    }

    function setVariablesDefinitionsTab(counterID, callback) {
        $('#variables').empty();

        /*
            object: {
                variables: [{}, ...]
                variablesExpressions: [{}, ...]
            }
        */
        $.post(serverURL, {func: 'getVariables', id: counterID}, function (object) {
            if (object) {
                var variables = object.variables;
                var variablesExpressions = object.variablesExpression;

                if (variables && $.isArray(variables)) {
                    variables.forEach(function (variable) {
                        addVariable(
                            variable.name,
                            {id: variable.objectID, name: variable.objectName},
                            variable.parentCounterName,
                            variable.function,
                            variable.functionParameters,
                            variable.objectVariable);
                    });
                }

                if (variablesExpressions && $.isArray(variablesExpressions)) {
                    variablesExpressions.forEach(function (variable) {
                        addVariableExpression(variable.name, variable.expression);
                    })
                }
            }

            if (typeof callback === 'function') callback();
        });
    }

    function addVariableExpression(variableName, expression) {
        var variableID = 'variable_' + variableNumber;

        variableName = variableName === undefined || typeof variableName !== 'string' ? '' : variableName;
        expression = expression === undefined || typeof expression !== 'string' ? '' : expression;

        var variableHTML = '\
<div class="col s12" id="' + variableID + '">\
  <div class="card-panel row">\
    <a href="#!" id="' + variableID + '_delete" class="secondary-content">\
      <i class="material-icons">close</i>\
    </a>\
    <a href="#!" class="secondary-content" data-functionsHelpVariables="' + variableID + '">\
        <i class="material-icons">help_outline</i>\
    </a>\
    <div class="input-field col s12 m6 l4 tooltipped" data-tooltip="You can use this variable name in collector parameters">\
      <input type="text" id="' + variableID + '_name" value="' + variableName + '"/>\
      <label for="' + variableID + '_name">Variable name</label>\
    </div>\
    <div class="input-field col s12 tooltipped" data-tooltip="Variable expression">\
      <textarea id="' + variableID + '_expression" class="materialize-textarea" data-textarea-variable>' + expression + '</textarea>\
      <label for="' + variableID + '_expression">Expression</label>\
    </div>\
  </div>\
</div>\
';
        $('#variables').append(variableHTML);

        M.updateTextFields();

        $('#' + variableID + '_delete').click(function () {
            $('#' + variableID).remove();
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
        });

        $('a[data-functionsHelpVariables="' + variableID + '"]').unbind('click').click(showFunctionDescription);

        variableNumber++;
        return variableID;
    }

    function addVariable(variableName, obj, parentCounterName, functionName, functionParameters, objectVariable) {
        var variableID = 'variable_' + variableNumber;

        functionParameters = functionParameters ? functionParameters : '';

        var variableHTML = '\
<div class="col s12" id="' + variableID + '">\
  <div class="card-panel row">\
  <a href="#!" id="' + variableID + '_delete" class="secondary-content">\
      <i class="material-icons">close</i>\
    </a>\
    <a href="#!" id="' + variableID + '_description" class="secondary-content">\
      <i class="material-icons">help_outline</i>\
    </a>\
    <input type="hidden" variableObjectID id="' + variableID + '_objectID" variableID="' + variableID + '"/>\
    <input type="hidden" id="' + variableID + '_objectName"/>\
    <div>For "THIS OBJECT" make sure that all linked objects contain the selected counter. Otherwise, the variable will not calculate for all objects. Also if you change counter name, please change counter for variable manually</div>\
    <div class="input-field col s11 m11 l2">\
      <input type="text" id="' + variableID + '_objectVariable" placeholder="THIS OBJECT" disabled class="tooltipped" data-tooltip="Get data from this object or from selected object or object name, created from variable value"\>\
      <label for="' + variableID + '_objectVariable" class="active">Object</label>\
    </div>\
    <div class="input-field col s1 m1 l1">\
      <a class="btn-floating tooltipped" id="' + variableID + '_changeObjectType" data-tooltip="Press to change object source" data-position="right">\
        <i class="material-icons">swap_horiz</i>\
      </a>\
    </div>\
    <div class="input-field col s11 m11 l4">\
      <select countersForHistoryVariables id="' + variableID + '_parentCounterName">\
        <option value="" disabled>Counters are not exists</option>\
      </select>\
      <label>Counter</label>\
    </div>\
    <div class="input-field col s1 m1 l1">\
      <a id="' + variableID + '_reload" class="btn-floating tooltipped" data-tooltip="Refresh counter list">\
        <i class="material-icons">refresh</i>\
      </a>\
    </div>\
    <div class="input-field col s12 m12 l4 tooltipped" data-tooltip="You can use this variable name in collector parameters">\
      <input type="text" id="' + variableID + '_name"/>\
      <label for="' + variableID + '_name">Variable name</label>\
    </div>\
    <div class="input-field col s12 m12 l4">\
      <select id="' + variableID + '_function">' + historyFunctionsHTML + '</select>\
      <label>Function</label>\
    </div>\
    <div class="input-field col s12 m12 l8 tooltipped" data-tooltip="Set comma separated parameters for a function">\
      <input type="text" id="' + variableID + '_function_parameters" value="' + escapeHtml(functionParameters) + '"/>\
      <label for="' + variableID + '_function_parameters">Function parameters</label>\
    </div>\
  </div>\
</div>';
        $('#variables').append(variableHTML);
        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});

        initAddObjectForVariableButton(variableID, obj, parentCounterName, variableName, objectVariable);

        if (functionName !== undefined) $('#' + variableID + '_function').val(functionName);

        $('#' + variableID + '_delete').click(function () {
            $('#' + variableID).remove();
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
        });

        $('#' + variableID + '_description').click(function () {
            var funcName = $('#' + variableID + '_function').val();
            var description = 'Function ' + escapeHtml(funcName) + '(): ' + escapeHtml(historyFunctionsDescription[funcName]).replace(/\n/g, '<br>') +
                '<button class="btn-flat toast-action" onclick="M.Toast.dismissAll();">X</button>';
            M.Toast.dismissAll();
            M.toast({html: description, displayLength: 50000});
        });

        (function (variableID) {
            $('#' + variableID + '_reload').click(function () {
                reloadCounterListForVariable(variableID)
            });
        })(variableID);

        // set variable name field when change counter
        var selectElm = $('#' + variableID + '_parentCounterName');
        selectElm.change(function () {
            $('#' + variableID + '_name').val(createVariableName(variableID));
            // add class 'active' to label elements, which input elements has value
            $('input[type=text]').filter(function () {
                return this.value
            }).next('label').addClass('active');
        });
        // don\'t understand why, but it does not work without setTimeout
        setTimeout(function() {markNotSharedCounters(selectElm); }, 500);
        M.FormSelect.init(document.querySelectorAll('select'), {});
        variableNumber++;
        return variableID;
    }

    function createVariableName(variableID) {
        var counterName = $('#' + variableID + '_parentCounterName option:selected').text();
        var objectName = $('#' + variableID + '_objectName').val();
        if (objectName) objectName += '_';
        else objectName = '';
        return String(objectName + counterName).toUpperCase().replace(/\s/g, '_').replace(notSharedSuffix, '');
    }


    function reloadCounterListForAllVariables() {

        var selectElements = $('select[objectID="0"]');

        if (selectElements.get().length) {

            getCountersForUpdateEventsObject([0], function (counters) {

                if (counters && counters.length) var countersHTML = createOptionsForSelectElmWithCounters(counters);
                else countersHTML = {0: '<option>No shared counters</option>'};

                selectElements.each(function (index, elm) {
                    var savedValue = $(elm).val();
                    $(elm).html(countersHTML[0]);
                    $(elm).val(savedValue);

                    if ($(elm).val() !== savedValue)
                        $(elm).html(countersHTML[0]);
                    //M.toast({html: 'Counter for update event was changed, because objects, linked to a counter, don\'t have previous selected shared counter. Please check update events settings', displayLength: 20000});
                });

                M.FormSelect.init(document.querySelectorAll('select[objectID="0"]'), {});
                getSharedCountersNamesAndMarkNotSharedCounters();
            });
        }

        var variablesIDs = $('input[variableObjectID]:not([value])').map(function (i, elm) {
            return $(elm).attr('variableID');
        }).get();

        for (var i = 0; i < variablesIDs.length; i++) {
            var variableID = variablesIDs[i];
            var parentCounterName = $('#' + variableID + '_parentCounterName').val();
            if (parentCounterName) var variableName = $('#' + variableID + '_name').val();
            reloadCounterListForVariable(variableID, parentCounterName, variableName);
        }

        // remove class 'active' from label elements, which input elements has not value
        // add class 'active' to label elements, which input elements has value
        $('input[type=text]').each(function() {
            if(this.value) $(this).next('label').addClass('active');
            else $(this).next('label').removeClass('active')
        });
        /*
        // remove class 'active' from label elements, which input elements has not value
        $('input[type=text]').filter(function () {
            return !this.value
        }).next('label').removeClass('active');
        // add class 'active' to label elements, which input elements has value
        $('input[type=text]').filter(function () {
            return this.value
        }).next('label').addClass('active');
        */
    }

    function getSharedCountersNamesAndMarkNotSharedCounters() {

        try {
            var objectsIDs = JSON.parse($('#linkedObjectsIDs').val()).map(function (object) {
                return object.id;
            });
        } catch (e) {
            sharedCountersNames = [];
            markNotSharedCounters($('select[objectID="0"]'));
            markNotSharedCounters($('select[countersForHistoryVariables]'));
            return;
        }

        $.post(serverURL, {
                func: 'getCountersForObjects',
                ids: objectsIDs.join(',')
            }, function (allCounters) {
                var sharedCounters = getSharedCounters(objectsIDs.length, allCounters);

                if(!sharedCounters || !sharedCounters.length) sharedCountersNames = [];

                sharedCountersNames = sharedCounters.map(function (counter) {
                    return counter.name;
                });

                markNotSharedCounters($('select[objectID="0"]'));
                markNotSharedCounters($('select[countersForHistoryVariables]'));
            }
        );
    }

    function markNotSharedCounters(selectElm) {
        if(!sharedCountersNames) return;
        selectElm.find('option:not(:disabled)').each(function () {
            var counterNameFromSelectElm = $(this).text();

            if(sharedCountersNames.indexOf(counterNameFromSelectElm) === -1 &&
                counterNameFromSelectElm.indexOf(notSharedSuffix) === -1) {
                $(this).text(counterNameFromSelectElm + notSharedSuffix);
            }
        });

        M.FormSelect.init(selectElm[0], {});
    }

    function reloadCounterListForVariable(variableID, parentCounterName, variableName) {
        // get object ID from object, linked to a variable
        var objectsIDs = $('#' + variableID + '_objectID').val();

        // if selected 'This object', then get objects IDs from all objects, linked to a counter
        // but it's can be some times very long query
        // use selected obejcts in objects list instead
        //if (!objectsIDs) objectsIDs = JSON.parse($('#linkedObjectsIDs').val()).map(function (object) {
        //             return object.id;
        //         });
        if (!objectsIDs) {
            var thisObjects = true;
            objectsIDs = $('#objectsIDs').val();
        }
        else objectsIDs = [objectsIDs];

        $.post(serverURL, {
            func: 'getCountersForObjects',
            ids: objectsIDs.join(',')
        }, function (allCounters) {
            var counters = getSharedCounters(objectsIDs.length, allCounters);

            var selectElm = $('#' + variableID + '_parentCounterName');
            selectElm.empty();

            if (!counters) {
                selectElm.append('<option value="" disabled>Counters are not exists</option>');

                M.FormSelect.init(selectElm[0], {});
                return M.toast({html: obj.message, displayLength: 5000});
            }

            if (!parentCounterName) var selected = ' selected';
            else selected = '';
            selectElm.append('<option value="" disabled' + selected + '>Select counter from list</option>');

            var isFoundParentCounterName = false;
            for (var i = 0; counters && i < counters.length; i++) {
                var counter = counters[i];
                if (parentCounterName === counter.name.toUpperCase()) {
                    isFoundParentCounterName = true;
                    selected = ' selected';
                }
                else selected = '';
                selectElm.append('<option value="' + counter.name + '"' + selected + '>' + counter.name + '</option>');
            }

            if (parentCounterName && variableName) {
                if(!isFoundParentCounterName) {
                    selectElm.append('<option value="' + parentCounterName + '" selected>' + parentCounterName + '</option>');
                    //M.toast({html: 'Selected object do not have a linked counter ' + parentCounterName + ' for calculate variable ' + variableName, displayLength: 20000});
                }
                $('#' + variableID + '_name').val(variableName);
                // add class 'active' to label elements, which input elements has value
                $('input[type=text]').filter(function () {
                    return this.value
                }).next('label').addClass('active');
            } else $('#' + variableID + '_name').val('');

            // don\'t understand why, but it does not work without setTimeout
            if(thisObjects) setTimeout(function() {markNotSharedCounters(selectElm); }, 500);
            M.FormSelect.init(selectElm[0], {});
        });
    }

    function initAddObjectForVariableButton(variableID, obj, parentCounterName, variableName, objectVariable) {
        var changeObjectButtonElm = $('#' + variableID + '_changeObjectType');
        var objectIDElm = $('#' + variableID + '_objectID');
        var objectNameElm = $('#' + variableID + '_objectName');
        var objectTypeElm = $('#' + variableID + '_objectVariable');
        if(objectVariable) {
            var variable = objectVariable;
            objectIDElm.val(obj.id);
            objectNameElm.val(obj.name);
            reloadCounterListForVariable(variableID);
            objectTypeElm.attr('placeholder', 'Variable name');
            objectIDElm.removeAttr('value');
            objectNameElm.removeAttr('value');
            objectTypeElm.prop('disabled', false).val(variable).focus();
            M.updateTextFields();
        } else {
            variable = '';
            addObject(obj);
        }

        reloadCounterListForVariable(variableID, parentCounterName, variableName);

        changeObjectButtonElm.click(function () {
            if (!objectIDElm.val() && objectTypeElm.is(':disabled')) {
                if (objects && objects.length === 1) addObject(objects[0]);
                else M.toast({html: 'Please select object for create variable', displayLength: 20000});
            } else if(objectIDElm.val()) {
                objectTypeElm.attr('placeholder', 'Variable name');
                objectIDElm.removeAttr('value');
                objectNameElm.removeAttr('value');
                objectTypeElm.prop('disabled', false).val(variable).focus();
            } else if(!objectTypeElm.is(':disabled')) {
                objectTypeElm.attr('placeholder', 'THIS OBJECT');
                variable = objectTypeElm.val();
                objectTypeElm.prop('disabled', true).val('');
                reloadCounterListForVariable(variableID);
            }
        });

        objectTypeElm.keyup(function (e) {
            if (!objectTypeElm.is(':disabled') && e.which === 27) objectTypeElm.val('');
        });

        function addObject(obj) {
            if (!obj || !obj.id || !obj.name) return;

            variable = objectTypeElm.val();
            objectTypeElm.prop('disabled', true).val(obj.name);
            objectIDElm.val(obj.id);
            objectNameElm.val(obj.name);
            M.updateTextFields();
            reloadCounterListForVariable(variableID);
        }
    }

    function onSaveCounterWithNewName(callback) {

        var counterIDSelectorElm = $('#counterIDSelector');
        if(!counterIDSelectorElm.val()) return callback(); //creating a new counter

        // get text from selected option
        var oldCounterName = counterIDSelectorElm.find('option[value=' + counterIDSelectorElm.val() + ']').text().replace(/ \(#\d+\)$/, '');
        var newCounterName = $('#name').val();
        if(!oldCounterName || !newCounterName || oldCounterName.toUpperCase() === newCounterName.toUpperCase()) return callback();

        $.post(serverURL, {
            func: 'getVariablesForParentCounterName',
            counterName: oldCounterName,
        }, function (variablesForOldName) {
            if (!variablesForOldName) return callback(new Error('Some error is occurred while getting variables list for old parent counter name ' + oldCounterName));

            $.post(serverURL, {
                func: 'getVariablesForParentCounterName',
                counterName: newCounterName,
            }, function (variablesForNewName) {
                if (!variablesForNewName) return callback(new Error('Some error is occurred while getting variables list for new parent counter name ' + newCounterName));

                if (!variablesForOldName.length && !variablesForNewName.length) return callback();

                $('#modalCounterNameChangedConfirmOldVariablesList').html(createVariablesList(variablesForOldName));
                $('#modalCounterNameChangedConfirmNewVariablesList').html(createVariablesList(variablesForNewName));

                var modalCounterNameChangedConfirmInstance = M.Modal.init(document.getElementById('modalCounterNameChangedConfirm'), {dismissible: false});
                modalCounterNameChangedConfirmInstance.open();

                $('#modalCounterNameChangedConfirmYes').click(function () {
                    if(Array.isArray(variablesForOldName) && variablesForOldName.length) $('#updateVariablesRef').val(oldCounterName);
                    callback();
                });

                $('#modalCounterNameChangedConfirmNo').click(function () {
                    callback();
                });
                $('#modalCounterNameChangedConfirmCancel').click(function () {
                    callback(new Error('Counter saving operation is canceled from counter name changed dialog'));
                });
            })
        });

        function createVariablesList(variables) {
            if(!Array.isArray(variables) ||  !variables.length) return 'No variables';
            // return: [{name, objectID, objectName, parentCounterName, function, functionParameters, counterID},...]
            return variables.map(function (variable) {
                return '<li>%:' + escapeHtml(variable.name + ':% [ ' +
                    (variable.objectName ? variable.objectName + ':' : '') +  variable.parentCounterName + ':' +
                    variable.function + '(' + variable.functionParameters + ') ]') + '</li>';
            }).join('');
        }
    }

})(jQuery); // end of jQuery name space
