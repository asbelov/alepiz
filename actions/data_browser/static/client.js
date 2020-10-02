/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 12.02.2017.
 */

var JQueryNamespace = (function ($) {
    $(function () {

        bodyElm = $('body');
        selectGroupsElm = $('#select-groups');
        selectCountersElm = $('#select-counters');
        latestDataElm = $('#latest-data');
        historyDataElm = $('#history-data');
        graphAreaElm = $('#graphArea');
        graphAreaDomElm = document.getElementById('graphArea'); // for drawing graph by Flotr2 library
        dateFromElm = $('#startDate');
        dateToElm = $('#endDate');
        autoUpdateElm = $('#auto-update');
        messageElm = $('#message-area');
        fullScreenGraphBtnElm = $('#fullScreenGraphBtn');
        fullScreenCountersBtnElm = $('#fullScreenCountersBtn');
        leftDivElm = $('#leftDiv');
        rightDivElm = $('#rightDiv');
        alignSettingsElm = $('#alignSettings');
        closeGraphSettingsElm = $('#closeGraphSettings');

        M.FormSelect.init(document.querySelectorAll('select'), {});

        init(parameters.objects, function(){
            var datePickerFromInstance = M.Datepicker.init(dateFromElm[0], {
                firstDay: 1,
                format: 'dd mmmm, yyyy',
                setDefaultDate: true
            });

            var datePickerToInstance = M.Datepicker.init(dateToElm[0], {
                firstDay: 1,
                format: 'dd mmmm, yyyy',
                setDefaultDate: true
            });

            initGraphEvents();

            dateFromElm.change(function() {
                var timeInterval = dateTo - dateFrom;
                // midnight of dateFromElm + time after midnight from previous dateFrom
                dateFrom = getTimestampFromStr(dateFromElm.val()) + (new Date(dateFrom) - new Date(dateFrom).setHours(0,0,0,0));

                if(!dateFrom || dateFrom > Date.now()) dateFrom = Date.now() - timeInterval;
                if(dateTo < dateFrom) dateTo = dateFrom + timeInterval;
                if(dateTo > Date.now()) dateTo = Date.now();
                dateToElm.val(getDateString(new Date(dateTo)));
                datePickerToInstance.setDate(new Date(dateTo));
                autoUpdateElm.prop('checked', false);
                getCountersValues();
            });

            dateToElm.change(function() {
                var timeInterval = dateTo - dateFrom;
                // midnight of dateToElm + time after midnight from previous dateTo
                dateTo = getTimestampFromStr(dateToElm.val()) + (new Date(dateTo) - new Date(dateTo).setHours(0,0,0,0));

                if(!dateTo || dateTo > Date.now()) dateTo = Date.now();
                if(dateFrom > dateTo) dateFrom = dateTo - timeInterval;
                dateFromElm.val(getDateString(new Date(dateFrom)));
                datePickerFromInstance.setDate(new Date(dateFrom));
                autoUpdateElm.prop('checked', false);
                getCountersValues();
            });

            setInterval(autoUpdateData, 30000);
        });
    });

    var serverURL = parameters.action.link+'/ajax',
        unitsObj = {},
        OCIDs = [],
        counterObj = {},
        bodyElm,
        selectCountersElm,
        selectGroupsElm,
        latestDataElm,
        historyDataElm,
        graphAreaElm,
        graphAreaDomElm,
        dateFromElm,
        dateToElm,
        autoUpdateElm,
        messageElm,
        fullScreenGraphBtnElm,
        fullScreenCountersBtnElm,
        leftDivElm,
        rightDivElm,
        alignSettingsElm,
        closeGraphSettingsElm,
        objects = parameters.objects,
        groups = [],
        counters = [],
        y1 = {},
        y2 = {},
        graphProperties = {},
        dateFrom,
        dateTo,
        parametersFromURL = {},
        historyTooltipsInstances,
        drawingInProgress = false;

    var monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    return { init: init };

    /*
        init and run all of this

        object: array of objects with IDs [{id:...}, ...] from parameters.objects
        callback(): may be skipped
     */
    function init(_objects, callback){
        if(_objects) objects = _objects;

        // parse parameters from browser URL
        // external function from init.js
        getActionParametersFromBrowserURL(function(actionParametersFromURL) {
            actionParametersFromURL.forEach(function(prm) {
                if(prm.key === 'f' || prm.key === 'n') var val = Number(prm.val);
                // Number(' ') = 0
                else if(/-/.test(prm.val)) val = prm.val.split('-').map(function(o) { return (o === '' ? '' : Number(o)); });
                else val = prm.val === '' ? [] : [Number(prm.val)];
                parametersFromURL[prm.key.toLowerCase()] = val;
            });

            if(parametersFromURL.f === 1) fullScreenGraphSwitcher(true);

            if(parametersFromURL.y && parametersFromURL.y.length === 4){
                $('#yMinLeft').val(parametersFromURL.y[0]).addClass('active');
                $('#yMaxLeft').val(parametersFromURL.y[1]).addClass('active');
                $('#yMinRight').val(parametersFromURL.y[2]).addClass('active');
                $('#yMaxRight').val(parametersFromURL.y[3]).addClass('active');
            }

            // !!! parametersFromURL.t is an Array, splited by '-'. Array made when parse parameters from actionParametersFromURL
            if(parametersFromURL.t && parametersFromURL.t.length === 2 &&
                new Date(parametersFromURL.t[0]) && new Date(parametersFromURL.t[1]) &&
                parametersFromURL.t[0] < parametersFromURL.t[1]
            ) {
                dateFrom = parametersFromURL.t[0];
                dateTo = parametersFromURL.t[1];
            } else {
                dateTo = Date.now();
                // set dateFrom to yesterday midnight
                dateFrom = new Date(new Date(dateTo - 86400000).setHours(0,0,0,0)).getTime();
            }
            dateFromElm.val(getDateString(new Date(dateFrom)));
            dateToElm.val(getDateString(new Date(dateTo)));

            drawGroups(function(_groups) {
                groups = _groups;
                initCounters(getValuesForMultipleSelectElement(selectCountersElm), callback);
            });

            fullScreenGraphBtnElm.click(function() {
                if(leftDivElm.hasClass('hide')) fullScreenGraphSwitcher(false);
                else fullScreenGraphSwitcher(true);
            });

            fullScreenCountersBtnElm.click(function() {
                if(rightDivElm.hasClass('hide')) fullScreenCountersSwitcher(false);
                else fullScreenCountersSwitcher(true);
            });

            closeGraphSettingsElm.click(getCountersValues);

            $(window).resize(getCountersValues);

            // set to true or false according parameter from URL. if not present in URL, set to true
            autoUpdateElm.prop('checked', parametersFromURL.n !== 0);

            autoUpdateElm.click(function() {
                if(autoUpdateElm.is(':checked')) autoUpdateData();
                else drawHistory(); // run for update this parameter in browser URL
            })
        });
    }

    /*
    Create html with align property element

    prop: { id: <id>, align: <1>|<2> }, where 1 - left, 2 - right
     */
    function createAlignElmHTML(prop){
        var id = prop.id;

        if(!counterObj[id]) return '';

        return '\
<div class="col s12" style="margin-top: 10px" alignElmID="'+id+'">\
    <div class="col s1 switch">\
        <label>\
            <input type="checkbox"' + (prop.align === 2 ? ' checked' : '') + ' alignCounterID="' + id + '">\
            <span class="lever"></span>\
        </label>\
    </div>\
    <div class="col s8">' + escapeHtml(counterObj[id].objectName + ': ' +counterObj[id].counterName +
                (counterObj[id].unitID ? ' in '+ unitsObj[counterObj[id].unitID].abbreviation : '')) + '</div>\
    <div class="col s3" minAvgMax="'+id+'"></div>\
</div>';
    }

    function autoUpdateData() {
        if(autoUpdateElm.is(':checked')) {
            dateFrom = Date.now() - (dateTo - dateFrom);
            dateTo = Date.now();

            dateFromElm.val(getDateString(new Date(dateFrom)));
            dateToElm.val(getDateString(new Date(dateTo)));

            getCountersValues();
        }
    }

    function fullScreenGraphSwitcher(runInFullScreenMode) {

        if(runInFullScreenMode) {
            leftDivElm.addClass('hide');
            historyDataElm.addClass('hide');
            rightDivElm.removeClass('l8');
            graphAreaElm.css('height', '600px');
            fullScreenGraphBtnElm.find('i').text('fullscreen_exit');
        } else {
            leftDivElm.removeClass('hide');
            historyDataElm.removeClass('hide');
            rightDivElm.addClass('l8');
            graphAreaElm.css('height', '300px');
            fullScreenGraphBtnElm.find('i').text('fullscreen');
        }

        getCountersValues();
    }

    function fullScreenCountersSwitcher(runInFullScreenMode) {

        if(runInFullScreenMode) {
            rightDivElm.addClass('hide');
            leftDivElm.removeClass('l4');
            fullScreenCountersBtnElm.find('i').text('fullscreen_exit');
        } else {
            rightDivElm.removeClass('hide');
            leftDivElm.addClass('l4');
            fullScreenCountersBtnElm.find('i').text('fullscreen');
        }

        getCountersValues();
    }

    /*
        initializing counters

        selectedCountersIDs: array of selected counters IDs
        callback(): may be skipped
     */
    function initCounters(selectedCountersIDs, callback){
        drawCounters(selectedCountersIDs, function(_counters){
            counters = _counters;
            initLatestData(callback)
        });
    }

    /*
        initializing Latest Data

        callback(): may be skipped
     */
    function initLatestData(callback) {
        drawLatestData(function(){
            getUnits(function(_unitsObj){
                unitsObj = _unitsObj;
                // create align settings elements
                var OCIDs = parametersFromURL.l && parametersFromURL.l.length ? parametersFromURL.l.map(function(id) {return {id: id, align: 1}}) : [];
                if(parametersFromURL.r && parametersFromURL.r.length)
                    Array.prototype.push.apply(OCIDs, parametersFromURL.r.map(function(id) {return {id: id, align: 2}}));
                alignSettingsElm.empty().append(OCIDs.map(createAlignElmHTML).join(''));

                getCountersValues(function(){
                    if(typeof(callback) === 'function') callback();
                });
            })
        });
    }

    /*
        convert selected values from select(multiple) element to Number and return it.

        selectElm: jquery select element ( $('select') )
        return array of selected values. All values will have a Number type
     */
    function getValuesForMultipleSelectElement(selectElm){

        var selectedValues = selectElm.val();
        if(selectedValues) selectedValues = selectedValues.map(function(val) { return Number(val) });
        else selectedValues = [];

        return selectedValues;
    }

    function ajaxError (jqXHR, exception) {
        bodyElm.css("cursor", "auto");
        var msg = '';
        if (jqXHR.status === 0) {
            msg = 'Not connect.\n Verify Network.';
        } else if (jqXHR.status === 404) {
            msg = 'Requested page not found. [404]';
        } else if (jqXHR.status === 500) {
            msg = 'Internal Server Error [500].';
        } else if (exception === 'parsererror') {
            msg = 'Requested JSON parse failed.';
        } else if (exception === 'timeout') {
            msg = 'Time out error.';
        } else if (exception === 'abort') {
            msg = 'Ajax request aborted.';
        } else {
            msg = 'Uncaught Error.\n' + jqXHR.responseText;
        }
        M.toast({html: 'Web server error: ' + msg});
    }

    /*
        getting counters groups and draw it in select(multiple) element

        callback(groups)
        groups: [{id:.., name:...},...]
     */
    function drawGroups(callback) {
        var html = '';

        var selectedGroupsIDs = getValuesForMultipleSelectElement(selectGroupsElm);

        var IDs = objects.map(function(obj){ return obj.id});

        bodyElm.css("cursor", "wait");
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: 'getCountersGroups',
                IDs: IDs.join(',')
            },
            error: ajaxError,
            success: function (groups) {

                bodyElm.css("cursor", "auto");
                if (!groups || !groups.length) return callback([]);
                groups.forEach(function (group) {

                    if ((selectedGroupsIDs.length && selectedGroupsIDs.indexOf(group.id) !== -1) ||
                        !parametersFromURL.g ||
                        (parametersFromURL.g && parametersFromURL.g.length && parametersFromURL.g.indexOf(group.id) !== -1))
                        var selected = ' selected';
                    else selected = '';

                    html += '<option value="' + group.id + '"' + selected + '>' + escapeHtml(group.name) + '</option>';
                });

                selectGroupsElm.empty().append(html);

                M.FormSelect.init(selectGroupsElm[0], {});
                selectGroupsElm.change(initCounters);
                callback(groups);
            }
        });
    }

    /*
        getting counters and draw it in select(multiple) element

        selectedCountersIDs: array of selected counters or null. Don't replace it getValuesForMultipleSelectElement
            function.
        callback(counters)
        counters: [{id:.., name:.., unitID:.., groupID:.., OCID:.., objectID:.., objectName:...}]

     */
    function drawCounters(selectedCountersIDs, callback) {
        var html = '';
        var selectedGroupsIDs = getValuesForMultipleSelectElement(selectGroupsElm);

        if(selectedCountersIDs.length) {
            var selectedCountersIDsObj = {};
            selectedCountersIDs.forEach(function(id){ selectedCountersIDsObj[id] = true; })
        } else selectedCountersIDsObj = null;

        var IDs = objects.map(function(obj){ return obj.id});

        bodyElm.css("cursor", "wait");
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: 'getCounters',
                IDs: IDs.join(','),
                groupsIDs: selectedGroupsIDs.join(',')
            },
            error: ajaxError,
            success: function (counters) {

                bodyElm.css("cursor", "auto");
                if (!counters.length) {
                    html = '<option disabled selected>Not found shared counters for selected objects</option>'
                } else {
                    var countersObj = {}, multipleCounters = {};
                    counters.forEach(function (counter) {
                        if (countersObj[counter.id]) {
                            if (!multipleCounters[counter.id]) multipleCounters[counter.id] = 2;
                            else ++multipleCounters[counter.id];
                            countersObj[counter.id] = '(' + multipleCounters[counter.id] + ') ' + counter.name;
                        } else countersObj[counter.id] = counter.name;
                    });
                    for (var id in countersObj) {
                        if (!countersObj.hasOwnProperty(id)) continue;
                        if (selectedCountersIDs.length && selectedCountersIDs.indexOf(Number(id)) !== -1 ||
                            !parametersFromURL.o ||
                            (parametersFromURL.o && parametersFromURL.o.length && parametersFromURL.o.indexOf(Number(id)) !== -1))
                            var selected = ' selected';
                        else selected = '';

                        html += '<option value="' + id + '"' + selected + '>' + escapeHtml(countersObj[id]) + '</option>';
                    }
                }

                selectCountersElm.empty().append(html);

                M.FormSelect.init(selectCountersElm[0], {});
                selectCountersElm.change(initLatestData);
                callback(counters);
            }
        });
    }

    /*
        getting all units and return it as unitObj

        callback(unitObj)
        unitObj { <unitID>: {id:.., name:..., abbreviation:.., multiplies: [xx,yy,], prefixes: [str1, str2], onlyPrefixes:...}, ... }
     */
    function getUnits(callback){
        bodyElm.css("cursor", "wait");
        $.ajax({
            type: 'POST',
            timeout: 10000,
            url: serverURL,
            data: {
                func: 'getUnits'
            },
            error: ajaxError,
            success: function (units) {

                bodyElm.css("cursor", "auto");
                var unitsObj = {};
                units.forEach(function (unit) {
                    if (unit.multiplies) {

                        var multiplies = unit.multiplies.split(',');
                        var prefixes = unit.prefixes.split(',');
                        unit.multiplies = [];
                        unit.prefixes = [];

                        for (var i = 0; i < multiplies.length; i++) {
                            if ((i === 0 || multiplies[i - 1] < 1) && multiplies[i] > 1) {
                                unit.multiplies.push(1);
                                unit.prefixes.push(unit.abbreviation);
                            }
                            unit.multiplies.push(Number(multiplies[i]));
                            unit.prefixes.push(prefixes[i])
                        }

                        if (Number(multiplies[multiplies.length - 1]) < 1) {
                            unit.multiplies.push(1);
                            unit.prefixes.push(unit.abbreviation);
                        }
                    }

                    unitsObj[unit.id] = unit;
                });

                callback(unitsObj);
            }
        });
    }

    /*
        draw latest data tables without data

        callback()
     */
    function drawLatestData(callback){
        var html = '';

        OCIDs = [];
        counterObj = {};

        var selectedOCID = getOCIDFromSelectedLatestDataCheckBoxes();

        var currentGroupID = 0, multipleObjects = objects && objects.length > 1;
        if(!jQuery.isEmptyObject(counters)) {
            var groupsObj = {};
            groups.forEach(function(group){
                groupsObj[group.id] = group.name;
            });

            var htmlGroupTail = '</tbody></table></div></li>';

            var selectedCountersIDs = getValuesForMultipleSelectElement(selectCountersElm);

            counters.forEach(function (counter) {
                if (selectedCountersIDs.indexOf(counter.id) === -1) return;
                OCIDs.push(counter.OCID);
                counterObj[counter.OCID] = {
                    objectName: counter.objectName,
                    counterName: counter.name,
                    unitID: counter.unitID,
                    multiplier: Number(counter.sourceMultiplier) ? Number(counter.sourceMultiplier) : 1
                };

                if (currentGroupID !== counter.groupID) {
                    if (html) html += htmlGroupTail;
                    html += '<li class="active"><div class="collapsible-header">' +
                        '<i class="material-icons">collections_bookmark</i>' +
                        '<span>' + escapeHtml(groupsObj[counter.groupID]) + '</span>' +
                        '</div>' +
                        '<div class="collapsible-body">' +
                        '<table class="highlight bordered" style="table-layout:fixed;"><thead><tr>' +
                        '<th style="width: 10%" class="tooltipped" data-position="top" data-tooltip="select/unselect all"><a href="#!" id="selectUnselect" ><i class="material-icons">check</i></a></th>' +
                        (multipleObjects ? '<th style="width: 30%">Object</th>' : '') +
                        '<th>Counter</th>' +
                        '<th style="width: 18%">Time</th>' +
                        '<th style="width: 18%" class="right-align">Value</th>' +
                        '</tr></thead><tbody>';

                    currentGroupID = counter.groupID;
                }

                if(selectedOCID.indexOf(counter.OCID) !== -1 ||
                    (parametersFromURL.l && parametersFromURL.l.length && parametersFromURL.l.indexOf(counter.OCID) !== -1) ||
                    (parametersFromURL.r && parametersFromURL.r.length && parametersFromURL.r.indexOf(counter.OCID) !== -1)
                ) var checked = ' checked';
                else checked = '';

                html += '<tr><td>' +
                    '<label><input type="checkbox" latest-data-cb value="'+counter.OCID+'" id="cb-'+counter.OCID+'" '+checked+'/>' +
                    '<span></span></label></td>' +
                    (multipleObjects ? '<td class="no-padding"><div class="truncate no-padding tooltipped" data-position="top" data-tooltip="' +
                        escapeHtml(counter.objectName + (counter.objectDescription ? ': ' + counter.objectDescription : '')) + '">' +
                        escapeHtml(counter.objectName) + '</div></td>' : '') +
                    '<td class="no-padding"><div class="truncate no-padding tooltipped" data-position="top" data-tooltip="' + escapeHtml(counter.name) + '">' + escapeHtml(counter.name) + '</div></td>' +
                    '<td class="no-padding"><div class="truncate no-padding" id="OCID-time-' + counter.OCID + '" timestampForLastValue>loading...</div></td>' +
                    '<td class="right-align no-padding"><div class="truncate no-padding tooltipped" latestData data-position="top" data-tooltip="undefined" id="OCID-' + counter.OCID + '" lastValue>loading...</div></td>'
            });
            html += htmlGroupTail;
        }

        latestDataElm.empty().append(html);

        $('a#selectUnselect').click(function() {
            var checkedElms = $(this).closest('table').find('input:checkbox:checked');
            var uncheckedElms = $(this).closest('table').find('input:checkbox:not(:checked)');

            if(checkedElms.get().length > uncheckedElms.get().length) {
                checkedElms.prop('checked', false).each(function(idx, elm) {
                    $('div[alignElmID="'+$(elm).val()+'"]').remove();
                });
            } else uncheckedElms.prop('checked', true);
            setTimeout(drawHistory, 500);
        });

        M.Tooltip.init(document.querySelectorAll('.tooltipped'), {
            enterDelay: 1000
        });
        M.Collapsible.init(latestDataElm[0], {
            accordion: false
        });
        $('input[latest-data-cb]').click(function() {
            var id = $(this).val();
            if(!$(this).is(':checked')) $('div[alignElmID="'+id+'"]').remove();
            setTimeout(drawHistory, 500);
        });

        callback();
    }

    /*
     convert timestamp in ms from 1970 to time string HH:MM:SS
     */
    function timestampToTimeStr(timestamp, withDate) {
        var t = new Date(Number(timestamp));
        if(withDate) {
            var month = t.getMonth() + 1;
            var date = t.getDate();
            var dateStr = String(date < 10 ? '0' + date : date) + '.' + String(month < 10 ? '0' + month : month) + '.' + String((t.getYear() - 100))
        } else dateStr = '';
        return dateStr + ' ' + String('0' + t.getHours() + ':0' + t.getMinutes() + ':0' + t.getSeconds()).replace(/0(\d\d)/g, '$1');
    }


    /*
     getting counters values and fill Latest Data tables

     callback(): may be skipped
     */
    function getCountersValues(callback) {
        if(!OCIDs.length) {
            if (typeof(callback) === 'function') callback();
            return;
        }
        $("[timestampForLastValue]:contains('no data')").text('loading...');
        $("[lastValue]:contains('no data')").text('loading...');
        bodyElm.css("cursor", "wait");
        $.post(serverURL, {func: 'getObjectsCountersValues', IDs: OCIDs.join(',')}, function (records) {
            bodyElm.css("cursor", "auto");
            if(records) {
                Object.keys(records).forEach(function (id) {
                    var record = records[id];
                    if(record.timestamp ) {
                        var t = new Date(Number(record.timestamp));
                        if (t.getDate() !== (new Date).getDate()) { // compare two days of month
                            var month = t.getMonth() + 1;
                            var date = t.getDate();
                            var timeStr = String(date < 10 ? '0' + date : date) + '.' + String(month < 10 ? '0' + month : month) + '.' + String((t.getYear() - 100));
                        } else timeStr = timestampToTimeStr(record.timestamp);
                    } else timeStr = '';
                    $('#OCID-time-' + id).empty().append(timeStr);

                    var value = !isNaN(parseFloat(record.data)) && isFinite(record.data) ? record.data * counterObj[id].multiplier : record.data;

                    if(record.data === undefined) {
                        if(record.err && record.err.message) value = record.err.message;
                        else value = 'no data';
                    }
                    else if (counterObj[id]) value = formatValue(value, unitsObj[counterObj[id].unitID]);

                    $('#OCID-' + id).empty().append(value).attr('data-tooltip', value);
                });
            }
            $("[timestampForLastValue]:contains('loading...')").text('no data');
            $("[lastValue]:contains('loading...')").text('no data');
            M.Tooltip.init(document.querySelectorAll('div[latestData]'), {
                enterDelay: 1000
            });
            drawHistory(callback);
        });
    }

    /*
        Return array of objectsCountersIDs with Number type of elements for selected checkbox in Latest Data table
     */
    function getOCIDFromSelectedLatestDataCheckBoxes() {
        var checkBoxElms = $('input[latest-data-cb]:checked:enabled');
        if(checkBoxElms) return checkBoxElms.get().map(function(elm){ return Number($(elm).val()) });
        else return [];
    }


    function drawHistory(callback) {

        if(drawingInProgress) {
            if(typeof(callback) === 'function') callback();
            return;
        }

        drawingInProgress = true;
        //console.log('drawHistory: ', (new Date), ': ', (new Error('stack')).stack);

        var OCIDs = getOCIDFromSelectedLatestDataCheckBoxes();

        var tableHearedHTML = '';
        if(OCIDs.length && !jQuery.isEmptyObject(counters)) {

            // 5400000 ms = 1:30, if maxRecordsCnt = 0, then return all records
            if(dateTo - dateFrom < 5400000) var maxRecordsCnt = 0;
            else maxRecordsCnt = Math.round(graphAreaElm.width() / 5);

            //console.log(dateFrom, dateTo, maxRecordsCnt, OCIDs);

            var messageTail = (maxRecordsCnt ? 'AVERAGE' : 'ALL') +' values from ' +
                ((new Date(dateFrom)).toLocaleString()) + ' to ' + ((new Date(dateTo)).toLocaleString());
            messageElm.empty().append('Loading ' + messageTail + '...');

            /*
             objectsCountersValues: {<ocid1>: [{timestamp:.., data:..},..], <ocid2>: [{timestamp:.., data:..},..], ...}
             sorted by timestamps from older (smaller) to newer (larger)
             */
            bodyElm.css("cursor", "wait");
            var timestampWithDate = (new Date(dateFrom).getDate() !== (new Date(dateTo)).getDate());
            $.ajax({
                type: 'POST',
                timeout: 10000,
                url: serverURL,
                data: {
                    func: 'getObjectsCountersHistoryValues',
                    IDs: OCIDs.join(','),
                    from: dateFrom,
                    to: dateTo,
                    maxRecordsCnt: maxRecordsCnt
                },
                error: ajaxError,
                success: function (objectsCountersValues) {
                    // [{<id1>: [{timestamp:.., data:..}, ...]}, {<id2>: [{timestamp:.., data:..}, ....]}, ...]

                    if (!objectsCountersValues) {
                        drawingInProgress = false;
                        bodyElm.css("cursor", "auto");
                        if (typeof (callback) === 'function') callback();
                        messageElm.empty().append('No data for displaying ' + messageTail);
                        return;
                    }

                    messageElm.empty().append('Displaying ' + messageTail);

                    tableHearedHTML += '<thead><tr><th>Time</th>';
                    // set start index (OCIDsIndexes[ocid] variable) to 0 and drawing table header
                    var OCIDsIndexes = {};
                    OCIDs.forEach(function (ocid) {
                        OCIDsIndexes[ocid] = 0;
                        for (var i = 0; i < counters.length; i++) {
                            var counter = counters[i];
                            if (counter.OCID === ocid) {
                                tableHearedHTML += '<th class="right-align">' + escapeHtml(counter.objectName + ':' + counter.name) + '</th>';
                                return;
                            }
                        }

                        if (objectsCountersValues[ocid].length) {
                            objectsCountersValues[ocid] = objectsCountersValues[ocid].sort(function (a, b) {
                                if (a.timestamp < b.timestamp) return 1;
                                if (a.timestamp > b.timestamp) return -1;
                                return 0;
                            })
                        }
                    });
                    tableHearedHTML += '</tr></thead>';
                    var tableBodyElm = $('<tbody></tbody>');

                    if (historyTooltipsInstances && historyTooltipsInstances.length) {
                        historyTooltipsInstances.forEach(function (instance) {
                            instance.destroy();
                        })
                    }

                    historyDataElm.empty().append(tableHearedHTML, tableBodyElm);

                    if (!jQuery.isEmptyObject(objectsCountersValues)) {

                        // from older (smaller) timestamp values to newer (bigger)
                        // completedDrawingOCIDs[ocid] = true|undefined. if true, then all data from array for this ocid was processed and printed
                        // variable attempts will limits attempts count to 1000
                        for (var completedDrawingOCIDs = {}, attempts = 0; Object.keys(completedDrawingOCIDs).length !== OCIDs.length && attempts < 5000; attempts++) {
                            var minTimestamp = 0, minNextTimestamp = 0, maxTimestamp = 0;

                            // searching most smaller (min) next timestamp from all next OCIDs timestamps.
                            OCIDs.forEach(function (ocid) {
                                // if index of current OCID greater then OCID array length, mark this OCID array completed processing.
                                // when all OCID arrays will be marked as completed, main loop is finished
                                if (!objectsCountersValues[ocid] || !objectsCountersValues[ocid].length || objectsCountersValues[ocid].length <= OCIDsIndexes[ocid] + 1) {
                                    completedDrawingOCIDs[ocid] = true;
                                    return;
                                }
                                // find min timestamp from OCIDs timestamps
                                var nextTimestamp = objectsCountersValues[ocid][OCIDsIndexes[ocid] + 1].timestamp;
                                var currentTimestamp = objectsCountersValues[ocid][OCIDsIndexes[ocid]].timestamp;

                                // minNextTimestamp > currentTimestamp
                                // checking for error in data, when next timestamp lower then current timestamp
                                if (nextTimestamp > currentTimestamp && (!minNextTimestamp || minNextTimestamp > nextTimestamp))
                                    minNextTimestamp = nextTimestamp;
                            });

                            var historyRow = '';

                            //
                            OCIDs.forEach(function (ocid) {
                                if (objectsCountersValues[ocid] && objectsCountersValues[ocid].length &&
                                    objectsCountersValues[ocid].length > OCIDsIndexes[ocid]) {
                                    var currentTimestamp = objectsCountersValues[ocid][OCIDsIndexes[ocid]].timestamp;
                                } else currentTimestamp = 0;

                                if (currentTimestamp && (currentTimestamp <= minNextTimestamp || !minNextTimestamp)) {

                                    // calculate min timestamp for current row. It can be most smaller timestamp value
                                    // from timestamp values of all current OCIDs
                                    if (!minTimestamp || minTimestamp > currentTimestamp) minTimestamp = currentTimestamp;

                                    // calculate max timestamp for current row. It can be most bigger timestamp value
                                    // from timestamp values of all current OCIDs
                                    if (maxTimestamp < currentTimestamp) maxTimestamp = currentTimestamp;

                                    var value = objectsCountersValues[ocid][OCIDsIndexes[ocid]].data;
                                    var multipliedValue = !isNaN(parseFloat(value)) && isFinite(value) ? value * counterObj[ocid].multiplier : value;
                                    historyRow += '<td class="right-align tooltipped" data-position="top" data-tooltip="' +
                                        timestampToTimeStr(currentTimestamp, timestampWithDate) + ':' + escapeHtml(value) + '">' +
                                        formatValue(multipliedValue, unitsObj[counterObj[ocid].unitID]) +
                                        '</td>';
                                    // for debugging
                                    //historyRow += '<td class="right-align">' + formatValue(objectsCountersValues[ocid][OCIDsIndexes[ocid]].data, unitsObj[counterObj[ocid].unitID]) +
                                    //    ':'+OCIDsIndexes[ocid]+'/'+objectsCountersValues[ocid].length+';'+Object.keys(completedDrawingOCIDs).length+'/'+OCIDs.length+'</td>';

//if(/null/.test(historyRow)) console.log(OCIDsIndexes[ocid] + '/' + objectsCountersValues[ocid].length + ';' +
//    objectsCountersValues[ocid][OCIDsIndexes[ocid]].data + ' -', unitsObj[counterObj[ocid].unitID],
//    ' = ' + formatValue(objectsCountersValues[ocid][OCIDsIndexes[ocid]].data, unitsObj[counterObj[ocid].unitID]));

                                    // Increase index for OCID only if counter value for this index was printed.
                                    // else waiting for correct time interval
                                    if (objectsCountersValues[ocid].length > OCIDsIndexes[ocid]) ++OCIDsIndexes[ocid];
                                } else historyRow += '<td>&nbsp;</td>';
                                // for debugging
                                //} else historyRow += '<td class="right-align">'+OCIDsIndexes[ocid]+'/'+objectsCountersValues[ocid].length+':'+
                                //    timestampToTimeStr(minNextTimestamp)+'/'+(currentTimestamp ? timestampToTimeStr(currentTimestamp) : '0')+'</td>';
                            });

                            var minTimestampStr = timestampToTimeStr(minTimestamp, timestampWithDate);
                            var maxTimestampStr = timestampToTimeStr(maxTimestamp);
                            if (minTimestamp + 1000 >= maxTimestamp) var timestampStr = minTimestampStr;
                            else timestampStr = minTimestampStr + '-' + maxTimestampStr;

                            tableBodyElm.prepend('<tr><td>' + timestampStr + '</td>' + historyRow + '</tr>');
                        }
                    }
                    historyTooltipsInstances = M.Tooltip.init(document.querySelectorAll('td.tooltipped'), {
                        enterDelay: 1000
                    });

                    prepareDataForGraph(objectsCountersValues);
                    drawingInProgress = false;
                    bodyElm.css("cursor", "auto");
                    if (typeof (callback) === 'function') callback();
                }
            });
        } else {
            historyDataElm.empty();
            prepareDataForGraph({});
            drawingInProgress = false;
            if(typeof(callback) === 'function') callback();
        }
    }

    /*
        formatting value according units table

        val: data value
        unit: unit object {id:.., name:..., abbreviation:.., multiplies: [xx,yy,], prefixes: [str1, str2], onlyPrefixes:...}

        return formatted data value
     */
    function formatValue(val, unit){
        var isNumber = false;
        if(!isNaN(parseFloat(val)) && isFinite(val)){
            val = Number(val);
            isNumber = true;
        }

        if(!unit || !unit.name) {
            //if(!isNumber) return ((val && val.length > 1024) ? val.slice(0, 1024) + '...' : val);
            if(!isNumber) return val;
            if(val === 0) return '0';
            return Math.round(val * 100) / 100;
        }

        if(unit.name === 'Time' && isNumber && val > 1) return secondsToHuman(val);

        if(!isNumber) return escapeHtml(val) + '&nbsp;' + escapeHtml(unit.abbreviation);

        if(!unit.multiplies[0]) return String(Math.round(val * 100) / 100) + ' ' + escapeHtml(unit.abbreviation);

        // searching true multiplier index 'i'
        for (var i = 0; i < unit.multiplies.length && val / unit.multiplies[i] > 1; i++){} --i;

        if(i < 0) return String(val) + '&nbsp;' + escapeHtml(unit.abbreviation);

        var newVal = Math.round(val / unit.multiplies[i] * 100) / 100;

        if(unit.onlyPrefixes || unit.prefixes[i] === unit.abbreviation) var suffix = unit.prefixes[i];
        else suffix = unit.prefixes[i] + unit.abbreviation;

        return escapeHtml(newVal + ' ' + suffix);
    }

    function secondsToHuman ( seconds ) {
        // 1477236595310 = 01/01/2000)
        if(seconds > 1477236595310) return new Date(seconds).toLocaleString().replace(/\.\d\d(\d\d),/, '.$1');

        return [   [Math.floor(seconds / 31536000), function(y) { return y === 1 ? y + 'year ' : y + 'years ' }],
            [Math.floor((seconds % 31536000) / 86400), function(y) { return y === 1 ? y + 'day ' : y + 'days ' }],
            [Math.floor(((seconds % 31536000) % 86400) / 3600), function(y) { return y + (y === 1 ? 'hour ' : 'hours ' )}],
            [Math.floor((((seconds % 31536000) % 86400) % 3600) / 60), function(y) {return y + 'min '}],
            [(((seconds % 31536000) % 86400) % 3600) % 60, function(y) {return y + 'sec'}]
        ].map(function(level) {
            return level[0] ? level[1](level[0]) : '';
        }).join('').replace(/^([^ ]+ [^ ]+) ?.*$/, '$1').replace(/(\.\d\d)\d*/, '$1 ').trim() || '0 sec';
    }

    //=================================================================================================
    //===================================== GRAPHS AREA ===============================================

    function initGraphEvents() {

        // Hook into the 'flotr:select' event.
        Flotr.EventAdapter.observe(graphAreaDomElm, 'flotr:select', function(area) {
            dateFrom = Math.round(area.x1);
            dateTo = Math.round(area.x2);
            if(Date.now() - dateTo > 600000) autoUpdateElm.prop('checked', false);
            getCountersValues();

            //console.log('select on graph');
        });

        // Hook into the 'flotr:click' event. Return to day view on graph
        Flotr.EventAdapter.observe(graphAreaDomElm, 'flotr:click', function() {

            if(dateTo - dateFrom < 86400000) {// less then one day (< 24 hours)
                dateFrom = dateFrom + (Math.round((dateTo - dateFrom) / 2)) - 43200000; // 86400000 / 2
                dateTo = dateFrom + 86400000;
                dateFrom = new Date(new Date(dateFrom).setHours(0,0,0,0)).getTime();

                if(dateTo > Date.now()) {
                    dateTo = Date.now();
                    dateFrom = dateTo - 86400000;
                }
            } else { // more then one day (> 24 hours)
                dateFrom = dateTo - 86400000;
            }

            if(Date.now() - dateTo > 600000) autoUpdateElm.prop('checked', false);

            dateFromElm.val(getDateString(new Date(dateFrom)));
            dateToElm.val(getDateString(new Date(dateTo)));
            getCountersValues();

            //console.log('click on graph');
        });
    }

    /*
        returned date string in format DD MonthName, YYYY
        date: date object (new Date())
     */
    function getDateString(date) {
        if(!date) date = new Date();

        return date.getDate() + ' ' + monthNames[date.getMonth()] + ', ' + date.getFullYear();
    }

    /*
        Converting date string in format DD MonthName, YYYY to ms

        dateStr: date string in format DD MonthName, YYYY
        return time from 1.1.1970 in ms
     */
    function getTimestampFromStr(dateStr) {
        var dateParts = dateStr.match(/^(\d\d?)\s([^,]+),\s(\d\d\d\d)$/);
        if(dateParts === null) return;
        var monthNum = monthNames.indexOf(dateParts[2]);
        return new Date(Number(dateParts[3]), monthNum, Number(dateParts[1])).getTime();
    }


    /*
    objectsCountersValues:
    [{<id1>: [{timestamp:.., data:..}, ...]}, {<id2>: [{timestamp:.., data:..}, ....]}, ...]
     */
    function prepareDataForGraph(objectsCountersValues) {

        var graphData = [];

        function getLimitValues(elmID) {
            var val = $(elmID).val();
            if(/^\d+$/.test(val)) return Number(val);
            return '';
        }
        var yMinLeft = getLimitValues('#yMinLeft');
        var yMaxLeft = getLimitValues('#yMaxLeft');
        var yMinRight = getLimitValues('#yMinRight');
        var yMaxRight = getLimitValues('#yMaxRight');


        y1.unit = y2.unit = y1.title = y2.title = y1.min = y2.min = y1.max = y2.max = undefined;
        var countersNames = {}, objectsNames = {},
            maxDifference = graphAreaElm.height() / 5; // 20% from graph height
        var rightAxisObjects = [], leftAxisObjects = [], numberDataCnt = 0;

        for(var ocid in objectsCountersValues) {
            if(!objectsCountersValues.hasOwnProperty(ocid)) continue;


            /*
             converting objectsCountersValues to graph format
             from
             [{<id1>: [{timestamp:.., data:..}, ...]}, {<id2>: [{timestamp:.., data:..}, ....]}, ...]
             to
             [[{0:<timestamp, 1:<data>}, {0:<timestamp, 1:<data>}, ...], [{0:<timestamp, 1:<data>}, {0:<timestamp, 1:<data>}, ...], ....]

             and calculate min, average and max values
             */
            //!!!min = avg = undefined is needed, else min set to minimum value of all data
            var min = undefined, max = 0, avg = undefined;
            graphData.push({
                data: objectsCountersValues[ocid]
                    .filter(function(record) {
                        return !isNaN(record.data); // filter Not a Number values
                    }).map(function(record) {
                        ++numberDataCnt;
                        var data = Number(record.data) * counterObj[ocid].multiplier;
                        if(min === undefined || min > data) min = data;
                        if(max < data) max = data;
                        if(avg === undefined) avg = data;
                        else avg = (avg + data) / 2;
                        return {
                            0: record.timestamp,
                            1: data
                        }
                    }
                )
            });

            // for making graph title and subtitle
            countersNames[counterObj[ocid].counterName] = true;
            objectsNames[counterObj[ocid].objectName] = true;

            // Y axis will be 1 (left) or 2 (right) axis
            var yAxisNumber = 0;

            /*
            console.log('y1 title: ', y1.title, ' y2 title: ', y2.title, ' objects cnt: ', Object.keys(data).length);
            if(y1.max != undefined && Object.keys(data).length > 2) {
                console.log('1. (y1.max - y1.min) / (max - min)        > (max - min)       * maxDifference) = (',y1.max,'-',y1.min,')/(',max,'-',min,')>(',max,'-',min,')*',maxDifference,' = ',((y1.max-y1.min)/(max-min)),'>',(max-min)*maxDifference);
                console.log('2. ((max - min)       / (y1.max - y1.min) > (y1.max - y1.min) * maxDifference) = (',max,'-',min,')/(',y1.max,'-',y1.min,')>(',y1.max,'-',y1.min,')*',maxDifference,' = ',((max-min)/(y1.max-y1.min)),'>',(y1.max-y1.min)*maxDifference);
                console.log('3. ((y1.min - max)    / (y1.max - y1.min) > (y1.max - y1.min) * maxDifference) = (',y1.min,'-',max,')/(',y1.max,'-',y1.min,')>(',y1.max,'-',y1.min,')*',maxDifference,' = ',((y1.min-max)/(y1.max-y1.min)),'>',(y1.max-y1.min)*maxDifference);
                console.log('4. ((min - y1.max)    / (max - min)       > (max - min)       * maxDifference) = (',min,'-',y1.max,')/(',max,'-',min,')>(',max,'-',min,')*',maxDifference,' = ',((min-y1.max)/(max-min)),'>',(max-min)*maxDifference);
            }
            */
            /*
             max1 ------------------------ max2 ~~~~~~~~~~~~~~~~~~~~~~~ max1 ---------------------------
             max2 ~~~~~~~~~~~~~~~~~~~~~~~~ min2 ~~~~~~~~~~~~~~~~~~~~~~~
             min2 ~~~~~~~~~~~~~~~~~~~~~~~~ max1 -----------------------

                                                                        max2 ~~~~~~~~~~~~~~~~~~~~~~~~~~~
                                                                        min2 ~~~~~~~~~~~~~~~~~~~~~~~~~~~
             min1 ------------------------ min1 ----------------------- min1 ---------------------------
             (max1-min1) / (max2-min2) > (max2-min2) * X

             ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
             ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~



             -----------------------------------------------
             -----------------------------------------------
             (min1-max2) / (max1-min1) > (max1-min1) * X

             if data has equal to previous data unit (or has no unit, as a previous data)
             or
             if difference between min and max values of the previous data comparable with difference between min and max
             values of the current data
             or
             if difference between min and max values in current and previous data less then difference between
             previous and current data values
             then
             to draw data at the one Y axis
             */
            var alignElm = $('input[alignCounterID="'+ocid+'"]');
            if( (alignElm.length && !alignElm.is(':checked')) ||
                (!alignElm.length &&
                    (!leftAxisObjects.length ||
                    (counterObj[ocid].unitID && counterObj[ocid].unitID === y1.unit) || (!counterObj[ocid].unitID && y1.unit === 0) ||
                    (Object.keys(objectsCountersValues).length > 2 && !(
                        ((y1.max - y1.min) / (max - min)       > (max - min)       * maxDifference) ||
                        ((max - min)       / (y1.max - y1.min) > (y1.max - y1.min) * maxDifference) ||
                        ((y1.min - max)    / (y1.max - y1.min) > (y1.max - y1.min) * maxDifference) ||
                        ((min - y1.max)    / (max - min)       > (max - min)       * maxDifference)
                    )))
                )
            ) {
                if (y1.unit === undefined) {
                    if (counterObj[ocid].unitID) y1.unit = counterObj[ocid].unitID;
                    else y1.unit = 0;
                    y1.title = counterObj[ocid].counterName;
                }

                yAxisNumber = 1;
                leftAxisObjects.push(ocid);
                if(y1.title !== counterObj[ocid].counterName) y1.title = '';
                if (!counterObj[ocid].unitID || counterObj[ocid].unitID !== y1.unit) y1.unit = 0;

                if(yMinLeft !== '') y1.min = yMinLeft;
                else if(y1.min === undefined || y1.min > min) y1.min = min;

                if(yMaxLeft !== '') y1.max = yMaxLeft;
                else if(y1.max === undefined || y1.max < max) y1.max = max;
            } else {

                if (y2.unit === undefined) {
                    if (counterObj[ocid].unitID) y2.unit = counterObj[ocid].unitID;
                    else y2.unit = 0;
                    y2.title = counterObj[ocid].counterName;
                }

                yAxisNumber = 2;
                rightAxisObjects.push(ocid);
                if (y2.title !== counterObj[ocid].counterName) y2.title = '';
                if (!counterObj[ocid].unitID || counterObj[ocid].unitID !== y2.unit) y2.unit = 0;

                if(yMinRight !== '') y2.min = yMinRight;
                else if(y2.min === undefined || y2.min > min) y2.min = min;

                if(yMaxRight !== '') y2.max = yMaxRight;
                else if(y2.max === undefined || y2.max < max) y2.max = max;
            }

            graphData[graphData.length-1].yaxis = yAxisNumber;
            graphData[graphData.length-1].label = counterObj[ocid].objectName + ': ' + counterObj[ocid].counterName +
                (counterObj[ocid].unitID ? ' in '+unitsObj[counterObj[ocid].unitID].abbreviation : '') +
                (yAxisNumber === 2 ? ' (right)' : '');

            if(!alignElm.length) alignSettingsElm.append(createAlignElmHTML({id: ocid, align: yAxisNumber}));

            $('div[minAvgMax="'+ocid+'"]').text((Math.round(min * 100) / 100) + ' \\ ' + (Math.round(avg * 100) / 100) + ' \\ ' +
                (Math.round(max * 100) / 100));
        }

        graphProperties.title = Object.keys(countersNames).join(', ');
        graphProperties.subtitle = 'Objects: '+Object.keys(objectsNames).join(', ');

        //console.log('data: ', graphData);
        //alert(y1.min + ' : ' + y1.max + ' : ' + y2.min + ' : '+ y2.max);

        // saving action parameters to the browser URL.
        // it is an external function, which was exported from public/javascripts/init.js
        setActionParametersToBrowserURL([{
                key: 'g', // selected groups IDs list
                val: getValuesForMultipleSelectElement(selectGroupsElm).join('-')
            }, {
                key: 'o', // selected counters IDs list. 'o', because 'c' is reserved
                val: getValuesForMultipleSelectElement(selectCountersElm).join('-')
            }, {
                key: 't', // time from - time to for graph
                val: dateFrom + '-' + dateTo
            }, {
                key: 'f', // full screen 1 or 0
                val: leftDivElm.hasClass('hide') ? 1 : 0
            }, {
                key: 'y', // limits for y axis
                val: yMinLeft + '-' + yMaxLeft + '-' + yMinRight + '-' + yMaxRight
            }, {
                key: 'l', // OCIDs on a left y axis
                val: leftAxisObjects.join('-')
            }, {
                key: 'r', // OCIDs on a right y axis
                val: rightAxisObjects.join('-')
            }, {
                key: 'n', // auto update graph property. not 'n' because 'a' is reserved
                val: autoUpdateElm.is(':checked') ? 1 : 0
            }
        ]);

        if(!rightDivElm.hasClass('hide')) drawGraph(graphData);
    }

    function drawGraph(graphData){

        var options = {
            title : graphProperties.title,
            subtitle: graphProperties.subtitle,
            xaxis : {
                mode : 'time',
                timeMode: 'local',
                noTicks: 15, // ticks count (timestamps) on the x axis
                min: dateFrom,
                max: dateTo
            },
            yaxis: {
                tickFormatter: function(n){ return formatValue(n, unitsObj[y1.unit]) },
                //title: y1.title, // titleAngle does not work
                titleAngle: 90,
                min: y1.min,
                max: y1.max
            },
            y2axis: {
                tickFormatter: function(n){ return formatValue(n, unitsObj[y2.unit]) },
                //title: y2.title, // titleAngle does not work
                titleAngle: 270,
                min: y2.min,
                max: y2.max
            },
            selection : { mode : 'x' },
            legend : {
                position : 'sw',
                backgroundOpacity: 0.4,
                noColumns: 4,
                container: $('#legendArea')
            }
        };

        // Actually draw the graph. Make new object from options
        /* var graph = */Flotr.draw(graphAreaDomElm,  graphData, options);

        // required for make possible to copy graph to clipboard using standard browser right mouse click menu
        // graph.download.saveImage('png', null, null, true); // function (type, width, height, replaceCanvas)
    }

})(jQuery); // end of jQuery name space