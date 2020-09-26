/*
 * Copyright (c) 2018. Alexander Belov <asbel@alepiz.com>
 */

/*
Created from iconv-lite module
 */

const recode = {};
module.exports = recode;

// get from iconv-lite module encodings/sbcs-data-generated.js
const tables = {
    win1251: {
        "chars": "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя"
    },
    cp866: {
        "chars": "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ "
    },
    koi8r: {
        "chars": "─│┌┐└┘├┤┬┴┼▀▄█▌▐░▒▓⌠■∙√≈≤≥ ⌡°²·÷═║╒ё╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡Ё╢╣╤╥╦╧╨╩╪╫╬©юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ"
    }
};

// init first 127 characters of tables to ascii chars
for (var i = 0, asciiString = ''; i < 128; i++) asciiString += String.fromCharCode(i);
for(var codePage in tables) tables[codePage].chars = asciiString + tables[codePage].chars;

recode.decode = function(bufferToDecode, codePage) {

    let myTable = tables[codePage.toLowerCase()];
    if(!myTable) return bufferToDecode.toString();

    if(typeof bufferToDecode === 'string') bufferToDecode = Buffer.from(bufferToDecode);

    let newBuf = Buffer.alloc(bufferToDecode.length*2);
    let idx1 = 0, idx2 = 0;
    let decodeBuf = Buffer.from(myTable.chars, 'ucs2');
    for (let i = 0; i < bufferToDecode.length; i++) {
        idx1 = bufferToDecode[i]*2; idx2 = i*2;
        newBuf[idx2] = decodeBuf[idx1];
        newBuf[idx2+1] = decodeBuf[idx1+1];
    }
    return newBuf.toString('ucs2');
};

recode.encode = function(stringForEncode, codePage) {

    let myTable = tables[codePage.toLowerCase()];
    if(!myTable) return stringForEncode;

    // Encoding buffer.
    let encodeBuf = Buffer.alloc(65536, '?'.charCodeAt(0));

    for (let i = 0; i < myTable.chars.length; i++) encodeBuf[myTable.chars.charCodeAt(i)] = i;

    let buf = Buffer.alloc(stringForEncode.length);
    for (let i = 0; i < stringForEncode.length; i++) buf[i] = encodeBuf[stringForEncode.charCodeAt(i)];

    return buf;
};