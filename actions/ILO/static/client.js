/*
* Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
* Created on 2020-10-4 23:45:42
*/

var objects = parameters.objects;

redirect(objects[0].name.toLowerCase());

function onChangeObjects(_objects) {
    objects = _objects;
    redirect(objects[0].name.toLowerCase());
}

/*
 * You can't connect to ILO using iframe, because ILO has a header 'X-Frame-Options': 'sameorigin' and you will get an error:
 * Refused to display 'https://server_ilo.domain/' in a frame because it set 'X-Frame-Options' to 'sameorigin'.
 * sameorigin mean that you must to use a same protocol, same port and same hostname with the same domain.
 * Need to create a simple net proxy server, which will accept connection from http:// and make https:// connections to ILO server
 * and remove header X-Frame-Options': 'sameorigin' from ILO responses
 * example of simple proxy: https://medium.com/@nimit95/a-simple-http-https-proxy-in-node-js-4eb0444f38fc
 */

function redirect() {
    //console.log('redirect to ', hostname);
    var protocol = parameters.action.protocol || 'https';
    var domain = parameters.action.domain || location.hostname.replace(/^[^.]+/, '');
    var prefix = parameters.action.prefix || '';
    var suffix = parameters.action.suffix || '';
    var port = parameters.action.port || (protocol === 'https' ? 443 : 80);
    post({
        func: 'startProxy',
        dstAddr: prefix + hostname + suffix + domain,
        //dstAddr: 'localhost',
        //dstAddr: 'ngs.ru',
        dstPort: port,
    }, function(port) {
        window.location.replace('https://localhost:' + port);
    });
}

function post(params, callback) {
    var request = new XMLHttpRequest();
    var url = parameters.action.link+'/ajax'; // path to ajax
    request.open("POST", url, true);
    request.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
    request.addEventListener("readystatechange", () => {

        if(request.readyState === 4 && request.status === 200) {
            callback(request.responseText);
        }
    });

    var paramsArr = [];
    for(var key in params) {
        paramsArr.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
    request.send(paramsArr.join('&'));
}