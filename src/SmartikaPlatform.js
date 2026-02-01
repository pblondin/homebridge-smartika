'use strict';

const { PLATFORM_NAME, PLUGIN_NAME } = require('./settings');
const SmartikaHubConnection = require('./SmartikaHubConnection');
const SmartikaDiscovery = require('./SmartikaDiscovery');
const SmartikaLightAccessory = require('./accessories/SmartikaLightAccessory');
const SmartikaFanAccessory = require('./accessories/SmartikaFanAccessory');
const SmartikaPlugAccessory = require('./accessories/SmartikaPlugAccessory');
const protocol = require('./SmartikaProtocol');

/**
 * Smartika Platform Plugin for Homebridge
 * 
 * This platform dynamically discovers and registers Smartika devices as HomeKit accessories.
 * Communication is entirely local via TCP with AES-128-CBC encryption.
 */
class SmartikaPlatform {
    /**
     * @param {import('homebridge').Logger} log
     * @param {import('homebridge').PlatformConfig} config
     * @param {import('homebridge').API} api
     */
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;

        // Store restored cached accessories
        this.accessories = new Map();

        // Hub connection instance
        this.hub = null;

        // Discovery instance
        this.discovery = null;

        // Device accessory handlers
        this.deviceHandlers = new Map();

        // Validate configuration
        if (!config) {
            this.log.error('No configuration found for Smartika platform');
            return;
        }

        this.log.info('Smartika Platform initializing...');
        if (config.hubHost) {
            this.log.info(`Hub IP: ${config.hubHost}`);
        } else {
            this.log.info('No hub IP configured - will use auto-discovery');
        }

        // Wait for Homebridge to finish launching before initializing
        this.api.on('didFinishLaunching', () => {
            this.log.debug('didFinishLaunching');
            this.initializeHub();
        });

