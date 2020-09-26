/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var confirmDeleteYes, confirmDeleteNo, confirmRenameYes, confirmRenameNo;

function callbackBeforeExec(callback) {
    if($('#deleteMedia').prop("checked")) {

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

    var mediaNameElm = $('#ID');
    if(mediaNameElm.val() && mediaNameElm.val() !== $('#newMedia').val()) {
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
        M.Tabs.init(document.getElementById('mainTabs'), {});
        initJavaScriptEditors();
    });

    var helpEditor, defaultHelpContent;
    var serverURL = parameters.action.link+'/ajax';
    var mediaEditor, confEditor;

    var self = {};
    self.saveToTextarea = function() {
        mediaEditor.save();
        confEditor.save();
        if(helpEditor) helpEditor.save();
    };

    return self;

    function initJavaScriptEditors() {

        var mediaSelectorElm = $('#ID');

        mediaEditor = javaScriptEditor({parentID: 'mediaEditor'});
        confEditor = javaScriptEditor({parentID: 'confEditor', jsonMode: true});
        initHelp();

        $('#config').click(function() {
            setTimeout(function() { confEditor.init(); }, 100);
        });

        $.post(serverURL, {func: 'getMedias'}, function (medias) {
            var options = medias.sort(function (a ,b) {
                if(a > b) return 1;
                if(a < b) return -1;
                return 0;
            }).map(function (media) {
                return('<option value="' + media + '">' + media + '</option>');
            });
            options.unshift('<option value="" selected>New media</option>');
            mediaSelectorElm.empty().append(options);

            M.FormSelect.init(document.querySelectorAll('select'), {});
            mediaSelectorElm.unbind().change(function(e) {
                var media = e.target.value;
                $('#newMedia').val(media || '');
                $('#deleteMedia').prop('checked', false).attr('disabled', !media);
                if(!media) return;

                $.post(serverURL, {func: 'getMedia', name: media}, function (content) {
                    mediaEditor.setValue(content.server);
                    confEditor.setValue(content.config);
                });
                initHelp(media);
            });
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});
        });
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

