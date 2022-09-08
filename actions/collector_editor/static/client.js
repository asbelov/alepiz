/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 28.07.2015.
 */


var confirmDeleteCollectorYes, confirmDeleteCollectorNo;

function callbackBeforeExec(callback) {
    if($('#deleteCollector').prop("checked")) {

        var modalDeleteConfirmNoElm = $('#modalDeleteConfirmNo'),
            modalDeleteConfirmYesElm = $('#modalDeleteConfirmYes'),
            modalDeleteConfirmElm = $('#modalDeleteConfirm');

        if(confirmDeleteCollectorNo) modalDeleteConfirmNoElm.unbind('click', confirmDeleteCollectorNo);
        if(confirmDeleteCollectorYes) modalDeleteConfirmYesElm.unbind('click', confirmDeleteCollectorYes);

        confirmDeleteCollectorNo = function() {
            callback(new Error('Delete operation is canceled'));
        };
        confirmDeleteCollectorYes = function () {
            callback();
        };

        modalDeleteConfirmNoElm.click(confirmDeleteCollectorNo);
        modalDeleteConfirmYesElm.click(confirmDeleteCollectorYes);

        modalDeleteConfirmElm.modal({dismissible: false});
        modalDeleteConfirmElm.modal('open');

        return;
    }

    // save order for parameters
    $('#parametersOrder').val($('li[parametersID]').map(function(){return $(this).attr("parametersID");}).get().join(','));

    JQueryNamespace.saveToTextarea();
    callback();
}

