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
        var objectIDs = objects.map(function(obj){ return obj.id});
        if(!objectIDs || !objectIDs.length) return;

        if(objects.length === 1) {
            objectsREField.addClass('hide');
            batchRenameHelpElm.addClass('hide');
            newObjectsNamesElm.val(objects[0].name);
        } else {
            objectsREField.removeClass('hide');
            batchRenameHelpElm.removeClass('hide');
            newObjectsNamesElm.val('');
        }

        $.post(serverURL, {func: 'getObjectsParameters', IDs: objectIDs.join(',')}, function(data) {
            //objectsParameters = [{id: <id>, name: <objectName>, description: <objectDescription>,
            // sortPosition: <objectOrder>, color:.., disabled:..., created:...}, {...},...]

            var objectsParameters = data.objectsParameters;
            if(!objectsParameters.length) return;

            var disabled = objectsParameters[0].disabled,
                sortPosition = objectsParameters[0].sortPosition,
                description = objectsParameters[0].description;

            $('#objectsNames').text(objectsParameters.map(function(obj) {
                return obj.name + (obj.created ? ' (created: ' + new Date(Number(obj.created)).toLocaleString() + ')' : '');
            }).join(', '));

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

            var chipsData = [], linkedCounters = {}, prevSharedLinkedCounterIDs = [];
            data.objectsCountersLinkage.forEach(function (counter) {
                if(!linkedCounters[counter.id]) linkedCounters[counter.id] = [counter.objectID];
                else linkedCounters[counter.id].push(counter.objectID);

                if(linkedCounters[counter.id].length === objectIDs.length) {
                    chipsData.push({
                        tag: createChipName(counter.name, counter.id)
                    });
                    prevSharedLinkedCounterIDs.push(counter.id);
                }
            });

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
                onChipAdd: setCounterIDsElm,
                onChipDelete: setCounterIDsElm
            });

            var addCounterIDs = {}, delCounterIDs = {};

            // set value of 'input#linkedCountersIDs' to comma separated counters IDs
            function setCounterIDsElm() {
                var sharedLinkedCounterIDs = linkedCountersInstance.chipsData.map(function (chip) {
                    return Number(chip.tag.replace(/^.+\(#(\d+)\)$/, '$1')) });

                // add counter linkage
                if(prevSharedLinkedCounterIDs.length < sharedLinkedCounterIDs.length) {
                    for(var i = 0; i < sharedLinkedCounterIDs.length; i++) {
                        if(prevSharedLinkedCounterIDs.indexOf(sharedLinkedCounterIDs[i]) === -1) {
                            addCounterIDs[sharedLinkedCounterIDs[i]] = true;
                            delete delCounterIDs[sharedLinkedCounterIDs[i]];
                            break;
                        }
                    }
                } else { // del counter linkage
                    for(i = 0; i < prevSharedLinkedCounterIDs.length; i++) {
                        if(sharedLinkedCounterIDs.indexOf(prevSharedLinkedCounterIDs[i]) === -1) {
                            delCounterIDs[prevSharedLinkedCounterIDs[i]] = true;
                            delete addCounterIDs[prevSharedLinkedCounterIDs[i]];
                            break;
                        }
                    }
                }
                prevSharedLinkedCounterIDs = sharedLinkedCounterIDs;
                $('#linkedCounterIDsAdd').val(Object.keys(addCounterIDs).join(','));
                $('#linkedCounterIDsDel').val(Object.keys(delCounterIDs).join(','));
            }
        });
    }

    function createChipName(name, id) {
         return  name + ' (#' + id + ')';
    }
})(jQuery); // end of jQuery name space