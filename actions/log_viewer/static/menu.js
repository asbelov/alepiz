/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function Menu(cInitCfg, initMainObject, callback) {
    var mainObject;
    var codePageElm;
    var reElm;
    var searchElm;
    var searchBtnElm;
    var searchBtnIconElm;
    var searchUpArrowElm;
    var replaceElm;
    var doReplaceElm;
    var searchBackElm;
    var selectServiceElm;

    var searchBackLabel = String.fromCharCode(8593);  //Up arrow in utf-8
    var regExpLabel = '<a href="https://ru.wikipedia.org/wiki/Regexp" target="_blank">re</a>&nbsp;';
    var replaceAllLabel = 'все';

    var searchElmMaxSize = 40;
    var searchElmMinSize = 10;

    var heightCorrection = 0;
    if (cInitCfg.saveResult) heightCorrection = 0;

    var script = cInitCfg.script || parameters.action.link + '/ajax';
    var fileList = {};
    var selectFileElm;
    var prevFileName;

    selectFileElm = document.getElementById('selectFile');
    selectServiceElm = document.getElementById('selectService');

    mkMenu();
    cInitCfg.callBackSearchReverse = searchReverse;
    cInitCfg.heightCorrection = heightCorrection;
    selectService(reDrawLog);

    function reDrawLog(_fileName, _serviceName) {
        if(_fileName && typeof _fileName === 'string') cInitCfg.fileName = _fileName;
        if(_serviceName && typeof _serviceName === 'string') cInitCfg.serviceName = _serviceName;
        if(!_fileName && _serviceName) {
            cInitCfg.fileName = '';
            if(typeof callback === 'function') return callback(cInitCfg.logViewerObj, _fileName);
            else return;
        }
        cInitCfg.codePage = codePageElm.value || '';

        if(!mainObject) mainObject = cInitCfg.logViewerObj;
        if (mainObject) mainObject.del();
        mainObject = new initMainObject(cInitCfg);
        if( typeof mainObject.focus === 'function') setTimeout(mainObject.focus, 100);
        if(typeof callback === 'function') return callback(mainObject, _fileName);
    }

    function mkMenu() {
        searchBackElm = document.getElementById('searchDirection');

        searchUpArrowElm = document.getElementById('searchDirectionLabel');
        searchUpArrowElm.innerHTML = searchBackLabel;

        searchElm = document.getElementById('searchInput');
        searchElm.size = searchElmMaxSize;
        eConnect(searchElm, searchOnKeyUp, 'keyup');

        reElm = document.getElementById('searchAsRegExp');

        var reLabelElm = document.getElementById('searchAsRegExpLabel');
        reLabelElm.innerHTML = regExpLabel;

        if (cInitCfg.replaceElm) {
            doReplaceElm = document.getElementById('doReplaceCheckBox');

            replaceElm = document.getElementById('replaceInput');
            replaceElm.size = searchElmMinSize;
            eConnect(replaceElm, replaceKeyUp, 'keyup');
            eConnect(replaceElm, replaceOnFocus, 'focus');
            eConnect(replaceElm, replaceOnBlur, 'blur');
        }

        searchBtnElm = document.getElementById('searchBtn');
        searchBtnIconElm = document.getElementById('searchBtnIcon');
        searchBtnElm.onclick = beginSearch;

        codePageElm = document.getElementById('codePage');
        if(cInitCfg.codePage) codePageElm.value = cInitCfg.codePage;
        codePageElm.onchange = function() {
            confirmOnTextChanged(codePageElm, cInitCfg.codePage, reDrawLog);
        };
        M.FormSelect.init(codePageElm, {});
    }


    function searchReverse(reverse) {
        searchBackElm.checked = reverse;
    }

    function replaceOnFocus() {
        if (searchElm.size !== searchElmMinSize) searchElm.size = searchElmMinSize;
        if (replaceElm.size !== searchElmMaxSize) replaceElm.size = searchElmMaxSize;
    }

    function replaceOnBlur() {
        if (searchElm.size !== searchElmMaxSize) searchElm.size = searchElmMaxSize;
        if (replaceElm.size !== searchElmMinSize) replaceElm.size = searchElmMinSize;
    }

    function replaceKeyUp(elm, event) {
        var keyCode = ('which' in event) ? event.which : event.keyCode;
        if (keyCode === 27) replaceElm.value = ''; //Esc
        else if (keyCode === 13) beginSearch();

        if (replaceElm.value) {
            if(!doReplaceElm.checked) doReplaceElm.checked = true;
            searchBackElm.checked = false;
            searchUpArrowElm.innerHTML = replaceAllLabel;
        } else doReplaceElm.checked = false;

        if (!doReplaceElm.checked) {
            searchUpArrowElm.innerHTML = searchBackLabel;
            searchBackElm.checked = false;
        }
    }

    function searchOnKeyUp(elm, event) {
        var keyCode = ('which' in event) ? event.which : event.keyCode;
        if (keyCode === 27)//Esc
        {
            elm.value = '';
            beginSearch();
        } else if (keyCode === 13) beginSearch();

        if (doReplaceElm.checked) searchUpArrowElm.innerHTML = replaceAllLabel;
        else searchUpArrowElm.innerHTML = searchBackLabel;
    }

    function beginSearch() {
        var replaceStr = replaceElm ? replaceElm.value : '';
        var doReplace = doReplaceElm ? doReplaceElm.checked : false;
        var searchStr = searchElm.value;
        try {
            if (!reElm.checked) searchStr = searchStr.replace(/([:()\[\]\\.^$|?+])/gm, '\\$1');
        } catch (e) {
        }
        mainObject.Search(searchStr, searchBackElm.checked, replaceStr, doReplace);
    }

    function eConnect(element, handler, event, args) {
        try {
            // all browsers except IE before version 9
            if (element.addEventListener) element.addEventListener(event, function (e) {
                handler(element, e, args);
            }, false);
            // IE before version 9
            else if (element.attachEvent) element.attachEvent('on' + event, function (e) {
                handler(element, e, args);
            });
        } catch (e) {
            var elm = '';
            if (element && 'outerHTML' in element) elm = element.outerHTML;
            alert('Can\'t set event handler "on' + event + '" to the ' + elm + ': ' + e.message);
        }
    }

    function confirmOnTextChanged(elm, prevValue, callback) {
        if(typeof mainObject.isChanged === 'function' && mainObject.isChanged()) {
            if(confirm('The text has been modified but not saved. Discard all changes?')) callback();
            else {
                elm.value = prevValue;
                M.FormSelect.init(elm, {});
                if( typeof mainObject.focus === 'function') setTimeout(mainObject.focus, 100)
            }
        } else {
            callback();
        }
    }

    function selectService(callback) {
        var objects = cInitCfg.objects || parameters.objects;
        if (!objects || !objects.length) return callback(null, cInitCfg.serviceName);

        selectFileElm.onchange = function() {
            confirmOnTextChanged(selectFileElm, cInitCfg.fileName, function () {
                selectFileName(callback);
            });
        };

        selectServiceElm.innerHTML = '';
        if (objects.length > 0) {
            objects = objects.sort(function (a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) });
            for (var i = 0; i < objects.length; i++) {
                var optionElm = new Option(objects[i].name, objects[i].id);
                if (i === 0) {
                    optionElm.selected = true;
                    cInitCfg.serviceName = objects[i].name;
                }
                selectServiceElm.options.add(optionElm);
            }
            selectServiceElm.onchange = function () {
                confirmOnTextChanged(selectServiceElm, cInitCfg.objectID, function () {
                    selectFile(callback);
                });
            };
        }
        M.FormSelect.init(selectServiceElm, {});
        selectFile(callback);
    }

    function selectFile(callback) {
        cInitCfg.objectID = selectServiceElm.options[selectServiceElm.selectedIndex].value;
        cInitCfg.serviceName = selectServiceElm.options[selectServiceElm.selectedIndex].innerHTML;

        getFilesList(cInitCfg.objectID, function() {
            selectFileElm.innerHTML = '';

            var selectedUncPathFile;
            for (var i = 0; i < fileList[cInitCfg.objectID].length; i++) {
                var items = fileList[cInitCfg.objectID][i].split('\r'); //ID\r<uncdir>\r<file>
                if (items[1] === undefined || items[2] === undefined) continue;
                var uncPathFile = items[1] + '\\' + items[2];
                var fileName = items[2];

                var optionElm = new Option(fileName, uncPathFile);
                if (!selectedUncPathFile && prevFileName && compareFileNames(fileName, prevFileName)) {
                    optionElm.selected = true;
                    selectedUncPathFile = uncPathFile;
                }
                selectFileElm.options.add(optionElm);
            }
            M.FormSelect.init(selectFileElm, {});

            if (!prevFileName) prevFileName = (fileList[cInitCfg.objectID][0].split('\r'))[2];

            selectFileName(callback);
        });
    }

    function selectFileName(callback) {
        if(!selectFileElm.options.length) return callback(null, cInitCfg.serviceName);

        prevFileName = selectFileElm.options[selectFileElm.selectedIndex].innerHTML;
        callback(selectFileElm.options[selectFileElm.selectedIndex].value, cInitCfg.serviceName)
    }

    function compareFileNames(f1, f2) {
        // compare file names or file names without digits
        return f1.toLowerCase() === f2.toLowerCase() || f1.replace(/\d/g, '').toLowerCase() === f2.replace(/\d/g, '').toLowerCase();
    }

    function getFilesList(ID, callback) {
        var ai = new AJAXInteraction('', script, function (raw) {
            var List = raw.split('\n');

            if (List.length < 1) {
                setTimeout(getFilesList, 30000, ID, callback);
                return callback(false);
            }
            fileList[ID] = [];
            for (var i = 0; i < List.length; i++) if (List[i]) fileList[ID].push(List[i]); //ID\r<uncdir>\r<file>

            callback(true);
        }, true);
        ai.doPost('function=getFilesList&IDs=' + ID);
    }
}
