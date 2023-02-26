/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const path = require('path');
const express = require('express');
const browserLog = require('../serverAudit/browserLog');
const prepareUser = require('../lib/utils/prepareUser');


var router = express.Router();
module.exports = router;

router.all('/log/:sessionID', function(req, res) {

    var actionLink = req.body.actionLink || ''; // f.e. "/actions/counter_settings"
    var username = prepareUser(req.session.username);
    var sessionID = Number(req.params.sessionID);
    module.sessionID = sessionID;

    browserLog.log(req.body.level, req.body.args, module.sessionID, function (err) {
        if (err) log.error(err.message); // do not return. always send code 200 to client

        res.send('');
    });
});