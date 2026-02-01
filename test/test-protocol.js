#!/usr/bin/env node
'use strict';

/**
 * Protocol Unit Tests
 */

const protocol = require('../src/SmartikaProtocol');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.error(`✗ ${name}`);
        console.error(`  ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertBufferEqual(actual, expected, message) {
    if (!actual.equals(expected)) {
        throw new Error(`${message}: expected ${expected.toString('hex')}, got ${actual.toString('hex')}`);
    }
}

console.log('Protocol Unit Tests');
console.log('===================\n');

// Test command IDs
console.log('Command IDs:');
test('DEVICE_SWITCH is 0x0000', () => {
    assertEqual(protocol.CMD.DEVICE_SWITCH, 0x0000, 'DEVICE_SWITCH');
});

test('DEVICE_DISCOVERY is 0x0001', () => {
    assertEqual(protocol.CMD.DEVICE_DISCOVERY, 0x0001, 'DEVICE_DISCOVERY');
});

test('DEVICE_STATUS is 0x0002', () => {
    assertEqual(protocol.CMD.DEVICE_STATUS, 0x0002, 'DEVICE_STATUS');
});

test('LIGHT_DIM is 0x0004', () => {
    assertEqual(protocol.CMD.LIGHT_DIM, 0x0004, 'LIGHT_DIM');
});

test('LIGHT_TEMPERATURE is 0x0005', () => {
    assertEqual(protocol.CMD.LIGHT_TEMPERATURE, 0x0005, 'LIGHT_TEMPERATURE');
});

test('GATEWAY_ID is 0x0010', () => {
    assertEqual(protocol.CMD.GATEWAY_ID, 0x0010, 'GATEWAY_ID');
});

test('PING is 0x0101', () => {
    assertEqual(protocol.CMD.PING, 0x0101, 'PING');
});

test('GROUP_LIST is 0x0400', () => {
    assertEqual(protocol.CMD.GROUP_LIST, 0x0400, 'GROUP_LIST');
});

// Test packet creation
console.log('\nPacket Creation:');

test('createPacket generates correct format', () => {
    const packet = protocol.createPacket(0x0010, Buffer.alloc(0), 0, true);
    // Should be: FE00 0010 0000 0000 [FCS] 00FF
    assertEqual(packet.length, 11, 'packet length');
    assertEqual(packet.readUInt16BE(0), 0xFE00, 'start mark');
    assertEqual(packet.readUInt16BE(2), 0x0010, 'cmd ID');
    assertEqual(packet.readUInt16BE(4), 0x0000, 'data len');
    assertEqual(packet.readUInt16BE(6), 0x0000, 'list len');
    assertEqual(packet.readUInt16BE(9), 0x00FF, 'end mark');
});

test('createPingRequest generates valid packet', () => {
    const packet = protocol.createPingRequest();
    assertEqual(packet.length, 11, 'packet length');
    assertEqual(packet.readUInt16BE(2), 0x0101, 'PING cmd ID');
});

test('createGatewayIdRequest generates valid packet', () => {
    const packet = protocol.createGatewayIdRequest();
    assertEqual(packet.length, 11, 'packet length');
    assertEqual(packet.readUInt16BE(2), 0x0010, 'GATEWAY_ID cmd ID');
});

test('createDeviceSwitchRequest generates valid packet', () => {
    const packet = protocol.createDeviceSwitchRequest(true, [0x28cf]);
    // FE00 0000 0003 0001 [on=01 device=28cf] [FCS] 00FF
    assertEqual(packet.readUInt16BE(2), 0x0000, 'DEVICE_SWITCH cmd ID');
    assertEqual(packet.readUInt16BE(4), 3, 'data len (1 + 2)');
    assertEqual(packet.readUInt16BE(6), 1, 'list len');
    assertEqual(packet.readUInt8(8), 1, 'on = true');
    assertEqual(packet.readUInt16BE(9), 0x28cf, 'device ID');
});

test('createLightDimRequest generates valid packet', () => {
    const packet = protocol.createLightDimRequest(128, [0x28cf, 0xb487]);
    assertEqual(packet.readUInt16BE(2), 0x0004, 'LIGHT_DIM cmd ID');
    assertEqual(packet.readUInt16BE(4), 5, 'data len (1 + 4)');
    assertEqual(packet.readUInt16BE(6), 2, 'list len');
    assertEqual(packet.readUInt8(8), 128, 'brightness');
});

test('createDeviceStatusRequest with broadcast', () => {
    const packet = protocol.createDeviceStatusRequest();
    assertEqual(packet.readUInt16BE(2), 0x0002, 'DEVICE_STATUS cmd ID');
    assertEqual(packet.readUInt16BE(8), 0xFFFF, 'broadcast ID');
});

// Test packet parsing
console.log('\nPacket Parsing:');

test('parsePacket handles valid response', () => {
    // Build a valid response packet
    const packet = protocol.createPacket(0x0101, Buffer.from([0x00]), 0, false);
    const result = protocol.parsePacket(packet);
    assertEqual(result.cmdId, 0x0101, 'cmd ID');
    assertEqual(result.isRequest, false, 'is response');
    assertEqual(result.dataLen, 1, 'data len');
});

test('parsePacket throws on short packet', () => {
    try {
        protocol.parsePacket(Buffer.alloc(5));
        throw new Error('Should have thrown');
    } catch (e) {
        if (!e.message.includes('too short')) {
            throw e;
        }
    }
});

test('parsePacket throws on invalid start mark', () => {
    const packet = Buffer.alloc(11);
    packet.writeUInt16BE(0x1234, 0); // Invalid start mark
    packet.writeUInt16BE(0x00FF, 9);
    try {
        protocol.parsePacket(packet);
        throw new Error('Should have thrown');
    } catch (e) {
        if (!e.message.includes('Invalid start mark')) {
            throw e;
        }
    }
});

// Test checksum
console.log('\nChecksum:');

test('computeChecksum returns correct XOR', () => {
    const data = Buffer.from([0x12, 0x34, 0x56]);
    const fcs = protocol.computeChecksum(data);
    assertEqual(fcs, 0x12 ^ 0x34 ^ 0x56, 'XOR checksum');
});

test('parsePacket verifies checksum', () => {
    const packet = protocol.createPacket(0x0101, Buffer.alloc(0), 0, true);
    // Corrupt the checksum
    packet[8] = packet[8] ^ 0xFF;
    try {
        protocol.parsePacket(packet);
        throw new Error('Should have thrown');
    } catch (e) {
        if (!e.message.includes('Checksum mismatch')) {
            throw e;
        }
    }
});

// Test group commands
console.log('\nGroup Commands:');

test('createGroupListRequest generates valid packet', () => {
    const packet = protocol.createGroupListRequest();
    assertEqual(packet.readUInt16BE(2), 0x0400, 'GROUP_LIST cmd ID');
});

test('createGroupReadRequest generates valid packet', () => {
    const packet = protocol.createGroupReadRequest(0x1234);
    assertEqual(packet.readUInt16BE(2), 0x0403, 'GROUP_READ cmd ID');
    assertEqual(packet.readUInt16BE(8), 0x1234, 'group ID');
});

test('createGroupCreateRequest generates valid packet', () => {
    const packet = protocol.createGroupCreateRequest([0x28cf, 0xb487]);
    assertEqual(packet.readUInt16BE(2), 0x0401, 'GROUP_CREATE cmd ID');
    assertEqual(packet.readUInt16BE(6), 2, 'list len');
});

// Summary
console.log('\n===================');
console.log(`Results: ${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
