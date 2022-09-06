/*
* Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 04.09.2022, 22:55:38
*/

function callbackBeforeExec(callback) {
	JQueryNamespace.beforeExec(callback);
}

JQueryNamespace = (function ($) {
    var serverURL = parameters.action.link+'/ajax'; // path to ajax
    var confEditor;

    $(function () {
        confEditor = javaScriptEditor({parentID: 'config', jsonMode: true});
        var actionEditor = javaScriptEditor({parentID: 'actionEditor', jsonMode: true});
        var navBarLinksEditor = javaScriptEditor({parentID: 'navBarLinksEditor', jsonMode: true});
        var groupEditor = javaScriptEditor({parentID: 'groupEditor', jsonMode: true});
        
        M.Tabs.init(document.getElementById('mainTabs'), {});
        $.post(serverURL, {func: 'getConfig'}, function(data) {

            if(!data.config || !data.config.config) data.config = '{}';

            try {
                var config = JSON.parse(data.config.config)
            } catch (err) {
                console.error('Can\'t parse user configuration:', err.message, ': ', data.config.config);
                config = data.config.config;
            }

            confEditor.setValue(JSON.stringify(config || {}, null, 4));
            actionEditor.setValue(JSON.stringify(data.actionsLayout, null, 4));
            navBarLinksEditor.setValue(JSON.stringify(data.navBarLinks || {}, null, 4));
            groupEditor.setValue(JSON.stringify(data.objectGroups || {}, null, 4));

            /*
            actionEditor.setOption('readOnly', 'nocursor'); will hide the cursor, but you won't be able to copy the
            contents of the editor to the clipboard
             */
            actionEditor.setOption('readOnly', true);
            navBarLinksEditor.setOption('readOnly', true);
            groupEditor.setOption('readOnly', true);
        });

        $('#tabSwitchActions').click(function () {
            setTimeout(function() {actionEditor.init(); }, 100);
        });

        $('#tabSwitchNavBarLinks').click(function () {
            setTimeout(function() {navBarLinksEditor.init(); }, 100);
        });

        $('#tabSwitchGroups').click(function () {
            setTimeout(function() {groupEditor.init(); }, 100);
        });
    });
    
    function beforeExec(callback) {
        confEditor.save();
        callback();
    }

    return {
        beforeExec: beforeExec,
    };
})(jQuery); // end of jQuery name space