'use strict';

const crypto = require('crypto');

// Constants from hub_security.md
const PRIVATE_KEY = Buffer.from([
    0x42, 0x6B, 0xD6, 0xCD, 0x00, 0x59, 0x5B, 0x03, 0xFC, 0xCB, 0xF4, 0xDD, 0x09, 0x25, 0x85, 0x1B,
    0x3F, 0x91, 0x93, 0x81, 0xB3, 0x19, 0xB2, 0xD1, 0x41, 0x5B, 0xF7, 0x7D, 0xFD, 0x4F, 0x4C, 0xD3,
    0x5E, 0x00, 0xE1, 0xC0, 0x89, 0xA1, 0x94, 0xD4, 0xF6, 0xEA, 0x77, 0xAA, 0xC5, 0x1B, 0x66, 0x67,
    0xEE, 0x96, 0xCD, 0x6E, 0xC3, 0x7D, 0x8A, 0xF1, 0xD0, 0x2A, 0x10, 0x98, 0xA7, 0xF5, 0xB1, 0xC3,
    0x90, 0x3A, 0x4A, 0xB7, 0xB9, 0xE5, 0x0E, 0x47, 0xE5, 0xA0, 0xD2, 0x1B, 0x17, 0xD0, 0x8B, 0x5A,
    0x55, 0x7C, 0x50, 0xBA, 0x02, 0x66, 0xA7, 0xC1, 0xCC, 0x4D, 0x67, 0x3E, 0xD1, 0xB7, 0xEE, 0xC0,
    0xE3, 0x34, 0x00, 0x1F, 0x89, 0x7A, 0x0E, 0xC7, 0xC0, 0x49, 0x2F, 0xEE, 0x01, 0x7B, 0x94, 0x52,
    0x93, 0x22, 0xC0, 0xB9, 0xBB, 0x2C, 0x46, 0xD1, 0xBD, 0x65, 0x5F, 0x91, 0x56, 0x4B, 0x17, 0xCD
]);

const BASE_KEY = Buffer.from([
    0xB9, 0x43, 0x34, 0xB5, 0xBE, 0xDE, 0x9E, 0x05, 0x58, 0xE2, 0xE6, 0xD8, 0xCE, 0xBA, 0x7E, 0x47
]);

const IV = Buffer.from([
    0xA7, 0x2D, 0xD1, 0x29, 0x20, 0xDF, 0xAD, 0x61, 0x82, 0x03, 0x98, 0xFA, 0x9E, 0xEF, 0x59, 0x20
]);

const BLOCK_SIZE = 16;

/**
 * Generate encryption key from hub MAC address
 * Uses specific bytes from the MAC address as per hub simulator's security.py
 *
 * @param {Buffer} macAddress - 6 bytes MAC address
 * @returns {Buffer} - 16 bytes encryption key
 */
function generateKey(macAddress) {
    if (macAddress.length !== 6) {
        throw new Error('MAC address must be 6 bytes');
    }

    // Insert MAC address bytes in specific positions (from security.py)
    // seed = hub_id[-6:] (entire MAC for 6-byte MAC)
    // base_key[9] = seed[0], base_key[7] = seed[3], base_key[13] = seed[4], base_key[3] = seed[5]
    const baseKey = Buffer.from(BASE_KEY);
    baseKey[9] = macAddress[0];
    baseKey[7] = macAddress[3];
    baseKey[13] = macAddress[4];
    baseKey[3] = macAddress[5];

    // 8-pass encryption (1024-bit)
    let result = baseKey;
    for (let i = 0; i < 8; i++) {
        const key = PRIVATE_KEY.subarray(i * 16, (i + 1) * 16);
        const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
        cipher.setAutoPadding(false);
        result = Buffer.concat([cipher.update(result), cipher.final()]);
    }

    return result;
}

/**
 * Pad message to multiple of 16 bytes with random data
 * @param {Buffer} message
 * @returns {Buffer}
 */
function pad(message) {
    const remainder = message.length % BLOCK_SIZE;
    if (remainder === 0) {
        return message;
    }
    const paddingLength = BLOCK_SIZE - remainder;
    const padding = crypto.randomBytes(paddingLength);
    return Buffer.concat([message, padding]);
}

/**
 * Encrypt message using AES-128-CBC
 * @param {Buffer} message - Message to encrypt
 * @param {Buffer} key - 16 bytes encryption key
 * @returns {Buffer} - Encrypted message
 */
function encrypt(message, key) {
    const paddedMessage = pad(message);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, IV);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(paddedMessage), cipher.final()]);
}

/**
 * Decrypt message using AES-128-CBC
 * @param {Buffer} message - Encrypted message
 * @param {Buffer} key - 16 bytes encryption key
 * @returns {Buffer} - Decrypted message
 */
function decrypt(message, key) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(message), decipher.final()]);

    // Remove padding by finding actual command length
    if (decrypted.length > 11) {
        const startMark = decrypted.readUInt16BE(0);
        if (startMark === 0xFE00 || startMark === 0xFE01) {
            const dataLen = decrypted.readUInt16BE(4);
            const cmdLen = dataLen + 11; // header(8) + fcs(1) + end(2)
            if (cmdLen <= decrypted.length) {
                return decrypted.subarray(0, cmdLen);
            }
        }
    }

    return decrypted;
}

/**
 * Parse MAC address string to Buffer
 * @param {string} macString - MAC address like "00:12:4B:32:89:BB" or "00124B3289BB"
 * @returns {Buffer} - 6 bytes
 */
function parseMacAddress(macString) {
    const hex = macString.replace(/[:-]/g, '');
    if (hex.length !== 12) {
        throw new Error('Invalid MAC address format');
    }
    return Buffer.from(hex, 'hex');
}

module.exports = {
    generateKey,
    encrypt,
    decrypt,
    parseMacAddress,
    IV,
    BLOCK_SIZE,
};
