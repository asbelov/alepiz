/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-6-23 0:39:38
*/
(function ($) {
    $(function () {
        init();
    });
    function init() {

        $('#addNewFieldBtn').click(addNewField);

        getDataByAjax();
    }

    // path to ajax
    var serverURL = parameters.action.link+'/ajax';

    function getDataByAjax() {
        $.post(serverURL, {func: 'getInfo'}, function(result) {
            var userSelectOptionsElms = createUsersSelectOptionsElm(result.users);

            $('#sender').append(userSelectOptionsElms).val(result.user);
            $('#rcpt').append(userSelectOptionsElms);
            $('#prioritiesGrp').append(createPriorities(result.priorities));
            $('#mediasGrp').append(createMedias(result.medias));

            M.updateTextFields();
            M.FormSelect.init(document.querySelectorAll('select'), {});

        });
    }

    function addNewField() {
        var name = $('#newField').val();
        if(!name) return M.toast({html: 'Please enter a name for the new field', displayLength: 2000});

        var elm = $('#newField_' + name);
        if(elm.length) {
            M.toast({html: 'Field "' + name + '" already exist', displayLength: 2000});
            return elm.focus();
        }

        var html =
            '<div>' +
                '<div class="col s10 input-field">' +
                    '<textarea class="materialize-textarea" id="newField_' + name + '"/>' +
                    '<label for="newField_' + name + '">' + name +
                '</div>' +
                '<div class="col s2 input-field">' +
                    '<a class="btn-floating waves-effect" id="remove_' + name + '"><i class="material-icons">delete</i></a>' +
                '</div>' +
            '</div>';

        $('#additionalFields').append(html);

        $('#remove_' + name).click(function () {
            $(this).parent().parent().remove();
        });
    }

    function createUsersSelectOptionsElm(users) {
        var processedUsers = {};

        return users.sort(function (a,b) {
            if(a.fullName > b.fullName) return 1;
            if(a.fullName < b.fullName) return -1
            return 0;
        }).map(function (user) {
            if(processedUsers[user.name]) return;
            processedUsers[user.name] = true;
            return '<option value="' + user.name + '">' + user.fullName + ' ('  + user.name + ')</option>';
        }).join('');
    }

    function createPriorities(priorities) {
        return priorities.map(function (priority) {
            return '<option value="' + priority.id + '">#' + priority.id + ' ' +
                priority.description + '</option>';
        });
    }

    function createMedias(medias) {
        return Object.keys(medias).map(function (mediaID) {
                return '<option value="' + mediaID + '">' + mediaID + ': ' + medias[mediaID].description + '</option>';
        });
    }
})(jQuery); // end of jQuery name space