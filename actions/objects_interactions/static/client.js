/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 13.05.2015.
 */


function callbackBeforeExec(callback) {

    var interactions = getInteractionsDescriptions();

    var newInteractions = getDifferencesInArrays(interactions, initInteractions);
    var removedInteractions = getDifferencesInArrays(initInteractions, interactions);


    if(newInteractions.length) var description = 'Added interactions: ' + newInteractions.join('; ') + '\n';
    if(removedInteractions.length) description += 'Removed interactions: ' + removedInteractions.join('; ') + '\n';
    if(!newInteractions.length && ! removedInteractions.length) description = 'No one interaction has not removed or has not added\n';
    description += 'Resulting interaction list: ' + interactions.join('; ');

    $('#interactions_description').val(description);

    callback();
}

// return array with elements, which exists in arr1 and not exists in arr2
function getDifferencesInArrays(arr1, arr2) {

    if(!arr1 || !arr1.length) return [];
    if(!arr2 || !arr2.length) return arr1;

    for(var i = 0, isEqual = false, newArr = []; i < arr1.length; i++){
        for(var j = 0; j < arr2.length; j++){
            if(arr1[i] === arr2[j]) {
                isEqual = true;
                break;
            }
        }
        if(isEqual) isEqual = false;
        else newArr.push(arr1[i]);
    }
    return newArr;
}

// return array of selected interactions tooltips
function getInteractionsDescriptions() {
    return $('input[type=radio]:checked').next().map(function(){return $(this).attr("data-tooltip");}).get();
}

// array of selected interactions tooltips, when interaction table was creating
var initInteractions;

