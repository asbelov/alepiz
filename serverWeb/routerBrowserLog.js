/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const express = require('express');
const browserLog = require('../serverAudit/browserLog');


var router = express.Router();
module.exports = router;

router.all('/log/:sessionID', function(req, res) {

    module.sessionID = Number(req.params.sessionID);

    browserLog.log(req.body.level, req.body.args, module.sessionID, function (err) {
        if (err) log.error(err.message); // do not return. always send code 200 to client

        res.send('');
    });
});