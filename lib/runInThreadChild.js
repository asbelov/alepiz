/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const exitHandler = require('../lib/exitHandler');
const {parentPort, workerData} = require('worker_threads');

var requiredFile = workerData;
var messagePorts = {
    sendToParent: function (msg) {
        if (!msg) return;
        parentPort.postMessage({
            data: msg,
        });
    },
};

exitHandler.init(null, requiredFile);

try {
    var exportedData = require(requiredFile);
} catch (err) {
    parentPort.postMessage({
        err: 'Can\'t import ' + requiredFile + ': ' + err.message
    });
}

if(typeof exportedData === 'function') var init = 'function';
else {
    init = {};
    for (var name in exportedData) {
        init[name] = typeof exportedData[name];
    }
}

parentPort.postMessage({
    init: init,
});

parentPort.on('message', msg => {
    if (!msg) return;

    // receive messagePort for communicate between children workers
    if (msg.portType && msg.port) {
        if (!messagePorts[msg.portType]) messagePorts[msg.portType] = [];
        messagePorts[msg.portType].push(msg.port);
        return;
    }

    if(msg.exit !== undefined) {
        log.exit('Worker thread received exit signal from parent');
        log.disconnect(function () {
            process.exit(msg.exit);
        });
        return;
    }

    var data = typeof exportedData === 'function' ? exportedData : exportedData[msg.name];
    if (!data) return;

    /*
    run function with name msg.name and send messagePort as parameter
    function messagePortsReceiver(messagePorts) {
        messagePorts.child.forEach((child) => {
            child.postMessage({msg: 'message for all workers with type child'});
        });
        messagePorts.child2[0].postMessage({msg: 'message for worker with type child2'});

        messagePorts.child3[0].on('message', function(msg) {
            console.log('Receiving message from worker with type child3: ', msg);
        });
    }
    */
    if (msg.applyMessagePort && typeof data === 'function') {
        data(messagePorts);
        return;
    }

    if (typeof data !== 'function') {
        if (!msg.id) return;
        return parentPort.postMessage({
            id: msg.id,
            args: data,
        });
    }

    if (!msg.args) msg.args = [];
    if (msg.id) {
        // closure for save message id
        (function (_id) {
            msg.args.push(function () {
                var callbackArgs = Array.prototype.slice.call(arguments);
                return parentPort.postMessage({
                    id: _id,
                    args: callbackArgs,
                });
            });
        })(msg.id);
    }

    var returnedData = data.apply(this, msg.args);

    if (returnedData !== undefined && msg.id) {
        parentPort.postMessage({
            id: msg.id,
            args: returnedData,
        });
    }
});