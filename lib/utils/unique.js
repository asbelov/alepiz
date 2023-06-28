/*
 * Copyright © 2022. Alexander Belov. Contacts: <asbel@alepiz.com>
 */

const crypto = require('crypto');

module.exports = {
    createID: createUniqueID,
    createHash: createHash,
};

// 11.07.2015 15:57:15.000 - favicon.ico birthday
//const birthday = new Date(2015, 6, 11, 15, 57, 15).getTime();


/**
 * Generate unique integer like 42042290194283
 * @param {number} [max = 0xffffffffffff] - End of random range (exclusive)
 * @returns {number} - unique ID
 */
function createUniqueID (max = 0xffffffffffff) {
    return crypto.randomInt(max);
    // for real uud, like 8989cc5c-f11b-47dd-8569-64a7f4e4547e use
    //return crypto.randomUUID();
}

/**
 * Generate XOF shake256 6 bytes hash from string, number or object.
 * @param {Object|String|Number} init - source for make hash for alternate streams of the same init
 * @returns {number} - XOF shake256 6 bytes hash
 */
function createHash(init) {
    const str = typeof init === 'object' ? JSON.stringify(init) : init.toString();
// for outputLength: 7 may be return result f.e. 24219677581201592. And if you run
// console.log('24219677581201592 = ', 24219677581201592);
// will be printed 24219677581201592 = 24219677581201590
// const  hash = crypto.createHash('shake256', {outputLength: 7});

    const  hash = crypto.createHash('shake256', {outputLength: 6});
    hash.update(str);
    return parseInt(hash.digest('hex'), 16);
}


/**
 * Generate unique ID like 23019249303273700
 * @param {number} [timestamp = Date.now()] - timestamp. If undefined, set to Date.now()
 * @returns {number} - unique ID
function createUniqueID (timestamp ) {
    if(!timestamp) timestamp = Date.now();
    return parseInt((timestamp - birthday).toString() + Math.random().toString().substring(2, 7), 10);

    // for ID like "unique4o6rand3298id"
    //return timestamp.toString(36) + Math.random().toString(36).substring(2);
}
*/


/*
  simple but high quality 53-bit hash. It's quite fast, provides very good
  hash distribution, and because it outputs 53 bits, has significantly lower collision rates
  compared to any 32-bit hash.
  https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript

 You can optionally supply a seed (unsigned integer, 32-bit max)
 for alternate streams of the same input

 Technically, it is a 64-bit hash, that is, two uncorrelated 32-bit hashes computed in parallel,
 but JavaScript is limited to 53-bit integers. If convenient, the full 64-bit output can be used
 by altering the return statement with a hex string or array.
 return [h2>>>0, h1>>>0];
 or
 return (h2>>>0).toString(16).padStart(8,0)+(h1>>>0).toString(16).padStart(8,0);
 or
 return 4294967296n * BigInt(h2) + BigInt(h1);
 */
/**
 * Generate high quality 53-bit hash from string, number or object.
 * f.e. for "revenge" will generate 4051478007546757
 * @param {Object|String|Number} init - source for make hash
 * @param {number} [seed = 0] - optionally supply a seed (unsigned integer, 32-bit max)
 *  for alternate streams of the same init
 * @returns {number} - simple but high quality 53-bit hash
function createHash (init, seed = 0) {
    const str = typeof init === 'object' ? JSON.stringify(init) : init.toString();

    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);

}
*/