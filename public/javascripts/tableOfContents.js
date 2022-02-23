/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */


document.addEventListener('DOMContentLoaded', function () {
    makeTableOfContents();
});


function makeTableOfContents() {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", '/contents/', true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            var contents = JSON.parse(xhr.responseText);

            var common = contents.common.map(function (obj) {
                return '<li style="padding-left: 2em;"><h5><a href="/' +
                    obj.helpDir + '/' + obj.file + '">' + obj.title + '</h5></a></li>';
            }).join('');

            var lessons = contents.lessons.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/' +
                    obj.helpDir + '/' + obj.file + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var actions = contents.actions.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/actions/' +
                    obj.subDir + '/' + obj.helpDir + '/' + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var launchers = contents.launchers.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/launchers/' +
                    obj.subDir + '/' + obj.helpDir + '/' + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var medias = contents.medias.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/communication/' +
                    obj.subDir + '/' + obj.helpDir + '/' + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var collectors = contents.collectors.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/collectors/' +
                    obj.subDir + '/' + obj.helpDir + '/' + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var settings = contents.settings.map(function (obj) {
                return '<li style="padding-left: 2em;"><h6><a href="/settings/' +
                    obj.helpDir + '/' + obj.file + '">' + obj.title + '</h6></a></li>';
            }).join('');

            var html = '<ul>' + common +
                '<li><h3>Lessons</h3></li>' + lessons +
                '<li><h3>Actions</h3></li>' + actions +
                '<li><h3>Collectors</h3></li>' + collectors +
                '<li><h3>Launchers</h3></li>' + launchers +
                '<li><h3>Communication medias</h3></li>' + medias +
                '<li><h3>Settings</h3></li>' + settings;

            var elm = document.getElementById('tableOfContents');
            elm.innerHTML = html;
        }
    };
    xhr.send();
}
