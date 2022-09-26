/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var colorPicker = (function ($) {
    var colorClasses = ['red', 'pink', 'purple', 'deep-purple', 'indigo', 'blue', 'cyan', 'teal', 'green',
        'light-green', 'lime', 'yellow', 'amber', 'orange', 'deep-orange', 'brown', 'grey', 'blue-grey'];
    var shadeClasses = ['lighten-4', 'lighten-3', 'lighten-2', 'lighten-1', '', 'darken-1', 'darken-2',
        'darken-3', 'darken-4', 'accent-1', 'accent-2', 'accent-3', 'accent-4'];

    var colorPickerParentElm, shadePickerParentElm, exampleOfObjectColoringElm;

    //$(function () {});

    function init(_colorPickerParentElm, _shadePickerParentElm, _exampleOfObjectColoringElm) {
        exampleOfObjectColoringElm = _exampleOfObjectColoringElm;
        shadePickerParentElm = _shadePickerParentElm;
        colorPickerParentElm = _colorPickerParentElm;
        shadePickerParentElm.addClass('hide');
        drawColorPicker(colorPickerParentElm, shadePickerParentElm);
        initColorEvents();
    }


    function setColorAndShade(color, shade, addSaveUnchanged) {
        if(!color || typeof color !== 'string') color = '';
        else if(colorClasses.indexOf(color) === -1) {
            console.error('Try to set unexpected color', color , 'for colorPicker');
            return;
        }

        if(!shade || typeof shade !== 'string') shade = '';
        else if(shadeClasses.indexOf(shade) === -1) {
            console.error('Try to set unexpected shade', shade , 'for colorPicker');
            return;
        }

        if(addSaveUnchanged) {
            $('li[data-object-color="0"]').removeClass('hide');
            color = 0;
            shade = '';
        } else $('li[data-object-color="0"]').addClass('hide');

        $('li[data-object-color="' + color + '"]').trigger('click');
        $('li[data-object-shade="' + shade + '"]').trigger('click');
    }

    function initColorEvents() {
        M.Dropdown.init(document.getElementById('objectsColorBtn'), {
            coverTrigger: false,
        });

        M.Dropdown.init(document.getElementById('objectsShadeBtn'), {
            coverTrigger: false,
        });

        var accentShadeElms = $('li[data-object-shade-accent]');
        var objectsColorBtnNameElm = $('#objectsColorBtnName'),
            objectsShadeBtnNameElm = $('#objectsShadeBtnName');
        $('li[data-object-color]').click(function () {
            var oldColorClass = exampleOfObjectColoringElm.attr('class').split(/\s+/).filter(function(className) {
                return className.indexOf('-text') !== -1;
            })[0];
            var newColor = $(this).attr('data-object-color');
            var newColorClass = newColor && newColor !== '0' ? newColor + '-text' : '';
            exampleOfObjectColoringElm.removeClass(oldColorClass).addClass(newColorClass);
            $('#objectsColor').val(newColor);

            objectsColorBtnNameElm.find('div').text($(this).find('span').text());
            objectsColorBtnNameElm.find('i[data-object-color-icon]').removeClass(oldColorClass).addClass(newColorClass);

            if(newColor && newColor !== '0') {
                $('i[data-object-shade-icon]').each(function () {
                    var shadeIconsOldColor = $(this).attr('class').split(/\s+/).filter(function (className) {
                        return className.indexOf('-text') !== -1;
                    });
                    $(this).removeClass(shadeIconsOldColor).addClass(newColorClass);
                });

                if(['brown', 'grey', 'blue-grey'].indexOf(newColor) !== -1) {
                    accentShadeElms.addClass('hide');
                    if(objectsShadeBtnNameElm.find('i[data-object-shade-icon]').attr('class').indexOf('text-accent-') !== -1) {
                        objectsShadeBtnNameElm.find('i[data-object-shade-icon]').attr('class',
                            objectsShadeBtnNameElm.find('i[data-object-shade-icon]').attr('class')
                                .replace(/text-accent-[1-4]/, ''));
                        objectsShadeBtnNameElm.find('div').text('Auto');
                        $('#objectsShade').val('');
                    }
                }
                else accentShadeElms.removeClass('hide');

                shadePickerParentElm.removeClass('hide');
            } else {
                shadePickerParentElm.addClass('hide');
                exampleOfObjectColoringElm.addClass('black-text');
            }
        });

        $('li[data-object-shade]').click(function () {
            var oldShadeClass = exampleOfObjectColoringElm.attr('class').split(/\s+/).filter(function(className) {
                return className.indexOf('text-') === 0;
            })[0];
            var newShade = $(this).attr('data-object-shade');
            var newShadeClass = newShade ? 'text-' + newShade : '';
            exampleOfObjectColoringElm.removeClass(oldShadeClass).addClass(newShadeClass);

            $('#objectsShade').val(newShade);
            objectsShadeBtnNameElm.find('div').text($(this).find('span').text());
            objectsShadeBtnNameElm.find('i[data-object-shade-icon]').removeClass(oldShadeClass).addClass(newShadeClass);
        });
    }

    function drawColorPicker(colorPickerParentElm, shadePickerParentElm) {

        var colorPickerHeadHTML = '<input type="hidden" id="objectsColor"/><input type="hidden" id="objectsShade"/>' +
            '<div data-target="objectsColorDropDown" class="drop-down-btn row dropdown-trigger" ' +
            'id="objectsColorBtn">' +
            '<div class="col s10 row no-padding no-margin" id="objectsColorBtnName">' +
            '<i data-object-color-icon="main" style="padding: 10px 0 0 4px" class="material-icons col s2">circle</i>' +
            '<div class="col s10 truncate">Auto</div></div>' +
            '<i class="col s2 drop-down-icon material-icons right-align">arrow_drop_down</i>' +
            '<label class="drop-down-label">Color</label></div>' +
            '<ul class="dropdown-content" id="objectsColorDropDown">';

        var shadePickerHeadHTML = '<div data-target="objectsShadeDropDown" class="drop-down-btn row dropdown-trigger" ' +
            'id="objectsShadeBtn">' +
            '<div class="col s10 row no-padding no-margin" id="objectsShadeBtnName">' +
            '<i data-object-shade-icon="main" style="padding: 10px 0 0 4px" class="material-icons col s2">circle</i>' +
            '<div class="col s10 truncate">Auto</div></div>' +
            '<i class="col s2 drop-down-icon material-icons right-align">arrow_drop_down</i>' +
            '<label class="drop-down-label">Shade</label></div>' +
            '<ul class="dropdown-content" id="objectsShadeDropDown">';

        var colorOptionsHTML =
            '<li data-object-color="0" class="hide"><a href="#" class="input-text-color">' +
            '<i class="material-icons black-text">adjust</i><span>Save unchanged</span>' +
            '<li data-object-color=""><a href="#" class="input-text-color">' +
            '<i class="material-icons black-text">panorama_fish_eye</i><span>Auto</span>' +
            '<li class="divider" tabindex="-1"></li>' +
            colorClasses.map(colorClass => {
                return '<li data-object-color="' + colorClass + '"><a href="#" class="input-text-color">' +
                    '<i class="material-icons ' + colorClass + '-text">circle</i><span>' +
                    (colorClass.charAt(0).toUpperCase() + colorClass.slice(1)).replace('-', ' ') + '</span>'
            }).join('');

        var shadeOptionsHTML = shadeClasses.map(shadeClass => {
            var shadeName = shadeClass ?
                (shadeClass.charAt(0).toUpperCase() + shadeClass.slice(1)).replace('-', ' #') : 'None';
            var textShadeClass = shadeClass ? ' text-' + shadeClass : '';

            var dividerHTML = !shadeClass || shadeClass === 'lighten-1' || shadeClass === 'darken-4' ?
                '<li class="divider" tabindex="-1"></li>' : '';

            var accentAttr = shadeClass.indexOf('accent') === 0 ? ' data-object-shade-accent' : '';
            return '<li data-object-shade="' + shadeClass + '"' + accentAttr + '><a href="#" class="input-text-color">' +
                '<i data-object-shade-icon class="material-icons' + textShadeClass + '">circle</i><span>' +
                shadeName + '</span>' + dividerHTML;
        }).join('');

        colorPickerParentElm.html(colorPickerHeadHTML + colorOptionsHTML);
        shadePickerParentElm.html(shadePickerHeadHTML + shadeOptionsHTML);
    }

    return {
        init: init,
        setColorAndShade: setColorAndShade,
    }

})(jQuery); // end of jQuery name space