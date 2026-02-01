'use strict';

// Protocol constants
const START_MARK_REQUEST = 0xFE00;
const START_MARK_RESPONSE = 0xFE01;
const END_MARK = 0x00FF;

// Broadcast address for all devices
const DEVICE_ID_BROADCAST = 0xFFFF;

// Command IDs (from hub simulator)
const CMD = {
    // Main device commands
    DEVICE_SWITCH: 0x0000,          // Turn device on/off
    DEVICE_DISCOVERY: 0x0001,       // Discover devices on network
    DEVICE_STATUS: 0x0002,          // Get device status
    LIGHT_DIM: 0x0004,              // Set light brightness (0-255)
    LIGHT_TEMPERATURE: 0x0005,      // Set light color temperature (0-255)
    FAN_CONTROL: 0x0006,            // Control fan speed
    LIGHT_DIM_BATCH: 0x0008,        // Set brightness for multiple devices
    LIGHT_TEMPERATURE_BATCH: 0x0009, // Set temperature for multiple devices

    // System commands
    GATEWAY_ID: 0x0010,             // Fetch hub UUID (returns "artika" + hub_id)
    PING: 0x0101,                   // Keep-alive
    CREDENTIALS: 0x0103,            // Authentication (used by hub->bridge)
    JOIN_ENABLE: 0x0104,            // Enable device pairing
    JOIN_DISABLE: 0x0105,           // Disable device pairing
    FIRMWARE_VERSION: 0x0106,       // Get firmware version

    // Database commands
    DB_LIST_DEVICE: 0x0200,         // List registered device IDs
    DB_ADD_DEVICE: 0x0201,          // Add device to database
    DB_REMOVE_DEVICE: 0x0202,       // Remove device from database
    DB_LIST_DEVICE_FULL: 0x0203,    // List registered devices with full info

    // Group commands
    GROUP_LIST: 0x0400,             // List all groups
    GROUP_CREATE: 0x0401,           // Create a new group
    GROUP_UPDATE: 0x0402,           // Update group members
    GROUP_READ: 0x0403,             // Read group members
    GROUP_DELETE: 0x0404,           // Delete groups
};

// Hub communication port
const HUB_PORT = 1234;

// Device types
const DEVICE_TYPES = {
    // Real devices
    0x00000001: 'Champagne Track',
    0x00000005: 'Ceiling Fan',
    0x00000007: 'Smart Plug',
    0x00000008: 'Mini Wall Washer',
    0x00000009: 'Glowbox',
    0x0000000B: 'Recessed Lighting',
    0x0000000D: 'Water Leakage Sensor',
    0x00001001: 'Pendant 1',
    0x00001002: 'Pendant 2',
    0x00001003: 'Pendant 3',
    0x00001004: 'Pendant 4',
    0x00001005: 'Pendant 5',
    0x00001006: 'Smart Bulb',
    0x00001007: 'Spotlight',
    0x00001008: 'Sandwich Light 1',
    0x00001009: 'Sandwich Light 2',
    0x0000100A: 'Sandwich Light 3',
    0x00002001: 'Thermostat',
    0x00002002: 'Smart Heater',
    // Virtual devices (groups)
    0x40000001: 'Virtual Light',
    0x40000003: 'Virtual Fan',
    0x40000004: 'Virtual Plug',
    0x40002002: 'Virtual Heater',
    // Remote controls
    0x80000002: 'Remote Control Light',
    0x80000004: 'Remote Control Heater',
    0x80000006: 'Remote Control Fan',
    0x80000008: 'Programmable Remote',
};

// Device categories for HomeKit mapping
const DEVICE_CATEGORY = {
    LIGHT: 'light',
    FAN: 'fan',
    PLUG: 'plug',
    THERMOSTAT: 'thermostat',
    SENSOR: 'sensor',
    REMOTE: 'remote',
};

