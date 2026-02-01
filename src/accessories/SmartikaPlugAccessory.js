'use strict';

/**
 * Smartika Plug Accessory
 * 
 * Exposes Smartika smart plug devices to HomeKit with support for:
 * - On/Off control
 */
class SmartikaPlugAccessory {
    /**
     * @param {import('../SmartikaPlatform')} platform
     * @param {import('homebridge').PlatformAccessory} accessory
     * @param {Object} device - Device info from hub
     */
    constructor(platform, accessory, device) {
        this.platform = platform;
        this.accessory = accessory;
        this.device = device;
        this.log = platform.log;

        // HAP references
        this.Service = platform.api.hap.Service;
        this.Characteristic = platform.api.hap.Characteristic;

        // Current state
        this.state = {
            on: false,
        };

        // Configure the outlet service
        this.configureService();
    }

    /**
     * Configure the Outlet service
     */
    configureService() {
        // Get or create the Outlet service
        this.service = this.accessory.getService(this.Service.Outlet) ||
            this.accessory.addService(this.Service.Outlet, this.device.typeName);

        // Set the service name
        this.service.setCharacteristic(this.Characteristic.Name, this.device.typeName);

        // Configure On characteristic
        this.service.getCharacteristic(this.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));

        // Configure OutletInUse characteristic (we'll assume it's in use if it's on)
        this.service.getCharacteristic(this.Characteristic.OutletInUse)
            .onGet(this.getOutletInUse.bind(this));

        this.log.debug(`Configured plug accessory: ${this.device.typeName} (0x${this.device.shortAddress.toString(16)})`);
    }

    /**
     * Handle GET On
     * @returns {boolean}
     */
    getOn() {
        this.log.debug(`GET On for ${this.device.typeName}: ${this.state.on}`);
        return this.state.on;
    }

    /**
     * Handle SET On
     * @param {boolean} value
     */
    async setOn(value) {
        this.log.info(`SET On for ${this.device.typeName}: ${value}`);

        try {
            await this.platform.hub.setDevicePower(value, [this.device.shortAddress]);
            this.state.on = value;

            // Update OutletInUse when power state changes
            this.service.updateCharacteristic(this.Characteristic.OutletInUse, value);
        } catch (error) {
            this.log.error(`Failed to set power for ${this.device.typeName}:`, error.message);
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
        }
    }

    /**
     * Handle GET OutletInUse
     * @returns {boolean}
     */
    getOutletInUse() {
        // We'll assume the outlet is in use if it's on
        // (Smartika plugs don't report power consumption)
        return this.state.on;
    }

    /**
     * Update state from hub status
     * @param {Object} status - Status from hub
     */
    updateStatus(status) {
        // Update On state
        if (status.on !== undefined && status.on !== this.state.on) {
            this.state.on = status.on;
            this.service.updateCharacteristic(this.Characteristic.On, status.on);
            this.service.updateCharacteristic(this.Characteristic.OutletInUse, status.on);
            this.log.debug(`Updated ${this.device.typeName} On: ${status.on}`);
        }
    }
}

module.exports = SmartikaPlugAccessory;
