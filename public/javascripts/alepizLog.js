/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


var log = (function($) {

    var modalLogHeaderElm,
        modalLogMessageElm,
        modalLogInstance;

    function init () {
        modalLogHeaderElm = $('#modalLogHeader');
        modalLogMessageElm = $('#modalLogMessage');
        modalLogInstance = M.Modal.init(document.getElementById('modal-log'), {});

    }

    function getHumanLogLevel(level) {
        var humanLevel;
        if(level === 'S') humanLevel = { text: 'Silly', color: 'grey'};
        else if(level === 'D') humanLevel = { text: 'Debug', color: 'green'};
        else if(level === 'I') humanLevel = { text: 'Information', color: 'black'};
        else if(level === 'W') humanLevel = { text: 'Warning', color: 'blue'};
        else if(level === 'E') humanLevel = { text: 'Error', color: 'red'};
        else humanLevel = { text: 'Unknown', color: 'yellow'};

        return humanLevel;
    }

    function _log(level, args) {
        if(!args) return;

        var sessionID = alepizMainNamespace.getSessionID();

        $.post('/log' + (sessionID ? '/' + String(sessionID) : '/0'), {level: level, args: JSON.stringify(args)}, function() {

            var header = getHumanLogLevel(level);
            modalLogHeaderElm.text(header.text).removeClass().addClass(header.color + '-text');

            if(level === 'E') {
                var actionName = $('li[action_link].active').attr('action_name') || '';
                if(actionName) actionName = 'An error occurred while executing action ' + actionName + ': ';
                var message = actionName + '<span class="red-text">' +
                    escapeHtml(JSON.stringify(args).replace(/^\["Error: (.*?)\\n.*$/i, '$1')) +
                    '</span>';
            } else message = JSON.stringify(args);
            modalLogMessageElm.html(message);

            modalLogInstance.open();

            //want to close modal when press to Esc, but this is not working with overlay and with modal too
            // only work after mouse click on overlay
            $('div.modal-overlay').keypress(function(e) {
                if(e.which === 27) modalLogInstance.close();
            });
        });
    }

    return {
        init: init,
        silly:          function() { _log('S', Array.prototype.slice.call(arguments)) },
        debug:          function() { _log('D', Array.prototype.slice.call(arguments)) },
        info:           function() { _log('I', Array.prototype.slice.call(arguments)) },
        warn:           function() { _log('W', Array.prototype.slice.call(arguments)) },
        warning:        function() { _log('W', Array.prototype.slice.call(arguments)) },
        error:          function() { _log('E', Array.prototype.slice.call(arguments)) },
    };

})(jQuery);