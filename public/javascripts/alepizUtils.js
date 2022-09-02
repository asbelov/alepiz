/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

function escapeHtml (string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
    });
}

    /*
Getting parameters from URL

return {
checkedObjectsNames: array of checked objects names in objects list [name1, name2, ...]
uncheckedObjectsNames: array of unchecked objects names in objects list [name3, name4, ...]
activeActionLink: active action link "/action/link"
actionParameters: array of action parameters [{key: <key1>, val: <val1>}, {..}, ...]
}
*/
function getParametersFromURL(callback) {

    var query = window.location.search.substring(1);

    var actionParameters = [],
        uncheckedObjectsNames = [],
        checkedObjectsNames = [],
        activeActionLink = '';

    if (query) {
        query.split('&').forEach(function (parameter) {
            var pair = parameter.split('=');
            var key = decodeURIComponent(pair[0]);
            var val = pair[1] ? decodeURIComponent(pair[1]).trim() : '';

            if (key === 'u') uncheckedObjectsNames = val.replace(/\s*,\s*/g, ',').split(',');
            else if (key === 'c') checkedObjectsNames = val.replace(/\s*,\s*/g, ',').split(',');
            else if (key === 'a') activeActionLink = val || '';
            else actionParameters.push({
                    key: key,
                    val: val
                });
        });
    }

    if(typeof callback !== 'function') {
        return {
            checkedObjectsNames: checkedObjectsNames,
            uncheckedObjectsNames: uncheckedObjectsNames,
            activeActionLink: activeActionLink,
            actionParameters: actionParameters
        };
    }

    return callback({
        checkedObjectsNames: checkedObjectsNames,
        uncheckedObjectsNames: uncheckedObjectsNames,
        activeActionLink: activeActionLink,
        actionParameters: actionParameters,
    });
}

/*
Set action parameters to the URL
actionParameters: [{key: <key1>, val:<val1>}, {..}, ...]
 */

function setActionParametersToBrowserURL(actionParameters) {
    if(!Array.isArray(actionParameters) || !actionParameters.length) return;

    actionParameters = actionParameters
        .filter(function(param) {
            return (typeof param === 'object' &&
                param.key &&
                param.key.toLowerCase() !== 'p' &&
                param.key.toLowerCase() !== 'u' &&
                param.key.toLowerCase() !== 'c' &&
                param.key.toLowerCase() !== 'a');
        })
        .map(function(param) {
            if(param.val === undefined) param.val = '';
            return (encodeURIComponent(param.key) + '=' + encodeURIComponent(param.val));
        });

    var parametersFromURL = getParametersFromURL();

    if(parametersFromURL.activeActionLink) {
        actionParameters.unshift('a='+encodeURIComponent(parametersFromURL.activeActionLink));
    }

    var parameters = [];
    if (parametersFromURL.uncheckedObjectsNames.length) {
        parameters.push('u=' + encodeURIComponent(parametersFromURL.uncheckedObjectsNames.join(',')));
    }
    if (parametersFromURL.checkedObjectsNames.length) {
        parameters.push('c=' + encodeURIComponent(parametersFromURL.checkedObjectsNames.join(',')));
    }

    Array.prototype.push.apply(parameters, actionParameters);

    var URL = parameters.join('&');
    // checking for changes in parameter string
    if(URL === parametersFromURL) return;

    window.history.pushState(null, document.title, '?' + URL);
}