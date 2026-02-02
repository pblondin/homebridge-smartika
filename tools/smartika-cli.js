#!/usr/bin/env node
'use strict';

/**
 * Smartika Hub CLI
 *
 * A comprehensive command-line interface for controlling Smartika smart home devices.
 */

const net = require('net');
const dgram = require('dgram');
const readline = require('readline');
const crypto = require('../src/SmartikaCrypto');
const protocol = require('../src/SmartikaProtocol');

const HUB_PORT = protocol.HUB_PORT;
const BROADCAST_PORT = 4156;
const VERSION = '1.0.0';

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

// Check if colors should be disabled
const noColor = process.env.NO_COLOR || !process.stdout.isTTY;
const c = noColor ? Object.fromEntries(Object.keys(colors).map(k => [k, ''])) : colors;

// ============================================================================
// Command Definitions
// ============================================================================

// Standalone commands (no hub IP required)
const standaloneCommands = {
    'hub-discover': {
        category: 'Hub Discovery',
        description: 'Discover Smartika hubs on the network via UDP broadcast',
        usage: 'hub-discover [timeout]',
        args: [
            { name: 'timeout', type: 'number', required: false, default: 10, description: 'Discovery timeout in seconds (default: 10)' },
        ],
        handler: handleHubDiscover,
    },
};

const commands = {
    // System Commands
    'hub-info': {
        category: 'System',
        description: 'Get hub information (ID, firmware, encryption key)',
        usage: 'hub-info',
        args: [],
        handler: handleHubInfo,
    },
    ping: {
        category: 'System',
        description: 'Send keep-alive ping to hub',
        usage: 'ping',
        args: [],
        handler: handlePing,
    },
    firmware: {
        category: 'System',
        description: 'Get hub firmware version',
        usage: 'firmware',
        args: [],
        handler: handleFirmware,
    },
    'join-enable': {
        category: 'System',
        description: 'Enable device pairing mode',
        usage: 'join-enable [duration]',
        args: [
            { name: 'duration', type: 'number', required: false, default: 0, description: 'Duration in seconds (0 = default)' },
        ],
        handler: handleJoinEnable,
    },
    'join-disable': {
        category: 'System',
        description: 'Disable device pairing mode',
        usage: 'join-disable',
        args: [],
        handler: handleJoinDisable,
    },

    // Device Commands
    discover: {
        category: 'Device',
        description: 'Discover active devices on the network',
        usage: 'discover',
        args: [],
        handler: handleDiscover,
    },
    status: {
        category: 'Device',
        description: 'Get device status',
        usage: 'status [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: false, variadic: true, description: 'Device address(es) or "all"' },
        ],
        handler: handleStatus,
    },
    on: {
        category: 'Device',
        description: 'Turn device(s) on',
        usage: 'on <device-id> [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es)' },
        ],
        handler: handleOn,
    },
    off: {
        category: 'Device',
        description: 'Turn device(s) off',
        usage: 'off <device-id> [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es)' },
        ],
        handler: handleOff,
    },
    dim: {
        category: 'Device',
        description: 'Set light brightness',
        usage: 'dim <brightness> <device-id> [device-id...]',
        args: [
            { name: 'brightness', type: 'number', required: true, min: 0, max: 255, description: 'Brightness level (0-255 or 0%-100%)' },
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es)' },
        ],
        handler: handleDim,
    },
    temp: {
        category: 'Device',
        description: 'Set light color temperature',
        usage: 'temp <temperature> <device-id> [device-id...]',
        args: [
            { name: 'temperature', type: 'number', required: true, min: 0, max: 255, description: 'Color temperature (0=warm, 255=cool)' },
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es)' },
        ],
        handler: handleTemp,
    },
    fan: {
        category: 'Device',
        description: 'Set fan speed',
        usage: 'fan <speed> <device-id> [device-id...]',
        args: [
            { name: 'speed', type: 'number', required: true, min: 0, max: 255, description: 'Fan speed (0-255)' },
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es)' },
        ],
        handler: handleFan,
    },

    // Database Commands
    list: {
        category: 'Database',
        description: 'List all registered devices',
        usage: 'list',
        args: [],
        handler: handleList,
    },
    'db-add': {
        category: 'Database',
        description: 'Add device(s) to database',
        usage: 'db-add <device-id> [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es) to add' },
        ],
        handler: handleDbAdd,
    },
    'db-remove': {
        category: 'Database',
        description: 'Remove device(s) from database',
        usage: 'db-remove <device-id> [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es) to remove' },
        ],
        handler: handleDbRemove,
    },

    // Group Commands
    groups: {
        category: 'Group',
        description: 'List all groups',
        usage: 'groups',
        args: [],
        handler: handleGroups,
    },
    'group-read': {
        category: 'Group',
        description: 'Read group members',
        usage: 'group-read <group-id>',
        args: [
            { name: 'group-id', type: 'device-id', required: true, description: 'Group address' },
        ],
        handler: handleGroupRead,
    },
    'group-create': {
        category: 'Group',
        description: 'Create a new group',
        usage: 'group-create <device-id> [device-id...]',
        args: [
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'Device address(es) to include' },
        ],
        handler: handleGroupCreate,
    },
    'group-update': {
        category: 'Group',
        description: 'Update group members',
        usage: 'group-update <group-id> <device-id> [device-id...]',
        args: [
            { name: 'group-id', type: 'device-id', required: true, description: 'Group address' },
            { name: 'device-id', type: 'device-id', required: true, variadic: true, description: 'New device address(es)' },
        ],
        handler: handleGroupUpdate,
    },
    'group-delete': {
        category: 'Group',
        description: 'Delete group(s)',
        usage: 'group-delete <group-id> [group-id...]',
        args: [
            { name: 'group-id', type: 'device-id', required: true, variadic: true, description: 'Group address(es) to delete' },
        ],
        handler: handleGroupDelete,
    },

    // HomeKit Preview
    'homekit-preview': {
        category: 'HomeKit',
        description: 'Preview what accessories would be added to HomeKit',
        usage: 'homekit-preview',
        args: [],
        handler: handleHomekitPreview,
    },

    // Pairing Wizard
    'pair': {
        category: 'Pairing',
        description: 'Interactive wizard to pair new devices',
        usage: 'pair [duration]',
        args: [
            { name: 'duration', type: 'number', required: false, default: 60, description: 'Pairing window duration in seconds (default: 60)' },
        ],
        handler: handlePairWizard,
    },
};

