/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */


const log = require('../lib/log')(module);
const path = require('path');
const Conf = require('../lib/conf');
const confSqlite = new Conf('config/sqlite.json');
const Database = require('better-sqlite3');

/*
 Show compiled flags
WITH opts(n, opt) AS (
  VALUES(0, NULL)
  UNION ALL
  SELECT n + 1,
         sqlite_compileoption_get(n)
  FROM opts
  WHERE sqlite_compileoption_get(n) IS NOT NULL
)
SELECT opt
FROM opts;

result:
COMPILER=msvc-1916
ENABLE_FTS3
ENABLE_FTS3_PARENTHESIS
ENABLE_FTS5
ENABLE_GEOPOLY
ENABLE_JSON1
ENABLE_RTREE
ENABLE_STAT4
HAS_CODEC
MAX_ATTACHED=125
MAX_TRIGGER_DEPTH=100
SOUNDEX
TEMP_STORE=2
THREADSAFE=1
 */

var bestDB = dbInit();

var db = {
    maxVariableNumber: confSqlite.get('maxVariableNumber') || 99,
    init: dbInit,
};
module.exports = db;

function dbInit() {
    var dbPath = path.join(__dirname, '..', confSqlite.get('path'));
    const options = confSqlite.get('options');
    /* https://github.com/JoshuaWise/better-sqlite3/blob/HEAD/docs/api.md
    Various options are accepted:
    readonly: open the database connection in readonly mode (default: false).
    fileMustExist: if the database does not exist, an Error will be thrown instead of creating a new file. This option is ignored for in-memory, temporary, or readonly database connections (default: false).
    timeout: the number of milliseconds to wait when executing queries on a locked database, before throwing a SQLITE_BUSY error (default: 5000).
    verbose: provide a function that gets called with every SQL string executed by the database connection (default: null).
    */

    if(typeof options === 'object') {
        if (options.verbose) options.verbose = log.info;
        else delete options.verbose
    }

    try {
        var bestDB = new Database(dbPath, options);
        bestDB.function('regexp', { deterministic: true }, (regex, text) => {
            return new RegExp(regex).test(text) ? 1 : 0;
        });
    } catch (err) {
        log.throw('Can\'t open DB ', dbPath, ': ', err.message);
    }

    if(!options.readonly) {
        try {
            bestDB.pragma('foreign_keys = "ON"');
            bestDB.pragma('encoding = "UTF-8"');
            bestDB.pragma('journal_mode = "WAL"');
        } catch (err) {
            log.warn('Can\'t set some required pragma modes to ', dbPath, ': ', err.message);
        }
    }

    return bestDB;
}

db.close = function (callback) {
    try {
        bestDB.close();
        if (typeof callback === 'function') return callback();
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('close(): ' + err.message));
        throw err
    }
}

