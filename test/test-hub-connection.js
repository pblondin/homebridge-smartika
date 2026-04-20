#!/usr/bin/env node
'use strict';

/**
 * SmartikaHubConnection Unit Tests
 *
 * Tests the handleData / command-queue logic in isolation using a fake socket
 * and the real crypto + protocol modules. No actual network connection needed.
 */

const crypto = require('../src/SmartikaCrypto');
const protocol = require('../src/SmartikaProtocol');
const SmartikaHubConnection = require('../src/SmartikaHubConnection');

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

async function testAsync(name, fn) {
    try {
        await fn();
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
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// ============================================================================
// Test helpers
// ============================================================================

// Known-good test MAC / key from test-crypto.js
const TEST_MAC = Buffer.from([0x00, 0x12, 0x4B, 0x32, 0x89, 0xBB]);
const TEST_KEY = crypto.generateKey(TEST_MAC);

const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * Build a pre-connected SmartikaHubConnection with a fake socket.
 * Returns { hub, emitData } where emitData(buf) simulates incoming TCP data.
 */
function makeConnectedHub() {
    const hub = new SmartikaHubConnection({ host: '127.0.0.1', log: silentLog });

    // Inject pre-connected state
    hub.connected = true;
    hub.encryptionKey = TEST_KEY;
    hub.socket = {
        write: () => {},
        destroy: () => {},
    };

    function emitData(buf) {
        hub.handleData(buf);
    }

    return { hub, emitData };
}

/**
 * Encrypt a protocol packet with the test key (simulates a hub response).
 */
function encryptPacket(packet) {
    return crypto.encrypt(packet, TEST_KEY);
}

// ============================================================================
// Main — wraps all async tests so top-level await is not required (CommonJS)
// ============================================================================

async function main() {

// ============================================================================
// handleData — fragmentation tests
// ============================================================================

console.log('handleData – TCP fragmentation');
console.log('================================\n');

await testAsync('resolves when full encrypted response arrives in one chunk', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const encrypted = encryptPacket(pingResponse);

    const resultPromise = hub.sendCommand(protocol.createPingRequest());
    emitData(encrypted);

    const decrypted = await resultPromise;
    assert(decrypted.length >= 11, 'decrypted response should be a full packet');
});

await testAsync('buffers partial chunk and resolves only when final chunk completes a 16-byte block', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const encrypted = encryptPacket(pingResponse); // always a multiple of 16 bytes

    assert(encrypted.length >= 16, 'encrypted response must be at least one block');
    assert(encrypted.length % 16 === 0, 'encrypted response must be block-aligned');

    // Split at a non-block boundary
    const splitAt = 9; // not a multiple of 16
    const chunk1 = encrypted.subarray(0, splitAt);
    const chunk2 = encrypted.subarray(splitAt);

    const resultPromise = hub.sendCommand(protocol.createPingRequest());

    emitData(chunk1); // partial — should be buffered, NOT rejected

    // Give any accidental rejection a tick to surface
    await new Promise(resolve => setImmediate(resolve));

    // Command should still be pending
    assert(hub.pendingCommand !== null, 'command should still be pending after partial chunk');

    emitData(chunk2); // final — now buffer is block-aligned → decrypt succeeds

    const decrypted = await resultPromise; // must not throw
    assert(decrypted.length >= 11, 'decrypted response should be a full packet');
    assertEqual(hub.pendingCommand, null, 'pendingCommand should be cleared after resolve');
    assertEqual(hub.responseBuffer.length, 0, 'responseBuffer should be cleared after resolve');
});

await testAsync('does not reject command when first fragment is not block-aligned', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const encrypted = encryptPacket(pingResponse);

    let rejected = false;
    const resultPromise = hub.sendCommand(protocol.createPingRequest()).catch(() => {
        rejected = true;
    });

    // Send a non-block-aligned fragment
    emitData(encrypted.subarray(0, 7));
    await new Promise(resolve => setImmediate(resolve));

    assert(!rejected, 'command must NOT be rejected after a partial fragment');

    // Deliver remainder so the promise settles before the test ends
    emitData(encrypted.subarray(7));
    await resultPromise;
});