// Map device types to categories
const DEVICE_TYPE_CATEGORY = {
    0x00000001: DEVICE_CATEGORY.LIGHT,  // Champagne Track
    0x00000005: DEVICE_CATEGORY.FAN,    // Ceiling Fan
    0x00000007: DEVICE_CATEGORY.PLUG,   // Smart Plug
    0x00000008: DEVICE_CATEGORY.LIGHT,  // Mini Wall Washer
    0x00000009: DEVICE_CATEGORY.LIGHT,  // Glowbox
    0x0000000B: DEVICE_CATEGORY.LIGHT,  // Recessed Lighting
    0x0000000D: DEVICE_CATEGORY.SENSOR, // Water Leakage Sensor
    0x00001001: DEVICE_CATEGORY.LIGHT,  // Pendant 1
    0x00001002: DEVICE_CATEGORY.LIGHT,  // Pendant 2
    0x00001003: DEVICE_CATEGORY.LIGHT,  // Pendant 3
    0x00001004: DEVICE_CATEGORY.LIGHT,  // Pendant 4
    0x00001005: DEVICE_CATEGORY.LIGHT,  // Pendant 5
    0x00001006: DEVICE_CATEGORY.LIGHT,  // Smart Bulb
    0x00001007: DEVICE_CATEGORY.LIGHT,  // Spotlight
    0x00001008: DEVICE_CATEGORY.LIGHT,  // Sandwich Light 1
    0x00001009: DEVICE_CATEGORY.LIGHT,  // Sandwich Light 2
    0x0000100A: DEVICE_CATEGORY.LIGHT,  // Sandwich Light 3
    0x00002001: DEVICE_CATEGORY.THERMOSTAT, // Thermostat
    0x00002002: DEVICE_CATEGORY.THERMOSTAT, // Smart Heater
    0x40000001: DEVICE_CATEGORY.LIGHT,  // Virtual Light
    0x40000003: DEVICE_CATEGORY.FAN,    // Virtual Fan
    0x40000004: DEVICE_CATEGORY.PLUG,   // Virtual Plug
    0x40002002: DEVICE_CATEGORY.THERMOSTAT, // Virtual Heater
    0x80000002: DEVICE_CATEGORY.REMOTE, // Remote Control Light
    0x80000004: DEVICE_CATEGORY.REMOTE, // Remote Control Heater
    0x80000006: DEVICE_CATEGORY.REMOTE, // Remote Control Fan
    0x80000008: DEVICE_CATEGORY.REMOTE, // Programmable Remote
};

// ============================================================================
// Core Protocol Functions
// ============================================================================

/**
 * Compute XOR checksum of buffer
 * @param {Buffer} data
 * @returns {number}
 */
function computeChecksum(data) {
    let fcs = 0;
    for (let i = 0; i < data.length; i++) {
        fcs ^= data[i];
    }
    return fcs;
}

/**
 * Create a command packet
 * @param {number} cmdId - Command ID
 * @param {Buffer} data - Command data (optional)
 * @param {number} listLen - List length (optional)
 * @param {boolean} isRequest - True for request, false for response
 * @returns {Buffer}
 */
function createPacket(cmdId, data = Buffer.alloc(0), listLen = 0, isRequest = true) {
    const startMark = isRequest ? START_MARK_REQUEST : START_MARK_RESPONSE;
    const dataLen = data.length;

    // Build the FCS data (cmd + len + listLen + data)
    const fcsData = Buffer.alloc(6 + dataLen);
    fcsData.writeUInt16BE(cmdId, 0);
    fcsData.writeUInt16BE(dataLen, 2);
    fcsData.writeUInt16BE(listLen, 4);
    data.copy(fcsData, 6);

    const fcs = computeChecksum(fcsData);

    // Build full packet
    const packet = Buffer.alloc(2 + fcsData.length + 1 + 2);
    packet.writeUInt16BE(startMark, 0);
    fcsData.copy(packet, 2);
    packet.writeUInt8(fcs, 2 + fcsData.length);
    packet.writeUInt16BE(END_MARK, 2 + fcsData.length + 1);

    return packet;
}

/**
 * Parse a response packet
 * @param {Buffer} packet
 * @returns {Object} - { cmdId, dataLen, listLen, data, isRequest }
 */
