/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function onChangeObjects(objects){
    JQueryNamespace.init(objects);
}

var JQueryNamespace = (function ($) {
    $(function () {
        init(parameters.objects);
        $('#addProperty').click(addProperty);
        M.Tabs.init(document.getElementById('mainTabs'), {});
    });

    // path to ajax
    var serverURL = parameters.action.link+'/ajax',
        propIdx = 0,
        modes = {
            0: 'Not calculated text field',
            1: 'Checkbox',
            2: 'Not calculated text area',
            3: 'Calculated expression',
        };

    return { init: init };

    function init(objects) {
        $('#searchProperties').unbind('click', searchObjectsWithProperties).click(searchObjectsWithProperties);
        $('#propertyName').unbind('keyup').keyup(function(e) {
            if(e.which === 13) searchObjectsWithProperties();
            else if(e.which === 27) $(this).val('');
        });

        var objectsNamesElm = $('#objectsNames');
        var addPropertyElm = $('#addProperty');
        $('#propertiesField').empty();
        if(!objects || !objects.length) {
            objectsNamesElm.html('No objects selected');
            addPropertyElm.hide();
            return;
        }
        // HTML chars in names are always escaped by jquery
        objectsNamesElm.text(objects.map(function(obj){ return obj.name}).join(', '));

        var IDs = objects.map(function(obj){ return obj.id});
        if(!IDs || !IDs.length) {
            addPropertyElm.hide();
            return;
        } else addPropertyElm.show();

        // properties [{name:.., value:.., mode:.., description:..}]
        $.post(serverURL, {func: 'getSharedObjectsProperties', IDs: IDs.join(',')}, function(properties){
            if(!properties || !properties.length) return;

            properties.sort(function(a, b) {
                if(!a || !b) return 0;
                if(a.name > b.name) return -1;
                if(a.name < b.name) return 1;
                return 0;
            }).forEach(addProperty);

            M.updateTextFields();
            setTimeout(function() {
                $('textarea').each(function() {
                    M.textareaAutoResize($(this));
                });
            }, 500);
        });
    }

    function addProperty (property) {

        if(property === undefined) property = {};
        if(typeof property.name !== 'string') property.name = '';
        if(typeof property.value !== 'string') property.value = '';
        if(typeof property.description !== 'string') property.description = '';

        var propertyValueCheckboxHTML = '\
                <label><input type="checkbox" id="property'+propIdx+'value"' +(property.value ? ' checked': '')+ '/>\
                <span>Value</span></label>';

        var propertyValueTextareaHTML = '\
                <textarea id="property'+propIdx+'value" class="materialize-textarea">' + escapeHtml(property.value) + '</textarea>\
                <label for="property'+propIdx+'value"' +(property.value ? ' class="active"': '')+ '>Value</label>';

        var propertyValueTextFieldHTML = '\
                    <input type="text" id="property'+propIdx+'value"' +(property.value ? ' value="' + escapeHtml(property.value) + '"': '')+ '/>\
                    <label for="property'+propIdx+'value"' +(property.value ? ' class="active"': '')+ '>Value</label>';


        if(property.mode === 1) var propertyValueHTML = propertyValueCheckboxHTML;
        else if(property.mode === 2 || property.mode === 3) propertyValueHTML = propertyValueTextareaHTML;
        else {
            property.mode = 0;
            propertyValueHTML = propertyValueTextFieldHTML;
        }

        var html = '\
<div>\
    <div class="row no-margin">\
        <div class="col s12 m4 l2 input-field">\
            <input type="text" id="property'+propIdx+'name"' +(property.name ? ' value="' + escapeHtml(property.name) + '"': '')+ '/>\
            <label for="prop_'+propIdx+'name"' +(property.name ? ' class="active"': '')+ '>Name</label>\
        </div>\
        <div class="col s12 m4 l4 input-field" propertyValue="'+ propIdx +'">' + propertyValueHTML + '</div>\
        <div class="col s12 m3 l2 input-field">\
            <select id="property'+propIdx+'mode" propIdx="' + propIdx + '">\
                <option value="0"' +(property.mode === 0 ? ' selected' : '')+ '>'+ modes[0] + '</option>\
                <option value="1"' +(property.mode === 1 ? ' selected' : '')+ '>'+ modes[1] + '</option>\
                <option value="2"' +(property.mode === 2 ? ' selected' : '')+ '>'+ modes[2] + '</option>\
                <option value="3"' +(property.mode === 3 ? ' selected' : '')+ '>'+ modes[3] + '</option>\
            </select>\
            <label>Mode</label>\
        </div>\
        <div class="col s12 m12 l3 input-field">\
            <textarea id="property'+propIdx+'description" class="materialize-textarea">' +escapeHtml(property.description)+ '</textarea>\
            <label for="prop_'+propIdx+'description"' +(property.description ? ' class="active"': '')+ '>Description</label>\
        </div>\
        <div class="col input-field">\
            <a href="#!" removeProp="'+propIdx+'">\
                <i class="material-icons">close</i>\
            </a>\
        </div>\
    </div>\
</div>\
';
        $('#propertiesField').prepend(html);
        M.FormSelect.init(document.querySelectorAll('select'), {});
        $('a[removeProp=' + propIdx + ']').click(function(){
            $(this).parent().parent().remove();
        });

        // closure
        (function(propIdx, propertyValueTextFieldHTML, propertyValueCheckboxHTML, propertyValueTextareaHTML) {
            $('#property' + propIdx + 'mode').change(function () {
                var mode = $(this).val();
                var propertyValueElm = $('[propertyValue=' + propIdx + ']');
                if (mode === '1') propertyValueElm.html(propertyValueCheckboxHTML);
                else if (mode === '2' || mode === '3') propertyValueElm.html(propertyValueTextareaHTML);
                else propertyValueElm.empty().append(propertyValueTextFieldHTML);
            });
        })(propIdx, propertyValueTextFieldHTML, propertyValueCheckboxHTML, propertyValueTextareaHTML);

        ++propIdx;
    }

    function searchObjectsWithProperties() {
        var propName = $('#propertyName').val();
        if(!propName) return;
        var searchResultElm = $('#searchResult'), bodyElm = $('body');

        bodyElm.css("cursor", "wait");
        $.post(serverURL, {func: 'getObjectsForProperty', propertyName: propName}, function(rows) {
            bodyElm.css("cursor", "auto");
            if (!rows || !rows.length) {
                searchResultElm.html('<tr><td colspan="5" class="center-align">Nothing found</td></tr>');
                return;
            }

            var HTML = rows.map(function (row) {
                return '<tr><td>' + escapeHtml(row.objectName) + '</td><td>' + escapeHtml(row.propName) +
                    '</td><td>' + escapeHtml(row.propVal) +
                    '</td><td>' + modes[row.propMode] + '</td><td>' + escapeHtml(row.propDescription) + '</td></tr>';
            });
            searchResultElm.html(HTML.join(''));
        });
    }
})(jQuery); // end of jQuery name space