'use strict';

const net = require('net');
const EventEmitter = require('events');
const crypto = require('./SmartikaCrypto');
const protocol = require('./SmartikaProtocol');

/**
 * Manages the TCP connection to the Smartika hub.
 * Handles encryption, protocol commands, and automatic reconnection.
 */
class SmartikaHubConnection extends EventEmitter {
    /**
     * @param {Object} options
     * @param {string} options.host - Hub IP address
     * @param {number} options.port - Hub port (default: 1234)
     * @param {number} options.pollingInterval - Status polling interval in ms
     * @param {Object} options.log - Homebridge logger
     * @param {boolean} options.debug - Enable debug logging
     */
    constructor(options) {
        super();

        this.host = options.host;
        this.port = options.port || protocol.HUB_PORT;
        this.pollingInterval = options.pollingInterval || 5000;
        this.log = options.log;
        this.debug = options.debug || false;

        this.socket = null;
        this.encryptionKey = null;
        this.hubId = null;
        this.connected = false;
        this.reconnecting = false;

        this.pollingTimer = null;
        this.pingTimer = null;
        this.reconnectTimer = null;

        // Command queue for handling responses
        this.pendingCommand = null;
        this.responseBuffer = Buffer.alloc(0);
    }

    /**
     * Connect to the Smartika hub
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.connected) {
                resolve();
                return;
            }

            this.debugLog(`Connecting to hub at ${this.host}:${this.port}...`);

            this.socket = new net.Socket();
            this.socket.setTimeout(30000);

            const cleanup = () => {
                this.socket.removeAllListeners('error');
                this.socket.removeAllListeners('timeout');
            };

            this.socket.once('error', (err) => {
                cleanup();
                reject(new Error(`Connection failed: ${err.message}`));
            });

            this.socket.once('timeout', () => {
                cleanup();
                this.socket.destroy();
                reject(new Error('Connection timeout'));
            });

            this.socket.connect(this.port, this.host, async () => {
                cleanup();
                this.setupSocketHandlers();

                try {
                    // Fetch gateway ID to get encryption key
                    await this.initializeEncryption();
                    this.connected = true;
                    this.reconnecting = false;
                    this.emit('connected');
                    resolve();
                } catch (error) {
                    this.socket.destroy();
                    reject(error);
                }
            });
        });
    }

    /**
     * Set up socket event handlers
     */
    setupSocketHandlers() {
        this.socket.on('data', (data) => {
            this.handleData(data);
        });

        this.socket.on('close', () => {
            this.connected = false;
            this.emit('disconnected');
            this.scheduleReconnect();
        });

        this.socket.on('error', (err) => {
            this.log.error('Socket error:', err.message);
            this.emit('error', err);
        });

        this.socket.on('timeout', () => {
            this.log.warn('Socket timeout - attempting to keep alive');
            this.ping().catch(() => { });
        });
    }

