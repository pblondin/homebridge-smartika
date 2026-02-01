'use strict';

/**
 * Smartika Fan Accessory
 * 
 * Exposes Smartika ceiling fan devices to HomeKit with support for:
 * - On/Off control
 * - Rotation Speed
 */
class SmartikaFanAccessory {
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
            active: false,
            rotationSpeed: 0,
        };

        // Configure the fan service
        this.configureService();
    }

    /**
     * Configure the Fanv2 service
     */
    configureService() {
        // Use Fanv2 for better HomeKit support
        this.service = this.accessory.getService(this.Service.Fanv2) ||
            this.accessory.addService(this.Service.Fanv2, this.device.typeName);

        // Set the service name
        this.service.setCharacteristic(this.Characteristic.Name, this.device.typeName);

        // Configure Active characteristic (on/off)
        this.service.getCharacteristic(this.Characteristic.Active)
            .onGet(this.getActive.bind(this))
            .onSet(this.setActive.bind(this));

        // Configure RotationSpeed characteristic
        this.service.getCharacteristic(this.Characteristic.RotationSpeed)
            .onGet(this.getRotationSpeed.bind(this))
            .onSet(this.setRotationSpeed.bind(this))
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: 1,
            });

        this.log.debug(`Configured fan accessory: ${this.device.typeName} (0x${this.device.shortAddress.toString(16)})`);
    }

    /**
     * Handle GET Active
     * @returns {number} - 0 (INACTIVE) or 1 (ACTIVE)
     */
    getActive() {
        this.log.debug(`GET Active for ${this.device.typeName}: ${this.state.active}`);
        return this.state.active ? 1 : 0;
    }

    /**
     * Handle SET Active
     * @param {number} value - 0 (INACTIVE) or 1 (ACTIVE)
     */
    async setActive(value) {
        const active = value === 1;
        this.log.info(`SET Active for ${this.device.typeName}: ${active}`);

        try {
            await this.platform.hub.setDevicePower(active, [this.device.shortAddress]);
            this.state.active = active;

            // If turning on and speed is 0, set a default speed
            if (active && this.state.rotationSpeed === 0) {
                this.state.rotationSpeed = 50;
                this.service.updateCharacteristic(this.Characteristic.RotationSpeed, 50);
            }
        } catch (error) {
            this.log.error(`Failed to set power for ${this.device.typeName}:`, error.message);
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
        }
    }

    /**
     * Handle GET RotationSpeed
     * @returns {number} - Speed percentage (0-100)
     */
    getRotationSpeed() {
        this.log.debug(`GET RotationSpeed for ${this.device.typeName}: ${this.state.rotationSpeed}%`);
        return this.state.rotationSpeed;
    }

    /**
     * Handle SET RotationSpeed
     * @param {number} value - Speed percentage (0-100)
     */
    async setRotationSpeed(value) {
        this.log.info(`SET RotationSpeed for ${this.device.typeName}: ${value}%`);

        try {
            // Convert 0-100% to 0-255
            const speed255 = Math.round(value / 100 * 255);
            await this.platform.hub.setFanSpeed(speed255, [this.device.shortAddress]);
            this.state.rotationSpeed = value;

            // Update active state based on speed
            if (value > 0 && !this.state.active) {
                this.state.active = true;
                this.service.updateCharacteristic(this.Characteristic.Active, 1);
            } else if (value === 0 && this.state.active) {
                this.state.active = false;
                this.service.updateCharacteristic(this.Characteristic.Active, 0);
            }
        } catch (error) {
            this.log.error(`Failed to set fan speed for ${this.device.typeName}:`, error.message);
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
        }
    }

    /**
     * Update state from hub status
     * @param {Object} status - Status from hub
     */
    updateStatus(status) {
        // Update Active state
        if (status.on !== undefined && status.on !== this.state.active) {
            this.state.active = status.on;
            this.service.updateCharacteristic(this.Characteristic.Active, status.on ? 1 : 0);
            this.log.debug(`Updated ${this.device.typeName} Active: ${status.on}`);
        }

        // Update RotationSpeed
        if (status.speed !== undefined) {
            // Convert 0-255 to 0-100%
            const speed = Math.round(status.speed / 255 * 100);
            if (speed !== this.state.rotationSpeed) {
                this.state.rotationSpeed = speed;
                this.service.updateCharacteristic(this.Characteristic.RotationSpeed, speed);
                this.log.debug(`Updated ${this.device.typeName} RotationSpeed: ${speed}%`);
            }
        }
    }
}

module.exports = SmartikaFanAccessory;
