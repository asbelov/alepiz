/*
 * Copyright © 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by asbel on 08.08.2015.
 */

var confirmDeleteYes, confirmDeleteNo, confirmRenameYes, confirmRenameNo;

function callbackBeforeExec(callback) {
    if($('#deleteAction').prop("checked")) {

        var modalDeleteConfirmNoElm = $('#modalDeleteConfirmNo'),
            modalDeleteConfirmYesElm = $('#modalDeleteConfirmYes'),
            modalDeleteConfirmElm = $('#modalDeleteConfirm');

        if(confirmDeleteNo) modalDeleteConfirmNoElm.unbind('click', confirmDeleteNo);
        if(confirmDeleteYes) modalDeleteConfirmYesElm.unbind('click', confirmDeleteYes);

        confirmDeleteNo = function() {
            callback(new Error('Delete operation is canceled'));
        };
        confirmDeleteYes = function () {
            callback();
        };

        modalDeleteConfirmNoElm.click(confirmDeleteNo);
        modalDeleteConfirmYesElm.click(confirmDeleteYes);

        modalDeleteConfirmElm.modal({dismissible: false});
        modalDeleteConfirmElm.modal('open');

        return;
    }

    JQueryNamespace.saveToTextarea();

    var actionIDElm = $('#ID');
    if(actionIDElm.val() && actionIDElm.val() !== $('#newActionID').val()) {
        var modalRenameConfirmNoElm = $('#modalRenameConfirmNo'),
            modalRenameConfirmYesElm = $('#modalRenameConfirmYes'),
            modalRenameConfirmElm = $('#modalRenameConfirm');

        if(confirmRenameNo) modalRenameConfirmNoElm.unbind('click', confirmRenameNo);
        if(confirmRenameYes) modalRenameConfirmYesElm.unbind('click', confirmRenameYes);

        confirmRenameNo = function() {
            callback(new Error('Rename operation is canceled'));
        };
        confirmRenameYes = function () {
            callback();
        };

        modalRenameConfirmNoElm.click(confirmRenameNo);
        modalRenameConfirmYesElm.click(confirmRenameYes);

        modalRenameConfirmElm.modal({dismissible: false});
        modalRenameConfirmElm.modal('open');
        return;
    }

    callback();
}


