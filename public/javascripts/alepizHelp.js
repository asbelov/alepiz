/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


(function($) {
    $(function () {
        // help button click
        $('#helpBtn').click(function (e) {
            e.preventDefault();  // prevent default

            var activeAction = alepizActionsNamespace.getActiveActionConf();
            if(activeAction) var activeActionLink = activeAction.link;

            var helpWindowWidth = Math.floor(screen.width - screen.width / 3);
            var helpWindowsHeight = Math.floor(screen.height - screen.height / 3);
            var helpWindowLeft = (screen.width - helpWindowWidth) / 2;
            var helpWindowTop = (screen.height - helpWindowsHeight) / 2;
            var url = activeActionLink ? (activeActionLink + '/help/') : '/help/contents.pug';
            window.open(url, 'ALEPIZ help window',
                'toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=' +
                helpWindowWidth + ', height=' + helpWindowsHeight + ', top=' + helpWindowTop + ', left=' + helpWindowLeft);
        });
    });
})(jQuery)