await testAsync('handles three fragments that together form a complete block', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const encrypted = encryptPacket(pingResponse);
    assert(encrypted.length >= 16, 'need at least 16 bytes to split three ways');

    const resultPromise = hub.sendCommand(protocol.createPingRequest());

    // Send 3 fragments that only make a full block together
    const third = Math.floor(encrypted.length / 3);
    emitData(encrypted.subarray(0, third));
    await new Promise(resolve => setImmediate(resolve));
    assert(hub.pendingCommand !== null, 'still pending after fragment 1');

    emitData(encrypted.subarray(third, third * 2));
    await new Promise(resolve => setImmediate(resolve));
    assert(hub.pendingCommand !== null, 'still pending after fragment 2');

    emitData(encrypted.subarray(third * 2));

    const decrypted = await resultPromise;
    assert(decrypted.length >= 11, 'full packet decrypted after three fragments');
});

// ============================================================================
// handleData — no pending command
// ============================================================================

console.log('\nhandleData – no pending command');
console.log('================================\n');

test('does not throw when data arrives with no pending command', () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const encrypted = encryptPacket(pingResponse);

    // No sendCommand called — should silently accumulate / ignore
    emitData(encrypted);
});

// ============================================================================
// Command queue tests
// ============================================================================

console.log('\nCommand queue');
console.log('=============\n');

await testAsync('second command is sent only after first resolves', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const enc = encryptPacket(pingResponse);

    const order = [];

    const p1 = hub.sendCommand(protocol.createPingRequest()).then(() => order.push(1));
    const p2 = hub.sendCommand(protocol.createPingRequest()).then(() => order.push(2));

    // Provide response for first command
    emitData(enc);
    await new Promise(resolve => setImmediate(resolve));

    // Provide response for second command
    emitData(enc);
    await Promise.all([p1, p2]);

    assertEqual(order[0], 1, 'first command resolves first');
    assertEqual(order[1], 2, 'second command resolves second');
});

await testAsync('rejects with "Not connected" when hub is disconnected', async () => {
    const { hub } = makeConnectedHub();
    hub.connected = false;

    let errorMessage = null;
    await hub.sendCommand(protocol.createPingRequest()).catch(e => {
        errorMessage = e.message;
    });

    assert(errorMessage !== null, 'should have rejected');
    assert(errorMessage.includes('Not connected'), `got: ${errorMessage}`);
});

await testAsync('command times out if no response arrives', async () => {
    const { hub } = makeConnectedHub();

    let errorMessage = null;
    await hub.sendCommand(protocol.createPingRequest(), 50 /* 50 ms timeout */).catch(e => {
        errorMessage = e.message;
    });

    assert(errorMessage !== null, 'should have rejected on timeout');
    assert(errorMessage.includes('timeout'), `got: ${errorMessage}`);
    assertEqual(hub.pendingCommand, null, 'pendingCommand cleared after timeout');
    assertEqual(hub.responseBuffer.length, 0, 'responseBuffer cleared after timeout');
});

await testAsync('queue continues processing after a timeout', async () => {
    const { hub, emitData } = makeConnectedHub();

    const pingResponse = protocol.createPacket(protocol.CMD.PING, Buffer.alloc(1), 0, false);
    const enc = encryptPacket(pingResponse);

    // First command: will time out (no response delivered)
    const p1 = hub.sendCommand(protocol.createPingRequest(), 50).catch(() => 'timed-out');

    // Second command: will succeed
    const p2 = hub.sendCommand(protocol.createPingRequest());

    // Wait for first to time out
    const r1 = await p1;
    assertEqual(r1, 'timed-out', 'first command should time out');

    // Deliver response for the second command
    emitData(enc);
    const decrypted = await p2;
    assert(decrypted.length >= 11, 'second command should resolve after first times out');
});

// ============================================================================
// Summary
// ============================================================================

    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
