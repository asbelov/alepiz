    /*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

function LogViewer(initCfg) {

    var script = initCfg.script || parameters.action.link + '/ajax';

    var c = {};
    var c_default = {
        IDForm: 'LogViewerForm',
        IDParent: 'tmodule',
        IDChangeSizeCB: 'chListHide',

        heightCorrection: 0,
        widthCorrection: 0,

        searchBackground: '#000000',
        searchFontcolor: '#DDDD00',

        codePage: '',
        fileName: './logs/server.log.200102'
    };

    var fileName;
    var skeleton = [];
    var bufferSize = 131072; //128 Kb
    var maxTextParts = 512;
//	var bufferSize = 32768; //32 Kb
//	var maxTextParts = 64;
    var boneHeight = bufferSize / 100;
    var scanBonesAround = 10;

    var itsNotAScroll = false;
    var fileSize = 0;
    var oldFileSize = 0;

    var searchStr = '';
    var searchPos = -1;

    var canAutoReload = true;
    var autoreloadCnt = 0;
    var maxAutoreloadCnt = 7200; // about 2 hours

    var timerScroll = false;
    var timerAutoReload = false;

    var prevScrollPosition = 0;
    var scrollSpeed = 0;

    var formElm;
    var logElm;
    var changeSizeElm;

    var isOldIE = '\v' == 'v';

    if (isOldIE && document.readyState !== "complete") {
        window.onload = function () {
            init(initCfg);
        };
    } else init(initCfg);

    function init(initCfg) {
        c = {};
        for (var key in c_default) c[key] = c_default[key];
        for (key in initCfg) c[key] = initCfg[key];

        c.id = '_' + c.IDForm + Math.floor(Math.random() * (1000000));

        fileName = c.fileName;
        try {
            var parentElm = document.getElementById(c.IDParent);
        } catch (e) {
            alert('Can\'t find parent element with ID "' + c.IDParent + '" for set size: ' + e.message);
            return;
        }
        try {
            infoElm = document.getElementById(c.IDinfo);
            infoElm.id = c.IDInfo + c.id;
        } catch (e) {
        }

        try {
            changeSizeElm = document.getElementById(c.IDChangeSizeCB);
        } catch (e) {
        }

        try {
            formElm = document.getElementById(c.IDForm);
            formElm.id = c.IDForm + c.id;
            c.heightCorrection += formElm.offsetHeight;
        } catch (e) {
            alert('Can\'t initialize element with ID ' + c.IDForm + ': ' + e.message);
            return;
        }

        logElm = document.createElement('div');
        logElm.tabindex = 1;

        logElm.style.border = '0px groove';
        logElm.style.padding = '5px';
        logElm.style.overflow = 'auto';
        logElm.style.fontFamily = 'monospace';
        logElm.style.whiteSpace = 'pre';
        logElm.style.backgroundColor = '#FFFFFF';
        logElm.style.clear = 'both';

        formElm.appendChild(logElm);
        setSize(logElm, parentElm);
        if (changeSizeElm) eConnect(changeSizeElm, function () {
            setSize(logElm, parentElm, {parentChangeSize: true})
        }, 'change');
        eConnect(logElm, scroll, 'scroll');
        makeSkeleton(logElm);
        if (c.callBackSearchReverse && typeof (c.callBackSearchReverse) === "function") c.callBackSearchReverse(true);
        logElm.focus();
        autoReload();
    }

    this.del = function () {
        stopAutoReload();
        if (timerScroll) clearTimeout(timerScroll);
        try {
            formElm.id = c.IDForm;
            formElm.removeChild(logElm);
        } catch (e) {
        }
    };

    this.Search = function (initSearchStr, direction) {
        if (direction) direction = -1;
        else direction = 1;

        searchNext(initSearchStr, direction);
    };

    function eConnect(element, handler, event, args) {
        try {
            // all browsers except IE before version 9
            if (element.addEventListener) element.addEventListener(event, function (e) {
                handler(element, e, args);
            }, false);
            // IE before version 9
            else if (element.attachEvent) element.attachEvent('on' + event, function (e) {
                handler(element, e, args);
            });
        } catch (e) {
            var elm = '';
            if (element && 'outerHTML' in element) elm = element.outerHTML;
            alert('Can\'t set event handler "on' + event + '" to the ' + elm + ': ' + e.message);
        }
    }

    function setSize(Elm, parentElm, e) {
//alert('!!!');
// Event onResize on window occured
        if (Elm === window) {
            if ((e.bodyHeight === window.document.body.clientHeight && e.bodyWidth === window.document.body.clientWidth)) return;
            e.bodyHeight = window.document.body.clientHeight;
            e.bodyWidth = window.document.body.clientWidth;
            e.parentChangeSize = false;
            setTimeout(function () {
                setSize(e.Elm, e.parentElm, e)
            }, 1000);
            return;
        }

        if (e && e.parentChangeSize) {
            setTimeout(function () {
                setSize(Elm, parentElm)
            }, 1000);
            return;
        }

        if (e && (e.bodyHeight !== window.document.body.clientHeight || e.bodyWidth !== window.document.body.clientWidth)) return;

// Resize first time
        if (!e) {
            e = {};
            e.Elm = Elm;
            e.parentElm = parentElm;
            eConnect(window, setSize, 'resize', e);
        }

        if (window.getComputedStyle) var styleParentElm = getComputedStyle(parentElm, '');
// For OLD fucking IE
        else {
            Elm.style.height = '100px';
            Elm.style.width = '100px';
            Elm.style.height = parentElm.offsetHeight - c.heightCorrection - 20;
            Elm.style.width = parentElm.offsetWidth - c.widthCorrection - 20;
            return;
        }

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.width = '0px';
            Elm.style.height = '0px';
        } else {
            Elm.setAttribute('height', '0px');
            Elm.setAttribute('width', '0px');
        }
        var parentHeight = parentElm.style.height;
        var parentWidth = parentElm.style.width;


        var maxHeight = Number(styleParentElm.height.replace(/(\d+).*/, "$1"));
        var maxWidth = Number(styleParentElm.width.replace(/(\d+).*/, "$1"));
        parentElm.style.height = maxHeight;
        parentElm.style.width = maxWidth;
        maxHeight += maxHeight - Number(styleParentElm.height.replace(/(\d+).*/, "$1"));
        maxWidth += maxWidth - Number(styleParentElm.width.replace(/(\d+).*/, "$1"));
        parentElm.style.height = maxHeight;
        parentElm.style.width = maxWidth;
