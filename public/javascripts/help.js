/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var sites = ['pad-asbel', 'alepiz.com', 'alepiz.cloudno.de'];

document.addEventListener('DOMContentLoaded', function () {
    // similar behavior as an HTTP redirect
    //if(window.location.hostname === 'alepiz.cloudno.de') {
    //    var newLocation = window.location.href.replace('http://', 'https://').replace('alepiz.cloudno.de', 'alepiz.com');
    //    window.location.replace(newLocation);
    //}

    var bodyElm = document.getElementsByTagName('body')[0];
    bodyElm.style.maxWidth = '1400px';
    bodyElm.style.width = '90%';
    bodyElm.style.marginLeft = 'auto';
    bodyElm.style.marginRight = 'auto';

    initGA();
    addClassFrSkipTranslateIcons();
    var divElm = document.getElementsByTagName('header')[0].childNodes[0].querySelectorAll('div.col')[0];
    makeTableOfContents(divElm);
    makeNavBar(divElm);
    makeFooter();
    initTranslation();

    //M.Materialbox.init(document.querySelectorAll('.materialboxed'), {});
    //M.Collapsible.init(document.querySelectorAll('.collapsible'), {});
    M.AutoInit();
    var elems = document.querySelectorAll('.slider');
    M.Slider.init(elems, {
        height: 700,
        interval: 20000,
    });
    //sliderInstances.start();

    var topElement = document.getElementById('scroll-to-me');
    if(topElement) setTimeout(function() { topElement.scrollIntoView() }, 1000);

    if(sites.indexOf(window.location.hostname) === -1) {
        var hideElements = Array.from(document.getElementsByClassName('show-on-site-only'));
        hideElements.forEach(function (elm) {
            elm.classList.add('hide');
        });
    }
});

function addClassFrSkipTranslateIcons() {
    var iconElms = Array.from(document.getElementsByClassName('material-icons'));
    iconElms.forEach(function (elm) {
        elm.classList.add('skiptranslate');
    });

    var imgElms = Array.from(document.getElementsByTagName('img'));
    imgElms.forEach(function (elm) {
        elm.removeAttribute('width');
        elm.style.maxWidth = '100%';
        elm.style.maxHeight = '100%';
    });
}

function makeTableOfContents(divElm) {
    if(divElm.getAttribute('data-toc') === 'false') return;
    var mainElm = document.getElementsByTagName('main')[0];
    var headers = mainElm.querySelectorAll("h1, h2, h3, h4");

    var headerElm = document.getElementsByTagName('h1')[0];

    var tableOfContentsLink = '<b><a href="/help/contents.pug">Table of contents</a></b>';
    var alepizLink = '<b><a href="/" target="_blank">Connect to ALEPIZ</a></b>';

    var contentArray = [];
    headers.forEach(function (hdr, idx) {
        if(!hdr.innerText) return;
        var headerLevel = Number(hdr.tagName.substring(1));
        var paddingLeft = headerLevel > 3 ? ' style="padding-left: ' + (headerLevel-2) + 'em;"' : '';

        contentArray.push('<li' + paddingLeft + '><a href="#bookmark' + idx + '">' + escapeHtml(hdr.innerText) + '</a></li>');
        hdr.id = 'bookmark'+idx;
        //hdr.innerHTML += '&nbsp;[<a href="#top"><i class="material-icons skiptranslate">publish</i></a>]';
        //hdr.innerHTML = '<a name="' + idx + '">' + hdr.innerHTML + '</a>';
        //console.log(hdr.tagName, hdr.innerText);
    });

    var isActive = contentArray.length > 20 ? '' : ' class="active"';

    divElm.innerHTML += '<ul class="collapsible"><li' + isActive + '>' +
        '<div class="collapsible-header"><i class="material-icons skiptranslate">toc</i>' + escapeHtml(headerElm.innerHTML) + '</div>' +
        '<div class="collapsible-body">' +
        '<ul><li>' + alepizLink + '</li><li>' + tableOfContentsLink + '</li>' + contentArray.join('') + '</ul></div></li></ul>';



    var html = '<div class="col hide-on-small-only m1 l1" style="position: fixed; bottom: 0;">' +
        '<ul class="section table-of-contents">' +
            '<li><a href="#top"><i class="material-icons skiptranslate">publish</i></a></li>' +
        '</ul></div>';

    var mainDivElm = mainElm.querySelectorAll('.row')[0];
    mainDivElm.innerHTML += html;
}


