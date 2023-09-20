/*
 * Copyright © 2021. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const log = require('../lib/log')(module);
const async = require('async');
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
var slowQueryExecutionTime = 20000;

var db = {
    maxVariableNumber: confSqlite.get('maxVariableNumber') || 99,
    init: dbInit,
};
module.exports = db;

/**
 * Open the database from sqlite.json: path parameters
 * @return {Database} better-sqlite3 database object
 */
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
            bestDB.pragma('busy_timeout = 30000'); // DB Lock timeout (not working)
        } catch (err) {
            log.warn('Can\'t set some required pragma modes to ', dbPath, ': ', err.message);
        }
    }

    return bestDB;
}

/**
 * Prepare SQL statement and return it
 * @param {Array} args an array of args. First element is a SQL query, last element is a callback function
 * @return {[]} return an array [bestStmt, callback] or [] if error occurred and run callback(err)
 * if callback was specified in the from args
 */
function prepareCommonArgs (args) {
    var sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();


    try {
        var bestStmt = bestDB.prepare(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') {
            callback(new Error('prepare(): ' + err.message + '; SQL: ' + sql));
            return [];
        } else throw err;
    }

    return [bestStmt, callback];
}

/**
 * Close the database
 * @param {function(Error)|function()} [callback] if callback specified, run callback(err) after close database.
 */
db.close = function (callback) {
    try {
        bestDB.close();
        if (typeof callback === 'function') return callback();
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('close(): ' + err.message));
        throw err
    }
}

/**
 * Run SQL query with database modification
 * @param {string} sql SQL query for database modification
 * @param {...*, function(Error)|function()|function(null, {changes: number, lastInsertRowid: number})} [args]
 *      SQL parameters and callback as a last parameter. callback(err, {changes: number, lastInsertRowid: number})
 *      where info described at the example
 * @return {{changes: number, lastInsertRowid: number}|undefined} return {changes: number, lastInsertRowid: number}
 *      if callback undefined
 * @example
 * returned info object has two properties
 * info.changes: the total number of rows that were inserted, updated, or deleted by this operation.
 *  Changes made by foreign key actions or trigger programs do not count.
 * info.lastInsertRowid: the rowid of the last row inserted into the database
 *  (ignoring those caused by trigger programs). If the current statement did not insert any rows into the database,
 *  this number should be completely ignored.
 */
