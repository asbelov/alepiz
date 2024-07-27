/*
 * Copyright © 2024. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

module.exports = onFinished;

/*!
 * Copyright(c) 2013 Jonathan Ong
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

/**
 * Invoke callback when the response has finished, useful for
 * cleaning up resources afterwards.
 *
 * @param {object} res
 * @param {function} listener
 * @public
 */

function onFinished (res, listener) {
    if (isFinished(res) !== false) return listener(res);

    // attach the listener to the message
    attachListener(res, listener)
}

/**
 * Determine if message is already finished.
 *
 * @param {object} res
 * @return {boolean}
 * @public
 */

function isFinished (res) {
    var socket = res.socket

    if (typeof res.finished === 'boolean') {
        // OutgoingMessage
        return Boolean(res.finished || (socket && !socket.writable))
    }

    if (typeof res.complete === 'boolean') {
        // IncomingMessage
        return Boolean(res.upgrade || !socket || !socket.readable || (res.complete && !res.readable))
    }

    // don't know
    return undefined
}

/**
 * Attach a finished listener to the message.
 *
 * @param {object} res
 * @param {function} callback
 * @private
 */

function attachFinishedListener (res, callback) {
    var eeMsg
    var eeSocket
    var finished = false

    function onFinish (error) {
        eeMsg.cancel()
        eeSocket.cancel()

        finished = true
        callback(error)
    }

    // finished on first message event
    eeMsg = eeSocket = first([[res, 'end', 'finish']], onFinish)

    function onSocket (socket) {
        // remove listener
        res.removeListener('socket', onSocket)

        if (finished) return
        if (eeMsg !== eeSocket) return

        // finished on first socket event
        eeSocket = first([[socket, 'error', 'close']], onFinish)
    }

    if (res.socket) {
        // socket already assigned
        onSocket(res.socket)
        return
    }

    // wait for socket to be assigned
    res.on('socket', onSocket)

}

/**
 * Attach the listener to the message.
 *
 * @param {object} res
 * @param {function} listener
 * @return {function}
 * @private
 */

function attachListener (res, listener) {
    var attached = res.__onFinished

    // create a private single listener with queue
    if (!attached || !attached.queue || !attached.queue.size) {
        attached = res.__onFinished = createListener(res)
        attachFinishedListener(res, attached)
    }

    attached.queue.add(listener)
}

/**
 * Create listener on message.
 *
 * @param {object} res
 * @return {function}
 * @private
 */

function createListener (res) {
    function listener (err) {
        if (res.__onFinished === listener) res.__onFinished = null
        if (!listener.queue || !listener.queue.size) return

        listener.queue.forEach(queueFunc => queueFunc(err, res));
        listener.queue.clear();
    }

    listener.queue = new Set();

    return listener
}

function first (stuff, done) {
    if (!Array.isArray(stuff)) {
        throw new TypeError('arg must be an array of [ee, events...] arrays')
    }

    var cleanups = []

    for (var i = 0; i < stuff.length; i++) {
        var arr = stuff[i]

        if (!Array.isArray(arr) || arr.length < 2) {
            throw new TypeError('each array member must be [ee, events...]')
        }

        var ee = arr[0]

        for (var j = 1; j < arr.length; j++) {
            var event = arr[j]
            var fn = listener(event, callback)

            // listen to the event
            ee.on(event, fn)
            // push this listener to the list of cleanups
            cleanups.push({
                ee: ee,
                event: event,
                fn: fn
            })
        }
    }

    function callback () {
        cleanup()
        done.apply(null, arguments)
    }

    function cleanup () {
        var x
        for (var i = 0; i < cleanups.length; i++) {
            x = cleanups[i]
            x.ee.removeListener(x.event, x.fn)
        }
    }

    function thunk (fn) {
        done = fn
    }

    thunk.cancel = cleanup

    return thunk
}

/**
 * Create the event listener.
 * @private
 */

function listener (event, done) {
    return function (arg1) {
        var args = new Array(arguments.length)
        var ee = this
        var err = event === 'error'
            ? arg1
            : null

        // copy args to prevent arguments escaping scope
        for (var i = 0; i < args.length; i++) {
            args[i] = arguments[i]
        }

        done(err, ee, event, args)
    }
}