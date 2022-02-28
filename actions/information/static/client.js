/*
* Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2021-1-24 0:54:27
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
    //var cfg = parameters.action.properties;
    var tableElm,
        CSVData = '',
        CSVRawData = '',
        div = parameters.action.CSVDiv || ',',
        decimalSep = parameters.action.CSVDecimalSep || '.';

    return {
        onChangeObjects: _onChangeObjects,
    };

    function _onChangeObjects (_objects) {
        objects = _objects; // set variable "objects" for selected objects
        getData(drawData);
    }

    function init() {
        tableElm = $('#infoTable');
        $('#downloadCSV').click(function () {
            saveToFile(CSVData, 'objectsInfo.csv');
        });
        $('#downloadRawCSV').click(function () {
            saveToFile(CSVRawData, 'objectsInfoRaw.csv');
        });
        getData(drawData);
    }

    function getData(callback) {
        $.post(serverURL, {func: 'getProperties', objects: JSON.stringify(objects)}, function(data) {
            if(!data || typeof data !== 'object' || !data.result || !Array.isArray(data.tableHeads) || !data.tableHeads.length) {
                //console.log('getProperties(', objects, '): ', data);
                return callback([]);
            }
            callback(data);
        });
    }

    function drawData(data) {

        if(!data.tableHeads) return;

        //console.log(data);
        var html = '<thead><tr><th>#</th><th>Object name</th><th>' +
            data.tableHeads.map(h => escapeHtml(h)).join('</th><th>') + '</th></tr></thead><tbody>';
        CSVRawData = '"Object name"' + div + '"' + data.tableHeads.join('"'+ div +'"') + '"\n';
        CSVData = '"#"' + div + CSVRawData;
        var objectsNames = Object.keys(data.result).sort(), leftOCIDs = [], rightsOCIDs = [];

        for(var i = 0, num = 1; i < objectsNames.length; i++) {
            var row = data.result[objectsNames[i]],
                CSVRow = [i, '"' + objectsNames[i].replace(/"/g, "'") + '"'],
                CSVRawRow = ['"' + objectsNames[i].replace(/"/g, "'") + '"'];

            var resultsNum = 0;
            var results = data.tableHeads.map(function(head) {
                if(!row[head]) row[head] = {};
                if(row[head].OCID && row[head].axisY) {
                    if (row[head].axisY === 'right') rightsOCIDs.push(row[head].OCID);
                    else if (row[head].axisY === 'left') leftOCIDs.push(row[head].OCID);
                }

                if(row[head].result !== undefined) ++resultsNum;
                var CSVRes = row[head].result !== undefined ? row[head].result : '';
                var CSVRawRes = row[head].rawResult;
                CSVRow.push(Number(CSVRes) === parseFloat(String(CSVRes)) ? String(CSVRes).replace('.', decimalSep) :
                    ('"' + String(CSVRes).replace(/"/g, "'") + '"'));
                CSVRawRow.push(Number(CSVRawRes) === parseFloat(String(CSVRawRes)) ? String(CSVRawRes).replace('.', decimalSep) :
                    ('"' + String(CSVRawRes).replace(/"/g, "'") + '"'));

                return escapeHtml(row[head].result !== undefined ? row[head].result : '');
            });
            if(!resultsNum) {
                console.log(objectsNames[i], 'has no data for information, skip');
                continue;
            }

            var link = !leftOCIDs.length && !rightsOCIDs.length ? ('<b>' + escapeHtml(objectsNames[i]) + '</b>') :
                ('<a href="' + makeURLForDataBrowser(objectsNames[i], leftOCIDs, rightsOCIDs) + '" target="_blank">' +
                    escapeHtml(objectsNames[i]) + '</a>');
            html += '<tr><td><b>' + (num++) + '</b></td><td>' + link + '</td><td>' +
                results.join('</td><td>') + '</td></tr>';

            CSVData += CSVRow.join(div) + '\n';
            CSVRawData += CSVRawRow.join(div) + '\n';
        }
        html += '</tbody>';

        tableElm.html(html);
    }

    function makeURLForDataBrowser(objectName, leftOCIDs, rightOCIDs) {
        var actionPath = parameters.action.link.replace(/\/[^\/]+$/, '') + '/data_browser';

        var urlParameters = {
            't': encodeURIComponent(Date.now() - 3600000 + '-' + Date.now()), // timestamps in ms
            'l': encodeURIComponent(leftOCIDs.join('-')), // show graph for this OCID with align to left
            'r': encodeURIComponent(rightOCIDs.join('-')), // show graph for this OCID with align to left
            'n': '1', // don't autoupdate
            'y': '0--0-',
            'a': encodeURIComponent(actionPath), // /action/data-browser
            'c': encodeURIComponent(objectName), // selected object
        };

        return '/?' + Object.keys(urlParameters).map(function(key) {
            return key + '=' + urlParameters[key];
        }).join('&');
    }

    function saveToFile(CSVData, fileName) {
        var dataStr = "data:text/csv;charset=utf-8," + encodeURIComponent(CSVData);
        var downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", fileName);
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

})(jQuery); // end of jQuery name space