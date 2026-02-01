'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

const BROADCAST_PORT = 4156;
const DEFAULT_TIMEOUT = 15000; // 15 seconds

/**
 * Smartika Hub Discovery
 * 
 * Discovers Smartika hubs on the local network via UDP broadcast.
 * Hubs broadcast their presence every ~10 seconds on UDP port 4156.
 */
class SmartikaDiscovery extends EventEmitter {
    /**
     * @param {Object} options
     * @param {Object} options.log - Logger instance
     * @param {number} options.timeout - Discovery timeout in ms
     */
    constructor(options = {}) {
        super();
        this.log = options.log || console;
        this.timeout = options.timeout || DEFAULT_TIMEOUT;
        this.server = null;
        this.foundHubs = new Map();
    }

    /**
     * Discover hubs on the network
     * @returns {Promise<Array>} - Array of discovered hubs
     */
    discover() {
        return new Promise((resolve, reject) => {
            this.foundHubs.clear();

            this.server = dgram.createSocket('udp4');

            this.server.on('error', (err) => {
                this.log.error('Discovery error:', err.message);
                this.cleanup();
                reject(err);
            });

            this.server.on('message', (msg, rinfo) => {
                this.handleMessage(msg, rinfo);
            });

            this.server.on('listening', () => {
                this.log.debug(`Discovery listening on UDP port ${BROADCAST_PORT}`);
            });

            // Start listening
            try {
                this.server.bind(BROADCAST_PORT, () => {
                    this.server.setBroadcast(true);
                });
            } catch (err) {
                this.log.error('Failed to bind discovery port:', err.message);
                reject(err);
                return;
            }

            // Timeout
            setTimeout(() => {
                this.cleanup();
                resolve(Array.from(this.foundHubs.values()));
            }, this.timeout);
        });
    }

    /**
     * Handle incoming broadcast message
     * @param {Buffer} msg
     * @param {Object} rinfo
     */
    handleMessage(msg, rinfo) {
        // Remove null bytes and trim whitespace
        const message = msg.toString('utf-8').replace(/\x00/g, '').trim();

        // Parse "SMARTIKA HUB - {ID}" or "SMARTIKA HUB - BOOTLOADER - {ID}"
        // ID is 16 chars (IEEE address prefix + MAC) or 12 chars (MAC only)
        const match = message.match(/^SMARTIKA HUB(?: - BOOTLOADER)? - ([0-9A-F]{12,16})/i);

        if (match) {
            const hubId = match[1].toUpperCase();
            const isBootloader = message.includes('BOOTLOADER');

            // Extract last 6 bytes (12 chars) as MAC address
            const macHex = hubId.slice(-12);
            const macFormatted = macHex.match(/.{2}/g).join(':');

            const hubInfo = {
                hubId,
                mac: macFormatted,
                macBuffer: Buffer.from(macHex, 'hex'),
                ip: rinfo.address,
                port: rinfo.port,
                bootloader: isBootloader,
                lastSeen: new Date(),
            };

            if (!this.foundHubs.has(hubId)) {
                this.foundHubs.set(hubId, hubInfo);
                this.log.info(`Discovered hub: ${hubId} at ${rinfo.address}`);
                this.emit('hubFound', hubInfo);
            } else {
                // Update existing hub info
                const existing = this.foundHubs.get(hubId);
                existing.ip = rinfo.address;
                existing.lastSeen = new Date();
            }
        }
    }

    /**
     * Clean up resources
     */
    cleanup() {
        if (this.server) {
            try {
                this.server.close();
            } catch (e) {
                // Ignore close errors
            }
            this.server = null;
        }
    }

    /**
     * Start continuous discovery (for background hub monitoring)
     * @param {number} interval - Check interval in ms (default: 30000)
     */
    startContinuousDiscovery(interval = 30000) {
        if (this.continuousServer) {
            return;
        }

        this.continuousServer = dgram.createSocket('udp4');

        this.continuousServer.on('error', (err) => {
            this.log.error('Continuous discovery error:', err.message);
            this.stopContinuousDiscovery();
        });

        this.continuousServer.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
        });

        try {
            this.continuousServer.bind(BROADCAST_PORT, () => {
                this.continuousServer.setBroadcast(true);
                this.log.debug('Continuous hub discovery started');
            });
        } catch (err) {
            this.log.error('Failed to start continuous discovery:', err.message);
        }
    }

    /**
     * Stop continuous discovery
     */
    stopContinuousDiscovery() {
        if (this.continuousServer) {
            try {
                this.continuousServer.close();
            } catch (e) {
                // Ignore close errors
            }
            this.continuousServer = null;
            this.log.debug('Continuous hub discovery stopped');
        }
    }
}

module.exports = SmartikaDiscovery;
