/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

function Editor(initCfg) {

    var script = parameters.action.link + '/ajax';

    var c = {};
    var c_default = {
        IDForm: 'EditorForm',
        IDParent: 'tmodule',
        IDChangeSizeCB: 'chListHide',

        // If you change RegExp here,  correct same RegExt in GetFileSimple function in get.pl
        // it used for hide password in a temp file, while user press on link for show it
        diffReplacePasswordRE: '(pass[^\=]*=\s*).*?$',

        iniMode: 'properties',

        heightCorrection: 0,
        widthCorrection: 0,

        searchBackground: '#000000',
        searchFontcolor: '#DDDD00',

        fileName: './config/conf.json'
    };

    var searchStr = '';
    var isTextChanged = false;

    var editor;
    var formElm;
    var textareaElm;
    var textareaSav;
    var resultElm;
    var changesElm;

    var codeMirrorExt = {
        '(\.xml)': 'xml',
        '(\.ini)|(\.dcs)|(\.data)|(\.cfg)': 'properties',
        '(\.bat)|(\.cmd)': 'cmd',
        '(\.json)': 'javascript'
    };
    //var codemirror = parameters.action.link+'/static/CodeMirror-2.25';
    var codemirror = '/codemirror';

    init(initCfg);

    function init(initCfg) {
        c = {};
        for (var key in c_default) c[key] = c_default[key];
        for (key in initCfg) c[key] = initCfg[key];

        c.id = '_' + c.IDForm + Math.floor(Math.random() * (1000000));

        try {
            var parentElm = document.getElementById(c.IDParent);
        } catch (e) {
            alert('Can\'t find parent element with ID "' + c.IDParent + '" for set size: ' + e.message);
            return;
        }


        try {
            formElm = document.getElementById(c.IDForm);
            formElm.id = c.IDForm + c.id;
            c.heightCorrection += formElm.offsetHeight;
        } catch (e) {
            alert('Can\'t initialize element with ID: ' + c.IDForm + ': ' + e.message);
            return;
        }

        try {
            resultElm = document.getElementById(c.IDResult);
            resultElm.id = 'result_' + c.id;
            resultElm.style.display = 'none';
        } catch (e) {
            alert('Can\'t initialize element for saving result of save file operation with ID: ' + c.IDResult + ': ' + e.message);
            return;
        }

        try {
            changesElm = document.getElementById(c.IDChanges);
            changesElm.id = 'changes_' + c.id;
            changesElm.style.display = 'none';
        } catch (e) {
            alert('Can\'t initialize element for saving result of changes in file with ID: ' + c.IDChanges + ': ' + e.message);
            return;
        }

        textareaElm = document.createElement('textarea');
        textareaElm.style.display = 'none';


        var editElm = document.createElement('div');
        editElm.style.backgroundColor = '#FFFFFF';
        editElm.tabindex = 1;
        editElm.style.clear = 'both';
        formElm.appendChild(editElm);

        window.onload = function () {
            initCodeMirror(editElm, textareaElm, parentElm);
        };
        if (document.readyState === "complete") initCodeMirror(editElm, textareaElm, parentElm);
    }

    this.set = function (initFileName, serviceName, codePage) {
        c.serviceName = serviceName;
        c.fileName = initFileName;

        var mode = findCMHighlighter();
        CodeMirror.modeURL = codemirror + '/mode/%N/%N.js';
        editor.setOption("mode", mode);
        CodeMirror.autoLoadMode(editor, mode);
        if(!c.fileName) text2Editor();
        else loadFilePart(codePage);
    };

    this.isChanged = function() { return isTextChanged; };

    this.del = function () {
        try {
            editor.getWrapperElement().parentNode.removeChild(editor.getWrapperElement());
            formElm.id = c.IDForm;
            resultElm.id = c.IDResult;
            resultElm.value = '';
            changesElm.id = c.IDChanges;
            changesElm.value = '';
            formElm.removeChild(textareaElm.parentNode);
            textareaElm.value = '';
            editor.setValue(textareaSav);
        } catch (e) {
        }
    };

    this.Search = function (initSearchStr, SearchBack, replaceStr, doReplace) {
        if (searchStr !== initSearchStr) CMClearSearch(editor);
        searchStr = initSearchStr;
        if (!initSearchStr) return;

        try {
            var reSearch = new RegExp(searchStr, 'gmi');
        } catch (e) {
            searchStr = searchStr.replace(/([:()\[\]\\.^$|?+])/gm, "\\$1");
            try {
                reSearch = new RegExp(searchStr, 'gmi');
            } catch (e) {
                alert('Error inRegExp ' + initSearchStr + ' (also tried escaped RegExp: ' + searchStr + '): ' + e.message);
                return;
            }
        }
        if (doReplace) CMReplace(editor, reSearch, replaceStr, SearchBack);
        else CMSearchText(editor, reSearch, SearchBack);
    };

    this.saveFile = saveFile;

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

    function setSize(Elm, parentElm, e) {
//alert('!!!');
// Event onResize on window occured
        if (Elm === window) {
            if ((e.bodyHeight === window.document.body.clientHeight && e.bodyWidth === window.document.body.clientWidth)) return;
            e.bodyHeight = window.document.body.clientHeight;
            e.bodyWidth = window.document.body.clientWidth;
            e.parentChangeSize = false;
            setTimeout(function () {
                setSize(e.Elm, e.parentElm, e)
            }, 1000);
            return;
        }

        if (e && e.parentChangeSize) {
            setTimeout(function () {
                setSize(Elm, parentElm)
            }, 1000);
            return;
        }

        if (e && (e.bodyHeight !== window.document.body.clientHeight || e.bodyWidth !== window.document.body.clientWidth)) return;

// Resize first time
        if (!e) {
            e = {};
            e.Elm = Elm;
            e.parentElm = parentElm;
            eConnect(window, setSize, 'resize', e);
        }

        if (window.getComputedStyle) var styleParentElm = getComputedStyle(parentElm, '');
// For OLD fucking IE
        else {
            Elm.style.height = '100px';
            Elm.style.width = '100px';
            Elm.style.height = parentElm.offsetHeight - c.heightCorrection - 20;
            Elm.style.width = parentElm.offsetWidth - c.widthCorrection - 20;
            SetCodemirrorSize(Elm);
            return;
        }

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.width = '0px';
            Elm.style.height = '0px';
        } else {
            Elm.setAttribute('height', '0px');
            Elm.setAttribute('width', '0px');
        }
        var parentHeight = parentElm.style.height;
        var parentWidth = parentElm.style.width;


        var maxHeight = Number(styleParentElm.height.replace(/(\d+).*/, "$1"));
        var maxWidth = Number(styleParentElm.width.replace(/(\d+).*/, "$1"));
        parentElm.style.height = maxHeight;
        parentElm.style.width = maxWidth;
        maxHeight += maxHeight - Number(styleParentElm.height.replace(/(\d+).*/, "$1"));
        maxWidth += maxWidth - Number(styleParentElm.width.replace(/(\d+).*/, "$1"));
        parentElm.style.height = maxHeight;
        parentElm.style.width = maxWidth;
//alert(maxHeight+'x'+maxWidth+' '+parentElm.offsetHeight+'x'+parentElm.offsetWidth);

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.height = maxHeight + 'px';
            Elm.style.width = maxWidth + 'px';
        } else {
            Elm.setAttribute('height', maxHeight + 'px');
            Elm.setAttribute('width', maxWidth + 'px');
        }

        maxHeight -= Number(styleParentElm.height.replace(/(\d+).*/, "$1")) - maxHeight + c.heightCorrection;
        maxWidth -= Number(styleParentElm.width.replace(/(\d+).*/, "$1")) - maxWidth + c.widthCorrection;

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.height = maxHeight + 'px';
            Elm.style.width = maxWidth + 'px';
        } else {
            Elm.setAttribute('height', maxHeight + 'px');
            Elm.setAttribute('width', maxWidth + 'px');
        }

        parentElm.style.height = parentHeight;
        parentElm.style.width = parentWidth;

        e.bodyHeight = window.document.body.clientHeight;
        e.bodyWidth = window.document.body.clientWidth;
        SetCodemirrorSize(Elm);
    }

    function loadFilePart(codePage, callback) {
        var prms = 'function=getFilePart&fileName=' + encodeURIComponent(c.fileName) + '&codePage=' + codePage;
        var ai = new AJAXInteraction('', script, function (text) {
            textareaSav = text;
            text2Editor(text);
            if(typeof callback === 'function') callback(text);
        }, true);
        ai.doPost(prms);
    }

    function text2Editor(text) {
        if (text === '{}' || !text) text = (c.fileName ? 'Error while processing file ' + c.fileName : 'Can\'t found files') + ' for service ' + c.serviceName;
        else text = text.slice(Number(text.indexOf('\n', text.indexOf('\n') + 1) + 1), text.length);

        text = text.split('\r').join('');
// when submit, textareaElm.value set to result of editing
        textareaElm.value = text;

        editor.setValue(text);
        resultElm.value = '';
        changesElm.value = '';
        isTextChanged = false;
    }

    function initCodeMirror(editElm, textareaElm, parentElm) {
        setSize(editElm, parentElm);
        editElm.appendChild(textareaElm);
        if (c.callBackSearchReverse && typeof (c.callBackSearchReverse) === "function") c.callBackSearchReverse(false);

        editor = CodeMirror.fromTextArea(textareaElm,
            {
                mode: 'text/html',
                lineNumbers: true,
                fixedGutter: true,
                matchBrackets: true,
                autofocus: true,
                onCursorActivity: function () {
                    editor.matchHighlight('CodeMirror-searching');
                }/*,
                extraKeys:
                    {
                        'Ctrl-S': function () {
                            saveFile();
                            try {
                                mformElm.submit()
                            } catch (e) {
                                alert('Cant save file. Please press a button for it. Sorry.\n' + e.message)
                            }
                        },
                        'F2': function () {
                            saveFile();
                            try {
                                mformElm.submit()
                            } catch (e) {
                                alert('Cant save file. Please press a button for it. Sorry.\n' + e.message)
                            }
                        }
                    }

                 */
            });
        SetCodemirrorSize(editElm);

        var mode = findCMHighlighter();
        CodeMirror.modeURL = codemirror + '/mode/%N/%N.js';
        editor.setOption("mode", mode);
        CodeMirror.autoLoadMode(editor, mode);

        if(!c.fileName) text2Editor();
        else loadFilePart(null, function(_textareaSav) {
            setTimeout(function() {
                editor.on('change', function() {
                    isTextChanged = true;
                });
            }, 500);
        });
    }

    function saveFile(callback) {
        var text = editor.getValue();

        var isIniFileFormat = (findCMHighlighter() === c.iniMode);
        var diffResult = diff(textareaSav, text, isIniFileFormat);
        if (!diffResult[1]) diffResult = [' Изменений нет<br>', ' Изменений нет\n'];
        if (c.useTextResult) var result = c.fileName + '\nСделаны следующие изменения:\n' + diffResult[1];
        else result = c.fileName + '<br>Сделаны следующие изменения:<br>' + diffResult[0];
        try {
            changesElm.innerHTML = result;
        } catch (e) {
        }
        changesElm.value = result;

        try {
            resultElm.innerHTML = text;
        } catch (e) {
        }
        resultElm.value = text;

        callback();
    }

    function diff(t1, t2, isIniFileFormat, origTextStrsCnt) {
        var text1 = t1.split('\n');
        var text2 = t2.split('\n');
        var changes = [];
        for (var i = 0, j = 0; i < text1.length || j < text2.length; i++, j++) {
            if (text1[i] === text2[j]) continue;
            var isBreak = false;
            for (var pos1 = i; pos1 <= text1.length; pos1++) {
                for (var pos2 = j; pos2 <= text2.length; pos2++) {
                    if (text1[pos1] !== text2[pos2]) continue;
                    isBreak = true;
                    for (var delta = 1; delta < 3; delta++) {
                        if ((pos1 + delta) === text1.length || (pos2 + delta) === text2.length || text1[pos1 + delta] !== text2[pos2 + delta]) {
                            isBreak = false;
                            break;
                        }
                    }

                    if (isBreak) break;
                }
                if (isBreak) break;
            }
            changes.push([i, pos1, j, pos2]);
            i = pos1;
            j = pos2;
        }

        var changeLogHTML = '';
        var changeLog = '';
        for (i = 0; i < changes.length; i++) {
// For understanding
            var firstStr1 = changes[i][0];
            var lastStr1 = changes[i][1];
            var firstStr2 = changes[i][2];
            var lastStr2 = changes[i][3];
            delta = firstStr2 - firstStr1;
            if (!origTextStrsCnt) {
                if (isIniFileFormat) origTextStrsCnt = 2;
                else origTextStrsCnt = 5;
            }
            if ((firstStr1 - origTextStrsCnt) < 0) var origTextStrs = firstStr1;
            else origTextStrs = origTextStrsCnt;
//			changeLogHTML += '<br><span style="font-weight:bold;">Строка '+(firstStr1-origTextStrs)+', фрагмент '+firstStr1+'-'+lastStr1+'=&gt;'+firstStr2+'-'+lastStr2+':</span><br><span style="font-style:italic;">';
//			changeLog += '\nСтрока '+(firstStr1-origTextStrs)+', фрагмент '+firstStr1+'-'+lastStr1+'=>;'+firstStr2+'-'+lastStr2+':\n';

            changeLogHTML += '<br><span style="font-weight:bold;">Изменения сделаны в строках ' + firstStr1 + '-' + lastStr1 + ' исходного и ' + firstStr2 + '-' + lastStr2 + ' отредактированного файлов:</span><br><span style="font-style:italic;">';
            changeLog += '\nИзменения сделаны в строках ' + firstStr1 + '-' + lastStr1 + ' исходного и ' + firstStr2 + '-' + lastStr2 + ' отредактированного файлов:\n';

            var tryToFindSectionName = isIniFileFormat;
            var sectionName = '';
            var strs = '';
            for (p = firstStr1 - origTextStrs; p < firstStr1; p++) {
                if (tryToFindSectionName && /^\[[^\]]+]/.test(text1[p]))
                    tryToFindSectionName = false;
                strs += text1[p] + '\n';

            }

// try to find section name
            for (p = firstStr1 - origTextStrs; tryToFindSectionName && p >= 0; p--) {
                if (/^\[[^\]]+]/.test(text1[p])) {
                    sectionName += text1[p] + '\n';
//if any stings is present after section name to the first string of original text, then add '...'
                    if (p < firstStr1 - origTextStrs - 1) sectionName += '...\n';
                    break;
                }
            }

            changeLogHTML += toHTML(sectionName) + toHTML(strs);
            changeLog += sectionName + strs;

