/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 08.08.2015.
 */

// set stylesheet in HTML head and javascripts
__initPugEditor();

// parentID: string - ID of parent element
// height: min height
function pugEditor(c){

    if(c.parentID) var codeMirrorElm = document.getElementById(c.parentID);
    else codeMirrorElm = document.body;

    if(!c.height) c.height = 300;

    var editor = new CodeMirror.fromTextArea(codeMirrorElm, {
        pollInterval: 100,
        lineNumbers: true,
        showCursorWhenSelecting: true,
        showTrailingSpace: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        highlightSelectionMatches: {showToken: /\w/},
        extraKeys: {
            "Ctrl-Space": 'autocomplete',
            "Ctrl-Y": 'deleteLine',
            "Tab": function(cm) {
                cm.replaceSelection("    " , "end");
            },
        },
        mode: {name: "pug", alignCDATA: true},
    });
    setSize(editor);

    editor.on('change', setSize);

    editor.on('keypress', function(cm/*, e*/){
        var currentPosition = cm.getCursor();

        var firstChar = cm.findWordAt(currentPosition).anchor;
        var lastChar = cm.findWordAt(currentPosition).head;
        var currentWord = cm.getRange(firstChar, lastChar);

        if(currentWord.length && currentWord.match(/\w/)){
            CodeMirror.showHint(cm, null, {completeSingle: false});
        }
    });

    editor.refresh();
    editor.init = function() {
        setSize(editor);
        editor.refresh();
    }
    return editor;

    function setSize(cm) {
        if (cm.lineCount() < c.height/cm.defaultTextHeight()) cm.setSize(null, c.height);
        else cm.setSize(null, 'auto');
    }
}

function __initPugEditor() {
    var cssFile = [
        '/codemirror/lib/codemirror.css',
        '/codemirror/addon/fold/foldgutter.css',
        '/codemirror/addon/hint/show-hint.css',
        '/codemirror/addon/lint/lint.css',
        '/stylesheets/codemirror.css'
    ];

    var jsFile = [
        '/codemirror/lib/codemirror.js',
        '/codemirror/mode/javascript/javascript.js',
        '/codemirror/mode/css/css.js',
        '/codemirror/mode/xml/xml.js',
        '/codemirror/mode/htmlmixed/htmlmixed.js',
        '/codemirror/mode/pug/pug.js',

        '/codemirror/addon/hint/show-hint.js',
        '/codemirror/addon/hint/anyword-hint.js',

        '/codemirror/addon/edit/closebrackets.js',
        '/codemirror/addon/edit/matchbrackets.js',
        '/codemirror/addon/edit/trailingspace.js',

        '/codemirror/addon/search/searchcursor.js',
        '/codemirror/addon/search/match-highlighter.js'
    ];

    var headElm = document.getElementsByTagName('head')[0];
    var linkElms = headElm.getElementsByTagName('link');

    for(var i = 0; i < cssFile.length; i++) {
        var isHasThisStylesheet = false;
        for(var j=0; j<linkElms.length; j++) {
            if(linkElms[j].getAttribute('href') && linkElms[j].getAttribute('href').toLowerCase() === cssFile[i].toLowerCase()) {
                isHasThisStylesheet = true;
                //console.log('skipe '+cssFile[i]);
                break;
            }
        }
        if(isHasThisStylesheet) continue;

        var css = document.createElement("link");
        css.setAttribute("rel", "stylesheet");
        css.setAttribute("type", "text/css");
        css.setAttribute("href", cssFile[i]);
        headElm.appendChild(css);
    }

    var jsElms = document.getElementsByTagName('script');
    for(i=0; i<jsFile.length; i++)
    {
        var isHasThisJS = false;
        for(j=0; j<jsElms.length; j++) {
            if(jsElms[j].getAttribute('src') && jsElms[j].getAttribute('src').toLowerCase() === jsFile[i].toLowerCase()) {
                isHasThisJS = true;
                //console.log('skipe '+jsFile[i]);
                break;
            }
        }
        if(isHasThisJS) continue;
        document.write('<script type="text/javascript" src="'+jsFile[i]+'"></script>');
    }
}