// ============================================================================
// Argument Parsing
// ============================================================================

function parseDeviceId(str) {
    if (str.toLowerCase() === 'all') {
        return protocol.DEVICE_ID_BROADCAST;
    }
    if (str.startsWith('0x') || str.startsWith('0X')) {
        return parseInt(str, 16);
    }
    return parseInt(str, 10);
}

function parseNumber(str, min, max) {
    // Support percentage values
    if (str.endsWith('%')) {
        const percent = parseInt(str.slice(0, -1), 10);
        return Math.round(percent / 100 * 255);
    }
    const num = parseInt(str, 10);
    if (isNaN(num)) {
        throw new Error(`Invalid number: ${str}`);
    }
    if (min !== undefined && num < min) {
        throw new Error(`Value must be >= ${min}`);
    }
    if (max !== undefined && num > max) {
        throw new Error(`Value must be <= ${max}`);
    }
    return num;
}

function parseArgs(cmdDef, args) {
    const result = {};
    let argIndex = 0;

    for (const argDef of cmdDef.args) {
        if (argDef.variadic) {
            // Collect remaining args
            const values = [];
            while (argIndex < args.length) {
                if (argDef.type === 'device-id') {
                    values.push(parseDeviceId(args[argIndex]));
                } else if (argDef.type === 'number') {
                    values.push(parseNumber(args[argIndex], argDef.min, argDef.max));
                } else {
                    values.push(args[argIndex]);
                }
                argIndex++;
            }
            if (argDef.required && values.length === 0) {
                throw new Error(`Missing required argument: ${argDef.name}`);
            }
            result[argDef.name.replace(/-/g, '_')] = values;
        } else {
            const value = args[argIndex];
            if (argDef.required && value === undefined) {
                throw new Error(`Missing required argument: ${argDef.name}`);
            }
            if (value !== undefined) {
                if (argDef.type === 'device-id') {
                    result[argDef.name.replace(/-/g, '_')] = parseDeviceId(value);
                } else if (argDef.type === 'number') {
                    result[argDef.name.replace(/-/g, '_')] = parseNumber(value, argDef.min, argDef.max);
                } else {
                    result[argDef.name.replace(/-/g, '_')] = value;
                }
                argIndex++;
            } else if (argDef.default !== undefined) {
                result[argDef.name.replace(/-/g, '_')] = argDef.default;
            }
        }
    }

    return result;
}

// ============================================================================
// Help System
// ============================================================================

function printBanner() {
    console.log(`
${c.cyan}╔═══════════════════════════════════════════════════════════╗
║                   ${c.bright}Smartika Hub CLI${c.reset}${c.cyan}                         ║
║                      Version ${VERSION}                         ║
╚═══════════════════════════════════════════════════════════╝${c.reset}
`);
}

function printUsage() {
    console.log(`${c.bright}USAGE${c.reset}`);
    console.log(`    smartika-cli hub-discover              ${c.dim}# Find hubs on network${c.reset}`);
    console.log(`    smartika-cli <hub-ip> <command> [args] ${c.dim}# Control a hub${c.reset}`);
    console.log(`    smartika-cli --help                    ${c.dim}# Show this help${c.reset}`);
    console.log(`    smartika-cli <hub-ip> <command> --help ${c.dim}# Command help${c.reset}\n`);
}

function printCommands() {
    console.log(`${c.bright}COMMANDS${c.reset}\n`);

    // Print standalone commands first
    console.log(`  ${c.yellow}Hub Discovery${c.reset} ${c.dim}(no hub IP required)${c.reset}`);
    for (const [name, cmd] of Object.entries(standaloneCommands)) {
        console.log(`    ${c.green}${name.padEnd(16)}${c.reset} ${cmd.description}`);
    }
    console.log();

    // Print regular commands by category
    const categories = {};
    for (const [name, cmd] of Object.entries(commands)) {
        if (!categories[cmd.category]) {
            categories[cmd.category] = [];
        }
        categories[cmd.category].push({ name, ...cmd });
    }

    for (const [category, cmds] of Object.entries(categories)) {
        console.log(`  ${c.yellow}${category}${c.reset}`);
        for (const cmd of cmds) {
            console.log(`    ${c.green}${cmd.name.padEnd(16)}${c.reset} ${cmd.description}`);
        }
        console.log();
    }
}

function printExamples() {
    console.log(`${c.bright}EXAMPLES${c.reset}\n`);
    console.log(`    ${c.dim}# Discover hubs on the network${c.reset}`);
    console.log(`    smartika-cli hub-discover\n`);
    console.log(`    ${c.dim}# Get hub information${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 hub-info\n`);
    console.log(`    ${c.dim}# Get status of all devices${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 status\n`);
    console.log(`    ${c.dim}# Turn on a specific device${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 on 0x28cf\n`);
    console.log(`    ${c.dim}# Set brightness to 50%${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 dim 50% 0x28cf\n`);
    console.log(`    ${c.dim}# Set multiple devices${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 dim 128 0x28cf 0xb487 0xb492\n`);
    console.log(`    ${c.dim}# List all groups${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 groups\n`);
}

function printDeviceIdHelp() {
    console.log(`${c.bright}DEVICE IDS${c.reset}\n`);
    console.log(`    Device IDs can be specified as:`);
    console.log(`    - Hexadecimal: ${c.cyan}0x28cf${c.reset}`);
    console.log(`    - Decimal: ${c.cyan}10447${c.reset}`);
    console.log(`    - Broadcast: ${c.cyan}all${c.reset} (for status command)\n`);
}

function printHelp() {
    printBanner();
    printUsage();
    printCommands();
    printExamples();
    printDeviceIdHelp();
}