function parsePacket(packet) {
    if (packet.length < 11) {
        throw new Error('Packet too short');
    }

    const startMark = packet.readUInt16BE(0);
    const isRequest = startMark === START_MARK_REQUEST;

    if (startMark !== START_MARK_REQUEST && startMark !== START_MARK_RESPONSE) {
        throw new Error(`Invalid start mark: 0x${startMark.toString(16)}`);
    }

    const cmdId = packet.readUInt16BE(2);
    const dataLen = packet.readUInt16BE(4);
    const listLen = packet.readUInt16BE(6);

    if (packet.length < 8 + dataLen + 3) {
        throw new Error('Packet data incomplete');
    }

    const data = packet.subarray(8, 8 + dataLen);
    const fcs = packet.readUInt8(8 + dataLen);
    const endMark = packet.readUInt16BE(8 + dataLen + 1);

    if (endMark !== END_MARK) {
        throw new Error(`Invalid end mark: 0x${endMark.toString(16)}`);
    }

    // Verify checksum
    const fcsData = packet.subarray(2, 8 + dataLen);
    const expectedFcs = computeChecksum(fcsData);
    if (fcs !== expectedFcs) {
        throw new Error(`Checksum mismatch: got 0x${fcs.toString(16)}, expected 0x${expectedFcs.toString(16)}`);
    }

    return { cmdId, dataLen, listLen, data, isRequest };
}

// ============================================================================
// System Commands
// ============================================================================

/**
 * Create gateway ID request (fetch hub UUID)
 * @returns {Buffer}
 */
function createGatewayIdRequest() {
    return createPacket(CMD.GATEWAY_ID, Buffer.alloc(0), 0, true);
}

/**
 * Parse gateway ID response
 * @param {Buffer} packet
 * @returns {Object} - { prefix, hubId, hubIdHex }
 */
function parseGatewayIdResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.GATEWAY_ID) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    // Response format: "artika" (6 bytes) + hub_id (6 bytes) = 12 bytes
    if (data.length < 12) {
        throw new Error(`Gateway ID response too short: ${data.length} bytes`);
    }

    const prefix = data.subarray(0, 6).toString('ascii');
    const hubId = data.subarray(6, 12);

    return {
        prefix,
        hubId,
        hubIdHex: hubId.toString('hex').toUpperCase(),
    };
}

/**
 * Create ping request
 * @returns {Buffer}
 */
function createPingRequest() {
    return createPacket(CMD.PING, Buffer.alloc(0), 0, true);
}

/**
 * Parse ping response
 * @param {Buffer} packet
 * @returns {Object} - { alarmSet }
 */
function parsePingResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.PING) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    return {
        alarmSet: data.length > 0 && data[0] !== 0,
    };
}

/**
 * Create credentials request
 * @param {Buffer} hubId - 6 bytes hub MAC address
 * @returns {Buffer}
 */
function createCredentialsRequest(hubId) {
    const prefix = Buffer.from('artika', 'ascii');
    const data = Buffer.concat([prefix, hubId.subarray(0, 6)]);
    return createPacket(CMD.CREDENTIALS, data, 0, true);
}

/**
 * Parse credentials response
 * @param {Buffer} packet
 * @returns {boolean} - Success
 */
function parseCredentialsResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.CREDENTIALS) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    return data.length === 0 || data[0] !== 0;
}

/**
 * Create join enable request
 * @param {number} duration - Duration in seconds (0 = use default)
 * @returns {Buffer}
 */
function createJoinEnableRequest(duration = 0) {
    const data = Buffer.alloc(1);
    data.writeUInt8(duration, 0);
    return createPacket(CMD.JOIN_ENABLE, data, 0, true);
}

/**
 * Parse join enable response
 * @param {Buffer} packet
 * @returns {Object} - { duration }
 */
function parseJoinEnableResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.JOIN_ENABLE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    return {
        duration: data.length > 0 ? data.readUInt8(0) : 0,
    };
}

/**
 * Create join disable request
 * @returns {Buffer}
 */
function createJoinDisableRequest() {
    return createPacket(CMD.JOIN_DISABLE, Buffer.alloc(0), 0, true);
}

/**
 * Create firmware version request
 * @returns {Buffer}
 */
function createFirmwareVersionRequest() {
    return createPacket(CMD.FIRMWARE_VERSION, Buffer.alloc(0), 0, true);
}

/**
 * Parse firmware version response
 * @param {Buffer} packet
 * @returns {Object} - { major, minor, patch, version }
 */
function parseFirmwareVersionResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.FIRMWARE_VERSION) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    if (data.length < 3) {
        throw new Error('Firmware version response too short');
    }
    const major = data.readUInt8(0);
    const minor = data.readUInt8(1);
    const patch = data.readUInt8(2);
    return {
        major,
        minor,
        patch,
        version: `${major}.${minor}.${patch}`,
    };
}

