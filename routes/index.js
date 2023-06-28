/*
 * Copyright (C) 2018. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var express = require('express');
var router = express.Router();
module.exports = router;

/* GET home page. */
router.get('/', function(req, res) {
  res.render('index');
});

