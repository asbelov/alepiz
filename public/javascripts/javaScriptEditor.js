/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 08.08.2015.
 */

// set stylesheet in HTML head and javascripts
__initJavaScriptEditor();

// parentID: string - ID of parent element
// height: min height
function javaScriptEditor(c){

    if(c.parentID) var codeMirrorElm = document.getElementById(c.parentID);
    else codeMirrorElm = document.body;

    var jsonMode = !!c.jsonMode;

    if(!c.height) c.height = 300;

    if(jsonMode) {
        var editor = CodeMirror.fromTextArea(codeMirrorElm, {
            lineNumbers: true,
            lint: true,
            gutters: ["CodeMirror-lint-markers"],
            mode: "application/json",
        });
    } else {

        editor = CodeMirror.fromTextArea(codeMirrorElm, {
            pollInterval: 100,
            lineNumbers: true,
            indentUnit: 4,
            showCursorWhenSelecting: true,
            showTrailingSpace: false,
            autoCloseBrackets: true,
            matchBrackets: true,
            continueComments: true,
            // JSHint Options: https://jshint.com/docs/options/
            lint: {
                esversion: 6,
                multistr: true,
                funcscope: true,
            },
            lintOnChange: false,
            highlightSelectionMatches: {showToken: /\w/},
            extraKeys: {
                "Ctrl-Space": 'autocomplete',
                "Ctrl-Y": 'deleteLine'
            },
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter", "CodeMirror-lint-markers"],
            //mode: jsonMode ? {name: "javascript", globalVars: true, json: jsonMode} : "application/json",
            mode: {name: "javascript", globalVars: true, json: jsonMode},
        });
    }

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

function __initJavaScriptEditor() {
    jsonlint = {};

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

        '/codemirror/addon/fold/foldcode.js',
        '/codemirror/addon/fold/foldgutter.js',
        '/codemirror/addon/fold/brace-fold.js',
        '/codemirror/addon/fold/comment-fold.js',

        '/codemirror/addon/hint/show-hint.js',
        '/codemirror/addon/hint/javascript-hint.js',
        '/codemirror/addon/hint/anyword-hint.js',

        '/codemirror/addon/edit/closebrackets.js',
        '/codemirror/addon/edit/matchbrackets.js',
        '/codemirror/addon/edit/trailingspace.js',

        '/codemirror/addon/search/searchcursor.js',
        '/codemirror/addon/search/match-highlighter.js',

        '/jshint/dist/jshint.js',
        'javascripts/jsonLint.js',
        '/codemirror/addon/lint/lint.js',
        '/codemirror/addon/lint/javascript-lint.js',
        '/codemirror/addon/lint/json-lint.js',

        '/codemirror/addon/comment/continuecomment.js'
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