// ============================================================================
// Device Commands
// ============================================================================

/**
 * Create device discovery request
 * @returns {Buffer}
 */
function createDeviceDiscoveryRequest() {
    return createPacket(CMD.DEVICE_DISCOVERY, Buffer.alloc(0), 0, true);
}

/**
 * Parse device discovery response
 * @param {Buffer} packet
 * @returns {Array} - List of devices
 */
function parseDeviceDiscoveryResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DEVICE_DISCOVERY) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const devices = [];
    // Each device: short_address(2) + type_id(4) + mac_address(8) = 14 bytes
    const deviceSize = 14;

    for (let i = 0; i < listLen && (i * deviceSize) < data.length; i++) {
        const offset = i * deviceSize;
        const shortAddress = data.readUInt16BE(offset);
        const typeId = data.readUInt32BE(offset + 2);
        const macAddress = data.subarray(offset + 6, offset + 14);

        devices.push({
            shortAddress,
            typeId,
            typeName: DEVICE_TYPES[typeId] || `Unknown (0x${typeId.toString(16)})`,
            category: DEVICE_TYPE_CATEGORY[typeId] || 'unknown',
            macAddress: macAddress.toString('hex').toUpperCase(),
        });
    }

    return devices;
}

/**
 * Create device status request
 * @param {number[]} deviceIds - Array of device short addresses (use DEVICE_ID_BROADCAST for all)
 * @returns {Buffer}
 */
function createDeviceStatusRequest(deviceIds = [DEVICE_ID_BROADCAST]) {
    const data = Buffer.alloc(deviceIds.length * 2);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, index * 2);
    });
    return createPacket(CMD.DEVICE_STATUS, data, deviceIds.length, true);
}

/**
 * Parse device status response
 * @param {Buffer} packet
 * @returns {Array} - List of device statuses
 */
function parseDeviceStatusResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DEVICE_STATUS) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const devices = [];
    let offset = 0;

    for (let i = 0; i < listLen && offset < data.length; i++) {
        const shortAddress = data.readUInt16BE(offset);
        const typeId = data.readUInt32BE(offset + 2);
        const stateLen = data.readUInt8(offset + 6);
        const stateData = data.subarray(offset + 7, offset + 7 + stateLen);

        const device = {
            shortAddress,
            typeId,
            typeName: DEVICE_TYPES[typeId] || `Unknown (0x${typeId.toString(16)})`,
            category: DEVICE_TYPE_CATEGORY[typeId] || 'unknown',
        };

        // Parse state based on device category
        const category = DEVICE_TYPE_CATEGORY[typeId];
        if (category === DEVICE_CATEGORY.LIGHT && stateLen >= 3) {
            device.on = stateData[0] !== 0;
            device.brightness = stateData[1];  // 0-255
            device.temperature = stateData[2]; // 0-255
        } else if (category === DEVICE_CATEGORY.FAN && stateLen >= 2) {
            device.on = stateData[0] !== 0;
            device.speed = stateData[1]; // 0-255
        } else if (category === DEVICE_CATEGORY.PLUG && stateLen >= 1) {
            device.on = stateData[0] !== 0;
        } else {
            device.rawState = stateData.toString('hex').toUpperCase();
        }

        devices.push(device);
        offset += 7 + stateLen;
    }

    return devices;
}

/**
 * Create device switch request (on/off)
 * @param {boolean} on - True to turn on, false to turn off
 * @param {number[]} deviceIds - Array of device short addresses
 * @returns {Buffer}
 */
function createDeviceSwitchRequest(on, deviceIds) {
    // Format: on(1 byte boolean) + device_ids (2 bytes each)
    const data = Buffer.alloc(1 + deviceIds.length * 2);
    data.writeUInt8(on ? 1 : 0, 0);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, 1 + index * 2);
    });
    return createPacket(CMD.DEVICE_SWITCH, data, deviceIds.length, true);
}

/**
 * Parse device switch response
 * @param {Buffer} packet
 * @returns {Object} - { deviceIds }
 */
function parseDeviceSwitchResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DEVICE_SWITCH) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const deviceIds = [];
    for (let i = 0; i < listLen; i++) {
        deviceIds.push(data.readUInt16BE(i * 2));
    }
    return { deviceIds };
}