        // Handle shutdown
        this.api.on('shutdown', () => {
            this.log.info('Shutting down Smartika platform...');
            if (this.hub) {
                this.hub.disconnect();
            }
            if (this.discovery) {
                this.discovery.stopContinuousDiscovery();
            }
        });
    }

    /**
     * Initialize connection to Smartika hub and discover devices
     */
    async initializeHub() {
        let hubHost = this.config.hubHost;

        // If no hub IP configured, try auto-discovery
        if (!hubHost) {
            this.log.info('Starting hub auto-discovery...');
            hubHost = await this.discoverHub();

            if (!hubHost) {
                this.log.error('No Smartika hub found on the network. Please configure hubHost manually.');
                return;
            }
        }

        try {
            // Create hub connection
            this.hub = new SmartikaHubConnection({
                host: hubHost,
                port: this.config.hubPort || protocol.HUB_PORT,
                pollingInterval: this.config.pollingInterval || 5000,
                log: this.log,
                debug: this.config.debug || false,
            });

            // Set up event handlers
            this.hub.on('connected', () => {
                this.log.info(`Connected to Smartika hub at ${hubHost}`);
            });

            this.hub.on('disconnected', () => {
                this.log.warn('Disconnected from Smartika hub');
            });

            this.hub.on('deviceStatusUpdate', (devices) => {
                this.handleDeviceStatusUpdate(devices);
            });

            this.hub.on('error', (error) => {
                this.log.error('Hub error:', error.message);
            });

            // Connect to hub
            await this.hub.connect();

            // Discover devices
            await this.discoverDevices();

            // Start polling for status updates
            this.hub.startPolling();

        } catch (error) {
            this.log.error('Failed to initialize hub:', error.message);
        }
    }

    /**
     * Discover Smartika hub on the network using UDP broadcast
     * @returns {Promise<string|null>} - Hub IP address or null if not found
     */
    async discoverHub() {
        try {
            this.discovery = new SmartikaDiscovery({
                log: this.log,
                timeout: 15000, // 15 seconds for discovery
            });

            this.discovery.on('hubFound', (hubInfo) => {
                this.log.info(`Found hub: ${hubInfo.hubId} at ${hubInfo.ip}`);
            });

            const hubs = await this.discovery.discover();

            if (hubs.length === 0) {
                return null;
            }

            // Use the first hub found (or filter by hubId if configured)
            const hub = hubs[0];
            this.log.info(`Using hub at ${hub.ip} (${hub.hubId})`);
            return hub.ip;

        } catch (error) {
            this.log.error('Hub discovery failed:', error.message);
            return null;
        }
    }

    /**
     * Discover devices from the hub and register them as accessories
     */
    async discoverDevices() {
        try {
            this.log.info('Discovering devices...');

            // Get registered devices from hub database
            const devices = await this.hub.listDevices();
            this.log.info(`Found ${devices.length} registered device(s)`);

            // Get devices that are members of groups - we'll skip these
            // Only the group (virtual device) itself should be exposed to HomeKit
            const groupedDeviceIds = await this.hub.getGroupedDeviceIds();
            if (groupedDeviceIds.size > 0) {
                this.log.info(`Found ${groupedDeviceIds.size} device(s) in groups - these will be controlled via their group`);
            }

            // Track which accessories we found
            const foundUUIDs = new Set();

            for (const device of devices) {
                // Skip remote controls - they don't need HomeKit accessories
                if (device.category === protocol.DEVICE_CATEGORY.REMOTE) {
                    this.log.debug(`Skipping remote control: ${device.typeName} (0x${device.shortAddress.toString(16)})`);
                    continue;
                }

                // Skip devices that are part of a group - the group handles them
                if (groupedDeviceIds.has(device.shortAddress)) {
                    this.log.debug(`Skipping grouped device: ${device.typeName} (0x${device.shortAddress.toString(16)}) - controlled via group`);
                    continue;
                }

                // Generate unique identifier for this device
                const uuid = this.api.hap.uuid.generate(`smartika-${device.shortAddress}`);
                foundUUIDs.add(uuid);

                // Check if accessory already exists (from cache)
                const existingAccessory = this.accessories.get(uuid);

                if (existingAccessory) {
                    // Update existing accessory
                    this.log.info(`Restoring cached accessory: ${device.typeName} (0x${device.shortAddress.toString(16)})`);
                    existingAccessory.context.device = device;
                    this.setupAccessory(existingAccessory, device);
                } else {
                    // Create new accessory
                    this.log.info(`Adding new accessory: ${device.typeName} (0x${device.shortAddress.toString(16)})`);
                    this.addAccessory(device, uuid);
                }
            }

            // Remove accessories that are no longer present
            for (const [uuid, accessory] of this.accessories) {
                if (!foundUUIDs.has(uuid)) {
                    this.log.info(`Removing stale accessory: ${accessory.displayName}`);
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                    this.accessories.delete(uuid);
                    this.deviceHandlers.delete(uuid);
                }
            }

        } catch (error) {
            this.log.error('Failed to discover devices:', error.message);
        }
    }

    /**
     * Add a new accessory to Homebridge
     * @param {Object} device - Device info from hub
     * @param {string} uuid - Unique identifier
     */
    addAccessory(device, uuid) {
        // Determine accessory category based on device type
        let category;
        switch (device.category) {
            case protocol.DEVICE_CATEGORY.LIGHT:
                category = this.api.hap.Categories.LIGHTBULB;
                break;
            case protocol.DEVICE_CATEGORY.FAN:
                category = this.api.hap.Categories.FAN;
                break;
            case protocol.DEVICE_CATEGORY.PLUG:
                category = this.api.hap.Categories.OUTLET;
                break;
            default:
                category = this.api.hap.Categories.OTHER;
        }

        // Create accessory
        const accessory = new this.api.platformAccessory(
            device.typeName,
            uuid,
            category,
        );

        // Store device info in context for persistence
        accessory.context.device = device;

        // Configure the accessory
        this.setupAccessory(accessory, device);

        // Register the accessory
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
    }

    /**
     * Handle device status updates from hub
     * @param {Array} devices - Array of device status objects
     */
    handleDeviceStatusUpdate(devices) {
        for (const status of devices) {
            // Find the handler for this device
            const uuid = this.api.hap.uuid.generate(`smartika-${status.shortAddress}`);
            const handler = this.deviceHandlers.get(uuid);

            if (handler) {
                handler.updateStatus(status);
            }
        }
    }

    /**
     * Setup an accessory with appropriate services and handlers
     * @param {import('homebridge').PlatformAccessory} accessory
     * @param {Object} device - Device info
     */
    setupAccessory(accessory, device) {
        // Get device from context if not provided
        if (!device) {
            device = accessory.context.device;
        }

        if (!device) {
            this.log.warn('No device info available for accessory:', accessory.displayName);
            return;
        }

        // Set up AccessoryInformation service
        const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation) ||
            accessory.addService(this.api.hap.Service.AccessoryInformation);

        infoService
            .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Smartika')
            .setCharacteristic(this.api.hap.Characteristic.Model, device.typeName)
            .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.macAddress || `0x${device.shortAddress.toString(16)}`);

        // Create appropriate handler based on device category
        let handler;
        switch (device.category) {
            case protocol.DEVICE_CATEGORY.LIGHT:
                handler = new SmartikaLightAccessory(this, accessory, device);
                break;
            case protocol.DEVICE_CATEGORY.FAN:
                handler = new SmartikaFanAccessory(this, accessory, device);
                break;
            case protocol.DEVICE_CATEGORY.PLUG:
                handler = new SmartikaPlugAccessory(this, accessory, device);
                break;
            default:
                this.log.warn(`Unknown device category: ${device.category} for ${device.typeName}`);
                return;
        }

        // Store handler reference
        const uuid = accessory.UUID;
        this.deviceHandlers.set(uuid, handler);
        this.accessories.set(uuid, accessory);
    }

    /**
     * REQUIRED - Called by Homebridge for each cached accessory on startup
     * @param {import('homebridge').PlatformAccessory} accessory
     */
    configureAccessory(accessory) {
        this.log.debug('Restoring accessory from cache:', accessory.displayName);
        this.accessories.set(accessory.UUID, accessory);
        // Note: setupAccessory will be called later in discoverDevices with fresh device data
    }
}

module.exports = SmartikaPlatform;
