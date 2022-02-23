/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
var log = require('../lib/log')(module);
var db = require('./db');

var unitsDB = {};
module.exports = unitsDB;

unitsDB.getUnits = function(callback) {
    db.all('SELECT * FROM countersUnits', [],  function(err, units) {
        if(err) {
            log.error('Error when getting units from countersUnits table: ' +err.message);
            return callback(err);
        }
        callback(null, units);
    });
};

unitsDB.new = function(unit, abbreviation, prefixes, multiplies, onlyPrefixes, callback) {
    log.debug('New unit parameters: ', unit, abbreviation, prefixes, multiplies, onlyPrefixes);

    if(!unit) {
        var err = new Error('Error inserting counters unit into database: unit name is not set');
        return callback(err);
    }

    if(!abbreviation){
        err = new Error('Error inserting counters unit into database: abbreviation is not set');
        return callback(err);
    }

    if(!prefixes && multiplies) {
        err = new Error('Error inserting counters unit into database: prefixes is set but multiplies is not set');
        return callback(err);
    }

    if(prefixes && !multiplies) {
        err = new Error('Error inserting counters unit into database: prefixes is not set but multiplies is set');
        return callback(err);
    }

    if(prefixes && multiplies &&
        prefixes.replace(/\s*[;,]\s*/, ',').split(',').length !== multiplies.replace(/\s*[;,]\s*/, ',').split(',').length) {
        err = new Error('Error inserting counters unit into database: count of prefixes is not equal to count of multiplies');
        return callback(err);
    }

    if(Number(onlyPrefixes) !== 0) onlyPrefixes = 1;
    else onlyPrefixes = 0;

    db.run(
        'INSERT INTO countersUnits (name, abbreviation, prefixes, multiplies, onlyPrefixes) VALUES ' +
        '($name, $abbreviation, $prefixes, $multiplies, $onlyPrefixes)', {
            $name: unit,
            $abbreviation: abbreviation,
            $prefixes: prefixes,
            $multiplies: multiplies,
            $onlyPrefixes: onlyPrefixes
        },
        function(err) {
            if (err) {
                log.error('Error inserting counter unit ' + unit + ' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    )
};

unitsDB.edit = function(unitID, newUnit, abbreviation, prefixes, multiplies, onlyPrefixes, callback) {
    log.debug('Edit unit parameters: ', unitID, newUnit, abbreviation, prefixes, multiplies, onlyPrefixes);
    if(!unitID) {
        var err = new Error('Error editing counters unit: initial unit name is not set');
        return callback(err);
    }

    if(!newUnit) {
        err = new Error('Error editing counters unit: new unit name is not set');
        return callback(err);
    }

    if(!abbreviation){
        err = new Error('Error editing counters unit: abbreviation is not set');
        return callback(err);
    }

    if(!prefixes && multiplies) {
        err = new Error('Error editing counters unit: prefixes is set but multiplies is not set');
        return callback(err);
    }

    if(prefixes && !multiplies) {
        err = new Error('Error editing counters unit: prefixes is not set but multiplies is set');
        return callback(err);
    }

    if(prefixes && multiplies &&
        prefixes.replace(/\s*[;,]\s*/, ',').split(',').length !== multiplies.replace(/\s*[;,]\s*/, ',').split(',').length) {
        err = new Error('Error editing counters unit: count of prefixes is not equal to count of multiplies');
        return callback(err);
    }

    if(Number(onlyPrefixes) !== 0) onlyPrefixes = 1;
    else onlyPrefixes = 0;

    db.run(
        'UPDATE countersUnits SET name=$newUnit, abbreviation=$abbreviation, prefixes=$prefixes, ' +
        'multiplies=$multiplies, onlyPrefixes=$onlyPrefixes WHERE id=$oldUnitID', {
            $newUnit: newUnit,
            $oldUnitID: unitID,
            $abbreviation: abbreviation,
            $prefixes: prefixes,
            $multiplies: multiplies,
            $onlyPrefixes: onlyPrefixes
        }, function(err) {
            if (err) {
                log.error('Error changing name for counter unit from ' + unitID + ' to '+newUnit+' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    );
};

unitsDB.remove = function(unitID, callback) {
    log.debug('Remove unit parameters: ', unitID);

    if(!unitID) return callback(new Error('Error removing counters unit from database: unit name is not set'));

    db.run('DELETE FROM countersUnits WHERE id=?', unitID, function(err){
        if(err) return callback(new Error('Error removing counter unit ' + unitID + ' from database: ' + err.message));

        callback();
    })
};