/**
 * Create light dim request
 * @param {number} brightness - Brightness level (0-255)
 * @param {number[]} deviceIds - Array of device short addresses
 * @returns {Buffer}
 */
function createLightDimRequest(brightness, deviceIds) {
    // Format: brightness(1 byte) + device_ids (2 bytes each)
    const data = Buffer.alloc(1 + deviceIds.length * 2);
    data.writeUInt8(brightness, 0);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, 1 + index * 2);
    });
    return createPacket(CMD.LIGHT_DIM, data, deviceIds.length, true);
}

/**
 * Parse light dim response
 * @param {Buffer} packet
 * @returns {Object} - { deviceIds }
 */
function parseLightDimResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.LIGHT_DIM) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const deviceIds = [];
    for (let i = 0; i < listLen; i++) {
        deviceIds.push(data.readUInt16BE(i * 2));
    }
    return { deviceIds };
}

/**
 * Create light temperature request
 * @param {number} temperature - Color temperature (0-255, warm to cool)
 * @param {number[]} deviceIds - Array of device short addresses
 * @returns {Buffer}
 */
function createLightTemperatureRequest(temperature, deviceIds) {
    // Format: temperature(1 byte) + device_ids (2 bytes each)
    const data = Buffer.alloc(1 + deviceIds.length * 2);
    data.writeUInt8(temperature, 0);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, 1 + index * 2);
    });
    return createPacket(CMD.LIGHT_TEMPERATURE, data, deviceIds.length, true);
}

/**
 * Parse light temperature response
 * @param {Buffer} packet
 * @returns {Object} - { deviceIds }
 */
function parseLightTemperatureResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.LIGHT_TEMPERATURE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const deviceIds = [];
    for (let i = 0; i < listLen; i++) {
        deviceIds.push(data.readUInt16BE(i * 2));
    }
    return { deviceIds };
}

/**
 * Create fan control request
 * @param {number} speed - Fan speed (0-255)
 * @param {number[]} deviceIds - Array of device short addresses
 * @returns {Buffer}
 */
function createFanControlRequest(speed, deviceIds) {
    const data = Buffer.alloc(1 + deviceIds.length * 2);
    data.writeUInt8(speed, 0);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, 1 + index * 2);
    });
    return createPacket(CMD.FAN_CONTROL, data, deviceIds.length, true);
}

/**
 * Create light dim batch request (different brightness per device)
 * @param {Array<{deviceId: number, brightness: number}>} devices
 * @returns {Buffer}
 */
function createLightDimBatchRequest(devices) {
    // Format: (device_id(2) + brightness(1)) per device
    const data = Buffer.alloc(devices.length * 3);
    devices.forEach((device, index) => {
        data.writeUInt16BE(device.deviceId, index * 3);
        data.writeUInt8(device.brightness, index * 3 + 2);
    });
    return createPacket(CMD.LIGHT_DIM_BATCH, data, devices.length, true);
}

/**
 * Create light temperature batch request (different temperature per device)
 * @param {Array<{deviceId: number, temperature: number}>} devices
 * @returns {Buffer}
 */
function createLightTemperatureBatchRequest(devices) {
    // Format: (device_id(2) + temperature(1)) per device
    const data = Buffer.alloc(devices.length * 3);
    devices.forEach((device, index) => {
        data.writeUInt16BE(device.deviceId, index * 3);
        data.writeUInt8(device.temperature, index * 3 + 2);
    });
    return createPacket(CMD.LIGHT_TEMPERATURE_BATCH, data, devices.length, true);
}

// ============================================================================
// Database Commands
// ============================================================================

/**
 * Create DB list device request (IDs only)
 * @returns {Buffer}
 */
function createDbListDeviceRequest() {
    return createPacket(CMD.DB_LIST_DEVICE, Buffer.alloc(0), 0, true);
}

/**
 * Parse DB list device response
 * @param {Buffer} packet
 * @returns {Object} - { deviceIds }
 */
function parseDbListDeviceResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DB_LIST_DEVICE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const deviceIds = [];
    for (let i = 0; i < listLen; i++) {
        deviceIds.push(data.readUInt16BE(i * 2));
    }
    return { deviceIds };
}

/**
 * Create DB list device full request
 * @returns {Buffer}
 */
function createDbListDeviceFullRequest() {
    return createPacket(CMD.DB_LIST_DEVICE_FULL, Buffer.alloc(0), 0, true);
}

