/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-8-9 23:19:40
*/

function onChangeObjects(objects){
    JQueryNamespace.onChangeObjects(objects);
}

var JQueryNamespace = (function ($) {
    $(function () {
        init(); // Will run after finishing drawing the page
    });

    var serverURL = parameters.action.link+'/ajax'; // path to ajax
    var objects = parameters.objects; // initialize the variable "objects" for the selected objects on startup
    var serviceStates = parameters.action.serviceStates;
    var startTimeOutlier = parameters.action.startTimeOutlier || 240000; // as set in the trigger variable START_TIME_SCHEDULE_OUTLIER
    var stopTimeOutlier = parameters.action.stopTimeOutlier || 120000; // as set in the trigger variable STOP_TIME_SCHEDULE_OUTLIER
    var tableData, rawData;
    var collapseElm;
    var dataNumElm;
    var sortOrder = {
        name: 'timestamps',
        reverse: true,
    };

    return {
        onChangeObjects: _onChangeObjects,
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
        if(objects.length > 5) {
            dataNumElm.val(1);
        }
        getDataByAjax();
    }

    function init() {
        collapseElm = $('#collapse');
        dataNumElm = $('#dataNum');

        var dataNum = Number(parameters.action.historyDataNum);

        if(!dataNum || dataNum !== parseInt(String(dataNum), 10) || dataNum > 1000) dataNum = 7;
        dataNumElm.val(dataNum).keyup(function (e) {
            if(e.which === 13) getDataByAjax();
        });

        getDataByAjax();

        collapseElm.change(function () {
            tableData = prepareData(rawData, collapseElm.is(':checked'));
            drawTable(tableData);
        });

        $('#name').click(function () {
            sortOrder = {
                name: 'name',
                reverse: false,
            };
            drawTable(tableData);
        });

        $('#action').click(function () {
            sortOrder = {
                name: 'action',
                reverse: false,
            };
            drawTable(tableData);
        });

        $('#date').click(function () {
            sortOrder = {
                name: 'timestamps',
                reverse: false,
            };
            drawTable(tableData);
        });

        $('#time').click(function () {
            sortOrder = {
                name: 'data',
                reverse: false,
            };
            drawTable(tableData);
        });

        $('#status').click(function () {
            sortOrder = {
                name: 'state',
                reverse: false,
            };
            drawTable(tableData);
        });

        $('#reload').click(getDataByAjax);
    }

    function getDataByAjax() {
        var dataNum = Number(dataNumElm.val()), bodyElm = $('body');
        if(!dataNum || dataNum !== parseInt(String(dataNum), 10) || dataNum > 1000) dataNum = 7;

        bodyElm.css("cursor", "progress");
        $.post(serverURL, {func: 'getData', objects: JSON.stringify(objects), dataNum: dataNum}, function(data) {
            /*
            data[objectID] = {
                name: object.name,
                start: startData,
                stop: stopData,
                state: serviceStateData[0].data,
            };
             */
            bodyElm.css("cursor", "auto");
            rawData = data;
            collapseElm.attr('disabled', false);
            tableData = prepareData(rawData, collapseElm.is(':checked'));
            drawTable(tableData);
        });
    }

    function prepareData(data, isCollapsed) {
        tableData = [];
        for(var id in data) {
            prepareDataHelper(data, id, 'start', startTimeOutlier, isCollapsed);
            prepareDataHelper(data, id,'stop', stopTimeOutlier, isCollapsed);
        }
        return tableData.reverse();
    }

    function prepareDataHelper(data, id, type, outlier, isCollapsed) {
        if(!data[id][type]) return;
        var records = data[id][type].slice();
        if(!Array.isArray(records)) return;

        records.reverse().forEach(function (record) {
            if(isCollapsed) {
                for(var i = 0, isFoundEqualTime = false; i < tableData.length; i++) {
                    if(Math.abs(record.data - tableData[i].data) < outlier && id === tableData[i].id) {
                        tableData[i].timestamps.push(record.timestamp);
                        tableData[i].data = Math.round((record.data + tableData[i].data) / 2);
                        isFoundEqualTime = true;
                        break;
                    }
                }
            }
            if(!isCollapsed || !isFoundEqualTime) {
                tableData.push({
                    id: id,
                    name: data[id].name,
                    action: type,
                    timestamps: [record.timestamp],
                    data: record.data,
                    state: data[id].state,
                });
            }
        });
    }

    function sortTableData(tableData, field, reverse) {
        tableData.sort(function (a,b) {
            if(Array.isArray(a[field]) && Array.isArray(b[field])) {
                a[field].sort().reverse();
                b[field].sort().reverse();
                if(a[field][0] > b[field][0]) return 1;
                if(a[field][0] < b[field][0]) return -1;
                return 0;
            }

            if(a[field] > b[field]) return 1;
            if(a[field] < b[field]) return -1;
            return 0;
        });

        if(reverse) return tableData.reverse();
        return tableData;
    }

    function drawTable(tableData) {
        tableData = sortTableData(tableData, sortOrder.name, sortOrder.reverse);


        var rows = tableData.map(function (row) {
            return '<tr><td>' + row.name + '</td><td>' + getDates(row.timestamps) + '</td><td>' + getTime(row.data) +
                '</td><td>' + row.action + '</td><td>' + getStates(row.state)+ '</td></tr>';
        });

        if(!rows.length) {
            var names = objects.map(obj => { return obj.name; });
            $('tbody').html('<tr><td class="center" colspan="5">No schedule data for ' + names.join(', ') + '</td></tr>');
        }
        else $('tbody').html(rows.join(''));
    }

    function getDates(timestamps) {
        return timestamps.map(function (timestamp) {
            return new Date(timestamp).toDateString() + '&nbsp;' + new Date(timestamp).toLocaleTimeString();
        }).join('<br/>');
    }

    function getTime(time) {
        //time = 11912000; // 03:18:32
        if(time > 1477236595310) return time;

        var h = Math.floor(time / 3600000);
        var m = Math.floor((time - h * 3600000) / 60000);
        var s = Math.floor((time % 60000) / 1000);
        return String('0' + h + ':0' + m + ':0' + s).replace(/0(\d\d)/g, '$1');
    }

    function getStates(state) {
        if(typeof serviceStates !== 'object' || typeof serviceStates[state] !== 'string') return state;
        return serviceStates[state] + ' (' + state + ')';
    }

})(jQuery); // end of jQuery name space