function printStandaloneCommandHelp(cmdName, cmdDef) {
    console.log(`\n${c.bright}${cmdName.toUpperCase()}${c.reset}`);
    console.log(`    ${cmdDef.description}\n`);
    console.log(`${c.bright}USAGE${c.reset}`);
    console.log(`    smartika-cli ${cmdDef.usage}\n`);

    if (cmdDef.args.length > 0) {
        console.log(`${c.bright}ARGUMENTS${c.reset}`);
        for (const arg of cmdDef.args) {
            const req = arg.required ? '(required)' : '(optional)';
            console.log(`    ${c.green}<${arg.name}>${c.reset} ${c.dim}${req}${c.reset}`);
            console.log(`        ${arg.description}`);
            if (arg.default !== undefined) {
                console.log(`        Default: ${arg.default}`);
            }
        }
        console.log();
    }

    console.log(`${c.bright}EXAMPLE${c.reset}`);
    console.log(`    smartika-cli ${cmdDef.usage}\n`);
}

function printCommandHelp(cmdName, cmdDef) {
    console.log(`\n${c.bright}${cmdName.toUpperCase()}${c.reset}`);
    console.log(`    ${cmdDef.description}\n`);
    console.log(`${c.bright}USAGE${c.reset}`);
    console.log(`    smartika-cli <hub-ip> ${cmdDef.usage}\n`);

    if (cmdDef.args.length > 0) {
        console.log(`${c.bright}ARGUMENTS${c.reset}`);
        for (const arg of cmdDef.args) {
            const req = arg.required ? '(required)' : '(optional)';
            const variadic = arg.variadic ? '...' : '';
            console.log(`    ${c.green}<${arg.name}>${variadic}${c.reset} ${c.dim}${req}${c.reset}`);
            console.log(`        ${arg.description}`);
            if (arg.min !== undefined || arg.max !== undefined) {
                console.log(`        Range: ${arg.min ?? '...'} - ${arg.max ?? '...'}`);
            }
            if (arg.default !== undefined) {
                console.log(`        Default: ${arg.default}`);
            }
        }
        console.log();
    }

    console.log(`${c.bright}EXAMPLE${c.reset}`);
    console.log(`    smartika-cli 10.0.0.122 ${cmdDef.usage}\n`);
}

// ============================================================================
// Command Handlers
// ============================================================================

// Standalone command: Hub Discovery (no IP required)
function handleHubDiscover(args) {
    const timeout = (args.timeout || 10) * 1000;

    console.log(`${c.bright}Smartika Hub Discovery${c.reset}\n`);
    console.log(`Listening for hub broadcasts on UDP port ${BROADCAST_PORT}...`);
    console.log(`${c.dim}(Hub broadcasts every ~10 seconds, waiting ${timeout / 1000}s)${c.reset}\n`);

    const server = dgram.createSocket('udp4');
    const foundHubs = new Map();

    server.on('error', (err) => {
        console.error(`${c.red}Server error: ${err.message}${c.reset}`);
        server.close();
        process.exit(1);
    });

    server.on('message', (msg, rinfo) => {
        // Remove null bytes and trim whitespace
        const message = msg.toString('utf-8').replace(/\x00/g, '').trim();

        // Parse "SMARTIKA HUB - {ID}" or "SMARTIKA HUB - BOOTLOADER - {ID}"
        // ID is 16 chars (IEEE address prefix + MAC) or 12 chars (MAC only)
        const match = message.match(/^SMARTIKA HUB(?: - BOOTLOADER)? - ([0-9A-F]{12,16})/i);

        if (match) {
            const hubId = match[1].toUpperCase();
            const isBootloader = message.includes('BOOTLOADER');
            const macHex = hubId.slice(-12);
            const macFormatted = macHex.match(/.{2}/g).join(':');

            if (!foundHubs.has(hubId)) {
                foundHubs.set(hubId, {
                    hubId,
                    mac: macFormatted,
                    ip: rinfo.address,
                    bootloader: isBootloader,
                });

                console.log(`${c.green}✓ Found Hub!${c.reset}`);
                console.log(`  ${c.cyan}Hub ID:${c.reset}      ${hubId}`);
                console.log(`  ${c.cyan}MAC Address:${c.reset} ${macFormatted}`);
                console.log(`  ${c.cyan}IP Address:${c.reset}  ${rinfo.address}`);
                console.log(`  ${c.cyan}Mode:${c.reset}        ${isBootloader ? `${c.yellow}BOOTLOADER${c.reset}` : 'Normal'}\n`);
            } else {
                // Update IP if changed
                const hub = foundHubs.get(hubId);
                if (hub.ip !== rinfo.address) {
                    hub.ip = rinfo.address;
                    console.log(`${c.dim}Hub ${hubId.slice(-6)} IP updated: ${rinfo.address}${c.reset}`);
                }
            }
        }
    });

    server.on('listening', () => {
        const address = server.address();
        console.log(`${c.dim}Listening on ${address.address}:${address.port}${c.reset}\n`);
    });

    server.bind(BROADCAST_PORT, () => {
        server.setBroadcast(true);
    });

    // Timeout
    setTimeout(() => {
        console.log(`\n${c.bright}─── Discovery Complete ───${c.reset}\n`);

        if (foundHubs.size === 0) {
            console.log(`${c.yellow}No hubs found.${c.reset}\n`);
            console.log('Troubleshooting:');
            console.log('  1. Make sure your hub is powered on');
            console.log('  2. Ensure your computer is on the same network');
            console.log('  3. Check if firewall is blocking UDP port 4156');
            console.log('  4. Try running with sudo if on Linux/Mac\n');
        } else {
            console.log(`Found ${c.green}${foundHubs.size}${c.reset} hub(s):\n`);

            let idx = 1;
            for (const [, hub] of foundHubs) {
                console.log(`  ${c.bright}[${idx}]${c.reset} ${hub.hubId}`);
                console.log(`      IP:  ${c.cyan}${hub.ip}${c.reset}`);
                console.log(`      MAC: ${hub.mac}`);
                if (hub.bootloader) {
                    console.log(`      ${c.yellow}⚠ BOOTLOADER MODE${c.reset}`);
                }
                idx++;
            }

            // Output config suggestion
            const firstHub = foundHubs.values().next().value;
            console.log(`\n${c.bright}Homebridge Configuration:${c.reset}\n`);
            console.log(JSON.stringify({
                platform: 'Smartika',
                name: 'Smartika Hub',
                hubHost: firstHub.ip,
            }, null, 2));

            console.log(`\n${c.bright}CLI Commands:${c.reset}`);
            console.log(`  smartika-cli ${firstHub.ip} hub-info`);
            console.log(`  smartika-cli ${firstHub.ip} list`);
            console.log(`  smartika-cli ${firstHub.ip} status\n`);
        }

        server.close();
        process.exit(0);
    }, timeout);

    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log(`\n${c.dim}Discovery interrupted.${c.reset}`);
        server.close();
        process.exit(0);
    });
}