/**
 * Parse DB list device full response
 * @param {Buffer} packet
 * @returns {Array} - List of devices with short_address, type_id, mac_address
 */
function parseDbListDeviceFullResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DB_LIST_DEVICE_FULL) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const devices = [];
    // Each device: short_address(2) + type_id(4) + mac_address(8) = 14 bytes
    const deviceSize = 14;

    for (let i = 0; i < listLen && (i * deviceSize) < data.length; i++) {
        const offset = i * deviceSize;
        const shortAddress = data.readUInt16BE(offset);
        const typeId = data.readUInt32BE(offset + 2);
        const macAddress = data.readBigUInt64BE(offset + 6);

        devices.push({
            shortAddress,
            typeId,
            typeName: DEVICE_TYPES[typeId] || `Unknown (0x${typeId.toString(16)})`,
            category: DEVICE_TYPE_CATEGORY[typeId] || 'unknown',
            macAddress: macAddress.toString(16).toUpperCase().padStart(16, '0'),
        });
    }

    return devices;
}

/**
 * Create DB add device request
 * @param {number[]} deviceIds - Array of device short addresses to add
 * @returns {Buffer}
 */
function createDbAddDeviceRequest(deviceIds) {
    const data = Buffer.alloc(deviceIds.length * 2);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, index * 2);
    });
    return createPacket(CMD.DB_ADD_DEVICE, data, deviceIds.length, true);
}

/**
 * Parse DB add device response
 * @param {Buffer} packet
 * @returns {Object} - { errorIds } - device IDs that failed to add
 */
function parseDbAddDeviceResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DB_ADD_DEVICE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const errorIds = [];
    for (let i = 0; i < listLen; i++) {
        errorIds.push(data.readUInt16BE(i * 2));
    }
    return { errorIds };
}

/**
 * Create DB remove device request
 * @param {number[]} deviceIds - Array of device short addresses to remove
 * @returns {Buffer}
 */
function createDbRemoveDeviceRequest(deviceIds) {
    const data = Buffer.alloc(deviceIds.length * 2);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, index * 2);
    });
    return createPacket(CMD.DB_REMOVE_DEVICE, data, deviceIds.length, true);
}

/**
 * Parse DB remove device response
 * @param {Buffer} packet
 * @returns {Object} - { errorIds } - device IDs that failed to remove
 */
function parseDbRemoveDeviceResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.DB_REMOVE_DEVICE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const errorIds = [];
    for (let i = 0; i < listLen; i++) {
        errorIds.push(data.readUInt16BE(i * 2));
    }
    return { errorIds };
}

// ============================================================================
// Group Commands
// ============================================================================

/**
 * Create group list request
 * @returns {Buffer}
 */
function createGroupListRequest() {
    return createPacket(CMD.GROUP_LIST, Buffer.alloc(0), 0, true);
}

/**
 * Parse group list response
 * @param {Buffer} packet
 * @returns {Object} - { groupIds }
 */
function parseGroupListResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.GROUP_LIST) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const groupIds = [];
    for (let i = 0; i < listLen; i++) {
        groupIds.push(data.readUInt16BE(i * 2));
    }
    return { groupIds };
}

/**
 * Create group create request
 * @param {number[]} deviceIds - Array of device short addresses to include in group
 * @returns {Buffer}
 */
function createGroupCreateRequest(deviceIds) {
    const data = Buffer.alloc(deviceIds.length * 2);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, index * 2);
    });
    return createPacket(CMD.GROUP_CREATE, data, deviceIds.length, true);
}

/**
 * Parse group create response
 * @param {Buffer} packet
 * @returns {Object} - { groupId } - 0xFFFF on error
 */
function parseGroupCreateResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.GROUP_CREATE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    return {
        groupId: data.readUInt16BE(0),
        success: data.readUInt16BE(0) !== 0xFFFF,
    };
}

/**
 * Create group update request
 * @param {number} groupId - Group short address
 * @param {number[]} deviceIds - New array of device short addresses
 * @returns {Buffer}
 */
function createGroupUpdateRequest(groupId, deviceIds) {
    const data = Buffer.alloc(2 + deviceIds.length * 2);
    data.writeUInt16BE(groupId, 0);
    deviceIds.forEach((id, index) => {
        data.writeUInt16BE(id, 2 + index * 2);
    });
    return createPacket(CMD.GROUP_UPDATE, data, deviceIds.length, true);
}