function makeFooter() {

    var authorElm = document.querySelector('meta[name="author"]');
    var author = authorElm ? authorElm.content : 'ALEPIZ';

    var email = author.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
    author = author.
        replace(/&lt;[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+.*/, '').
        replace(/<[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+.*$/, '').
        replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+.*$/gi, '')
    email = email ? email[0] : 'support@alepiz.com';
    var lastModified = (new Date(document.lastModified || document.lastModifiedDate)).getFullYear();

    if(sites.indexOf(window.location.hostname) === -1) {
        var link = 'mailto:' + email + '?subject=[ALEPIZ page: ' + window.location.pathname +']'
    } else {
        author = 'ALEPIZ'
        link = '/help/copyright.pug';
    }

    //console.log(author, email, lastModified);
    document.body.innerHTML += '<footer><div class="row"><div class="col s12 m10 offset-m1">' +
        '<div class="page-footer" style="padding: 20px;">' +
        '<a href="/help/contents.pug" class="white-text" style="padding-left: 7px;"><i class="material-icons skiptranslate">toc</i></a>' +
        '<a href="' + link + '" class="white-text right skiptranslate">' +
        '<span class="hide-on-small-only">Copyright </span>&copy; ' + lastModified + '. ' + author + '</a>' +
        '</div></div></div></footer>';
}

function makeNavBar(headerElm) {
    if(!headerElm) return;

    var target = sites.indexOf(window.location.hostname) !== -1 ? '' : ' target="__blank"';

    var html = '\
    <nav>\
        <div class="nav-wrapper">\
            <a href="https://alepiz.com" class="brand-logo hide-on-med-and-down skiptranslate"' + target +
                    ' style="margin-left: 15px">ALEPIZ</a>\
            <ul class="left show-on-medium-and-down hide-on-large-only">\
                <li><a href="https://alepiz.com"' + target + '><i class="material-icons skiptranslate left">home</i></a></li>\
            </ul>\
            <ul class="right show-on-small">\
                <li class=" show-on-site-only"><a href="/help/contents.pug"><i class="material-icons skiptranslate">toc</i></a></li>\
                <li class=" show-on-site-only"><a href="/help/download.pug"><i class="material-icons skiptranslate">get_app</i></a></li>\
                <li class=" show-on-site-only"><a href="/help/contact.pug"><i class="material-icons skiptranslate">email</i></a></li>\
                <li class=" show-on-site-only"><a href="/help/money.pug"><i class="material-icons skiptranslate">credit_card</i></a></li>\
                <li><div id="google_translate_element"></div></li>\
            </ul>\
        </div>\
    </nav>';

    headerElm.innerHTML = html + headerElm.innerHTML;
}

function googleTranslateElementInit() {
    var lang = document.documentElement.lang || 'en';
    lang = lang.replace(/-.+$/, '');
    new google.translate.TranslateElement({
        pageLanguage: lang,
        layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
        autoDisplay: false,
    }, 'google_translate_element');
}

function initTranslation() {
    var scriptElm1 = document.createElement('script');
    scriptElm1.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    document.head.appendChild(scriptElm1);

    waitForGoogle(20);
}

function initGA() {
    if(sites.indexOf(window.location.hostname) === -1) return;
    (function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
        (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
        m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
    })(window,document,'script','https://www.google-analytics.com/analytics.js','ga');

    ga('create', 'UA-179080448-1', 'auto'); // https://alepiz.com
    ga('create', 'UA-179080448-2', 'auto'); // http://alepiz.cloudno.de
    ga('create', 'UA-179080448-3', 'auto'); // https://alepiz.cloudno.de
    ga('send', 'pageview');
}

function waitForGoogle(cnt) {
    if(!--cnt) return; // Internet not found

    setTimeout(function () {
        var selectLangElm = Array.from(document.getElementsByClassName('goog-te-menu-value'))[0];
        if(!selectLangElm) return waitForGoogle(cnt);
        var childrenElm = Array.from(selectLangElm.childNodes);
        if(!childrenElm[3]) return waitForGoogle(cnt);

        var imgElm = Array.from(document.getElementsByClassName('goog-te-gadget-icon'))[0];
        imgElm.remove();
        selectLangElm.style.backgroundColor = 'transparent';
        selectLangElm.style.margin = "0";
        selectLangElm.style.border = 'none';
        //selectLangElm.style.paddingLeft = "0";

        var langIconElm = document.createElement('i');
        langIconElm.classList.add("material-icons", "white-text", "skiptranslate");
        langIconElm.innerHTML = 'language';
        selectLangElm.replaceChild(langIconElm, childrenElm[0]);

        childrenElm[1].remove();
        childrenElm[2].remove();
        childrenElm[3].remove();
        childrenElm[4].remove();

        var selectLangParentElm = selectLangElm.parentElement.parentElement;
        selectLangParentElm.style.border = 'none';
        selectLangParentElm.style.backgroundColor = 'transparent';

    }, 100);
}

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

function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return entityMap[s];
    });
}