// Hub info command
function handleHubInfo(args, send, hubInfo) {
    console.log(`\n${c.bright}Hub Information${c.reset}\n`);
    console.log(`  ${c.cyan}Hub ID:${c.reset}         ${hubInfo.hubIdHex}`);
    console.log(`  ${c.cyan}MAC Address:${c.reset}    ${hubInfo.hubIdHex.match(/.{2}/g).join(':')}`);
    console.log(`  ${c.cyan}Encryption Key:${c.reset} ${hubInfo.encryptionKey.toString('hex').toUpperCase()}`);

    // Now get firmware version
    console.log(`\n${c.dim}Fetching firmware version...${c.reset}`);
    send(protocol.createFirmwareVersionRequest(), (packet) => {
        const result = protocol.parseFirmwareVersionResponse(packet);
        console.log(`  ${c.cyan}Firmware:${c.reset}       ${result.version}`);
        console.log(`\n${c.green}✓ Hub is ready${c.reset}\n`);
    });
}

function handlePing(args, send) {
    console.log('Sending ping...');
    send(protocol.createPingRequest(), (packet) => {
        const result = protocol.parsePingResponse(packet);
        console.log(`\n${c.green}✓ Pong!${c.reset}`);
        console.log(`  Alarm set: ${result.alarmSet ? 'Yes' : 'No'}`);
    });
}

function handleFirmware(args, send) {
    console.log('Getting firmware version...');
    send(protocol.createFirmwareVersionRequest(), (packet) => {
        const result = protocol.parseFirmwareVersionResponse(packet);
        console.log(`\n${c.green}Firmware Version: ${c.bright}${result.version}${c.reset}`);
    });
}

function handleJoinEnable(args, send) {
    const duration = args.duration || 0;
    console.log(`Enabling pairing mode${duration ? ` for ${duration}s` : ''}...`);
    send(protocol.createJoinEnableRequest(duration), (packet) => {
        const result = protocol.parseJoinEnableResponse(packet);
        console.log(`\n${c.green}✓ Pairing mode enabled${c.reset}`);
        console.log(`  Duration: ${result.duration}s`);
    });
}

function handleJoinDisable(args, send) {
    console.log('Disabling pairing mode...');
    send(protocol.createJoinDisableRequest(), (packet) => {
        console.log(`\n${c.green}✓ Pairing mode disabled${c.reset}`);
    });
}

function handleDiscover(args, send) {
    console.log('Discovering active devices...');
    send(protocol.createDeviceDiscoveryRequest(), (packet) => {
        const devices = protocol.parseDeviceDiscoveryResponse(packet);
        console.log(`\n${c.bright}Active Devices (${devices.length})${c.reset}\n`);
        printDeviceTable(devices, false);
    });
}

function handleStatus(args, send) {
    const deviceIds = args.device_id && args.device_id.length > 0
        ? args.device_id
        : [protocol.DEVICE_ID_BROADCAST];

    const label = deviceIds.length === 1 && deviceIds[0] === 0xFFFF
        ? 'all devices'
        : deviceIds.map(formatDeviceId).join(', ');

    console.log(`Getting status for ${label}...`);
    send(protocol.createDeviceStatusRequest(deviceIds), (packet) => {
        const devices = protocol.parseDeviceStatusResponse(packet);
        console.log(`\n${c.bright}Device Status (${devices.length})${c.reset}\n`);
        printStatusTable(devices);
    });
}

function handleOn(args, send) {
    const deviceIds = args.device_id;
    console.log(`Turning ON: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createDeviceSwitchRequest(true, deviceIds), (packet) => {
        const result = protocol.parseDeviceSwitchResponse(packet);
        console.log(`\n${c.green}✓ Success${c.reset}`);
        console.log(`  Affected: ${result.deviceIds.map(formatDeviceId).join(', ')}`);
    });
}

function handleOff(args, send) {
    const deviceIds = args.device_id;
    console.log(`Turning OFF: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createDeviceSwitchRequest(false, deviceIds), (packet) => {
        const result = protocol.parseDeviceSwitchResponse(packet);
        console.log(`\n${c.green}✓ Success${c.reset}`);
        console.log(`  Affected: ${result.deviceIds.map(formatDeviceId).join(', ')}`);
    });
}

function handleDim(args, send) {
    const brightness = args.brightness;
    const deviceIds = args.device_id;
    const percent = Math.round(brightness / 255 * 100);
    console.log(`Setting brightness to ${brightness} (${percent}%) for: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createLightDimRequest(brightness, deviceIds), (packet) => {
        const result = protocol.parseLightDimResponse(packet);
        console.log(`\n${c.green}✓ Success${c.reset}`);
        console.log(`  Affected: ${result.deviceIds.map(formatDeviceId).join(', ')}`);
    });
}

function handleTemp(args, send) {
    const temperature = args.temperature;
    const deviceIds = args.device_id;
    const label = temperature < 85 ? 'warm' : temperature < 170 ? 'neutral' : 'cool';
    console.log(`Setting temperature to ${temperature} (${label}) for: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createLightTemperatureRequest(temperature, deviceIds), (packet) => {
        const result = protocol.parseLightTemperatureResponse(packet);
        console.log(`\n${c.green}✓ Success${c.reset}`);
        console.log(`  Affected: ${result.deviceIds.map(formatDeviceId).join(', ')}`);
    });
}

