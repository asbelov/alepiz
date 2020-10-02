/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function onChangeObjects(objects){
    JQueryNamespace.init(objects);
}

var objects = parameters.objects;

function callbackBeforeExec(callback) {
    if(!objects.length) return callback(new Error('Objects for renaming are not set'));

    var newObjectsNames = $('#newObjectsNames').val();
    if(!newObjectsNames || (objects.length === 1 && newObjectsNames === objects[0].name)) return callback();

    var renameRegExp = $('#objectsRE').val();
    if(!renameRegExp) renameRegExp = '.*';
    try{
        var regExp = new RegExp(String(renameRegExp), 'ig');
    } catch(err) {
        return callback(new Error('Error in regexp /'+renameRegExp+'/: '+ err.message));
    }

    var renameRules = [];
    var descriptionString = [];

     for(var i = 0; i < objects.length; i++) {
        try {
            var renamedObjectName = objects[i].name.replace(regExp, newObjectsNames)
        } catch(err){
            return callback(new Error('Error in renaming object "'+objects[i].name+'" using regExp /'+
                regExp+'/'+newObjectsNames+'/gi: '+ err.message));
        }
        //check for equal new names
        for(var j = 0; j < i; j++) {
            if(renamedObjectName.toLowerCase() === renameRules[j].name.toLowerCase()){
                return callback(new Error('Several new names for objects are equal: '+renamedObjectName));
            }
        }
        renameRules.push({id: objects[i].id, name: renamedObjectName});
        descriptionString.push('"'+objects[i].name + '"->"' + renamedObjectName + '"');
    }
    $('#renamedObjectsNamesInModal').text(descriptionString.join('; '));
    $('#renamedObjectsNames').val(descriptionString.join('; '));


    $('#modalRenameConfirm').modal({dismissible: false}).modal('open');

    $('#modalRenameConfirmNo').unbind('click').click(function() {
        callback(new Error('Rename operation is canceled'));
    });

    $('#modalRenameConfirmYes').unbind('click').click(function(){
        $('#rulesForRenameObjects').val(JSON.stringify(renameRules));
        callback();
    });
}


var JQueryNamespace = (function ($) {
    $(function () {
        disabledElm = $('#disabled');
        objectsDescriptionElm = $('#objectsDescription');
        objectsOrderElm = $('#objectsOrder');
        objectsREField = $('#objectsREField');
        batchRenameHelpElm = $('#batchRenameHelp');
        newObjectsNamesElm = $('#newObjectsNames');
        init(parameters.objects);
    });

    var serverURL = parameters.action.link+'/ajax',
        disabledElm,
        objectsDescriptionElm,
        objectsOrderElm,
        objectsREField,
        batchRenameHelpElm,
        newObjectsNamesElm;

    return { init: init };

    function init(_objects) {
        objects = _objects;
        $('#objectsNames').text(_objects.map(function(obj){ return obj.name}).join(', '));

        var IDs = objects.map(function(obj){ return obj.id});
        if(!IDs || !IDs.length) return;

        if(objects.length === 1) {
            objectsREField.addClass('hide');
            batchRenameHelpElm.addClass('hide');
            newObjectsNamesElm.val(objects[0].name);
        } else {
            objectsREField.removeClass('hide');
            batchRenameHelpElm.removeClass('hide');
            newObjectsNamesElm.val('');
        }

        $.post(serverURL, {func: 'getObjectsParameters', IDs: IDs.join(',')}, function(data) {
            //objectsParameters = [{id: <id>, name: <objectName>, description: <objectDescription>, sortPosition: <objectOrder>, color:.., disabled:...}, {...},...]

            var objectsParameters = data.objectsParameters;
            if(!objectsParameters.length) return;

            var disabled = objectsParameters[0].disabled, sortPosition = objectsParameters[0].sortPosition, description = objectsParameters[0].description;

            for(var i = 1; i < objectsParameters.length; i++) {
                var obj = objectsParameters[i];
                if(disabled !== obj.disabled) disabled = undefined;
                if(sortPosition !== obj.sortPosition) sortPosition = undefined;
                if(description !== obj.description) description = undefined;
                if(description === undefined && sortPosition === undefined && disabled === undefined) break;
            }

            if(disabled === 1) disabledElm.prop('checked', "1");
            else disabledElm.prop('checked', "");

            if(sortPosition) objectsOrderElm.val(sortPosition);
            else objectsOrderElm.val(0);

            if(description) objectsDescriptionElm.val(description);
            else objectsDescriptionElm.val('');

            M.updateTextFields();
            M.FormSelect.init(objectsOrderElm[0], {});

            var chipsData = [], _linkedCounters = {};
            data.objectsCountersLinkage.forEach(function (counter) {
                if(!_linkedCounters[counter.id]) _linkedCounters[counter.id] = [counter.objectID];
                else _linkedCounters[counter.id].push(counter.objectID);

                if(_linkedCounters[counter.id].length === IDs.length) {
                    chipsData.push({
                        tag: createChipName(counter.name, counter.id)
                    });
                }
            });

            var countersIDsElm = $('input#linkedCoutersIDs');

            var countersChips = {};
            data.counters.forEach(function (counter) {
                countersChips[createChipName(counter.name, counter.id)] = null;
            });

            var linkedCountersInstance = M.Chips.init(document.getElementById('linkedCounters'), {
                data: chipsData,
                placeholder: 'Begin to type',
                secondaryPlaceholder: 'Type name',
                autocompleteOptions: {
                    data: countersChips,
                    limit: 30,
                    minLength: 3
                },
                onChipAdd: setCountersIDsElm,
                onChipDelete: setCountersIDsElm
            });

            setCountersIDsElm();

            // set value of 'input#linkedCoutersIDs' to comma separated counters IDs
            function setCountersIDsElm() {
                countersIDsElm.val(linkedCountersInstance.chipsData.map(function (chip) {
                    return Number(chip.tag.replace(/^.+\(#(\d+)\)$/, '$1'));
                }).join(','));
            }
        });
    }

    function createChipName(name, id) {
         return  name + ' (#' + id + ')';
    }
})(jQuery); // end of jQuery name space