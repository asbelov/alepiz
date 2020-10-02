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
    });

    // path to ajax
    var serverURL = parameters.action.link+'/ajax',
        propIdx = 0;

    return { init: init };

    function init(objects) {

        // HTML chars in names are always escaped by jquery
        $('#objectsNames').text(objects.map(function(obj){ return obj.name}).join(', '));

        $('#propertiesField').empty();

        var IDs = objects.map(function(obj){ return obj.id});
        var addPropertyElm = $('#addProperty');
        if(!IDs || !IDs.length) {
            addPropertyElm.hide();
            return;
        } else addPropertyElm.show();

        // properties [{name:.., value:.., mode:.., description:..}]
        $.post(serverURL, {func: 'getSharedObjectsProperties', IDs: IDs.join(',')}, function(properties){
            if(!properties || !properties.length) return;

            properties.reverse().forEach(function(property) {
                addProperty(property);
            });
            M.updateTextFields();
            M.textareaAutoResize($('textarea'));
        });
    }

    function addProperty (property) {

        if(property === undefined) property = {};
        if(typeof property.name !== 'string') property.name = '';
        if(typeof property.value !== 'string') property.value = '';
        if(typeof property.description !== 'string') property.description = '';

        var propertyValueCheckboxHTML = '\
            <div class="col s12">\
                <label><input type="checkbox" id="property'+propIdx+'value"' +(property.value ? ' checked': '')+ '/>\
                <span>Value</span></label>\
            </div>';

        var propertyValueTextareaHTML = '\
            <div class="col s12 input-field">\
                <textarea id="property'+propIdx+'value" class="materialize-textarea">' + escapeHtml(property.value) + '</textarea>\
                <label for="property'+propIdx+'value"' +(property.value ? ' class="active"': '')+ '>Value</label>\
            </div>';

        var propertyValueTextFieldHTML = '\
                <div class="col s12 input-field">\
                    <input type="text" id="property'+propIdx+'value"' +(property.value ? ' value="' + escapeHtml(property.value) + '"': '')+ '/>\
                    <label for="property'+propIdx+'value"' +(property.value ? ' class="active"': '')+ '>Value</label>\
                </div>';


        if(property.mode === 1) var propertyValueHTML = propertyValueCheckboxHTML;
        else if(property.mode === 2 || property.mode === 3) propertyValueHTML = propertyValueTextareaHTML;
        else {
            property.mode = 0;
            propertyValueHTML = propertyValueTextFieldHTML;
        }

        var html = '\
<div class="card">\
    <div class="card-content">\
        <a href="#!" removeProp="'+propIdx+'">\
            <i class="material-icons right">close</i>\
        </a>\
        <span class="card-title">Object property</span>\
        <div class="row">\
            <div class="col s12 m7 l9 input-field">\
                <input type="text" id="property'+propIdx+'name"' +(property.name ? ' value="' + escapeHtml(property.name) + '"': '')+ '/>\
                <label for="prop_'+propIdx+'name"' +(property.name ? ' class="active"': '')+ '>Name</label>\
            </div>\
            <div class="col s12 m5 l3 input-field">\
                <select id="property'+propIdx+'mode" propIdx="' + propIdx + '">\
                    <option value="0"' +(property.mode === 0 ? ' selected' : '')+ '>Not calculated text field</option>\
                    <option value="1"' +(property.mode === 1 ? ' selected' : '')+ '>Checkbox</option>\
                    <option value="2"' +(property.mode === 2 ? ' selected' : '')+ '>Not calculated text area</option>\
                    <option value="3"' +(property.mode === 3 ? ' selected' : '')+ '>Calculated expression</option>\
                </select>\
                <label>Display mode</label>\
            </div>\
            <span propertyValue="'+ propIdx +'">' + propertyValueHTML + '</span>\
            <div class="col s12 m12 l12 input-field">\
                <textarea id="property'+propIdx+'description" class="materialize-textarea">' +escapeHtml(property.description)+ '</textarea>\
                <label for="prop_'+propIdx+'description"' +(property.description ? ' class="active"': '')+ '>Description</label>\
            </div>\
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
                var propertyValueElm = $('span[propertyValue=' + propIdx + ']');
                if (mode === '1') propertyValueElm.empty().append(propertyValueCheckboxHTML);
                else if (mode === '2' || mode === '3') propertyValueElm.empty().append(propertyValueTextareaHTML);
                else propertyValueElm.empty().append(propertyValueTextFieldHTML);
            });
        })(propIdx, propertyValueTextFieldHTML, propertyValueCheckboxHTML, propertyValueTextareaHTML);

        ++propIdx;
    }
})(jQuery); // end of jQuery name space