function handleFan(args, send) {
    const speed = args.speed;
    const deviceIds = args.device_id;
    console.log(`Setting fan speed to ${speed} for: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createFanControlRequest(speed, deviceIds), (packet) => {
        console.log(`\n${c.green}✓ Success${c.reset}`);
    });
}

function handleList(args, send) {
    console.log('Listing registered devices...');
    send(protocol.createDbListDeviceFullRequest(), (packet) => {
        const devices = protocol.parseDbListDeviceFullResponse(packet);
        console.log(`\n${c.bright}Registered Devices (${devices.length})${c.reset}\n`);
        printDeviceTable(devices, true);
    });
}

function handleDbAdd(args, send) {
    const deviceIds = args.device_id;
    console.log(`Adding devices: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createDbAddDeviceRequest(deviceIds), (packet) => {
        const result = protocol.parseDbAddDeviceResponse(packet);
        if (result.errorIds.length === 0) {
            console.log(`\n${c.green}✓ All devices added successfully${c.reset}`);
        } else {
            console.log(`\n${c.yellow}⚠ Some devices failed to add${c.reset}`);
            console.log(`  Failed: ${result.errorIds.map(formatDeviceId).join(', ')}`);
        }
    });
}

function handleDbRemove(args, send) {
    const deviceIds = args.device_id;
    console.log(`Removing devices: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createDbRemoveDeviceRequest(deviceIds), (packet) => {
        const result = protocol.parseDbRemoveDeviceResponse(packet);
        if (result.errorIds.length === 0) {
            console.log(`\n${c.green}✓ All devices removed successfully${c.reset}`);
        } else {
            console.log(`\n${c.yellow}⚠ Some devices failed to remove${c.reset}`);
            console.log(`  Failed: ${result.errorIds.map(formatDeviceId).join(', ')}`);
        }
    });
}

function handleGroups(args, send) {
    console.log('Listing groups...');
    send(protocol.createGroupListRequest(), (packet) => {
        const result = protocol.parseGroupListResponse(packet);
        console.log(`\n${c.bright}Groups (${result.groupIds.length})${c.reset}\n`);
        if (result.groupIds.length === 0) {
            console.log(`  ${c.dim}No groups found.${c.reset}`);
        } else {
            result.groupIds.forEach((id, index) => {
                console.log(`  [${index + 1}] ${formatDeviceId(id)}`);
            });
        }
    });
}

function handleGroupRead(args, send) {
    const groupId = args.group_id;
    console.log(`Reading group ${formatDeviceId(groupId)}...`);
    send(protocol.createGroupReadRequest(groupId), (packet) => {
        const result = protocol.parseGroupReadResponse(packet);
        if (!result.success) {
            console.log(`\n${c.red}✗ Group not found${c.reset}`);
        } else {
            console.log(`\n${c.bright}Group ${formatDeviceId(result.groupId)} Members (${result.deviceIds.length})${c.reset}\n`);
            if (result.deviceIds.length === 0) {
                console.log(`  ${c.dim}No members.${c.reset}`);
            } else {
                result.deviceIds.forEach((id, index) => {
                    console.log(`  [${index + 1}] ${formatDeviceId(id)}`);
                });
            }
        }
    });
}

function handleGroupCreate(args, send) {
    const deviceIds = args.device_id;
    console.log(`Creating group with: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createGroupCreateRequest(deviceIds), (packet) => {
        const result = protocol.parseGroupCreateResponse(packet);
        if (!result.success) {
            console.log(`\n${c.red}✗ Failed to create group${c.reset}`);
        } else {
            console.log(`\n${c.green}✓ Group created${c.reset}`);
            console.log(`  Group ID: ${formatDeviceId(result.groupId)}`);
        }
    });
}