/**
 * Parse group update response
 * @param {Buffer} packet
 * @returns {Object} - { groupId } - 0xFFFF on error
 */
function parseGroupUpdateResponse(packet) {
    const { cmdId, data } = parsePacket(packet);
    if (cmdId !== CMD.GROUP_UPDATE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }
    return {
        groupId: data.readUInt16BE(0),
        success: data.readUInt16BE(0) !== 0xFFFF,
    };
}

/**
 * Create group read request
 * @param {number} groupId - Group short address
 * @returns {Buffer}
 */
function createGroupReadRequest(groupId) {
    const data = Buffer.alloc(2);
    data.writeUInt16BE(groupId, 0);
    return createPacket(CMD.GROUP_READ, data, 0, true);
}

/**
 * Parse group read response
 * @param {Buffer} packet
 * @returns {Object} - { groupId, deviceIds }
 */
function parseGroupReadResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.GROUP_READ) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const groupId = data.readUInt16BE(0);
    const deviceIds = [];
    for (let i = 0; i < listLen; i++) {
        deviceIds.push(data.readUInt16BE(2 + i * 2));
    }
    return {
        groupId,
        success: groupId !== 0xFFFF,
        deviceIds,
    };
}

/**
 * Create group delete request
 * @param {number[]} groupIds - Array of group short addresses to delete
 * @returns {Buffer}
 */
function createGroupDeleteRequest(groupIds) {
    const data = Buffer.alloc(groupIds.length * 2);
    groupIds.forEach((id, index) => {
        data.writeUInt16BE(id, index * 2);
    });
    return createPacket(CMD.GROUP_DELETE, data, groupIds.length, true);
}

/**
 * Parse group delete response
 * @param {Buffer} packet
 * @returns {Object} - { errorIds } - group IDs that failed to delete
 */
function parseGroupDeleteResponse(packet) {
    const { cmdId, listLen, data } = parsePacket(packet);
    if (cmdId !== CMD.GROUP_DELETE) {
        throw new Error(`Unexpected command ID: 0x${cmdId.toString(16)}`);
    }

    const errorIds = [];
    for (let i = 0; i < listLen; i++) {
        errorIds.push(data.readUInt16BE(i * 2));
    }
    return { errorIds };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    // Constants
    CMD,
    DEVICE_TYPES,
    DEVICE_CATEGORY,
    DEVICE_TYPE_CATEGORY,
    HUB_PORT,
    START_MARK_REQUEST,
    START_MARK_RESPONSE,
    END_MARK,
    DEVICE_ID_BROADCAST,

    // Core
    computeChecksum,
    createPacket,
    parsePacket,

    // System commands
    createGatewayIdRequest,
    parseGatewayIdResponse,
    createPingRequest,
    parsePingResponse,
    createCredentialsRequest,
    parseCredentialsResponse,
    createJoinEnableRequest,
    parseJoinEnableResponse,
    createJoinDisableRequest,
    createFirmwareVersionRequest,
    parseFirmwareVersionResponse,

    // Device commands
    createDeviceDiscoveryRequest,
    parseDeviceDiscoveryResponse,
    createDeviceStatusRequest,
    parseDeviceStatusResponse,
    createDeviceSwitchRequest,
    parseDeviceSwitchResponse,
    createLightDimRequest,
    parseLightDimResponse,
    createLightTemperatureRequest,
    parseLightTemperatureResponse,
    createFanControlRequest,
    createLightDimBatchRequest,
    createLightTemperatureBatchRequest,

    // Database commands
    createDbListDeviceRequest,
    parseDbListDeviceResponse,
    createDbListDeviceFullRequest,
    parseDbListDeviceFullResponse,
    createDbAddDeviceRequest,
    parseDbAddDeviceResponse,
    createDbRemoveDeviceRequest,
    parseDbRemoveDeviceResponse,

    // Group commands
    createGroupListRequest,
    parseGroupListResponse,
    createGroupCreateRequest,
    parseGroupCreateResponse,
    createGroupUpdateRequest,
    parseGroupUpdateResponse,
    createGroupReadRequest,
    parseGroupReadResponse,
    createGroupDeleteRequest,
    parseGroupDeleteResponse,
};