//alert(maxHeight+'x'+maxWidth+' '+parentElm.offsetHeight+'x'+parentElm.offsetWidth);

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.height = maxHeight + 'px';
            Elm.style.width = maxWidth + 'px';
        } else {
            Elm.setAttribute('height', maxHeight + 'px');
            Elm.setAttribute('width', maxWidth + 'px');
        }

        maxHeight -= Number(styleParentElm.height.replace(/(\d+).*/, "$1")) - maxHeight + c.heightCorrection;
        maxWidth -= Number(styleParentElm.width.replace(/(\d+).*/, "$1")) - maxWidth + c.widthCorrection;

        if (Elm.tagName !== 'IFRAME') {
            Elm.style.height = maxHeight + 'px';
            Elm.style.width = maxWidth + 'px';
        } else {
            Elm.setAttribute('height', maxHeight + 'px');
            Elm.setAttribute('width', maxWidth + 'px');
        }

        parentElm.style.height = parentHeight;
        parentElm.style.width = parentWidth;

        e.bodyHeight = window.document.body.clientHeight;
        e.bodyWidth = window.document.body.clientWidth;
    }

    function setWaitCursor(Elm, isWait) {
        try {
            if (isWait) {
                Elm.style.cursor = 'wait';
                document.body.style.cursor = 'wait';
            } else {
                Elm.style.cursor = 'auto';
                document.body.style.cursor = 'auto';
            }
        } catch (e) {
        }
    }

    function getFileSize(fileName) {
        var prms = 'function=getFileSize&fileName=' + encodeURIComponent(fileName);
        var ai = new AJAXInteraction('', script, function (raw) {
            fileSize = Number(raw);
        }, false);
        ai.doPost(prms);
        if (fileSize < oldFileSize) {
            formElm.id = c.IDForm;
            formElm.removeChild(logElm);

            if (isOldIE) window.onload = function () {
                init(initCfg);
            };
            else init(initCfg);
        }
        return (fileSize);
    }


    function loadFilePart(fileName, loadSize, filePosition) {
        if(!loadSize) return;
        var text;
        var prms = 'function=getFilePart&fileName=' + encodeURIComponent(fileName) + '&filePos=' + filePosition + '&loadSize=' + loadSize+'&codePage='+c.codePage;
        var ai = new AJAXInteraction('', script, function (raw) {
            text = raw
        }, false);
        ai.doPost(prms);

        return (text.slice(Number(text.indexOf('\n', text.indexOf('\n') + 1) + 1), text.length));
    }

    function addFilePart(skelPosition, filePosition) {

        if (skelPosition < 0) return (false);
        if (skelPosition > skeleton.length - 2) return (false);

        if (!filePosition && filePosition !== 0) {
            var elmCnt = Math.floor(fileSize / bufferSize);
            if (elmCnt > skeleton.length) filePosition = Math.round(skelPosition * elmCnt / skeleton.length) * bufferSize;
            else filePosition = skelPosition * bufferSize;
        }

        if (filePosition + bufferSize > fileSize && filePosition + bufferSize > getFileSize(fileName)) return (false);
        if (skeleton[skelPosition].top == filePosition) {
            reHighLightSearchStr(skelPosition);
            return (true);
        }

        if(!bufferSize) return;

        setWaitCursor(formElm, true);
        var prms = 'function=getFilePart&fileName=' + encodeURIComponent(fileName) + '&filePos=' + filePosition + '&loadSize=' + bufferSize+'&codePage='+c.codePage;
        var ai = new AJAXInteraction('', script, insertTextPart, true, skelPosition);
        ai.doPost(prms);
        return (true);
    }

    function insertTextPart(raw, skelPosition) {
        var filePosition = Number(raw.substring(0, raw.indexOf("\n")));
        var text = raw.slice(Number(raw.indexOf("\n", raw.indexOf("\n") + 1) + 1), raw.length);
        mkBone(skelPosition, text, filePosition);
        setWaitCursor(formElm, false);
    }


    function mkBone(skelPosition, text, filePosition, empty) {
        if (isNaN(skelPosition)) {
            //alert('Log file not found or empty');
            return;
        }

// Make bones after length of skeleton and before skelPosition
        for (var i = skeleton.length; i < skelPosition; i++) mkBone(i);

        itsNotAScroll = true;
        var oldScrollPos = logElm.scrollTop;
        var insertElm = 0;
// If bone not exist, create it
        if (skeleton.length <= skelPosition) {
            skeleton[skelPosition] = {};
            insertElm = -1;
        }
// if text, then text will fill this bone
        if (text) {
// if empty, then this bone not fill fully
            if (!skeleton[skelPosition].elm || skeleton[skelPosition].elm.tagName != 'SPAN') {
                if (!insertElm) insertElm = skeleton[skelPosition].elm;
                skeleton[skelPosition].elm = document.createElement('SPAN');
            }
            if (skeleton[skelPosition].searchStr && skeleton[skelPosition].searchStr != searchStr) text = removeHighlightSearchStr(text);
            skeleton[skelPosition].elm.innerHTML = textFormat(text, skelPosition);
            skeleton[skelPosition].top = filePosition;
            skeleton[skelPosition].searchStr = searchStr;
            if (!empty) skeleton[skelPosition].empty = false;
            else skeleton[skelPosition].empty = true;
            reHighLightSearchStr(skelPosition);
        }
// make empty bone
        else {
            if (!skeleton[skelPosition].elm || skeleton[skelPosition].elm.tagName != 'DIV') {
                if (!insertElm) insertElm = skeleton[skelPosition].elm;
                skeleton[skelPosition].elm = document.createElement('DIV');
            } else if (skeleton[skelPosition].empty) return;
            skeleton[skelPosition].elm.style.height = boneHeight + 'px';
            skeleton[skelPosition].elm.style.backgroundColor = '#e0e0e0';
            skeleton[skelPosition].top = -1;

            skeleton[skelPosition].elm.style.fontSize = (logElm.clientHeight) + 'px';
            skeleton[skelPosition].elm.style.color = '#d0d0d0';
            skeleton[skelPosition].elm.style.overflow = 'hidden';
            skeleton[skelPosition].elm.style.textAlign = 'center';
            var emptyText = '';
            for (var i = 0; i < boneHeight / logElm.clientHeight; i++) emptyText += skelPosition + '<br>';
            skeleton[skelPosition].elm.innerHTML = emptyText;
            eConnect(skeleton[skelPosition].elm, loadWhenScroll, 'mousemove', skelPosition);
            skeleton[skelPosition].empty = true;
            skeleton[skelPosition].searchStr = '';
        }

        if (insertElm == -1) logElm.appendChild(skeleton[skelPosition].elm);
        else if (insertElm) {
            logElm.removeChild(insertElm);
            logElm.insertBefore(skeleton[skelPosition].elm, skeleton[skelPosition + 1].elm);
        }

// Correct empty bone height as average of all text heights
        if (text && !skeleton[skelPosition].empty) {
            var oldBoneHeight = boneHeight;
            boneHeight = (boneHeight + skeleton[skelPosition].elm.offsetHeight) / 2;
            if (Math.abs(boneHeight - oldBoneHeight) > boneHeight / 5) {
                for (var i = 0; i < skeleton.length; i++)
                    if (skeleton[skelPosition].elm.tagName == 'DIV')
                        skeleton[skelPosition].elm.style.height = boneHeight + 'px';
            }
        }
        if (oldScrollPos == logElm.scrollTop) itsNotAScroll = false;
    }

    function makeSkeleton(logElm) {
        var fileSize = getFileSize(fileName);

        var elmCnt = Math.floor(fileSize / bufferSize);
        var endOfLastFullTextPart = elmCnt * bufferSize;
        if (elmCnt > maxTextParts) elmCnt = maxTextParts - 1;

        var lastTextPart = loadFilePart(fileName, fileSize - endOfLastFullTextPart, endOfLastFullTextPart);
        mkBone(elmCnt, lastTextPart, endOfLastFullTextPart, true);
        scrollToTheEnd();
    }

    function stopAutoReload() {
        canAutoReload = false;
        if (!timerAutoReload) return;
        clearTimeout(timerAutoReload);
        timerAutoReload = false;
        autoreloadCnt = 0;
    }

    function autoReload(once) {
        if (!canAutoReload) return;

        canAutoReload = false;
        var fileSize = getFileSize(fileName);
        if(!fileSize) return stopAutoReload();

        if (fileSize !== oldFileSize) {
            oldFileSize = fileSize;

            var elmCnt = Math.floor(fileSize / bufferSize);
            var endOfLastFullTextPart = elmCnt * bufferSize;
            if (elmCnt > maxTextParts) elmCnt = maxTextParts - 1;

            if (elmCnt > 1) {
                if (!skeleton[elmCnt - 1] || skeleton[elmCnt - 1].empty || skeleton[elmCnt - 1].top !== endOfLastFullTextPart - bufferSize) {
                    var preLastTextPart = loadFilePart(fileName, bufferSize, endOfLastFullTextPart - bufferSize);
                    mkBone(elmCnt - 1, preLastTextPart, endOfLastFullTextPart - bufferSize);
                } else reHighLightSearchStr(elmCnt - 1);
            }

            var lastTextPart = loadFilePart(fileName, fileSize - endOfLastFullTextPart, endOfLastFullTextPart);
            mkBone(elmCnt, lastTextPart, endOfLastFullTextPart, true);
            scrollToTheEnd();
        }

        prevScrollPosition = logElm.scrollTop;

        if (!once && autoreloadCnt < maxAutoreloadCnt) {
            autoreloadCnt++;
            timerAutoReload = setTimeout(autoReload, 1000);
            canAutoReload = true;
        } else autoreloadCnt = 0;
    }

    function scrollToTheEnd() {
        itsNotAScroll = true;
        var oldScrollPos = logElm.scrollTop;
        var span = document.createElement('SPAN');
        span.innerHTML = '<BR>scrollHere';
        logElm.appendChild(span);
        span.scrollIntoView(false); //true = alignToTop
        logElm.removeChild(span);
        if (oldScrollPos == logElm.scrollTop) itsNotAScroll = false;
    }

    function textFormat(text, skelPosition) {
        try {
            text = text.split('<').join('&lt;');
        } catch (e) {
        }
        try {
            text = text.split('>').join('&gt;');
        } catch (e) {
        }

        if (isOldIE) {
            try {
                text = text.split('\n').join('<br>\n');
            } catch (e) {
            }
        }

        try {
            text = text.split(String.fromCharCode(160)).join(String.fromCharCode(7841));
        } // replace cp866 russian 'a'
        catch (e) {
        }
        try {
            text = text.split(String.fromCharCode(173)).join(String.fromCharCode(668));
        }  // replace cp866 russian small 'пїЅ'
        catch (e) {
        }

        if (searchStr) text = highlightSearchStr(text, searchStr, false, skelPosition);

        return (text);
    }

    function reHighLightSearchStr(skelPosition) {
        if (skelPosition < 0 || skelPosition >= skeleton.length || skeleton[skelPosition].searchStr == searchStr || skeleton[skelPosition].elm.tagName != 'SPAN') return;
        var text = skeleton[skelPosition].elm.innerHTML;
        var checkChanges = true;
        if (skeleton[skelPosition].searchStr) {
            text = removeHighlightSearchStr(text);
            checkChanges = false;
        }

        text = highlightSearchStr(text, searchStr, checkChanges, skelPosition);
        if (text) skeleton[skelPosition].elm.innerHTML = text;
        skeleton[skelPosition].searchStr = searchStr;
    }


    function removeHighlightSearchStr(text) {
        var re = new RegExp('\\<span.+?id=\\"?' + c.id + '\\d+\\"?[^\\>]*\\>([^\\>]*)\\<\\/span\\>', 'gmi');
        return (text.replace(re, "$1"));
    }


    function highlightSearchStr(text, searchStr, checkChanges, skelPosition) {
        if (searchStr === '') {
            if (checkChanges) return (false);
            else return (text);
        }

        try {
            var reSearch = new RegExp(searchStr, 'gmi');
        } catch (e) {
            searchStr = searchStr.replace(/([:()\[\]\\.^$|?+])/gm, "\\$1");
            try {
                reSearch = new RegExp(searchStr, 'gmi');
            } catch (e) {
                if (checkChanges) return (false);
                else return (text);
            }
        }

        var n = 0;

        skelPosition *= 1000000;

        function replacer(str, offset) {
            var id = skelPosition + (n++);
            if (id == searchPos) return ('<span id="' + c.id + id + '" style="color:' + c.searchFontcolor + ';background-color:' + c.searchBackground + '">' + str + '</span>');
            else return ('<span id="' + c.id + id + '" style="color:' + c.searchFontcolor + '">' + str + '</span>');
        }

        text = text.replace(reSearch, replacer);

        if (n === 0 && checkChanges) return (false);
        return (text);
    }

    function scroll(Elm, e) {
        if (itsNotAScroll) {
            itsNotAScroll = false;
            return;
        }

        var scrollPosition = Elm.scrollTop;
        if (prevScrollPosition == scrollPosition) return;

        scrollSpeed = scrollPosition - prevScrollPosition;
        if (c.callBackSearchReverse && typeof (c.callBackSearchReverse) === "function") {
            if ((scrollSpeed < 300 && scrollPosition > 20) || logElm.scrollHeight - logElm.clientHeight - logElm.scrollTop < 20) c.callBackSearchReverse(true);
            else if (scrollSpeed > 300 || scrollPosition < 20) c.callBackSearchReverse(false);
        }

        if (scrollSpeed < 0 && logElm.scrollHeight - logElm.clientHeight - logElm.scrollTop > 10) stopAutoReload();
        else if (scrollSpeed >= 0 && logElm.scrollHeight - logElm.clientHeight - logElm.scrollTop < 5) {
            canAutoReload = true;
            autoReload(false); // Go to the end of file without autoreload
            return;
        }

        loadWhenScroll();
        prevScrollPosition = scrollPosition;
    }

    function loadWhenScroll(elm, event, skelPosition) {
        if (itsNotAScroll) {
            itsNotAScroll = false;
            if (timerScroll) clearTimeout(timerScroll);
            timerScroll = false;
            return;
        }

        var scrollPosition = logElm.scrollTop;
        if ((Math.abs(scrollSpeed) > 50 && prevScrollPosition != scrollPosition) || event) {
            if (timerScroll) clearTimeout(timerScroll);
            timerScroll = setTimeout(function () {
                loadWhenScroll(elm, false, skelPosition)
            }, 100);
            return;
        }

        timerScroll = false;

        if (!skelPosition && skelPosition != 0) skelPosition = getSkelPosition();

        if (skelPosition < 2) {
            if (skeleton[0].empty) mkBone(0, loadFilePart(fileName, bufferSize, 0), 0);
            else reHighLightSearchStr(0);
        }

        if (skelPosition < 1 || skelPosition > skeleton.length - 2) return;

        var elmCnt = Math.floor(fileSize / bufferSize);
        if (elmCnt > skeleton.length) {
            var minAbove = skelPosition - scanBonesAround;
            if (minAbove < 0) minAbove = 0;
            var maxBellow = skelPosition + scanBonesAround;
            if (maxBellow > skeleton.length - 1) maxBellow = skeleton.length - 1
            for (var above = skelPosition; above > minAbove && skeleton[above].empty; above--){}
            for (var bellow = skelPosition; bellow < maxBellow && skeleton[bellow].empty; bellow++){}

            if (!skeleton[above].empty && (scrollSpeed > 0 || skeleton[bellow].empty || skelPosition - above < bellow - skelPosition))
                var filePosition = skeleton[above].top + (skelPosition - above) * bufferSize;
            else if (!skeleton[bellow].empty && (scrollSpeed < 0 || skeleton[above].empty || skelPosition - above < bellow - skelPosition))
                filePosition = skeleton[bellow].top - (bellow - skelPosition) * bufferSize;

            skelPosition = correctSkelPosition(skelPosition, filePosition);
        }
        if (skeleton[skelPosition].elm.tagName === 'DIV') skeleton[skelPosition].elm.style.backgroundColor = '#c0c0c0';

        addFilePart(skelPosition, filePosition);
        if (skelPosition > 2) addFilePart(skelPosition - 1, filePosition - bufferSize);
        if (skelPosition < skeleton.length - 4) addFilePart(skelPosition + 1, filePosition + bufferSize);
    }

    function correctSkelPosition(skelPosition, filePosition, dontScroll) {
        var normalSkelPosition = Math.floor(filePosition * skeleton.length / fileSize);
//		if(!(filePosition && normalSkelPosition > 1 && normalSkelPosition < skeleton.length-2 && Math.abs(skelPosition-normalSkelPosition) > skelPosition/(skeleton.length/10)))
        if (!filePosition || normalSkelPosition < 2 || normalSkelPosition > skeleton.length - 3 || Math.abs(skelPosition - normalSkelPosition) < skeleton.length / 10)
            normalSkelPosition = skelPosition;

        if (normalSkelPosition == 0 && filePosition != 0) normalSkelPosition = 1;
        if (normalSkelPosition == skeleton.length - 1 && filePosition != Math.floor(fileSize / bufferSize) * bufferSize) normalSkelPosition = skeleton.length - 2;
        if (normalSkelPosition == skeleton.length - 2 && filePosition != Math.floor(fileSize / bufferSize) * bufferSize - bufferSize) normalSkelPosition = skeleton.length - 3;

        if (!dontScroll && normalSkelPosition != skelPosition) {
            itsNotAScroll = true;
            var oldScrollPos = logElm.scrollTop;

            // Create element, scroll to it and then remove it
            var div = document.createElement('DIV');
            div.innerHTML = 'scrollHere';
            logElm.insertBefore(div, skeleton[normalSkelPosition].elm);
            div.scrollIntoView(true); //true = alignToTop
            logElm.removeChild(div);

            if (oldScrollPos == logElm.scrollTop) itsNotAScroll = false;
        }

        return (normalSkelPosition);
    }


    function getSkelPosition() {
        var scrollPosition = logElm.scrollTop;
        for (var skelPosition = 0; skelPosition < skeleton.length && skeleton[skelPosition].elm.offsetTop < scrollPosition; skelPosition++){} ;
        if (skelPosition > 0 && (skelPosition != skeleton.length - 1 || skeleton[skelPosition].elm.offsetTop > scrollPosition + logElm.clientHeight)) skelPosition--;
        return (skelPosition);
    }

    function searchNext(initSearchStr, direction) {
        stopAutoReload();

        var skelPosition = getSkelPosition();
        if (initSearchStr !== searchStr) searchPos = -1;
        searchStr = initSearchStr;

        try {
            searchStr = searchStr.split('<').join('&lt;');
        } catch (e) {
        }
        try {
            searchStr = searchStr.split('>').join('&gt;');
        } catch (e) {
        }

        try {
            var reSearch = new RegExp(searchStr, 'gmi');
        } catch (e) {
            searchStr = searchStr.replace(/([:()\[\]\\.^$|?+])/gm, "\\$1");
            try {
                reSearch = new RegExp(searchStr, 'gmi');
            } catch (e) {
                alert('Error in RegExp "' + initSearchStr + '" (also tried to use escaped RegExp: "' + searchStr + '"): ' + e.message);
                return;
            }
        }
        reHighLightSearchStr(skelPosition);
        reHighLightSearchStr(skelPosition + 1);
        reHighLightSearchStr(skelPosition - 1);
        if (searchStr === '') return;

        try {
            if (searchPos != -1) {
                var searchElm = document.getElementById(c.id + searchPos);
                searchElm.style.backgroundColor = '';
            }
            //reset searchPos when you scrolling soo far from previous search position or searchPos not defined
            if (searchPos == -1 || Math.abs(logElm.scrollTop - searchElm.offsetTop) > 1000) {

                for (searchPos = skelPosition * 1000000; ; searchPos++) {
                    try {
                        searchElm = document.getElementById(c.id + searchPos);
                        searchElm.offsetTop;
                    } catch (e) {
                        if (searchPos == skelPosition * 1000000) searchPos = -1;
                        else --searchPos;
                        break;
                    }
                    if (direction > 0 && searchElm.offsetTop - c.heightCorrection > logElm.scrollTop) {
                        break;
                    }
                    if (direction < 0 && searchElm.offsetTop > logElm.scrollTop + logElm.clientHeight) {
                        if (searchPos > skelPosition * 1000000) --searchPos;
                        break;
                    }
                }
            } else {
                if (direction > 0) ++searchPos;
                else {
                    if (Math.floor(searchPos / 1000000) === searchPos / 1000000) throw 1; // exception
                    else --searchPos;
                }
            }
            document.getElementById(c.id + searchPos).tagName;
        } catch (e) {
//alert(skelPosition+'+'+direction+':'+searchPos);
            if (searchPos !== -1) skelPosition = Math.floor(searchPos / 1000000);
            searchPos = -1;
            skelPosition = searchInFile(searchStr, direction, skelPosition + direction, skeleton[skelPosition].top + (direction * bufferSize));
            if (skelPosition === -1) {
                alert('Nothing more found');
                return;
            }
            searchPos = skelPosition * 1000000;
            if (direction < 0) {
                for (++searchPos; ; searchPos++) {
                    try {
                        document.getElementById(c.id + searchPos).tagName;
                    } catch (e) {
                        --searchPos;
                        break;
                    }
                }
            }
        }
        searchElm = document.getElementById(c.id + searchPos);
        searchElm.style.backgroundColor = c.searchBackground;
        if (searchElm.offsetTop - c.heightCorrection <= logElm.scrollTop || searchElm.offsetTop > logElm.scrollTop + logElm.clientHeight) {
            itsNotAScroll = true;
            var oldScrollPos = logElm.scrollTop;
            if (direction > 0) searchElm.scrollIntoView(true);
            else searchElm.scrollIntoView(false);
            if (oldScrollPos == logElm.scrollTop) itsNotAScroll = false;
        }
//alert(direction+'|'+skelPosition+':'+searchPos+':'+searchElm.offsetTop+'('+c.heightCorrection+')<>'+logElm.scrollTop+'+'+logElm.clientHeight+'='+(logElm.scrollTop+logElm.clientHeight));
//alert(searchPos);
    }

    function searchInFile(searchStr, direction, skelPosition, filePosition) {

        if (skelPosition + 1 > skeleton.length || skelPosition < 0) return (-1);
        if (filePosition === -1) return (-1);

//alert('in file 1:('+direction+')'+skelPosition+':SP:'+searchPos+':FP:'+filePosition+':top:'+skeleton[skelPosition-direction].top+':'+skeleton[skelPosition].top);
//var oldFP = filePosition;
        if(!bufferSize) return(-1);
        setWaitCursor(formElm, true);
        var prms = 'function=getFilePart&fileName=' + encodeURIComponent(fileName) + '&filePos=' + filePosition + '&loadSize=' + bufferSize + '&search=' + encodeURIComponent(searchStr) + '&direction=' + direction+'&codePage='+c.codePage;
        var raw;
        var ai = new AJAXInteraction('', script, function (r) {
            raw = r
        }, false);
        ai.doPost(prms);
        if (!raw) {
            setWaitCursor(formElm, false);
            return (-1);
        }
        var calcFilePosition = filePosition;
        filePosition = Number(raw.substring(0, raw.indexOf("\n")));
        var text = raw.slice(Number(raw.indexOf("\n", raw.indexOf("\n") + 1) + 1), raw.length);
        if (!text) return (-1);

// Don't use 'for'. skelPosition can be set to +direction after check of the calcFilePosition != filePosition
        while (calcFilePosition !== filePosition) {
            skelPosition += direction;
            if (skelPosition >= skeleton.length || skelPosition < 0) {
                var elmCnt = Math.floor(fileSize / bufferSize);
                if (elmCnt > skeleton.length) skelPosition = Math.floor(filePosition * skeleton.length / fileSize);
                else skelPosition = Math.floor(filePosition / bufferSize);
                break;
            }

            if (skeleton[skelPosition].top === -1) calcFilePosition += direction * bufferSize;
            else calcFilePosition = skeleton[skelPosition].top;
            if (direction > 0 && calcFilePosition > filePosition) break;
            if (direction < 0 && calcFilePosition < filePosition) break;
        }

        skelPosition = correctSkelPosition(skelPosition, filePosition, true);

//alert('in file 2:('+direction+')'+skelPosition+':SP:'+searchPos+':FP:'+filePosition+':'+oldFP);
        mkBone(skelPosition, text, filePosition);
// Sync load for save scroll position
        if (skelPosition > 2) mkBone(skelPosition - 1, loadFilePart(fileName, bufferSize, filePosition - bufferSize), filePosition - bufferSize);
        if (skelPosition < skeleton.length - 4) mkBone(skelPosition + 1, loadFilePart(fileName, bufferSize, filePosition + bufferSize), filePosition + bufferSize);

        setWaitCursor(formElm, false);
        return (skelPosition);
    }
}