var JQueryNamespace = (function ($) {
    $(function () {
        parametersElm = $('#parameters');
        M.Tabs.init(document.getElementById('mainTabs'), {});

        initJavaScriptEditor();
        initCollectors();
        addEmptyParameter();
        $('#addParameter').click(addEmptyParameter);
        M.updateTextFields();

        // jquery-ui functions
        parametersElm.sortable();
        parametersElm.disableSelection();

    });

    // do not set to 0!!! in server.js we check 'if(pn){...}' for values, such as 'undefined', 'NaN', '', null etc.
    var pn = 1;
    var initCollectorJS;
    var collectorJSEditor;
    var helpEditor, defaultHelpContent;
    var parametersElm;
    var serverURL = parameters.action.link+'/ajax';

    var self = {};
    self.saveToTextarea = function() {
        if(collectorJSEditor) collectorJSEditor.save();
        if(helpEditor) helpEditor.save();
        //alert($('#jsEditorParent').val());
    };
    return self;


  function initJavaScriptEditor() {
    initCollectorJS = $('#jsEditorParent').val();

    $('#code').click(function() {
      if(!collectorJSEditor) {
        setTimeout(function() {
          collectorJSEditor = javaScriptEditor({
            parentID: 'jsEditorParent',
            javaScript: ''
          });
        }, 100);
      } else setTimeout(function() {collectorJSEditor.refresh();}, 100);
    });

    $('#activeCollector').click(function () {
        $('#separateCollector').prop("checked", false);
        if($(this).is(':checked')) $('#runCollectorAsThread').prop("disabled", false).prop("checked", true);
        else $('#runCollectorAsThread').prop("disabled", true).prop("checked", false);
    });

      $('#separateCollector').click(function () {
          $('#activeCollector').prop("checked", false);
          if($(this).is(':checked')) $('#runCollectorAsThread').prop("disabled", false).prop("checked", true);
          else $('#runCollectorAsThread').prop("disabled", true).prop("checked", false);
      });

      M.FormSelect.init(document.querySelectorAll('select'), {});
  }

  function addEmptyParameter(){

    var parameterID = 'parameter_'+pn;
    var parameterHTML = '\
<li id="'+parameterID+'" parametersID="'+pn+'" class="row"  style="cursor:pointer;">\
    <div class="col s12 divider"></div>\
    <div class="col s12">\
        <h4><span>Parameter settings</span>\
            <a href="#!" id="parameter_'+pn+'_delete" >\
                <i class="material-icons right">close</i>\
            </a>\
        </h4>\
    </div>\
    <div class="input-field col s12 m4 l4">\
        <input type="text" class="tooltipped" id="parameter_'+pn+'_name" data-tooltip="Short parameter name" validator="^[a-zA-Z_\\$][a-zA-Z0-9_\\$\\-]+$" validatorError="Parameter name has illegal symbols. It can contain Javascript variable symbols only"/>\
        <label for="parameter_'+pn+'_name">Parameter name</label>\
    </div>\
    <div class="input-field col s12 m8 l6">\
        <input type="text" class="tooltipped" id="parameter_'+pn+'_description" data-tooltip="Describe collector parameter"/>\
        <label for="parameter_'+pn+'_description">Parameter description</label>\
    </div>\
    <p class="col s6 m6 l2 tooltipped" data-tooltip="Check if parameter value can be empty">\
        <label><input type="checkbox" id="parameter_'+pn+'_canBeEmpty"/>\
        <span>Can be empty</span></label>\
    </p>\
    <div class="input-field col s12 m6 l4 ">\
        <textarea class="materialize-textarea tooltipped" id="parameter_'+pn+'_default" data-tooltip="Set default value, according to checking settings"></textarea>\
        <label for="parameter_'+pn+'_default">Default value</label>\
    </div>\
    <div class="input-field col s12 m6 l4 tooltipped" data-tooltip="Select, how to check entered parameter value" data-position="top">\
        <select id="parameter_'+pn+'_checkAs">\
            <option value="">Without checking</option>\
            <option value="Integer">Integer number</option>\
            <option value="UInteger">Unsigned Integer number</option>\
            <option value="UNZInteger">Unsigned non-zero integer</option>\
            <option value="zeroone">0 or 1</option>\
            <option value="timeInterval">Time interval (500, 10m, 10.5h, 2d etc)</option>\
            <option value="bytes">Bytes (10, 2Kb, 3Mb, 5.5Gb etc)</option>\
            <option value="24clock">24-hour clock (23:25, 21:45:30 etc)</option>\
            <option value="1224clock">12 or 24-hour clock (23:25, 21:45:30, 1:32Am, 10:40:30 pm etc)</option>\
            <option value="date">Date DD.MM.YYYY(20.07.20, 31/08/2020, 14-06-2021 etc)</option>\
            <option value="Float">Float number</option>\
            <option value="hostOrIP">Internet host name or IP4\\6 address</option>\
            <option value="TCPPort">TCP port (number)</option>\
        </select>\
        <label>Check parameter as</label>\
    </div>\
    <div class="input-field col s12 m6 l4 tooltipped" data-tooltip="Set input type for parameter" data-position="top">\
        <select id="parameter_'+pn+'_type">\
            <option value="">Standard text input</option>\
            <option value="textInputPassword">Password text input</option>\
            <option value="textInputShort">Short text input</option>\
            <option value="textInputMiddle">Middle text input</option>\
            <option value="textInputLong">Long text input</option>\
            <option value="select">Select (add "selectOptions" manually)</option>\
            <option value="checkbox">Checkbox</option>\
            <option value="textArea">Text area</option>\
            <option value="javaScriptEditor">Javascript editor</option>\
            <option value="jsonEditor">Json editor</option>\
        </select>\
        <label>Input type</label>\
    </div>\
</li>';

    parametersElm.append(parameterHTML);
    $('#parameter_'+pn+'_delete').click(function(){
      $('#'+parameterID).remove();
    });
    M.FormSelect.init(document.querySelectorAll('select'), {});
    M.Tooltip.init(document.querySelectorAll('.tooltipped'), {enterDelay: 500});

      // fix bug, when select is not close list with items after choosing one of items
    // This bug occur when used .sortable() function from jquery-ui.min.js with material select
    $('#parameter_'+pn+'_type').change(function() { M.FormSelect.init(this, {}) });
    $('#parameter_'+pn+'_checkAs').change(function() { M.FormSelect.init(this, {}) });
    pn++;
  }

  function initCollectors() {
      $.post(serverURL, {func: 'getCollectors'}, function(collectors){

          var collectorsSelectElm = $('#collectorID');
          collectorsSelectElm.empty().append('<option value="">New collector</option>');

          for(var collectorID in collectors) {
              if (!collectors.hasOwnProperty(collectorID) || !collectorID) continue;
              var collector = collectors[collectorID];

              if (!collector.name) var name = collectorID;
              else name = collector.name;

              collectorsSelectElm.append('<option value="' + collectorID + '">' + name + '</option>');
          }

          initHelp();

          collectorsSelectElm.change(function(e){setCollectorParameters(e.target.value)});
          M.FormSelect.init(document.querySelectorAll('select'), {});

          function setCollectorParameters(collectorID){
              var collector = collectors[collectorID];

              var IDElm = $('#ID'),
                  nameElm = $('#name'),
                  descriptionElm = $('#description');

              if(!collector) {
                  IDElm.val('');
                  nameElm.val('');
                  descriptionElm.val('');
                  parametersElm.empty();
                  addEmptyParameter();
                  $('#jsEditorParent').val(initCollectorJS);
                  if(collectorJSEditor) collectorJSEditor.setValue(initCollectorJS);
                  return;
              }

              IDElm.val(collectorID);
              nameElm.val(collector.name);
              descriptionElm.val(collector.description);

              if(collector.active) {
                  $('#activeCollector').prop("checked", true);
                  $('#runCollectorAsThread').prop("disabled", false);
              }
              else $('#activeCollector').prop("checked", false);

              if(collector.separate) {
                  $('#separateCollector').prop("checked", true);
                  $('#runCollectorAsThread').prop("disabled", false);
              }
              else $('#separateCollector').prop("checked", false);

              if(collector.runCollectorAsThread) $('#runCollectorAsThread').prop("checked", true).prop("disabled", false);
              else $('#runCollectorAsThread').prop("checked", false);

              if(collector.runCollectorSeparately) {
                  if(Number(collector.runCollectorSeparately) === parseInt(collector.runCollectorSeparately)) {
                      $('#runCollectorSeparately').val(parseInt(collector.runCollectorSeparately));
                  } else $('#runCollectorSeparately').val('on');
              } else $('#runCollectorSeparately').val(0);


              parametersElm.empty();

              for(var parameterName in collector.parameters) {
                  if (!collector.parameters.hasOwnProperty(parameterName)) continue;
                  var parameter = collector.parameters[parameterName];

                  var pID = '#parameter_'+pn+'_';
                  addEmptyParameter();
                  $(pID+'name').val(parameterName);
                  if(parameter.description !== undefined) $(pID+'description').val(parameter.description);
                  if(parameter.default !== undefined) {
                      var textAreaElm = $(pID+'default');
                      textAreaElm.val(parameter.default);
                      (function (textAreaElm) {
                          setTimeout(function() {M.textareaAutoResize(textAreaElm);}, 1000)
                      })(textAreaElm);

                  }
                  if(parameter.canBeEmpty) $(pID+'canBeEmpty').prop('checked', true);
                  if(parameter.checkAs) $(pID+'checkAs > [value='+parameter.checkAs+']').prop('selected', true);
                  if(parameter.type) $(pID+'type > [value='+parameter.type+']').prop('selected', true);
              }

              $.post(serverURL, {func: 'getCollectorCode', name: collectorID}, function(collectorSource) {
                  $('#jsEditorParent').val(collectorSource);
                  if(collectorJSEditor) collectorJSEditor.setValue(collectorSource);
              });

              initHelp(collectorID);
              M.textareaAutoResize($('textarea'));
          }

          function initHelp(id) {
              var defaultLang = navigator.language || '';
              var langElm = $('#lang'), newLangElm = $('#addLang'), helpEditorElm = $('#helpEditor');

              if (defaultLang) {
                  if (defaultLang.indexOf('-') !== -1) defaultLang = defaultLang.split('-')[0];

                  if (!id) {
                      langElm.empty().append('<option value="' + defaultLang + '">' + defaultLang + '</option>')
                      M.FormSelect.init(langElm[0], {});
                      defaultHelpContent = helpEditorElm.val();

                      $('#help').click(function () {
                          if(!helpEditor) {
                              setTimeout(function () {
                                  helpEditor = pugEditor({parentID: 'helpEditor'});
                              }, 100)
                          }else setTimeout(function() {helpEditor.refresh();}, 100);
                      })

                      $('#addLangBtn').click(function () {
                          var newLang = newLangElm.val();
                          if(!newLang) return;

                          newLangElm.val('');
                          newLang = newLang.toLowerCase();
                          // select always has this language
                          if(langElm.find('option[value='+newLang+']').length) return;

                          langElm.append('<option value="' + newLang + '" selected>' + newLang + '</option>')
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
                      var selectedLang;

                      if (Array.isArray(languages)) {
                          langElm.empty();
                          languages.forEach(function (lang) {
                              if (lang.toLowerCase() === defaultLang.toLowerCase()) {
                                  var selected = ' selected';
                                  selectedLang = defaultLang;
                              } else selected = '';
                              langElm.append('<option value="' + lang + '"' + selected + '>' + lang + '</option>')
                          });

                          if (!selectedLang) selectedLang = languages[0];

                          loadHelp(id, selectedLang);
                      } else {
                          langElm.empty().append('<option value="' + defaultLang + '">' + defaultLang + '</option>')
                          helpEditorElm.val(defaultHelpContent);
                          if (helpEditor) {
                              helpEditor.setValue(defaultHelpContent);
                              helpEditor.refresh();
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
                          helpEditor.refresh();
                      }
                  });
              }
          }
      });
  }

})(jQuery); // end of jQuery name space