db.run = function () {
    var args = Array.prototype.slice.call(arguments);
    var sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();
    if(!args.length) {
        try {
            //console.log('exec ', sql);
            bestDB.exec(sql.replace(/"/g, '\''));
        } catch (err) {
            //console.log('err exec ', sql, '; ', typeof callback === 'function', err);
            if (typeof callback === 'function') {
                return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
            }
            else throw err;
        }
        //console.log('done exec ', sql, '; ', typeof callback === 'function');
        if (typeof callback === 'function') return callback();
        return;
    }

    try {
        var bestStmt = bestDB.prepare(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('prepare(): ' + err.message + '; SQL: ' + sql));
        }
        else throw err;
    }

    try {
        var info = bestStmt.run.apply(bestStmt, convertNamedParam(args));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('run(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
        }
        else throw err;
    }

    if (typeof callback === 'function') callback(null, info);
    else return info;
}

db.get = function () {
    var args = Array.prototype.slice.call(arguments);
    var sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();
    try {
        var bestStmt = bestDB.prepare(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('prepare(): ' + err.message + '; SQL: ' + sql));
        else throw err;
    }
    try {
        var res = bestStmt.get.apply(bestStmt, convertNamedParam(args));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('get(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
        }
        else throw err;
    }

    if (typeof callback === 'function') return callback(null, res);
    else return res;
}

db.all = function () {
    var args = Array.prototype.slice.call(arguments);
    var sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();
    try {
        var bestStmt = bestDB.prepare(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('prepare(): ' + err.message + '; SQL: ' + sql));
        else throw err;
    }

    //console.log('all: ', sql, args, typeof callback === 'function')
    try {
        var res = bestStmt.all.apply(bestStmt, convertNamedParam(args));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('all(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
        }
        else throw err;
    }

    if (typeof callback === 'function') return callback(null, res);
    else return res;
}

db.exec = function () {
    var args = Array.prototype.slice.call(arguments);
    var sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

    // db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {});
    if(sql.toUpperCase().trim().indexOf('PRAGMA ') === 0) {
        sql = sql.replace(/\s*PRAGMA */i, '');
        try {
            bestDB.pragma(sql.replace(/"/g, '\''));
        } catch (err) {
            if (typeof callback === 'function') return callback(new Error('pragma(): ' + err.message + '; SQL: ' + sql));
            else throw err;
        }
        if (typeof callback === 'function') return callback();
        return;
    }

    try {
        bestDB.exec(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
        else throw err;
    }
    if (typeof callback === 'function') return callback();
}

//db.serialize = function (callback) { callback(); }

db.prepare = function () {
    return new STMT(Array.prototype.slice.call(arguments));
}

function STMT(prepareArgs) {
    var bestStmt, prepareError;

    var sql = prepareArgs.shift();
    if (prepareArgs.length > 0 && typeof prepareArgs[prepareArgs.length - 1] === 'function') {
        var callback = prepareArgs.pop();
        if (typeof callback === 'function') setTimeout(callback, 0).unref();
    }

    function prepare() {
        try {
            bestStmt = prepareArgs.length ?
                bestDB.prepare(sql.replace(/"/g, '\'')).bind(convertNamedParam(prepareArgs)) :
                bestDB.prepare(sql.replace(/"/g, '\''));
        } catch (err) {
            prepareError = new Error('prepare(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(prepareArgs));
        }
    }

    this.run = function () {
        var args = Array.prototype.slice.call(arguments);
        if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

        if (prepareError) {
            if (typeof callback === 'function') return callback(prepareError);
            else throw prepareError;
        }
        if(!bestStmt) prepare();

        try {
            var info = bestStmt.run.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('stmt run(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
            } else throw err;
        }

        if (typeof callback === 'function') callback(null, info);
        else return info;
    }

    this.get = function () {
        var args = Array.prototype.slice.call(arguments);
        if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

        if (prepareError) {
            if (typeof callback === 'function') return callback(prepareError);
            else throw prepareError;
        }
        if(!bestStmt) prepare();

        try {
            var res = bestStmt.get.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('stmt get(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
            } else throw err;
        }
        if (typeof callback === 'function') return callback(null, res);
        else return res;
    }

    this.all = function () {
        var args = Array.prototype.slice.call(arguments);
        if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

        if (prepareError) {
            if (typeof callback === 'function') return callback(prepareError);
            else throw prepareError;
        }
        if(!bestStmt) prepare();

        try {
            var res = bestStmt.all.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('stmt all(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' + JSON.stringify(args)));
            } else throw err;
        }
        if (typeof callback === 'function') return callback(null, res);
        else return res;
    }

    this.finalize = function() {};
}

/** Check for named SQL parameters and remove first "$" character,
 * f.e. [{"$user":"asbel","$actionID":"data_browser"}] => [{"user":"asbel","actionID":"data_browser"}]
 * @param {Array} args - SQL parameters
 * @returns {Array} - Array with object of named SQL parameters without first "$" character
 */
function convertNamedParam(args) {
    if(args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) return args;
    var newArgs = {};
    for(var key in args[0]) {
        newArgs[key.substring(1)] = args[0][key];
    }

    return [newArgs]
}