var JQueryNamespace = (function ($) {
    $(function () {
        objects = parameters.objects;
        init(parameters.objects);

        $('#addObjectsToInteractionTableBtn').click(function(){
            if(!parameters.objects.length) return;

            // Create comma separated string with objects names form, include a nes objects
            var objectsNamesStr = objects.map(function(obj){ return obj.name}).join(',');

            var objectsIDsInTable = $('tr[objectID]').map(function(i, elm){
                return Number($(elm).attr('objectID'));
            }).get();

            for(var i = 0; i < parameters.objects.length; i++) {
                var object = parameters.objects[i];
                if (object.id === undefined || !object.name || objectsIDsInTable.indexOf(object.id) !== -1) continue;

                createRow( {
                    objectID: object.id,
                    objectName: object.name,
                    objectDescription: object.description,
                    interactionType: 'include',
                    editedObjectNamesStr: objectsNamesStr
                });
            }
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {});
        });
    }); // end of document ready


    var serverURL = parameters.action.link+'/ajax',
        objects;

    return { init: init };

    function init(_objects) {
        objects = _objects;
        createInteractionsTable();
        $('#objectsIDs').objectsSelector(_objects, function(selectElm){
            objects = selectElm.children('option').map(function() {
                var val = $(this).val();
                if(val && Number(val) === parseInt(String(val), 10)) val = Number(val);

                return {
                    name: $(this).text(),
                    id: val
                }
            }).get();

            createInteractionsTable();
        });
    }

    // creating interactions table
    // objects is array of objects of object...  Yes, its strange
    // [{id: <id>, name: <name>, description: <description>, sortPosition: <sortPosition>}, {...}...]
    function createInteractionsTable(){

        $('#interactions').empty();

        if(!objects && !objects.length) return;

        var IDs = objects.map(function(obj){ return obj.id});
        if(!IDs || !IDs.length) return;

        var objectName = {};
        objects.forEach(function(obj){
            objectName[obj.id] = obj.name;
        });

        $.post(serverURL, {func: 'getInteractions', ids: IDs.join(',')}, function(interactionsQueryResult) {
            // interactionsQueryResult:
            //          [{
            //                  name1: <objName1>, description1: <objDescription1>, id1: <id1>,
            //                  name2: <objName2>, description2: <objDescription2>, id2: <id2>,
            //                  type: <interactionType1>},
            //                  {...},...]
            // interaction types: 0 - include; 1 - intersect, 2 - exclude

            if(!interactionsQueryResult || !interactionsQueryResult.length) return;

            var interactionTypes = {
                0: 'include',
                1: 'intersect',
                2: 'exclude',
                100: 'included',
                102: 'excluded'
            };

            // for save sort position bellow, when draw table's rows.
            var interactionsIDs = [];

            // create interactions object with object ID of the second interaction object as a keys
            // interactions = {<secondObjectIDIbInteractions1>: {
            //      name: <object name>,
            //      description: <object description>,
            //      type: <interactionType>,
            //      interactionsObjectsIDs: {<objectID1>: true, <objectID2>: true...}
            //      differentInteractions: ["<objectName1> as <interactionType1>", "<objectName2> as <interactionType2>"]...}]
            //      },
            //  {<secondObjectIDIbInteractions1>: {...}}
            var interactions = {};
            for(var i=0; i<interactionsQueryResult.length; i++){
                var interaction = interactionsQueryResult[i];
                var id1 = Number(interaction.id1);
                var id2 = Number(interaction.id2);
                var type = Number(interaction.type);

                if(objectName[id1] !== undefined){
                    if(!(id2 in interactions)) {
                        interactions[id2] = {
                            description: interaction.description2,
                            name: interaction.name2,
                            type: interactionTypes[type],
                            differentInteractions: [],
                            interactionsObjectsIDs: {}
                        };
                        interactionsIDs.push(id2);
                    } else {
                        if(interactions[id2].type !== interactionTypes[type])
                            interactions[id2].type = 'different';
                    }
                    interactions[id2].differentInteractions.push(interaction.name1+' as '+ interactionTypes[type]);
                    interactions[id2].interactionsObjectsIDs[id1] = type;
                } else if(objectName[id2] !== undefined){
                    if(type !== 1) type += 100;
                    if(!(id1 in interactions)) {
                        interactions[id1] = {
                            description: interaction.description1,
                            name: interaction.name1,
                            type: interactionTypes[type],
                            differentInteractions: [],
                            interactionsObjectsIDs: {}
                        };
                        interactionsIDs.push(id1);
                    } else {
                        if(interactions[id1].type !== interactionTypes[type])
                            interactions[id1].type = 'different';
                    }
                    interactions[id1].differentInteractions.push(interaction.name2+' as '+ interactionTypes[type]);
                    interactions[id1].interactionsObjectsIDs[id2] = type;
                }
            }

            // for save sort position, we use specially created for it "interactionsIDs" array
            // instead of object "interactions" in a loop
            var objectsNamesStr = objects.map(function(obj){ return obj.name}).join(',');
            for(i=0; i<interactionsIDs.length; i++){
                var id = interactionsIDs[i];

                // search for the interactions, which does not have some objects, add interaction to this objects as
                // "extend" and change type of those interactions to "different"
                for(var j=0; j<IDs.length; j++){
                    if(interactions[id].interactionsObjectsIDs[IDs[j]] === undefined){
                        interactions[id].type = 'different';
                        interactions[id].differentInteractions.push(objectName[IDs[j]]+' as extend or no integration');
                    }
                }

                createRow( {
                    objectID: id,
                    objectName: interactions[id].name,
                    objectDescription: interactions[id].description,
                    interactionType: interactions[id].type,
                    differentInteractions: interactions[id].differentInteractions,
                    editedObjectNamesStr: objectsNamesStr
                });
            }
            M.Tooltip.init(document.querySelectorAll('.tooltipped'), {});

            initInteractions = getInteractionsDescriptions();
        });
    }

    function createRow(parameters){

        var objectID = parameters.objectID,
            objectName = parameters.objectName,
            objectDescription = parameters.objectDescription,
            interactionType = parameters.interactionType,
            differentInteractions = parameters.differentInteractions,
            editedObjectNamesStr = parameters.editedObjectNamesStr;

        var objectTooltip = '';
        if (objectDescription) {
            objectTooltip = ' class="tooltipped" data-position="right" data-tooltip="' + objectDescription + '"';
        }
        var checked = {intersect:'',include:'',included:'',exclude:'',excluded:'',different:''};
        if(interactionType === 'excluded') interactionType = 'exclude';
        checked[interactionType] = ' checked';

        // format of inputs id and value is "interact_<XXX> = <interactionType>:<objectID>"
        // <XXX> is an objectID and used only as a interaction unique key and not used for parsing parameters

        var multipleInteraction = '<td class="center-align"></td>';
        if(interactionType === 'different') {
            multipleInteraction =
                '<td class="center-align">' +
                '<label><input type="radio" name="interact_' + objectID + '" id="different_' + objectID + '" ' +
                'value="different:' + objectID + '" class="with-gap" checked/>' +
                '<span class="tooltipped" data-position="top" ' +
                'data-tooltip="'+objectName+' interact with ' +differentInteractions.join(', ')+ '"></span></label>' +
                '</td>';
        }

        $('#interactions').append(
            '<tr objectID="'+objectID+'">' +
            '<td>' +
            '<a href="#!" id="tr_delete_'+objectID+'">' +
            // don't use tooltip here, it was remain after deleting row
            '<i class="material-icons right" style="margin-left:0">delete</i></a>' +
            '</td>' +
            '<td><span ' + objectTooltip + '>' + objectName + '</span>' +
            '</td>' +
            '<td class="center-align">' +
            '<label><input type="radio" name="interact_' + objectID + '" id="include_' + objectID + '"' +
                ' value="include:' + objectID + '" class="with-gap"' + checked.include + '/>' +
            '<span class="tooltipped" data-position="top" ' +
                'data-tooltip="Include ' + objectName + ' in ' + editedObjectNamesStr + '">' +
            '</span></label>' +
            '</td>' +
            '<td class="center-align">' +
            '<label><input type="radio" name="interact_' + objectID + '" id="included_' + objectID + '" ' +
                'value="included:' + objectID + '" class="with-gap"' + checked.included + '/>' +
            '<span class="tooltipped" data-position="top" ' +
                'data-tooltip="Include ' + editedObjectNamesStr + ' in ' + objectName + '">' +
            '</span></label>' +
            '</td>' +
            '<td class="center-align">' +
            '<label><input type="radio" name="interact_' + objectID + '" id="intersect_' + objectID + '" ' +
            'value="intersect:' + objectID + '" class="with-gap"' + checked.intersect + '/>' +
            '<span class="tooltipped" data-position="top" ' +
            'data-tooltip="Select only similar objects, included in '+editedObjectNamesStr+' and '+objectName+'">' +
            '</span></label>' +
            '</td>' +
            '<td class="center-align">' +
            '<label><input type="radio" name="interact_' + objectID + '" id="exclude_' + objectID + '" ' +
                'value="exclude:' + objectID + '" class="with-gap"' + checked.exclude + '/>' +
            '<span class="tooltipped" data-position="top" ' +
                //'data-tooltip="Objects from '+editedObjectNamesStr+' excluding similar objects from '+objectName+'">' +
                'data-tooltip="Only different objects, included in '+editedObjectNamesStr+' and '+objectName+'">' +
            '</span></label>' +
            '</td>' +
            '<td class="center-align hide">' +
            '<label><input type="radio" name="interact_' + objectID + '" id="excluded_' + objectID + '" ' +
                'value="excluded:' + objectID + '" class="with-gap"' + checked.excluded + '/>' +
            '<span class="tooltipped" data-position="top" ' +
                'data-tooltip="Objects from '+objectName+' excluding similar objects from '+editedObjectNamesStr+'">' +
            '</span></label>' +
            '</td>' +
            '</td>' +
            multipleInteraction +
            '</tr>'
        );

        $('#tr_delete_'+objectID).click(function(eventObject){
            $(this).parent().parent().remove();
            // don't execute default action for this event
            eventObject.preventDefault();
        });
    }
})(jQuery); // end of jQuery name space