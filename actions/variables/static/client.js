/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 28.07.2015.
 */

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}


var JQueryNamespace = (function ($) {
    $(function () {
        objects = parameters.objects;
        counterSelectorElm = $('#objectCounterID');
        initObjectsSelector(objects);
        $('#reload').click(showVariablesLog);
        M.FormSelect.init(document.querySelectorAll('select'), {});
    });


    var serverURL = parameters.action.link+'/ajax';
    // do not set 0!!! in childServer.js we check 'if(variableNumber){...}' for undefined, NaN, '', null etc.
    var objects, counterSelectorElm;

    return {
        onChangeObjects: onChangeObjects
    };

    function initObjectsSelector(objects) {
        var objectsSelectorElm = $('#objectsIDs'),
            filterGroupIDElm = $('#filterGroupID');

        // !!! objectsSelector callback will be called only when object selector is changed. It's not called when object selector is init
        objectsSelectorElm.objectsSelector(objects, function() {
            setCountersGroupsSelector(filterGroupIDElm, null, objectsSelectorElm.val().length ? 0 : 1, function() {
                initCountersSelector(showVariablesLog);
            });
        });

        setCountersGroupsSelector(filterGroupIDElm, filterGroupIDElm.val(), objects.length ? 0 : 1, function(){
            initCountersSelector(showVariablesLog);
        });

        filterGroupIDElm.unbind('change').change(function() {
            initCountersSelector(showVariablesLog);
        });
    }

    function onChangeObjects(_objects) {
        objects = _objects;
        initObjectsSelector(objects);
    }

    function initCountersSelector(callback) {
        var objectsIDs = $('#objectsIDs').val();

        $('#updateVariablesRef').val('');

        // get counters for selected objects from objects list
        $.post(serverURL, {
            func: 'getCountersForObjects',
            ids: objectsIDs.join(','),
            groupID: $('#filterGroupID').val()
        }, function (counters) {

            var selectHTML = '';
            if(counters && counters.length) {
                selectHTML += counters.sort(function(a,b) {
                    if(a.objectName + a.name < b.objectName + b.name) return -1;
                    return 1;
                }).map(function (counter) {
                    if(objects.length === 1) var name = counter.name;
                    else name = counter.objectName + ': ' + counter.name;
                    return '<option value="' + counter.OCID + '">' + escapeHtml(name) + '</option>';
                }).join('');
            }

            counterSelectorElm.empty().append(selectHTML);

            // function initCountersSelector called any times, when you change object selection
            // from the left object menu. We mast unbind previous onchange events before bind new
            counterSelectorElm.unbind('change');
            counterSelectorElm.change(showVariablesLog);

            M.FormSelect.init(counterSelectorElm[0], {});

            if(typeof callback === 'function') return callback();
        });
    }


    // mode: 0 - do not clean group selector element, 1 for default group
    function setCountersGroupsSelector(groupSelectorElm, activeGroupID, mode, callback) {
        //console.log('activeGroup: ', activeGroupID, 'mode: ', mode, 'groupSelectorElm: ', groupSelectorElm.attr('id'));
        $.post(serverURL, {func: 'getCountersGroups'}, function (groups) {
            if (mode === undefined) mode = 1;
            if (!groups || !groups.length) return;

            if(mode === 0) {
                groupSelectorElm.empty();
                var selectHTML = '<option value="0" selected>All groups</option>';
            }
            else selectHTML = '';

            groups.forEach(function (group) {
                if ((!activeGroupID && mode && group.isDefault === mode) || group.id === Number(activeGroupID)) var selected = ' selected';
                else selected = '';

                if (group.isDefault === 1) $('#defaultGroup').val(group.id);
                selectHTML += '<option value="' + group.id + '"' + selected + '>' + group.name + '</option>';
            });
            groupSelectorElm.append(selectHTML);
            M.FormSelect.init(groupSelectorElm[0], {});
            if (typeof(callback) === 'function') callback();
        });
    }

    function showVariablesLog() {
        $('#loadDataInfo').text('Starting update at ' + new Date().toLocaleString() + '...');
        $.post(serverURL, {func: 'getVariablesInfo', OCID: counterSelectorElm.val()}, function (variablesInfo) {
            //console.log(variablesInfo);

            $('#loadDataInfo').text('Loading ' + (variablesInfo ? variablesInfo.length : 0) +' debug data updates at ' + new Date().toLocaleString());
            var variablesLogElm = $('#variablesLog');
            if(!variablesInfo || !variablesInfo.length) {
                variablesLogElm.empty().append('<li><div class="collapsible-header">' +
                    'No variables information for selected object and counter. ' +
                    'Please switch on "debug" option in counter settings for specific counter before</div></li>');
                M.Collapsible.init(variablesLogElm[0], {});
                return;
            }

            var obj = variablesInfo.map(function (variables) {
                var dateTimeStr = '', timestamp;

                var body = Object.keys(variables).map(function (name) {
                    timestamp = variables[name].timestamp;
                    dateTimeStr = new Date(timestamp).toLocaleString();

                    if(!variables[name].variables) var variablesHTML = 'none';
                    else {
                        if(!variables[name].unresolvedVariables || !variables[name].unresolvedVariables.length) {
                            var unresolvedVariables = 'none';
                        } else {
                            unresolvedVariables = variables[name].unresolvedVariables.sort().join('; ');
                        }
                        variablesHTML = '<ul class="collapsible z-depth-0" data-collapsible="accordion"><li>' +
                            '<div class="collapsible-header">' + Object.keys(variables[name].variables).length +
                            '&nbsp;variables; Unresolved variables: ' + unresolvedVariables+ '</div>' +
                            '<div class="collapsible-body">' +
                            Object.keys(variables[name].variables).sort().map(function (_name) {
                                var value = variables[name].variables[_name] === '' ? '""' : variables[name].variables[_name];
                                return escapeHtml(_name + ' = ' + value);
                            }).join('<br/>') +
                            '</div></li>';
                    }
                    var functions = variables[name].functionDebug && variables[name].functionDebug.length ? (variables[name].functionDebug.map(function (f) {
                        if(f.name) {
                            return escapeHtml(f.name + '(' + (
                                f.parameters.map(function (p) {
                                    return typeof p + ': ' + (typeof p === 'object' ? JSON.stringify(p) : p);
                                }).join(', ')
                            ) + '); result: ' + f.result);
                        } else if(f.timestamp) {
                            return (new Date(f.timestamp)).toLocaleString().replace(/\.\d\d\d\d,/, '') + ': ' + escapeHtml(f.data);
                        } else if(typeof f === 'string' || typeof f === 'number' || typeof f === 'boolean') {
                            return f;
                        } else if(typeof f === 'object') {
                            return JSON.stringify(f);
                        }

                    }).join('<br/>')) : 'none';

                    if(variables[name].important) var color = ' style="background-color:#f0ffff"';
                    else color = '';
                    return '<tr' + color+ '><td>' + new Date(variables[name].timestamp).toLocaleString() + '.' + (variables[name].timestamp % 1000) + '</td><td>' +
                        escapeHtml(variables[name].name)+ '</td><td>' +
                        escapeHtml(variables[name].expression) + '</td><td>' +
                        escapeHtml( typeof variables[name].result === 'object' ? JSON.stringify(variables[name].result) : variables[name].result) + '</td><td>' +
                        variablesHTML+ '</td><td>' +
                        functions + '</td></tr>'
                }).join('');

                return {
                    timestamp: timestamp,
                    HTML: dateTimeStr ? ('<li><div class="collapsible-header">' + dateTimeStr + ': Calculate variables: ' +
                        escapeHtml(Object.keys(variables).join('; ')) +
                        '</div><div class="collapsible-body"><table class="bordered highlight responsive-table" style="word-break: break-word;">' +
                        '<thead>' +
                        '<tr>' +
                        '<th style="width:10%">Time</th>' +
                        '<th style="width:10%">Name</th>' +
                        '<th style="width:20%">Expression</th>' +
                        '<th style="width:10%">Result</th>' +
                        '<th style="width:30%">Variables</th>' +
                        '<th style="width:20%">Functions</th>' +
                        '</tr>' +
                        '</thead><tbody>' + body + '</tbody></table></div></li>') : ''
                }
            });

            var HTML = obj.sort(function (a, b) {
                return b.timestamp - a.timestamp;
            }).map(function (elm) {
                return elm.HTML;
            });

            variablesLogElm.empty().append(HTML.join(''));
            M.Collapsible.init(document.querySelectorAll('.collapsible'), {});
        });
    }

})(jQuery); // end of jQuery name space