function AJAXInteraction(prefix, script, callback, async, args) {
// test for IE
    var isIE = Boolean(navigator.userAgent.indexOf('Trident') + 1) || Boolean(navigator.userAgent.indexOf('MSIE') + 1);
    var req = false;
    if (window.XMLHttpRequest && (req = new XMLHttpRequest())) {
        req.onreadystatechange = processRequest;
    } else if (window.ActiveXObject && (req = new ActiveXObject("Microsoft.XMLHTTP"))) {
        req.onreadystatechange = processRequest;
    }
    if (!req || !(typeof (callback) === "function")) return;

    function processRequest() {
        if (req.readyState === 4 && req.status === 200) callback(req.responseText, args);
    }

    this.doGet = function () {
//add random to parameters for switch off caching in IE
        if (isIE) {
            if (script.indexOf('?') === -1) script += '?';
            else script += '&';
            script += 'nocacheIE=' + encodeURIComponent(Math.random());
        }
        try {
            req.open("GET", prefix + script, async);
        } catch (e) {
            req.open("GET", script, async);
        }
        try {
            req.withCredentials = true;
        } catch (e) {
        }
        req.send();
    };

    this.doPost = function (body) {
        try {
            req.open("POST", prefix + script, async);
        } catch (e) {
            req.open("POST", script, async);
        }
        if ('setRequestHeader' in req) req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        try {
            req.withCredentials = true;
        } catch (e) {
        }
//add random to parameters for switch off caching in IE
        if (isIE) {
            if (body) body += '&';
            else if (body === undefined) body = '';
            body += 'nocacheIE=' + encodeURIComponent(Math.random());
        }
        req.send(body);
    }
}