var JQueryNamespace = (function ($) {
    $(function () {
        tabInstance = M.Tabs.init(document.getElementById('mainTabs'), {});
        initJavaScriptEditors();
    });

    var helpEditor, defaultHelpContent;
    var tabInstance;
    var layout, actionsGroupSelectorElm, deleteActionCBElm;
    var serverURL = parameters.action.link+'/ajax';
    var serverJSEditor, ajaxJSEditor, clientJSEditor, homePageEditor, confEditor, defaultContent = {};

    var self = {};
    self.saveToTextarea = function() {
        serverJSEditor.save();
        ajaxJSEditor.save();
        clientJSEditor.save();
        homePageEditor.save();
        confEditor.save();
        if(helpEditor) helpEditor.save();
    };

    return self;

    function initJavaScriptEditors() {
        defaultContent = {
            server: $('#serverJSEditorParent').val(),
            ajax: $('#ajaxJSEditorParent').val(),
            client: $('#clientJSEditorParent').val(),
            homePage: $('#indexPugEditorParent').val(),
            conf: $('#confEditorParent').val()
        };

        var actionSelectorElm = $('#ID');
        actionsGroupSelectorElm = $('#actionsGroup');
        deleteActionCBElm = $('#deleteAction');

        serverJSEditor = javaScriptEditor({parentID: 'serverJSEditorParent'});
        ajaxJSEditor = javaScriptEditor({parentID: 'ajaxJSEditorParent'});
        clientJSEditor = javaScriptEditor({parentID: 'clientJSEditorParent'});
        homePageEditor = pugEditor({parentID: 'indexPugEditorParent'});
        confEditor = javaScriptEditor({parentID: 'confEditorParent', jsonMode: true});

        $('#ajaxJSEditorTab').click(function() {
            setTimeout(function() {ajaxJSEditor.init(); }, 100);
        });

        $('#clientJSEditorTab').click(function() {
            setTimeout(function() { clientJSEditor.init(); }, 100);
        });

        $('#indexPugEditorTab').click(function() {
            setTimeout(function() { homePageEditor.init(); }, 100);
        });

        $('#confEditorTab').click(function() {
            setTimeout(function() { confEditor.init(); }, 100);
        });

        $('#resetBtn').click(function () {
            serverJSEditor.setValue(defaultContent.server);
            ajaxJSEditor.setValue(defaultContent.ajax);
            clientJSEditor.setValue(defaultContent.client);
            homePageEditor.setValue(defaultContent.homePage);
            confEditor.setValue(defaultContent.conf);
            actionSelectorElm.val('');
            actionsGroupSelectorElm.val('');
            $('#newActionID').val('');
            $('#newActionGroup').val('');
            deleteActionCBElm.prop('checked', false).attr('disabled', true);
            M.FormSelect.init(document.querySelectorAll('select'), {});
            initHelp();
        });

        initHelp();

        $.post(serverURL, {func: 'getActions'}, function (obj) {
            var actions = obj.actions;
            layout = obj.layout;
            var options = actions.sort(function (a ,b) {
                if(a.name > b.name) return 1;
                if(a.name < b.name) return -1;
                return 0;
            }).map(function (action) {
                return('<option value="' + action.id + '">' + action.name + '</option>');
            });
            options.unshift('<option value="" selected>New action</option>');
            actionSelectorElm.empty().append(options);

            var actionGroups = Object.keys(layout).map(function (group) {
                return ('<option value="' + group + '">' + group + '</option>');
            });
            actionGroups.unshift('<option value="" selected>New group</option>');
            actionsGroupSelectorElm.empty().append(actionGroups);

            M.FormSelect.init(document.querySelectorAll('select'), {});
            actionSelectorElm.unbind().change(loadData);
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
        });
    }

    function loadData(e) {
        var actionID = e.target.value;

        $('#newActionID').val(actionID || '');

        if(!actionID) {
            deleteActionCBElm.prop('checked', false).attr('disabled', true);
            return;
        }

        deleteActionCBElm.prop('checked', false).attr('disabled', false);

        for(var group in layout) {
            if(layout[group][actionID]) {
                actionsGroupSelectorElm.val(group);
                break;
            }
        }

        // don't use actionID: actionID, it reserved parameter
        $.post(serverURL, {func: 'getFiles', ID: actionID}, function (files) {
            serverJSEditor.setValue(files.server.content);
            ajaxJSEditor.setValue(files.ajax.content);
            clientJSEditor.setValue(files.client.content);
            homePageEditor.setValue(files.homePage.content);
            confEditor.setValue(files.conf.content);
        });

        initHelp(actionID);
    }

    function initHelp(id) {
        var defaultLang = navigator.language || '';
        var langElm = $('#lang'), newLangElm = $('#addLang'), helpEditorElm = $('#helpEditor');

        if (defaultLang) {
            if (defaultLang.indexOf('-') !== -1) defaultLang = defaultLang.split('-')[0];

            if (!id) {
                langElm.empty().append('<option value="' + defaultLang + '">' + defaultLang + '</option>');
                M.FormSelect.init(langElm[0], {});
                defaultHelpContent = helpEditorElm.val();

                $('#help').click(function () {
                    if(!helpEditor) {
                        setTimeout(function () {
                            helpEditor = pugEditor({parentID: 'helpEditor'});
                        }, 100);
                    } else setTimeout(function() {helpEditor.init();}, 100);
                });

                $('#addLangBtn').click(function () {
                    var newLang = newLangElm.val();
                    if(!newLang) return;

                    newLangElm.val('');
                    newLang = newLang.toLowerCase();
                    // select always has this language
                    if(langElm.find('option[value='+newLang+']').length) return;

                    langElm.append('<option value="' + newLang + '" selected>' + newLang + '</option>');
                    M.FormSelect.init(langElm[0], {});
                    if(helpEditor) helpEditor.save();
                    var helpPage = helpEditorElm.val();
                    helpPage = helpPage.replace(/^html *?\((.*?)lang *?= *?["'](..)["']/img, 'html($1lang="' + newLang +'"');
                    helpPage = helpPage.replace(/^html *?\((.*?)xml:lang *?= *?["'](..)["']/img, 'html($1xml:lang="' + newLang +'"');
                    helpEditorElm.val(helpPage);
                    if (helpEditor) {
                        helpEditor.setValue(helpPage);
                        helpEditor.init();
                    }
                });
            }
        }

        if (id) {
            langElm.unbind().change(function (e) {
                loadHelp(id, e.target.value);
            });

            $.post(serverURL, {func: 'getHelpLanguages', name: id}, function (languages) {
                var selectedLang, selected;

                if (Array.isArray(languages)) {
                    langElm.empty();
                    languages.forEach(function (lang) {
                        if (lang.toLowerCase() === defaultLang.toLowerCase()) {
                            selected = ' selected';
                            selectedLang = defaultLang;
                        } else selected = '';
                        langElm.append('<option value="' + lang + '"' + selected + '>' + lang + '</option>');
                    });

                    if (!selectedLang) selectedLang = languages[0];

                    loadHelp(id, selectedLang);
                } else {
                    langElm.empty().append('<option value="' + defaultLang + '">' + defaultLang + '</option>');
                    helpEditorElm.val(defaultHelpContent);
                    if (helpEditor) {
                        helpEditor.setValue(defaultHelpContent);
                        helpEditor.init();
                    }
                }

                M.FormSelect.init(document.querySelectorAll('select'), {});
                M.updateTextFields();
            });
        }

        function loadHelp(id, lang) {
            $.post(serverURL, {
                func: 'getHelpContent',
                name: id,
                lang: lang
            }, function (helpPage) {
                if (!helpPage) helpPage = defaultHelpContent;
                helpEditorElm.val(helpPage);
                if (helpEditor) {
                    helpEditor.setValue(helpPage);
                    helpEditor.init();
                }
            });
        }
    }


})(jQuery); // end of jQuery name space

