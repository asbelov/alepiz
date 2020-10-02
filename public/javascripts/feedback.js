/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

document.addEventListener('DOMContentLoaded', function () {
    M.CharacterCounter.init(document.querySelectorAll('.has-character-counter'));
    var emailModalInstance = M.Modal.init(document.getElementById('modalEmail'), {});

    document.getElementById('sendFeedback').addEventListener('click', function () {
        var email = document.getElementById('email').value || '';
        var fullName = document.getElementById('fullName').value || '';
        var feedBackText = document.getElementById('feedbackText').value || '';

        var modalEmailActionElm = document.getElementById('modalEmailAction');
        var modalEmailActionText = document.getElementById('modalEmailText');

        var appeal = fullName ? fullName.charAt(0).toUpperCase() + fullName.slice(1) + '! ' : '';

        if(!/^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/.test(email) || email.length > 100) {
            modalEmailActionElm.innerText = appeal + 'We\'re sorry, but we are unable to submit this feedback';
            modalEmailActionText.innerText =
                'Thank you for your feedback, but unfortunately we cannot send it. ' +
                (email ? 'You entered an invalid email address "' + email + '"' : 'You have not entered your email');
            emailModalInstance.open();
            return;
        }
        if(feedBackText.length < 10) {
            modalEmailActionElm.innerText = appeal + 'We\'re sorry, but we are unable to submit this feedback';
            modalEmailActionText.innerText =
                'Thank you for your feedback, but unfortunately we cannot send it. ' +
                'The entered text is too small for feedback';
            emailModalInstance.open();
            return;
        }

        if (feedBackText.length > 4096) {
            modalEmailActionElm.innerText = appeal + 'We\'re sorry, but we are unable to submit this feedback';
            modalEmailActionText.innerText =
                'Thank you for your feedback, but unfortunately we cannot send it. ' +
                'The entered text is too big for feedback';
            emailModalInstance.open();
            return;
        }

        if (fullName.length > 100) {
            modalEmailActionElm.innerText = appeal + 'We\'re sorry, but we are unable to submit this feedback';
            modalEmailActionText.innerText =
                'Thank you for your feedback, but unfortunately we cannot send it. ' +
                'The entered name is too big';
            emailModalInstance.open();
            return;
        }

        //console.log('Name: ', fullName, 'email: ', email, 'text: ', feedBackText);
        ajax('/feedback', {
            email: email,
            fullName: fullName,
            feedbackText: feedBackText,
        }, function (obj) {
            if(!obj || !obj.err) {
                modalEmailActionElm.innerText = appeal + 'Feedback sending successfully';
                modalEmailActionText.innerText = 'Thanks for your feedback! It was sent to the ALEPIZ team. We will answer as soon as possible!'
            } else {
                modalEmailActionElm.innerText = appeal + 'Error sending feedback';
                modalEmailActionText.innerText = 'Thank you for your feedback, but unfortunately we cannot send it. ' + obj.err;
            }

            emailModalInstance.open();
        });
    });
});

function ajax(url, params, callback) {
    var request = new XMLHttpRequest();
    request.responseType = "json";
    request.open("POST", url, true);
    request.setRequestHeader("Content-type", "application/x-www-form-urlencoded");

    request.addEventListener("readystatechange", () => {

        if (request.readyState === 4 && request.status === 200) {
            let obj = request.response;

            //console.log(obj);
            document.body.style.cursor = 'default'
            callback(obj);
        }
    });

    var paramsStr = Object.keys(params).map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
    //console.log(url, paramsStr);
    document.body.style.cursor = 'wait'
    request.send(paramsStr);
}