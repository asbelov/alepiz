/*
* Connect - SQLite3
* Copyright (c) 2012 David Feinberg
* MIT Licensed
* forked from https://github.com/tnantoka/connect-sqlite
*/

/**
* Module dependencies.
*/

var Database = require('better-sqlite3');
//const log = require('../lib/log')(module);
var events = require('events');

/**
* One day in milliseconds.
*/

var oneDay = 86400000;

/**
* Return the SQLiteStore extending connects session Store.
*
* @param {object} connect
* @return {Function}
* @api public
*/

module.exports = function(connect) {

    /**
    * Connect's Store.
    */

    var Store = (connect.session) ? connect.session.Store : connect.Store;

    /**
    * Remove expired sessions from database.
    * @param {Object} store
    * @api private
    */

    function dbCleanup(store) {
        store.db.prepare('DELETE FROM ' + store.table + ' WHERE ? > expired').run([Date.now()]);
    }

    /**
    * Initialize SQLiteStore with the given options.
    *
    * @param {Object} options
    * @api public
    */

    function SQLiteStore(options) {
        options = options || {};
        Store.call(this, options);

        this.table = options.table || 'sessions';
        this.db = options.db || this.table;
        var dbPath;

        if (this.db.indexOf(':memory:') > -1 || this.db.indexOf('?mode=memory') > -1) {
            dbPath = this.db;
        } else {
            dbPath = (options.dir || '.') + '/' + this.db + '.db';
        }
        
        this.db = new Database(dbPath);
        this.client = new events.EventEmitter();
        var self = this;

        this.db.prepare('CREATE TABLE IF NOT EXISTS ' + this.table + ' (' + 'sid PRIMARY KEY, ' + 'expired, sess)').run();
        self.client.emit('connect');
        //log.warn('!!!Connect');
        dbCleanup(self);
        setInterval(dbCleanup, oneDay, self).unref();
    }
  
    /**
    * Inherit from Store.
    */

    SQLiteStore.prototype.__proto__ = Store.prototype;

    /**
    * Attempt to fetch session by the given sid.
    *
    * @param {String} sid
    * @param {Function} callback
    * @api public
    */

    SQLiteStore.prototype.get = function(sid, callback) {
        var now = Date.now();
        try {
            var row = this.db.prepare('SELECT sess FROM ' + this.table + ' WHERE sid = ? AND ? <= expired').get([sid, now]);
        } catch (err) {
            return callback(err);
        }
        //log.warn('!!!get ', row, ' ', row ? JSON.parse(row.sess) : 0);
        if (!row) return callback();
        callback(null, JSON.parse(row.sess));
    };


  /**
   * Commit the given `sess` object associated with the given `sid`.
   *
   * @param {String} sid
   * @param {string} sess
   * @param {Function} callback
   * @api public
   */

    SQLiteStore.prototype.set = function(sid, sess, callback) {
        var maxAge = sess.cookie.maxAge;
        var now = Date.now();
        var expired = maxAge ? now + maxAge : now + oneDay;
        sess = JSON.stringify(sess);

        try {
          this.db.prepare('INSERT OR REPLACE INTO ' + this.table + ' VALUES (?, ?, ?)').run([sid, expired, sess]);
        } catch(err) {
            if (typeof callback === 'function') return callback(err);
        }
        //log.warn('!!!Set ', sid, ' ', sess);
        if (typeof callback === 'function') callback();
    };


    /**
    * Destroy the session associated with the given `sid`.
    *
    * @param {String} sid
    * @param callback
    * @api public
    */

    SQLiteStore.prototype.destroy = function(sid, callback) {
        try {
            this.db.prepare('DELETE FROM ' + this.table + ' WHERE sid = ?').run([sid]);
        } catch (err) {
            return callback(err);
        }
        //log.warn('!!!destroy');
        callback();
    };


    /**
    * Fetch number of sessions.
    *
    * @param {Function} callback
    * @api public
    */

    SQLiteStore.prototype.length = function(callback) {
        try {
            var rows = this.db.prepare('SELECT COUNT(*) AS count FROM ' + this.table).all();
        } catch (err) {
            return callback(err);
        }
        //log.warn('!!!Length ', rows, ' ', rows[0].count);
        callback(null, rows[0].count);
    };

    /**
    * Clear all sessions.
    *
    * @param {Function} callback
    * @api public
    */

    SQLiteStore.prototype.clear = function (callback) {
        try {
            this.db.prepare('DELETE FROM ' + this.table).run();
        } catch(err) {
            return callback(err)
        }

        //log.warn('!!!Clear');
        callback(null, true);
    };
    
    
    /**
    * Touch the given session object associated with the given session ID.
    *
    * @param {string} sid
    * @param {object} session
    * @param {function} callback
    * @public
    */
    SQLiteStore.prototype.touch = function(sid, session, callback) {
        if (session && session.cookie && session.cookie.expires) {
            var now = new Date().getTime();
            var cookieExpires = new Date(session.cookie.expires).getTime();
            try {
                this.db.prepare('UPDATE ' + this.table + ' SET expired=? WHERE sid = ? AND ? <= expired')
                    .run([cookieExpires, sid, now]);
            } catch(err) {
                if (typeof callback === 'function') return callback(err);
            }
            if (typeof callback === 'function') callback(null, true);
        }
    };
    return SQLiteStore;
};