db.run = function (sql, args) {
    args = Array.prototype.slice.call(arguments);
    sql = args.shift();
    if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

    var operationSuccessfullyComplete = false,
        retryAttemptsAfterDBLock = Number(confSqlite.get('retryAttemptsAfterDBLock'))  || 20,
        retryAttemptsPause = Number(confSqlite.get('retryAttemptsPause'))  || 500;

    if(!args.length) {
        async.eachSeries([...Array(retryAttemptsAfterDBLock).keys()], function(idx, callback) {
            if(operationSuccessfullyComplete) return callback();
            var startQueryTime = Date.now();
            try {
                //console.log('exec ', sql);
                bestDB.exec(sql.replace(/"/g, '\''));
            } catch (err) {
                // if DB is locked, try to retry operation
                if(err.message.indexOf('database is locked') !== -1) {
                    if(idx + 1 < retryAttemptsAfterDBLock) {
                        log.debug('Try to retry ', idx + 1, '/',  retryAttemptsAfterDBLock, ' db.exec: ', err.message);
                        return setTimeout(callback, retryAttemptsPause);
                    }
                    log.warn(err.message, '; retryAttemptsAfterDBLock: ', retryAttemptsAfterDBLock,
                        '; retryAttemptsPause: ', retryAttemptsPause, '; sql: ', sql, '; args: ', args);
                } else return callback(err);
            }
            if(Date.now - startQueryTime >
                (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
                log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
                    'sec); SQL: ', sql, '; args: ', args);
            }

            operationSuccessfullyComplete = true;
            callback();
        }, function (err) {
                if(err) {
                    //console.log('err exec ', sql, '; ', typeof callback === 'function', err);
                    if (typeof callback === 'function') {
                        return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
                    } else throw err;
                }

                if (typeof callback === 'function') return callback();
                //console.log('done exec ', sql, '; ', typeof callback === 'function');
        });
        return;
    }

    var info;
    async.eachSeries([...Array(retryAttemptsAfterDBLock).keys()], function(idx, callback) {
        if(operationSuccessfullyComplete) return callback();

        try {
            var bestStmt = bestDB.prepare(sql.replace(/"/g, '\''));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('prepare(): ' + err.message + '; SQL: ' + sql));
            }
            else throw err;
        }

        var startQueryTime = Date.now();
        try {
            info = bestStmt.run.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            // if DB is locked, try to retry operation
            if(err.message.indexOf('database is locked') !== -1) {
                if(idx + 1 < retryAttemptsAfterDBLock) {
                    log.debug('Try to retry ', idx + 1, '/',  retryAttemptsAfterDBLock, ' db.run: ', err.message);
                    return setTimeout(callback, retryAttemptsPause);
                }
                log.warn(err.message, '; retryAttemptsAfterDBLock: ', retryAttemptsAfterDBLock,
                    '; retryAttemptsPause: ', retryAttemptsPause, '; sql: ', sql, '; args: ', args);
            } else return callback(err);
        }
        if(Date.now - startQueryTime >
            (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
            log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
                'sec); SQL: ', sql, '; args: ', args);
        }
        operationSuccessfullyComplete = true;
        callback();
    }, function (err) {
        if(err) {
            //console.log('err exec ', sql, '; ', typeof callback === 'function', err);
            if (typeof callback === 'function') {
                return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
            } else throw err;
        }

        if (typeof callback === 'function') callback(null, info);
    });
}

/**
 * Run SQL query and return the first row retrieved by the query
 * @param {string} sql SQL query for database modification
 * @param {...*} [args] SQL parameters and callback as a last parameter. callback(err, row) where row is an object
 *  with the first row retrieved by the query.If data was not found, return undefined
 * @return {Object} return row if callback undefined
 */
db.get = function (sql, args) {
    args = Array.prototype.slice.call(arguments);
    var [bestStmt, callback] = prepareCommonArgs(args);
    if(!bestStmt) return;

    var startQueryTime = Date.now();
    try {
        var row = bestStmt.get.apply(bestStmt, convertNamedParam(args));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('get(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' +
                JSON.stringify(args, null, 4)));
        }
        else throw err;
    }
    if(Date.now - startQueryTime >
        (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
        log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
            'sec); SQL: ', sql, '; args: ', args);
    }

    if (typeof callback === 'function') return callback(null, row);
    else return row;
}

/**
 * Run SQL query and return all matched rows retrieved by the query
 * @param {string} sql SQL query for database modification
 * @param {...*} [args] SQL parameters and callback as a last parameter. callback(err, rows) where rows is an array
 *  with the objects retrieved by the query. If data was not found, return empty array []
 *  @return {Array<Object>|undefined} return rows if callback undefined
 */
db.all = function (sql, args) {
    args = Array.prototype.slice.call(arguments);
    var [bestStmt, callback] = prepareCommonArgs(args);
    if(!bestStmt) return;

    //console.log('all: ', sql, args, typeof callback === 'function')
    var startQueryTime = Date.now();
    try {
        var rows = bestStmt.all.apply(bestStmt, convertNamedParam(args));
    } catch (err) {
        if (typeof callback === 'function') {
            return callback(new Error('all(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' +
                JSON.stringify(args, null, 4)));
        }
        else throw err;
    }
    if(Date.now - startQueryTime >
        (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
        log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
            'sec); SQL: ', sql, '; args: ', args);
    }

    if (typeof callback === 'function') return callback(null, rows);
    else return rows;
}

/**
 * Run PRAGMA for set SQLite database parameters or executes given SQL query
 * @param {string} sql SQL PRAGMA or SQL query. Query can contain multiple SQL statement
 * @param {function(Error)|function()|function(null, *)} [callback] callback(err, res) where res is an PRAGMA
 *  execution result
 */
db.exec = function (sql, callback) {
    // db.exec('PRAGMA wal_checkpoint(TRUNCATE)', function(err) {});
    if(sql.toUpperCase().trim().indexOf('PRAGMA ') === 0) {
        sql = sql.replace(/\s*PRAGMA */i, '');
        try {
            var res = bestDB.pragma(sql.replace(/"/g, '\''));
        } catch (err) {
            if (typeof callback === 'function') return callback(new Error('pragma(): ' + err.message + '; SQL: ' + sql));
            else throw err;
        }
        if (typeof callback === 'function') return callback(null, res);
        return;
    }

    var startQueryTime = Date.now();
    try {
        bestDB.exec(sql.replace(/"/g, '\''));
    } catch (err) {
        if (typeof callback === 'function') return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
        else throw err;
    }
    if(Date.now - startQueryTime >
        (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
        log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
            'sec); SQL: ', sql);
    }
    if (typeof callback === 'function') return callback();
}

//db.serialize = function (callback) { callback(); }

/**
 * Prepare SQL statement
 * @param {string} sql SQL query for database modification
 * @param {...*} [prepareArgs] SQL parameters and callback as a last parameter. callback(err)
 * @return {STMT} SQL statement
 */
db.prepare = function (sql, prepareArgs) {
    return new STMT(sql, Array.prototype.slice.call(arguments));
}

/**
 * @param {string} sql SQL query for database modification
 * @param prepareArgs
 * @constructor
 */
function STMT(sql, prepareArgs) {
    var bestStmt, prepareError;

    sql = prepareArgs.shift();
    if (prepareArgs.length > 0 && typeof prepareArgs[prepareArgs.length - 1] === 'function') {
        var callback = prepareArgs.pop();
        if (typeof callback === 'function') {
            var t = setTimeout(callback, 0);
            t.unref();
        }
    }

    function prepareArgsSTMT (args) {
        if(args.length > 0 && typeof args[args.length - 1] === 'function') var callback = args.pop();

        if (prepareError) {
            if (typeof callback === 'function') {
                callback(prepareError);
                return [];
            } else throw prepareError;
        }
        if(!bestStmt) {
            try {
                bestStmt = prepareArgs.length ?
                    bestDB.prepare(sql.replace(/"/g, '\'')).bind(convertNamedParam(prepareArgs)) :
                    bestDB.prepare(sql.replace(/"/g, '\''));
            } catch (err) {
                prepareError = new Error('prepare(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' +
                    JSON.stringify(prepareArgs, null, 4));
                if (typeof callback === 'function') {
                    callback(prepareError);
                    return [];
                } else throw prepareError;
            }
        }

        return [bestStmt, callback];
    }

    /**
     * Run prepared statement with database modification
     * @param {...*} [args] SQL parameters and callback as a last parameter. callback(err, info) where info described at
     *  the example
     * @return {*} return info if callback undefined
     * @example
     * returned info object has two properties
     * info.changes: the total number of rows that were inserted, updated, or deleted by this operation.
     *  Changes made by foreign key actions or trigger programs do not count.
     * info.lastInsertRowid: the rowid of the last row inserted into the database
     *  (ignoring those caused by trigger programs). If the current statement did not insert any rows into the database,
     *  this number should be completely ignored.
     */

    this.run = function (args) {
        args = Array.prototype.slice.call(arguments);
        var [bestStmt, callback] = prepareArgsSTMT(args);
        if(!bestStmt) return;

        var operationSuccessfullyComplete = false,
            retryAttemptsAfterDBLock = Number(confSqlite.get('retryAttemptsAfterDBLock'))  || 5,
            retryAttemptsPause = Number(confSqlite.get('retryAttemptsPause'))  || 300,
            info;

        async.eachSeries([...Array(retryAttemptsAfterDBLock).keys()], function(idx, callback) {
            if(operationSuccessfullyComplete) return callback();

            var startQueryTime = Date.now();
            try {
                info = bestStmt.run.apply(bestStmt, convertNamedParam(args));
            } catch (err) {
                // if DB is locked, try to retry operation
                if(err.message.indexOf('database is locked') !== -1) {
                    if(idx + 1 < retryAttemptsAfterDBLock) {
                        log.debug('Try to retry ', idx + 1, '/',  retryAttemptsAfterDBLock, ' stmt.run: ', err.message);
                        return setTimeout(callback, retryAttemptsPause);
                    }
                    log.warn(err.message, '; retryAttemptsAfterDBLock: ', retryAttemptsAfterDBLock,
                        '; retryAttemptsPause: ', retryAttemptsPause, '; sql: ', sql, '; args: ', args);
                } else return callback(err);
            }
            if(Date.now - startQueryTime >
                (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
                log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
                    'sec); SQL: ', sql, '; args: ', args);
            }
            operationSuccessfullyComplete = true;
            callback();
        }, function (err) {
            if(err) {
                //console.log('err exec ', sql, '; ', typeof callback === 'function', err);
                if (typeof callback === 'function') {
                    return callback(new Error('exec(): ' + err.message + '; SQL: ' + sql));
                } else throw err;
            }

            if (typeof callback === 'function') return callback(null, info);
            //console.log('done exec ', sql, '; ', typeof callback === 'function');
        });
    }

    /**
     * Run prepared statement and return the first row retrieved by the query
     * @param {...*} [args] SQL parameters and callback as a last parameter. callback(err, row) where row is an object
     *  with the first row retrieved by the query.If data was not found, return undefined
     * @return {Object} return row if callback undefined
     */
    this.get = function (args) {
        args = Array.prototype.slice.call(arguments);
        var [bestStmt, callback] = prepareArgsSTMT(args);
        if(!bestStmt) return;

        var startQueryTime = Date.now();
        try {
            var res = bestStmt.get.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('stmt get(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' +
                    JSON.stringify(args, null, 4)));
            } else throw err;
        }
        if(Date.now - startQueryTime >
            (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
            log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
                'sec); SQL: ', sql, '; args: ', args);
        }
        if (typeof callback === 'function') return callback(null, res);
        else return res;
    }

    /**
     * Run prepared statement and return all matched rows retrieved by the query
     * @param {...*} [args] SQL parameters and callback as a last parameter. callback(err, rows) where rows is an array
     *  with the objects retrieved by the query. If data was not found, return empty array []
     *  @return {Array<Object>|undefined} return rows if callback undefined
     */
    this.all = function (args) {
        args = Array.prototype.slice.call(arguments);
        var [bestStmt, callback] = prepareArgsSTMT(args);
        if(!bestStmt) return;

        var startQueryTime = Date.now();
        try {
            var res = bestStmt.all.apply(bestStmt, convertNamedParam(args));
        } catch (err) {
            if (typeof callback === 'function') {
                return callback(new Error('stmt all(): ' + err.message + '; SQL: ' + sql + '; ARGS: ' +
                    JSON.stringify(args, null, 4)));
            } else throw err;
        }
        if(Date.now - startQueryTime >
            (confSqlite.get('slowQueryExecutionTime') || slowQueryExecutionTime)) {
            log.warn('The SQL query was executed slowly (', Math.round((Date.now - startQueryTime) / 1000),
                'sec); SQL: ', sql, '; args: ', args);
        }
        if (typeof callback === 'function') return callback(null, res);
        else return res;
    }

    /**
     * Finalize SQL query
     */
    this.finalize = function() {};
}

/**
 * Check for named SQL parameters and remove first "$" character,
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