function handleGroupUpdate(args, send) {
    const groupId = args.group_id;
    const deviceIds = args.device_id;
    console.log(`Updating group ${formatDeviceId(groupId)} with: ${deviceIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createGroupUpdateRequest(groupId, deviceIds), (packet) => {
        const result = protocol.parseGroupUpdateResponse(packet);
        if (!result.success) {
            console.log(`\n${c.red}✗ Failed to update group${c.reset}`);
        } else {
            console.log(`\n${c.green}✓ Group updated${c.reset}`);
        }
    });
}

function handleGroupDelete(args, send) {
    const groupIds = args.group_id;
    console.log(`Deleting groups: ${groupIds.map(formatDeviceId).join(', ')}...`);
    send(protocol.createGroupDeleteRequest(groupIds), (packet) => {
        const result = protocol.parseGroupDeleteResponse(packet);
        if (result.errorIds.length === 0) {
            console.log(`\n${c.green}✓ All groups deleted${c.reset}`);
        } else {
            console.log(`\n${c.yellow}⚠ Some groups failed to delete${c.reset}`);
            console.log(`  Failed: ${result.errorIds.map(formatDeviceId).join(', ')}`);
        }
    });
}

function handleHomekitPreview(args, send) {
    console.log('Analyzing devices and groups for HomeKit...\n');
    
    let devices = [];
    let groupIds = [];
    const groups = [];
    const groupedDeviceIds = new Set();
    let currentGroupIndex = 0;
    
    // State machine for sequential requests
    const processNextStep = (step) => {
        switch (step) {
        case 'devices':
            send(protocol.createDbListDeviceFullRequest(), (packet) => {
                devices = protocol.parseDbListDeviceFullResponse(packet);
                processNextStep('groups');
                return true; // Keep connection open
            });
            break;
            
        case 'groups':
            send(protocol.createGroupListRequest(), (packet) => {
                const result = protocol.parseGroupListResponse(packet);
                groupIds = result.groupIds;
                
                if (groupIds.length === 0) {
                    displayHomekitPreview(devices, groups, groupedDeviceIds);
                    return false; // Close connection
                }
                
                currentGroupIndex = 0;
                processNextStep('read-group');
                return true; // Keep connection open
            });
            break;
            
        case 'read-group':
            if (currentGroupIndex >= groupIds.length) {
                displayHomekitPreview(devices, groups, groupedDeviceIds);
                return;
            }
            
            const groupId = groupIds[currentGroupIndex];
            send(protocol.createGroupReadRequest(groupId), (packet) => {
                const result = protocol.parseGroupReadResponse(packet);
                groups.push({ groupId, deviceIds: result.deviceIds });
                result.deviceIds.forEach(id => groupedDeviceIds.add(id));
                
                currentGroupIndex++;
                
                if (currentGroupIndex >= groupIds.length) {
                    displayHomekitPreview(devices, groups, groupedDeviceIds);
                    return false; // Close connection - done!
                }
                
                // Read next group
                processNextStep('read-group');
                return true; // Keep connection open
            });
            break;
        }
    };
    
    // Start the process
    processNextStep('devices');
}

function displayHomekitPreview(devices, groups, groupedDeviceIds) {
    const accessories = [];
    const skipped = [];
    
    // Add groups as accessories
    for (const group of groups) {
        accessories.push({
            type: 'Group',
            address: formatDeviceId(group.groupId),
            name: `Group ${group.groupId.toString(16).toUpperCase()}`,
            members: group.deviceIds.length,
            category: 'light',
        });
    }
    
    // Process devices
    for (const device of devices) {
        // Skip remotes
        if (device.category === protocol.DEVICE_CATEGORY.REMOTE) {
            skipped.push({
                address: formatDeviceId(device.shortAddress),
                name: device.typeName,
                reason: 'Remote control',
            });
            continue;
        }
        
        // Skip grouped devices
        if (groupedDeviceIds.has(device.shortAddress)) {
            skipped.push({
                address: formatDeviceId(device.shortAddress),
                name: device.typeName,
                reason: 'Part of group',
            });
            continue;
        }
        
        // Add standalone device
        accessories.push({
            type: 'Device',
            address: formatDeviceId(device.shortAddress),
            name: device.typeName,
            category: device.category,
        });
    }
    
    // Display results
    console.log(`${c.bright}═══════════════════════════════════════════════════════════════${c.reset}`);
    console.log(`${c.bright}                    HomeKit Accessories Preview${c.reset}`);
    console.log(`${c.bright}═══════════════════════════════════════════════════════════════${c.reset}\n`);
    
    console.log(`${c.green}✓ Accessories to Add (${accessories.length})${c.reset}\n`);
    
    // Groups first
    const groupAccessories = accessories.filter(a => a.type === 'Group');
    if (groupAccessories.length > 0) {
        console.log(`  ${c.cyan}Groups (${groupAccessories.length}):${c.reset}`);
        groupAccessories.forEach((a, i) => {
            console.log(`    ${i + 1}. ${a.address} - ${a.name} (${a.members} members)`);
        });
        console.log();
    }
    
    // Standalone devices
    const deviceAccessories = accessories.filter(a => a.type === 'Device');
    if (deviceAccessories.length > 0) {
        console.log(`  ${c.cyan}Standalone Devices (${deviceAccessories.length}):${c.reset}`);
        deviceAccessories.forEach((a, i) => {
            console.log(`    ${i + 1}. ${a.address} - ${a.name} [${a.category}]`);
        });
        console.log();
    }
    
    // Skipped
    if (skipped.length > 0) {
        console.log(`${c.dim}─ Skipped Devices (${skipped.length}) ─${c.reset}\n`);
        skipped.forEach((s, i) => {
            console.log(`  ${c.dim}${i + 1}. ${s.address} - ${s.name} (${s.reason})${c.reset}`);
        });
        console.log();
    }
    
    // Summary
    console.log(`${c.bright}───────────────────────────────────────────────────────────────${c.reset}`);
    console.log(`${c.bright}Summary:${c.reset}`);
    console.log(`  Total devices in hub:     ${devices.length}`);
    console.log(`  Groups:                   ${groups.length}`);
    console.log(`  Devices in groups:        ${groupedDeviceIds.size}`);
    console.log(`  Skipped (remotes):        ${skipped.filter(s => s.reason === 'Remote control').length}`);
    console.log(`  ${c.green}HomeKit accessories:    ${accessories.length}${c.reset}`);
    console.log(`${c.bright}───────────────────────────────────────────────────────────────${c.reset}\n`);
}

// ============================================================================
// Pairing Wizard
// ============================================================================

/**
 * Create a readline interface for user input
 */
function createReadlineInterface() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Prompt user for input
 */
function prompt(rl, question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Interactive pairing wizard
 */
function handlePairWizard(args, send) {
    const duration = args.duration || 60;
    
    console.log(`\n${c.bright}═══════════════════════════════════════════════════════════════${c.reset}`);
    console.log(`${c.bright}                    Smartika Device Pairing Wizard${c.reset}`);
    console.log(`${c.bright}═══════════════════════════════════════════════════════════════${c.reset}\n`);
    
    console.log(`${c.cyan}This wizard will help you pair new devices to your Smartika hub.${c.reset}\n`);
    console.log('Steps:');
    console.log('  1. Enable pairing mode on the hub');
    console.log('  2. Put your device into pairing mode (usually hold button 5+ seconds)');
    console.log('  3. Wait for the device to be discovered');
    console.log('  4. Add the device to the hub database\n');
    
    const rl = createReadlineInterface();
    
    // State
    let registeredDevices = new Set();
    let discoveredDevices = [];
    let newDevices = [];
    
    // Step 1: Get currently registered devices
    console.log(`${c.dim}Getting current device list...${c.reset}`);
    
    send(protocol.createDbListDeviceFullRequest(), (packet) => {
        const devices = protocol.parseDbListDeviceFullResponse(packet);
        devices.forEach(d => registeredDevices.add(d.shortAddress));
        console.log(`${c.dim}Found ${devices.length} registered device(s)${c.reset}\n`);
        
        // Step 2: Enable pairing mode
        console.log(`${c.yellow}► Enabling pairing mode for ${duration} seconds...${c.reset}`);
        
        send(protocol.createJoinEnableRequest(duration), (packet2) => {
            const result = protocol.parseJoinEnableResponse(packet2);
            console.log(`${c.green}✓ Pairing mode enabled${c.reset}\n`);
            console.log(`${c.bright}Put your device into pairing mode now!${c.reset}`);
            console.log(`${c.dim}(Press Enter to scan for new devices, or wait for the timer)${c.reset}\n`);
            
            // Create countdown timer
            let remaining = duration;
            const countdownTimer = setInterval(() => {
                remaining--;
                process.stdout.write(`\r${c.dim}Time remaining: ${remaining}s  ${c.reset}`);
                
                if (remaining <= 0) {
                    clearInterval(countdownTimer);
                    process.stdout.write('\r                              \r');
                    finishPairing();
                }
            }, 1000);
            
            // Allow user to press Enter to scan early
            rl.once('line', () => {
                clearInterval(countdownTimer);
                process.stdout.write('\r                              \r');
                scanForDevices();
            });
            
            function scanForDevices() {
                console.log(`\n${c.yellow}► Scanning for new devices...${c.reset}`);
                
                send(protocol.createDeviceDiscoveryRequest(), (packet3) => {
                    discoveredDevices = protocol.parseDeviceDiscoveryResponse(packet3);
                    
                    // Find devices not in the registered list
                    newDevices = discoveredDevices.filter(d => !registeredDevices.has(d.shortAddress));
                    
                    if (newDevices.length === 0) {
                        console.log(`\n${c.yellow}No new devices found.${c.reset}`);
                        console.log('Make sure your device is in pairing mode and try again.\n');
                        
                        prompt(rl, `${c.cyan}Scan again? (y/n): ${c.reset}`).then((answer) => {
                            if (answer.toLowerCase() === 'y') {
                                scanForDevices();
                            } else {
                                finishPairing();
                            }
                        });
                    } else {
                        console.log(`\n${c.green}✓ Found ${newDevices.length} new device(s)!${c.reset}\n`);
                        
                        newDevices.forEach((device, index) => {
                            console.log(`  ${c.bright}[${index + 1}]${c.reset} ${formatDeviceId(device.shortAddress)} - ${device.typeName} [${device.category}]`);
                        });
                        console.log();
                        
                        promptAddDevices();
                    }
                    
                    return true; // Keep connection open
                });
            }
            
            function promptAddDevices() {
                prompt(rl, `${c.cyan}Add these devices to the hub? (y/n/numbers e.g. "1,3"): ${c.reset}`).then((answer) => {
                    const lowerAnswer = answer.toLowerCase();
                    
                    if (lowerAnswer === 'n') {
                        finishPairing();
                        return;
                    }
                    
                    let devicesToAdd = [];
                    
                    if (lowerAnswer === 'y' || lowerAnswer === 'all') {
                        devicesToAdd = newDevices;
                    } else {
                        // Parse device numbers
                        const nums = answer.split(/[,\s]+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n));
                        devicesToAdd = nums.map(n => newDevices[n - 1]).filter(d => d);
                    }
                    
                    if (devicesToAdd.length === 0) {
                        console.log(`${c.yellow}No valid devices selected.${c.reset}`);
                        promptAddDevices();
                        return;
                    }
                    
                    const deviceIds = devicesToAdd.map(d => d.shortAddress);
                    console.log(`\n${c.yellow}► Adding ${deviceIds.length} device(s) to hub database...${c.reset}`);
                    
                    send(protocol.createDbAddDeviceRequest(deviceIds), (packet4) => {
                        const result = protocol.parseDbAddDeviceResponse(packet4);
                        
                        if (result.errorIds.length === 0) {
                            console.log(`${c.green}✓ All devices added successfully!${c.reset}\n`);
                        } else {
                            console.log(`${c.yellow}⚠ Some devices failed to add${c.reset}`);
                            console.log(`  Failed: ${result.errorIds.map(formatDeviceId).join(', ')}\n`);
                        }
                        
                        // Ask about scanning for more
                        prompt(rl, `${c.cyan}Scan for more devices? (y/n): ${c.reset}`).then((answer) => {
                            if (answer.toLowerCase() === 'y') {
                                // Update registered list
                                deviceIds.forEach(id => registeredDevices.add(id));
                                scanForDevices();
                            } else {
                                finishPairing();
                            }
                        });
                        
                        return true; // Keep connection open
                    });
                });
            }
            
            function finishPairing() {
                console.log(`\n${c.yellow}► Disabling pairing mode...${c.reset}`);
                
                send(protocol.createJoinDisableRequest(), (packet) => {
                    console.log(`${c.green}✓ Pairing mode disabled${c.reset}\n`);
                    
                    console.log(`${c.bright}═══════════════════════════════════════════════════════════════${c.reset}`);
                    console.log(`${c.bright}                       Pairing Complete!${c.reset}`);
                    console.log(`${c.bright}═══════════════════════════════════════════════════════════════${c.reset}\n`);
                    
                    console.log('Next steps:');
                    console.log('  • Restart Homebridge to discover new devices');
                    console.log('  • Use `groups` command to organize devices into groups');
                    console.log('  • Use `status` command to verify device connectivity\n');
                    
                    rl.close();
                    return false; // Close connection
                });
            }
            
            return true; // Keep connection open
        });
        
        return true; // Keep connection open
    });
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatDeviceId(id) {
    return `0x${id.toString(16).padStart(4, '0')}`;
}

function formatMac(mac) {
    return mac.match(/.{2}/g).join(':');
}

function printDeviceTable(devices, showMac) {
    if (devices.length === 0) {
        console.log(`  ${c.dim}No devices found.${c.reset}`);
        return;
    }

    // Calculate column widths
    const cols = {
        num: 4,
        address: 8,
        type: Math.max(12, ...devices.map(d => d.typeName.length)),
        category: 10,
        mac: showMac ? 20 : 0,
    };

    // Header
    let header = `  ${c.dim}${'#'.padEnd(cols.num)}${'Address'.padEnd(cols.address)}${'Type'.padEnd(cols.type)}${'Category'.padEnd(cols.category)}`;
    if (showMac) header += 'MAC Address'.padEnd(cols.mac);
    header += c.reset;
    console.log(header);
    console.log(`  ${c.dim}${'─'.repeat(cols.num + cols.address + cols.type + cols.category + (showMac ? cols.mac : 0))}${c.reset}`);

    // Rows
    devices.forEach((device, index) => {
        let row = `  ${String(index + 1).padEnd(cols.num)}`;
        row += `${c.cyan}${formatDeviceId(device.shortAddress).padEnd(cols.address)}${c.reset}`;
        row += device.typeName.padEnd(cols.type);
        row += `${c.dim}${device.category.padEnd(cols.category)}${c.reset}`;
        if (showMac) row += formatMac(device.macAddress);
        console.log(row);
    });
}

function printStatusTable(devices) {
    if (devices.length === 0) {
        console.log(`  ${c.dim}No devices found.${c.reset}`);
        return;
    }

    devices.forEach((device, index) => {
        console.log(`  ${c.bright}[${index + 1}] ${device.typeName}${c.reset} ${c.dim}(${formatDeviceId(device.shortAddress)})${c.reset}`);

        if (device.on !== undefined) {
            const powerIcon = device.on ? `${c.green}●${c.reset}` : `${c.dim}○${c.reset}`;
            console.log(`      Power:       ${powerIcon} ${device.on ? 'ON' : 'OFF'}`);
        }
        if (device.brightness !== undefined) {
            const percent = Math.round(device.brightness / 255 * 100);
            const bar = createProgressBar(percent, 20);
            console.log(`      Brightness:  ${bar} ${percent}%`);
        }
        if (device.temperature !== undefined) {
            const percent = Math.round(device.temperature / 255 * 100);
            const label = device.temperature < 85 ? 'warm' : device.temperature < 170 ? 'neutral' : 'cool';
            console.log(`      Temperature: ${device.temperature} (${label})`);
        }
        if (device.speed !== undefined) {
            console.log(`      Speed:       ${device.speed}`);
        }
        if (device.rawState) {
            console.log(`      Raw State:   ${device.rawState}`);
        }
        console.log();
    });
}

function createProgressBar(percent, width) {
    const filled = Math.round(percent / 100 * width);
    const empty = width - filled;
    return `${c.green}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

// ============================================================================
// Hub Connection
// ============================================================================

function connectAndExecute(hubIp, handler, args, needsHubInfo = false) {
    let encryptionKey = null;
    let responseHandler = null;
    let hubInfo = null;

    const client = new net.Socket();
    client.setTimeout(30000);

    client.connect(HUB_PORT, hubIp, () => {
        // Get Gateway ID for encryption
        client.write(protocol.createGatewayIdRequest());
    });

    client.on('data', (data) => {
        try {
            // First response is Gateway ID (unencrypted)
            if (!encryptionKey) {
                const gatewayInfo = protocol.parseGatewayIdResponse(data);
                encryptionKey = crypto.generateKey(gatewayInfo.hubId);
                hubInfo = {
                    ...gatewayInfo,
                    encryptionKey,
                };

                // Now execute the actual command
                const send = (request, callback) => {
                    responseHandler = callback;
                    const encrypted = crypto.encrypt(request, encryptionKey);
                    client.write(encrypted);
                };

                // Pass hubInfo for commands that need it
                if (needsHubInfo) {
                    handler(args, send, hubInfo);
                } else {
                    handler(args, send);
                }
            } else {
                // Decrypt and handle response
                const packet = crypto.decrypt(data, encryptionKey);
                if (responseHandler) {
                    const keepOpen = responseHandler(packet);
                    if (!keepOpen) {
                        client.destroy();
                    }
                }
            }
        } catch (e) {
            console.error(`\n${c.red}Error: ${e.message}${c.reset}`);
            client.destroy();
            process.exit(1);
        }
    });

    client.on('timeout', () => {
        console.error(`\n${c.red}Error: Connection timeout${c.reset}`);
        client.destroy();
        process.exit(1);
    });

    client.on('close', () => {
        process.exit(0);
    });

    client.on('error', (err) => {
        console.error(`\n${c.red}Error: ${err.message}${c.reset}`);
        process.exit(1);
    });
}

// ============================================================================
// Main Entry Point
// ============================================================================

function main() {
    const args = process.argv.slice(2);

    // Check for help flag
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        printHelp();
        process.exit(0);
    }

    if (args[0] === '--version' || args[0] === '-v') {
        console.log(`Smartika CLI v${VERSION}`);
        process.exit(0);
    }

    // Check for standalone commands (no hub IP required)
    const firstArg = args[0];
    if (standaloneCommands[firstArg]) {
        const cmdDef = standaloneCommands[firstArg];

        // Check for command help
        if (args.includes('--help') || args.includes('-h')) {
            printStandaloneCommandHelp(firstArg, cmdDef);
            process.exit(0);
        }

        // Parse arguments
        let parsedArgs;
        try {
            parsedArgs = parseArgs(cmdDef, args.slice(1));
        } catch (e) {
            console.error(`${c.red}Error: ${e.message}${c.reset}`);
            console.log(`\nUsage: smartika-cli ${cmdDef.usage}`);
            process.exit(1);
        }

        // Execute standalone command
        cmdDef.handler(parsedArgs);
        return;
    }

    // Get hub IP for regular commands
    const hubIp = args[0];
    if (!hubIp || hubIp.startsWith('-')) {
        console.error(`${c.red}Error: Hub IP address required${c.reset}`);
        console.log(`\nUsage: smartika-cli <hub-ip> <command> [arguments...]`);
        console.log(`   or: smartika-cli hub-discover`);
        process.exit(1);
    }

    // Get command
    const cmdName = args[1];
    if (!cmdName) {
        console.error(`${c.red}Error: Command required${c.reset}`);
        printCommands();
        process.exit(1);
    }

    // Check for command help
    if (args.includes('--help') || args.includes('-h')) {
        const cmdDef = commands[cmdName];
        if (cmdDef) {
            printCommandHelp(cmdName, cmdDef);
        } else {
            console.error(`${c.red}Error: Unknown command: ${cmdName}${c.reset}`);
        }
        process.exit(0);
    }

    // Find command
    const cmdDef = commands[cmdName];
    if (!cmdDef) {
        console.error(`${c.red}Error: Unknown command: ${cmdName}${c.reset}`);
        console.log(`\nRun 'smartika-cli --help' for available commands.`);
        process.exit(1);
    }

    // Parse arguments
    let parsedArgs;
    try {
        parsedArgs = parseArgs(cmdDef, args.slice(2));
    } catch (e) {
        console.error(`${c.red}Error: ${e.message}${c.reset}`);
        console.log(`\nUsage: smartika-cli <hub-ip> ${cmdDef.usage}`);
        process.exit(1);
    }

    // Execute command
    console.log(`${c.dim}Connecting to ${hubIp}...${c.reset}\n`);
    const needsHubInfo = cmdName === 'hub-info';
    connectAndExecute(hubIp, cmdDef.handler, parsedArgs, needsHubInfo);
}

main();
