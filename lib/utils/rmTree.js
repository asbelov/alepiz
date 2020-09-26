/*
 * Copyright © 2020. Alexandr Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');

var rmTree = {};
module.exports = rmTree;

rmTree.sync = function (pathForRemove) {
    var files = [];
    if (fs.statSync(pathForRemove).isDirectory()) {
        files = fs.readdirSync(pathForRemove);
        files.forEach(function (file) {
            var curPath = path.join(pathForRemove, file);
            if (fs.statSync(curPath).isDirectory()) rmTree.sync(curPath);
            else fs.unlinkSync(curPath);
        });
        fs.rmdirSync(pathForRemove);
    } else fs.unlinkSync(pathForRemove);
};