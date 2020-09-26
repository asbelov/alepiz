/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


var editorObj;
Menu(parameters.action.options, Editor, function(obj) {
    editorObj = obj;
});

function callbackBeforeExec(callback) {
    if(editorObj && typeof editorObj.saveFile === 'function') editorObj.saveFile(callback);
    else callback(new Error('Editor is not initialised'));
}