// \n before </span> needed for RE when password changed to *****
            changeLogHTML += '\n</span><br>';
            for (p = Math.min(firstStr1, firstStr2); p < Math.max(lastStr1, lastStr2); p++) {
// delta can be a negative and lastStr1 can be greater then lastStr1+delta
                if (p >= firstStr1 && p < lastStr1) {
                    if (p >= firstStr2 && p < lastStr2 && p >= firstStr1 + delta && p < lastStr1 + delta) {
                        changeLogHTML += '<span style="text-decoration:line-through;">' + toHTML(text1[p]) + '\n</span><br><span style="font-weight:bold;">' + toHTML(text2[p]) + '</span><br>';
                        changeLog += 'заменить"' + text1[p] + '"\nна строку"' + text2[p] + '"\n';
                    } else if (p < firstStr2 || p >= lastStr2) {
                        changeLogHTML += '<span style="text-decoration:line-through;">' + toHTML(text1[p]) + '\n</span><br>';
                        changeLog += 'удалить"' + text1[p] + '"\n';
                    }
                } else if (p >= firstStr2 && p < lastStr2) {
                    changeLogHTML += '<span style="font-weight:bold;">' + toHTML(text2[p]) + '\n</span><br>';
                    changeLog += 'добавить"' + text2[p] + '"\n';
                }
            }
            changeLogHTML += '<span style="font-style:italic;">';
            for (var p = lastStr1; p < lastStr1 + origTextStrsCnt && p < text1.length; p++) {
                changeLogHTML += toHTML(text1[p]) + '<br>';
                changeLog += text1[p] + '\n';
            }
            changeLogHTML += '\n</span><br>';
        }

        try {
            var passwordRE = new RegExp(c.diffReplacePasswordRE, 'img');
            changeLogHTML = changeLogHTML.replace(passwordRE, '$1*******');
            changeLog = changeLog.replace(passwordRE, '$1*******');
        } catch (err) {
            alert('Error while compile RegExp for hiding password in e-mail:' + err.message);
        }

		return([changeLogHTML.replace(/\n/g, ''), changeLog]);
