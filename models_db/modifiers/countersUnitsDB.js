/*
 * Copyright © 2020. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

/**
 * Created by Alexander Belov on 30.08.2015.
 */
const log = require('../../lib/log')(module);
const db = require('../db');
const unique = require('../../lib/utils/unique');

var unitsDB = {};
module.exports = unitsDB;

/**
 * Add a new counter unit
 * @param {string} unitName new unit name
 * @param {string } abbreviation unit abbreviation
 * @param {string} prefixes unit prefixes
 * @param {string} multiplies unit multiplies
 * @param {0|1} onlyPrefixes
 * @param {function(Error)|function()} callback callback(err)
 */
unitsDB.addCounterUnit = function(unitName, abbreviation, prefixes, multiplies, onlyPrefixes, callback) {
    log.debug('New unit parameters: ', unitName, abbreviation, prefixes, multiplies, onlyPrefixes);

    if(!unitName) {
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
        prefixes.replace(/\s*[;,]\s*/, ',').split(',').length !==
            multiplies.replace(/\s*[;,]\s*/, ',').split(',').length) {
        err = new Error('Error inserting counters unit into database: number of prefixes is not equal to number of multiplies');
        return callback(err);
    }

    if(Number(onlyPrefixes) !== 0) onlyPrefixes = 1;
    else onlyPrefixes = 0;

    // The hash algorithm is too simple. There may be problems with renaming
    const id = unique.createHash(unitName + abbreviation + prefixes + multiplies + onlyPrefixes);

    db.run(
        'INSERT INTO countersUnits (id, name, abbreviation, prefixes, multiplies, onlyPrefixes) VALUES ' +
        '($id, $name, $abbreviation, $prefixes, $multiplies, $onlyPrefixes)', {
            $id: id,
            $name: unitName,
            $abbreviation: abbreviation,
            $prefixes: prefixes,
            $multiplies: multiplies,
            $onlyPrefixes: onlyPrefixes
        },
        function(err) {
            if (err) {
                log.error('Error inserting counter unit ' + unitName + ' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    )
};

/**
 * Edit counter unit
 * @param {number} unitID unit ID
 * @param {string} newUnitName new unit name
 * @param {string } abbreviation unit abbreviation
 * @param {string} prefixes unit prefixes
 * @param {string} multiplies unit multiplies
 * @param {0|1} onlyPrefixes
 * @param {function(Error)|function()} callback callback(err)
 */
unitsDB.editCounterUnit = function(unitID, newUnitName, abbreviation, prefixes, multiplies, onlyPrefixes, callback) {
    log.debug('Edit unit parameters: ', unitID, newUnitName, abbreviation, prefixes, multiplies, onlyPrefixes);
    if(!unitID) {
        var err = new Error('Error editing counters unit: initial unit name is not set');
        return callback(err);
    }

    if(!newUnitName) {
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
        'UPDATE countersUnits SET name=$newUnitName, abbreviation=$abbreviation, prefixes=$prefixes, ' +
        'multiplies=$multiplies, onlyPrefixes=$onlyPrefixes WHERE id=$oldUnitID', {
            $newUnitName: newUnitName,
            $oldUnitID: unitID,
            $abbreviation: abbreviation,
            $prefixes: prefixes,
            $multiplies: multiplies,
            $onlyPrefixes: onlyPrefixes
        }, function(err) {
            if (err) {
                log.error('Error changing name for counter unit from ', unitID, ' to ',
                    newUnitName, ' into database: ', err.message);
                return callback(err);
            }
            callback();
        }
    );
};

/**
 * Remove counter unit
 * @param {number} unitID unit ID
 * @param {function(Error)|function()} callback callback(err)
 */
unitsDB.removeCounterUnit = function(unitID, callback) {
    log.debug('Remove unit parameters: ', unitID);

    if(!unitID) return callback(new Error('Error removing counters unit from database: unit name is not set'));

    db.run('DELETE FROM countersUnits WHERE id=?', unitID, function(err){
        if(err) return callback(new Error('Error removing counter unit ' + unitID + ' from database: ' + err.message));

        callback();
    })
};