    /**
     * Initialize encryption by fetching gateway ID
     * @returns {Promise<void>}
     */
    initializeEncryption() {
        return new Promise((resolve, reject) => {
            const request = protocol.createGatewayIdRequest();
            this.debugLog(`Sending gateway ID request: ${request.toString('hex').toUpperCase()}`);

            // Gateway ID response is unencrypted
            const handler = (data) => {
                try {
                    const result = protocol.parseGatewayIdResponse(data);
                    this.hubId = result.hubId;
                    this.encryptionKey = crypto.generateKey(result.hubId);
                    this.debugLog(`Hub ID: ${result.hubIdHex}`);
                    this.debugLog(`Encryption key generated`);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            };

            this.socket.once('data', handler);
            this.socket.write(request);

            // Timeout for gateway ID response
            setTimeout(() => {
                this.socket.removeListener('data', handler);
                reject(new Error('Gateway ID request timeout'));
            }, 5000);
        });
    }

    /**
     * Handle incoming data from the hub
     * @param {Buffer} data
     */
    handleData(data) {
        // Append to buffer
        this.responseBuffer = Buffer.concat([this.responseBuffer, data]);

        // Try to process complete packets
        if (this.pendingCommand && this.responseBuffer.length > 0) {
            const { resolve, reject, timeout } = this.pendingCommand;
            clearTimeout(timeout);

            try {
                // Decrypt the response
                const decrypted = crypto.decrypt(this.responseBuffer, this.encryptionKey);
                this.debugLog(`Response: ${decrypted.toString('hex').toUpperCase()}`);

                this.pendingCommand = null;
                this.responseBuffer = Buffer.alloc(0);
                resolve(decrypted);
            } catch (error) {
                this.pendingCommand = null;
                this.responseBuffer = Buffer.alloc(0);
                reject(error);
            }
        }
    }

    /**
     * Send an encrypted command to the hub
     * @param {Buffer} request - Protocol request buffer
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {Promise<Buffer>} - Decrypted response
     */
    sendCommand(request, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            if (!this.connected || !this.encryptionKey) {
                reject(new Error('Not connected to hub'));
                return;
            }

            if (this.pendingCommand) {
                reject(new Error('Another command is pending'));
                return;
            }

            this.debugLog(`Request: ${request.toString('hex').toUpperCase()}`);

            const encrypted = crypto.encrypt(request, this.encryptionKey);

            const timeout = setTimeout(() => {
                this.pendingCommand = null;
                this.responseBuffer = Buffer.alloc(0);
                reject(new Error('Command timeout'));
            }, timeoutMs);

            this.pendingCommand = { resolve, reject, timeout };
            this.responseBuffer = Buffer.alloc(0);

            this.socket.write(encrypted);
        });
    }

    /**
     * Disconnect from the hub
     */
    disconnect() {
        this.stopPolling();

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        this.connected = false;
        this.encryptionKey = null;
    }

    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnecting) {
            return;
        }

        this.reconnecting = true;
        const delay = 5000;

        this.log.info(`Reconnecting in ${delay / 1000} seconds...`);

        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
                this.log.info('Reconnected to hub');
                this.startPolling();
            } catch (error) {
                this.log.error('Reconnection failed:', error.message);
                this.reconnecting = false;
                this.scheduleReconnect();
            }
        }, delay);
    }

    /**
     * Start polling for device status
     */
    startPolling() {
        if (this.pollingTimer) {
            return;
        }

        this.debugLog(`Starting status polling every ${this.pollingInterval}ms`);

        // Initial poll
        this.pollDeviceStatus();

        // Set up polling interval
        this.pollingTimer = setInterval(() => {
            this.pollDeviceStatus();
        }, this.pollingInterval);

        // Set up ping interval (every 30 seconds)
        this.pingTimer = setInterval(() => {
            this.ping().catch(() => { });
        }, 30000);
    }

    /**
     * Stop polling for device status
     */
    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }

        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    /**
     * Poll device status from the hub
     */
    async pollDeviceStatus() {
        try {
            const devices = await this.getDeviceStatus();
            this.emit('deviceStatusUpdate', devices);
        } catch (error) {
            this.debugLog(`Status poll failed: ${error.message}`);
        }
    }

    // ========================================================================
    // Protocol Commands
    // ========================================================================

    /**
     * Send a ping to keep the connection alive
     * @returns {Promise<Object>}
     */
    async ping() {
        const response = await this.sendCommand(protocol.createPingRequest());
        return protocol.parsePingResponse(response);
    }

    /**
     * Get firmware version
     * @returns {Promise<Object>}
     */
    async getFirmwareVersion() {
        const response = await this.sendCommand(protocol.createFirmwareVersionRequest());
        return protocol.parseFirmwareVersionResponse(response);
    }

    /**
     * List all registered devices with full info
     * @returns {Promise<Array>}
     */
    async listDevices() {
        const response = await this.sendCommand(protocol.createDbListDeviceFullRequest());
        return protocol.parseDbListDeviceFullResponse(response);
    }

    /**
     * Discover active devices on the network
     * @returns {Promise<Array>}
     */
    async discoverDevices() {
        const response = await this.sendCommand(protocol.createDeviceDiscoveryRequest());
        return protocol.parseDeviceDiscoveryResponse(response);
    }

    /**
     * Get status of devices
     * @param {number[]} deviceIds - Device IDs to query (default: broadcast)
     * @returns {Promise<Array>}
     */
    async getDeviceStatus(deviceIds = [protocol.DEVICE_ID_BROADCAST]) {
        const response = await this.sendCommand(protocol.createDeviceStatusRequest(deviceIds));
        return protocol.parseDeviceStatusResponse(response);
    }

    /**
     * Turn device(s) on or off
     * @param {boolean} on - True to turn on, false to turn off
     * @param {number[]} deviceIds - Device IDs to control
     * @returns {Promise<Object>}
     */
    async setDevicePower(on, deviceIds) {
        const response = await this.sendCommand(protocol.createDeviceSwitchRequest(on, deviceIds));
        return protocol.parseDeviceSwitchResponse(response);
    }

    /**
     * Set light brightness
     * @param {number} brightness - Brightness level (0-255)
     * @param {number[]} deviceIds - Device IDs to control
     * @returns {Promise<Object>}
     */
    async setLightBrightness(brightness, deviceIds) {
        const response = await this.sendCommand(protocol.createLightDimRequest(brightness, deviceIds));
        return protocol.parseLightDimResponse(response);
    }

    /**
     * Set light color temperature
     * @param {number} temperature - Temperature (0=warm, 255=cool)
     * @param {number[]} deviceIds - Device IDs to control
     * @returns {Promise<Object>}
     */
    async setLightTemperature(temperature, deviceIds) {
        const response = await this.sendCommand(protocol.createLightTemperatureRequest(temperature, deviceIds));
        return protocol.parseLightTemperatureResponse(response);
    }

    /**
     * Set fan speed
     * @param {number} speed - Fan speed (0-255)
     * @param {number[]} deviceIds - Device IDs to control
     * @returns {Promise<void>}
     */
    async setFanSpeed(speed, deviceIds) {
        await this.sendCommand(protocol.createFanControlRequest(speed, deviceIds));
    }

    /**
     * Enable device pairing mode
     * @param {number} duration - Duration in seconds
     * @returns {Promise<Object>}
     */
    async enablePairing(duration = 0) {
        const response = await this.sendCommand(protocol.createJoinEnableRequest(duration));
        return protocol.parseJoinEnableResponse(response);
    }

    /**
     * Disable device pairing mode
     * @returns {Promise<void>}
     */
    async disablePairing() {
        await this.sendCommand(protocol.createJoinDisableRequest());
    }

    /**
     * List all groups
     * @returns {Promise<Object>}
     */
    async listGroups() {
        const response = await this.sendCommand(protocol.createGroupListRequest());
        return protocol.parseGroupListResponse(response);
    }

    /**
     * Read group members
     * @param {number} groupId - Group short address
     * @returns {Promise<Object>} - { groupId, deviceIds }
     */
    async readGroup(groupId) {
        const response = await this.sendCommand(protocol.createGroupReadRequest(groupId));
        return protocol.parseGroupReadResponse(response);
    }

    /**
     * Get all devices that are members of any group
     * @returns {Promise<Set<number>>} - Set of device short addresses that belong to groups
     */
    async getGroupedDeviceIds() {
        const groupedDevices = new Set();

        try {
            const { groupIds } = await this.listGroups();
            this.debugLog(`Found ${groupIds.length} groups`);

            for (const groupId of groupIds) {
                try {
                    const { deviceIds } = await this.readGroup(groupId);
                    this.debugLog(`Group 0x${groupId.toString(16)} has ${deviceIds.length} members: ${deviceIds.map(id => '0x' + id.toString(16)).join(', ')}`);
                    deviceIds.forEach(id => groupedDevices.add(id));
                } catch (err) {
                    this.log.warn(`Failed to read group 0x${groupId.toString(16)}: ${err.message}`);
                }
            }
        } catch (err) {
            this.log.warn(`Failed to list groups: ${err.message}`);
        }

        return groupedDevices;
    }

    /**
     * Debug logging helper
     * @param {string} message
     */
    debugLog(message) {
        if (this.debug) {
            this.log.debug(`[Hub] ${message}`);
        }
    }
}

module.exports = SmartikaHubConnection;