//        return ([changeLog, changeLog]);

        function toHTML(str) {
            return (str.replace(/</gm, '&lt').replace(/>/gm, '&gt').replace(/["']/gm, '&quot').replace(/\n/gm, '<br>'));
        }

    }

    function SetCodemirrorSize(elm) {
        // for codemirror version >= 2.31
        try {
            editor.setSize(elm.clientWidth, elm.clientHeight);
            elm.style.overflow = 'hidden';
        } catch (e) {
            var divs = document.getElementsByTagName("DIV");
            for (var i = 0; i < divs.length; i++) {
                if (/CodeMirror-scroll/.test(divs[i].className)) {
                    divs[i].style.height = elm.clientHeight;
                    divs[i].style.width = elm.clientWidth;
                }
            }
            elm.style.overflowY = 'hidden';
        }
    }

    function findCMHighlighter() {
        for (var FileExtRE in codeMirrorExt) {
            var re = new RegExp(FileExtRE, 'i');
            if (re && re.test(c.fileName)) return codeMirrorExt[FileExtRE];
        }
        return null;
    }

    function CMSearchText(cm, query, rev) {
        var state = CMGetSearchState(cm);
        if (state.query) return CMFindNext(cm, rev);

        cm.operation(function () {
            if (!query || state.query) return;
            state.query = query;
            if (cm.lineCount() < 2000) { // This is too expensive on big documents.
                for (var cursor = cm.getSearchCursor(query); cursor.findNext();)
                    state.marked.push(cm.markText(cursor.from(), cursor.to(), "CodeMirror-searching"));
            }
            state.posFrom = state.posTo = cm.getCursor();
            CMFindNext(cm, rev);
        });
    }

    function CMFindNext(cm, rev) {
        cm.operation(function () {
            var state = CMGetSearchState(cm);
            var cursor = cm.getSearchCursor(state.query, rev ? state.posFrom : state.posTo);
            if (!cursor.find(rev)) {
                cursor = cm.getSearchCursor(state.query, rev ? {line: cm.lineCount() - 1} : {line: 0, ch: 0});
                if (!cursor.find(rev)) {
                    alert("Nothing found");
                    return;
                }
            }
            cm.setSelection(cursor.from(), cursor.to());
            state.posFrom = cursor.from();
            state.posTo = cursor.to();
        })
    }

    function CMSearchState() {
        this.posFrom = this.posTo = this.query = null;
        this.marked = [];
    }

    function CMGetSearchState(cm) {
        return cm._searchState || (cm._searchState = new CMSearchState());
    }

    function CMReplace(cm, query, text, all) {
        if (!query) return;
        var count = 0;
        if (all) {
            cm.operation(function () {
                for (var cursor = cm.getSearchCursor(query); cursor.findNext(); count++) {
                    if (typeof query != "string") {
                        var match = cm.getRange(cursor.from(), cursor.to()).match(query);
                        // closure for match
                        (function(match) {
                            cursor.replace(text.replace(/\$(\d)/, function (w, i) {
                                return match[i];
                            }));
                        })(match);
                    } else cursor.replace(text);
                }
            });
            if (count) alert('Search completed, number of replacements: ' + count);
            else alert('Nothing found');
        } else {
            CMClearSearch(cm);
            var cursor = cm.getSearchCursor(query, cm.getCursor());

            advance(function(count) {
                if (count) alert('Search completed, number of replacements: ' + count);
                else alert('Nothing found');
            });

            function advance(callback) {
                var start = cursor.from(), match;
                if (!(match = cursor.findNext())) {
                    cursor = cm.getSearchCursor(query);
                    if (!(match = cursor.findNext()) || (!start) ||
                        (cursor.from().line === start.line && cursor.from().ch === start.ch)) return callback(count);
                }
                cm.setSelection(cursor.from(), cursor.to());

                // waiting for change cursor position and make new selection
                setTimeout(function() {
                    if (confirm('Replace "' + match[0] + '" in line "' + match.input + '" with ' + ( text ? '"' + text + '"' : 'empty string' )+ '?')) {
                        ++count;
                        cursor.replace(typeof query === "string" ? text : text.replace(/\$(\d)/, function (w, i) {
                            return match[i];
                        }));

                        advance(callback);
                    } else return callback(count);
                }, 50);
            }
        }
    }

    function CMClearSearch(cm) {
        cm.operation(function () {
            var state = CMGetSearchState(cm);
            if (!state.query) return;
            state.query = null;
            for (var i = 0; i < state.marked.length; ++i) state.marked[i].clear();
            state.marked.length = 0;
        })
    }
}

function AJAXInteraction(prefix, script, callback, async, args) {
// test for IE
    var isIE = Boolean(navigator.userAgent.indexOf('Trident') + 1) || Boolean(navigator.userAgent.indexOf('MSIE') + 1);
    var req = init();

    if (!req || !callback || !(typeof (callback) === "function")) return false;

    function init() {
        var r = false;
        if (window.XMLHttpRequest && (r = new XMLHttpRequest())) {
            r.onreadystatechange = processRequest;
        } else if (window.ActiveXObject && (r = new ActiveXObject("Microsoft.XMLHTTP"))) {
            r.onreadystatechange = processRequest;
        }
        return r;
    }

    function processRequest() {
        if (req.readyState === 4 && req.status === 200) callback(req.responseText, args);
    }

    this.doGet = function () {
//add random to paramenetrs for switch off caching in IE
        if (isIE) {
            if (script.indexOf('?') === -1) script += '?';
            else script += '&';
            script += 'nocacheIE=' + encodeURIComponent(Math.random());
        }
        try {
            req.open("GET", prefix + script, async);
        } catch (e) {
            req.open("GET", script, async);
        }
        try {
            req.withCredentials = true;
        } catch (e) {
        }
        req.send();
    };

    this.doPost = function (body) {
        try {
            req.open("POST", prefix + script, async);
        } catch (e) {
            req.open("POST", script, async);
        }
        if ('setRequestHeader' in req) req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        try {
            req.withCredentials = true;
        } catch (e) {
        }
//add random to paramenetrs for switch off caching in IE
        if (isIE) {
            if (body) body += '&';
            else if (body === undefined) body = '';
            body += 'nocacheIE=' + encodeURIComponent(Math.random());
        }
        req.send(body);
    }
}
