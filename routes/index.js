/*
 * Copyright (C) 2018. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var express = require('express');
var router = express.Router();
module.exports = router;

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index');
});

