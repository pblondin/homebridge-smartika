#!/usr/bin/env node
'use strict';

/**
 * Test SmartikaCrypto module
 *
 * Uses test vectors from hub_security.md:
 *   MAC = 0x00, 0x12, 0x4B, 0x32, 0x89, 0xBB
 *   KEY = 0xA7, 0xE5, 0x8B, 0x22, 0xF0, 0xBE, 0x6, 0xAC, 0x24, 0x24, 0x39, 0xCB, 0x94, 0x41, 0x83, 0x8E
 *
 *   ENCRYPTED: 65 A8 EB 37 8C 0D 1A E0 4A 77 1B 57 48 67 BD FE
 *   DECRYPTED: FE 00 01 06 00 00 00 01 06 00 FF 05 05 05 05 05
 */

const crypto = require('../src/SmartikaCrypto');

console.log('SmartikaCrypto Test');
console.log('===================\n');

// Test vectors from documentation
const testMac = Buffer.from([0x00, 0x12, 0x4B, 0x32, 0x89, 0xBB]);
const expectedKey = Buffer.from([0xA7, 0xE5, 0x8B, 0x22, 0xF0, 0xBE, 0x06, 0xAC, 0x24, 0x24, 0x39, 0xCB, 0x94, 0x41, 0x83, 0x8E]);

const testEncrypted = Buffer.from([0x65, 0xA8, 0xEB, 0x37, 0x8C, 0x0D, 0x1A, 0xE0, 0x4A, 0x77, 0x1B, 0x57, 0x48, 0x67, 0xBD, 0xFE]);
const testDecrypted = Buffer.from([0xFE, 0x00, 0x01, 0x06, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0xFF, 0x05, 0x05, 0x05, 0x05, 0x05]);

let passed = 0;
let failed = 0;

// Test 1: Key generation
console.log('Test 1: Key Generation');
console.log('----------------------');
console.log(`MAC Address: ${testMac.toString('hex').toUpperCase()}`);

const generatedKey = crypto.generateKey(testMac);
console.log(`Generated Key: ${generatedKey.toString('hex').toUpperCase()}`);
console.log(`Expected Key:  ${expectedKey.toString('hex').toUpperCase()}`);

if (generatedKey.equals(expectedKey)) {
    console.log('Result: PASS\n');
    passed++;
} else {
    console.log('Result: FAIL\n');
    failed++;
}

// Test 2: Decryption (note: our decrypt() strips padding automatically)
console.log('Test 2: Decryption');
console.log('------------------');
console.log(`Encrypted: ${testEncrypted.toString('hex').toUpperCase()}`);

const decrypted = crypto.decrypt(testEncrypted, generatedKey);
// The expected without padding (first 11 bytes)
const expectedWithoutPadding = testDecrypted.subarray(0, 11);
console.log(`Decrypted: ${decrypted.toString('hex').toUpperCase()}`);
console.log(`Expected:  ${expectedWithoutPadding.toString('hex').toUpperCase()} (padding stripped)`);

if (decrypted.equals(expectedWithoutPadding)) {
    console.log('Result: PASS\n');
    passed++;
} else {
    console.log('Result: FAIL\n');
    failed++;
}

// Test 3: Encryption (encrypt then decrypt should give original)
console.log('Test 3: Encrypt/Decrypt Round Trip');
console.log('-----------------------------------');
const original = Buffer.from([0xFE, 0x00, 0x01, 0x06, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0xFF]);
console.log(`Original:  ${original.toString('hex').toUpperCase()}`);

const encrypted = crypto.encrypt(original, generatedKey);
console.log(`Encrypted: ${encrypted.toString('hex').toUpperCase()}`);

const roundTrip = crypto.decrypt(encrypted, generatedKey);
console.log(`Decrypted: ${roundTrip.toString('hex').toUpperCase()}`);

// Check if the decrypted starts with our original (might have padding stripped)
if (roundTrip.subarray(0, original.length).equals(original)) {
    console.log('Result: PASS\n');
    passed++;
} else {
    console.log('Result: FAIL\n');
    failed++;
}

// Test 4: MAC address parsing
console.log('Test 4: MAC Address Parsing');
console.log('---------------------------');

const macStr1 = '00:12:4B:32:89:BB';
const macStr2 = '00-12-4B-32-89-BB';
const macStr3 = '00124B3289BB';

const parsed1 = crypto.parseMacAddress(macStr1);
const parsed2 = crypto.parseMacAddress(macStr2);
const parsed3 = crypto.parseMacAddress(macStr3);

console.log(`"${macStr1}" -> ${parsed1.toString('hex').toUpperCase()}`);
console.log(`"${macStr2}" -> ${parsed2.toString('hex').toUpperCase()}`);
console.log(`"${macStr3}" -> ${parsed3.toString('hex').toUpperCase()}`);

if (parsed1.equals(testMac) && parsed2.equals(testMac) && parsed3.equals(testMac)) {
    console.log('Result: PASS\n');
    passed++;
} else {
    console.log('Result: FAIL\n');
    failed++;
}

// Summary
console.log('===================');
console.log(`Tests: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
