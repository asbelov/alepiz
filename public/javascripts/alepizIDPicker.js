/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var alepizIDPicker = (function ($) {

    var serverIDInstance;

    function seObjectServerRelation(alepizIDsObj, objectsAlepizRelations, allObjectsNum) {
        var alepizIDsElm = $('#alepizIDs');
        var serverIDDropDownElm = $('#serverIDDropDown');
        var serverIDBtnNameElm = $('#serverIDBtnName');

        if(!objectsAlepizRelations) objectsAlepizRelations = [];
        if(allObjectsNum === undefined) allObjectsNum = -1;

        var isDifferentRelationships = false;
        var saveUnchanged = 'Save unchanged', noServerID = 'No server ID';
        var checkIcon = 'check', uncheckIcon = 'check_box_outline_blank';
        var serverID2name = {}, alepizIDs = [], serverNames = [];

        serverIDDropDownElm.html(alepizIDsObj.map(function (alepizID) {
            serverID2name[alepizID.id] = alepizID.name;
            // checking that all objects have the same server ID
            var isSelected = uncheckIcon;
            var objectNumHasRelations = objectsAlepizRelations.filter(function (rel) {
                return rel.alepizID === alepizID.id;
            }).length;
            if(objectNumHasRelations === allObjectsNum) {
                isSelected = checkIcon;
                alepizIDs.push(alepizID.id);
                serverNames.push(alepizID.name);
            } else if(objectNumHasRelations && objectsAlepizRelations.length !== 0 && allObjectsNum > 1) {
                isDifferentRelationships = true;
            }
            return '<li data-dd-id="' + alepizID.id +
                '"><a href="#" class="input-text-color"><i class="material-icons">' + isSelected + '</i>' +
                escapeHtml(alepizID.name) + '</a></li>';
        }).join(''));

        if(isDifferentRelationships) {
            serverIDDropDownElm.find('i.material-icons').text(uncheckIcon);
            serverIDDropDownElm.prepend('<li data-dd-save-unchanged><a href="#" class="red-text">' +
                '<i class="material-icons">' + checkIcon + '</i>' + saveUnchanged +
                '</a></li><li class="divider" tabindex="-1"></li>');
            serverIDBtnNameElm.text(saveUnchanged);
            alepizIDsElm.val("-1");
        } else {
            alepizIDsElm.val(alepizIDs.join(','));
            serverIDBtnNameElm.text(serverNames.sort().join(',') || noServerID);
        }

        if(serverIDInstance) serverIDInstance.destroy();
        serverIDInstance = M.Dropdown.init(document.getElementById('serverIDBtn'), {
            coverTrigger: false,
            closeOnClick: false,
        });

        var saveUnchangedElm = $('li[data-dd-save-unchanged]');
        var saveUnchangedIconElm = saveUnchangedElm.find('i.material-icons')
        $('li[data-dd-id]').click(function() {
            var iconElm = $(this).find('i.material-icons');
            var id = $(this).attr('data-dd-id');
            var valArr = alepizIDsElm.val().trim() ? alepizIDsElm.val().split(',') : [];
            saveUnchangedIconElm.text(uncheckIcon);
            valArr = valArr.filter(v => v !== '-1')
            alepizIDsElm.val(valArr.join(','));

            if(iconElm.text() === checkIcon) {
                iconElm.text(uncheckIcon);
                valArr = valArr.filter(v => v !== id);
                alepizIDsElm.val(valArr.join(','));
            } else {
                iconElm.text(checkIcon);
                valArr.push(id);
                alepizIDsElm.val(valArr.sort().join(','));
            }
            if(valArr.length) {
                serverIDBtnNameElm.text(valArr.map(v => {
                    return serverID2name[v];
                }).join(', '));
            } else {
                alepizIDsElm.val('');
                serverIDBtnNameElm.text(noServerID);
            }
        });

        saveUnchangedElm.click(function () {
            if(saveUnchangedIconElm.text() === checkIcon) {
                saveUnchangedIconElm.text(uncheckIcon);
                alepizIDsElm.val('');
                serverIDBtnNameElm.text(noServerID);
            } else {
                saveUnchangedIconElm.text(checkIcon);
                alepizIDsElm.val('-1');
                $('li[data-dd-id]').find('i.material-icons').text(uncheckIcon);
                serverIDBtnNameElm.text(saveUnchanged);
            }
        });

    }

    function drawServerIDPicker (parentElm) {
        parentElm.html('<input type="hidden" id="alepizIDs"/>' +
            '<div data-target="serverIDDropDown" class="drop-down-btn row dropdown-trigger" id="serverIDBtn">' +
            '<div class="col s10 truncate" id="serverIDBtnName">No server ID</div>' +
            '<i class="col s2 drop-down-icon material-icons right-align">arrow_drop_down</i>' +
            '<label class="drop-down-label">AlepizID</label> ' +
            '</div>' +
            '<ul class="dropdown-content" id="serverIDDropDown"></ul>');
    }

    return {
        init: drawServerIDPicker,
        seObjectServerRelation: seObjectServerRelation,
    }

})(jQuery); // end of jQuery name space