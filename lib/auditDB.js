/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

var fs = require('fs');
var path = require('path');
var Conf = require('../lib/conf');
const confLog = new Conf('config/log.json');

// !!! don't use log function (i.e. log = require('../lib/audit)(module)) in this module:
// it will creating circle requirements

var auditDB = {};
module.exports = auditDB;

var writeStream, readFD;
var recordSize = confLog.get('auditRecordSize') || 4096;
var auditDBFile = confLog.get('auditDB') || 'db/audit.tsv';
var lastRecordID = 0;

/*
TODO: add blockChain: each new record has a hash, created from the hash of the previous record and all elements from a new record.
 */

init();
function init() {
    if(!auditDBFile) return;
    var auditDBPath = path.join(__dirname, '..', auditDBFile);

    try {
        var stats = fs.statSync(auditDBPath);
        lastRecordID = stats.size / recordSize;
    } catch (e) {
        lastRecordID = 0;
    }

    if(lastRecordID !== parseInt(String(lastRecordID), 10))
        console.error('Found error in audit database structure while open file ' + auditDBPath + '; file size: ' + stats.size +
        '; last record ID: ' + lastRecordID);

    try {
        writeStream = fs.createWriteStream(auditDBPath, {flags: 'a'});
        readFD = fs.openSync(auditDBPath, 'r');
    } catch (e) {
        console.error('Error while open file or stream: ' + e.message);
    }
}

auditDB.insertRecords = function(messagesObj) {
    if(!messagesObj.length || !auditDBFile) return;

    for(var i = 0, buffers = []; i < messagesObj.length; i++) {
        //if(messagesObj[i].logToDatabase) buffers.push(createRawRecord(messagesObj[i]));
        if(messagesObj[i].sessionID) buffers.push(createRawRecord(messagesObj[i]));
    }

    writeStream.write(Buffer.concat(buffers));
    lastRecordID += messagesObj.length;
};


auditDB.getRecords = function(lastRecordID, sessionsIDs, callback) {
    if(!auditDBFile) return callback();

    var maxRecordsCnt = Number(confLog.get('maxRecordsReturnedFromDatabase'));
    if(maxRecordsCnt !== parseInt(String(maxRecordsCnt), 10) || maxRecordsCnt <= 0 ) maxRecordsCnt = 100;
    var readSize = maxRecordsCnt * recordSize;

    fs.fstat(readFD, function (err, stats) {
        if(err) return callback(new Error('Can\'t get information about audit file: '  + err.message));

        var fileSize = stats.size;
        var startPosition = lastRecordID ? lastRecordID * recordSize : fileSize - readSize;
        if(startPosition < 0) startPosition = 0; // if readSize > fileSize

        if(fileSize <= startPosition) return callback(); // if required lastRecord at the end of file
        if(startPosition + readSize > fileSize) readSize = fileSize - startPosition;

        var buffer = Buffer.alloc(readSize);
        fs.read(readFD, buffer, 0, readSize, startPosition, function (err, bytesRead, buffer) {
            if(err) return callback(new Error('Error reading from auditDB file: ' + err.message));

            var recordID = (fileSize - readSize) / recordSize + 1;
            if(bytesRead / recordSize !== parseInt(String(bytesRead / recordSize), 10) ||
                recordID !== parseInt(String(recordID), 10)) return callback(new Error('Error in auditDB structure'));

            //console.log('AUDIT: reading : ', bytesRead, 'b, from position ' + startPosition+ '; readSize: ' + readSize + ' b; read ' + bytesRead / recordSize + ' records', '; all records cnt: ', fileSize / recordSize, '; start read from ', startPosition / recordSize, ' record; recordID: ', recordID, '; lastRecordID: ', lastRecordID);
            var messagesObj = buffer.toString().split('\n').map(function(rawRecord) {
                var messageObj = getMessageObj(rawRecord);
                messageObj.id = recordID++;
                return messageObj;
            }).filter(function (record) {
                return !sessionsIDs.length || sessionsIDs.indexOf(record.sessionID) !== -1;
            });

            //console.log('AUDIT: ', messagesObj);
            callback(null, messagesObj);
        });
    });
};

function createRawRecord(messageObj) {

    var message = Buffer.from(messageObj.message.replace(/\t/g, ' ').replace(/\n/g, '\r'));
    var rawRecord = Buffer.concat([Buffer.from([messageObj.sessionID, messageObj.timestamp, messageObj.level, messageObj.label].join('\u0009')), Buffer.from([0x09]), message]);

    var spacesCount = recordSize - rawRecord.length - 1;

    if(spacesCount < 0) rawRecord = Buffer.concat([rawRecord.slice(0, recordSize-4), Buffer.from('...\n')]);
    else rawRecord = Buffer.concat([rawRecord, (Buffer.alloc(spacesCount)).fill(' '), Buffer.from('\n')]);

    return rawRecord;
}

function getMessageObj(rawRecord) {
    var arr = rawRecord.split('\t');

    return {
        sessionID: Number(arr[0]),
        timestamp: Number(arr[1]),
        level: arr[2],
        label: arr[3],
        message: arr[4]
    }
}
