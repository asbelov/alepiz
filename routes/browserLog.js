/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var express = require('express');
var browserLog = require('../lib/browserLog');
var log = require('../lib/log')(module);

var router = express.Router();
module.exports = router;

var defaultSessionID;

router.all('/log/:sessionID', function(req, res) {

    module.sessionID = Number(req.params.sessionID);

    browserLog.log(req.body.level, req.body.args, module.sessionID, function (err) {
        if (err) log.error(err.message); // do not return. always send code 200 to client

        res.send('');
    });
});