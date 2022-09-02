/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var alepizAuthSystem = (function($) {

    var authorizationInProgress = false;

    function init() {
        initAuthorizationSystem();
    };

    function initAuthorizationSystem() {

        var modalLoginInstance,
            userNameElm = $('#userName'),
            userPassElm = $('#userPass'),
            newPass1Elm = $('#newUserPass1'),
            newPass2Elm = $('#newUserPass2'),
            loginBtnElm = $('#loginBtn');

        modalLoginInstance = M.Modal.init(document.getElementById('modal-login'), {
            onOpenStart: function () {
                $('#changePasswordForm').addClass('hide');
                $('#newUserPass1').val('');
                $('#newUserPass2').val('');
                authorizationInProgress = true;
            },
            onCloseEnd: function () {
                authorizationInProgress = false;
            }
        });

        // set focus on a login field after login dialog initialize
        loginBtnElm.click(function(){ setTimeout(function(){ userNameElm.focus() }, 500 ) });

        // set focus to password field on press enter or tab on a user field
        // or close modal for esc
        userNameElm.keypress(function(e) {
            if(e.which === 13 || e.which === 9) userPassElm.focus();
            if(e.which === 27) modalLoginInstance.close();
        });
        // try to log in when press enter on a password field
        // or close modal for esc
        userPassElm.keypress(function(e) {
            if($('#changePasswordForm').hasClass('hide')) {
                if(e.which === 13) {
                    login();
                    modalLoginInstance.close();
                }
            } else if(e.which === 13 || e.which === 9) newPass1Elm.focus();

            if(e.which === 27) modalLoginInstance.close();
        });

        newPass1Elm.keypress(function(e) {
            if(e.which === 13 || e.which === 9) newPass2Elm.focus();
            if(e.which === 27) modalLoginInstance.close();
        });

        newPass2Elm.keypress(function(e) {
            if(e.which === 13) {
                login();
                modalLoginInstance.close();
            }
            if(e.which === 27) modalLoginInstance.close();
            var newPass = newPass1Elm.val();
            if(!newPass) return false;
        });

        newPass2Elm.keyup(function () {
            var newPass = newPass1Elm.val();
            if(newPass !== newPass2Elm.val()) newPass2Elm.addClass('red-text');
            else newPass2Elm.removeClass('red-text');
        });

        $('#changePasswordBtn').click(function () {
            $('#changePasswordForm').toggleClass('hide');
        });

        // try to log in when click on LOGIN button
        $('#login').click(function(eventObject){
            eventObject.preventDefault();
            login();
        });
        // logout when pressed LOGOUT button
        $('#logout').click(function(eventObject){
            eventObject.preventDefault();
            logout();
        });

        $.post('/mainMenu', {f: 'getCurrentUserName'}, function(userName) {
            if(userName && userName.length) { // userName is a string or empty array [], when login as guest

                loginBtnElm.removeClass('grey-text').attr('data-tooltip', 'Login as ' + userName);
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 500
                });

            }// else M.toast({html: 'Entering as "GUEST", please login first', displayLength: 3000});
        });

        function login() {
            var user = userNameElm.val(), pass = userPassElm.val(), newPass = newPass1Elm.val();
            if(newPass !== newPass2Elm.val()) {
                M.toast({html: 'Passwords do not match', displayLength: 5000});
                return;
            }

            if(newPass && !pass) {
                M.toast({html: 'Please enter your old password before changing', displayLength: 5000});
                return;
            }

            if(!user || !pass) {
                M.toast({html: 'Please enter your username and password for login', displayLength: 5000});
                return;
            }

            $.post('/mainMenu', {
                f: 'login', user: user,
                pass: pass,
                newPass: newPass,
            }, function(userName) {

                if(!userName) {
                    M.toast({html: 'Username or password are incorrect', displayLength: 4000});
                    return logout();
                }

                if (newPass) {
                    M.toast({
                        html: 'Password successfully changed for user ' + userName,
                        displayLength: 5000,
                    });
                } else {
                    M.toast({html: userName + ' is logged in', displayLength: 3000});
                }

                loginBtnElm.removeClass('grey-text').attr('data-tooltip', 'Login as ' + userName);
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 500
                });

                userPassElm.val('');
                setTimeout(function () { location.reload(); }, 3000);
            });
        }

        // send logout command to server, clear Username and password field, set grey color for login icon
        // and set tooltip for it as 'login as guest'
        function logout() {
            $.post('/mainMenu', {f: 'logout'}, function() {
                userPassElm.val('');
                userNameElm.val('');
                loginBtnElm.addClass('grey-text').attr('data-tooltip', 'Login as GUEST');
                M.Tooltip.init(loginBtnElm[0], {
                    enterDelay: 500
                });

                setTimeout(function () { location.reload() }, 2000);
            });
        }
    }

    return {
        init: init,
        authorizationInProgress: function () { return authorizationInProgress; }
    }
})(jQuery); // end of jQuery name space