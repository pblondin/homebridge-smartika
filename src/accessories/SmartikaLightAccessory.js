'use strict';

/**
 * Smartika Light Accessory
 * 
 * Exposes Smartika light devices to HomeKit with support for:
 * - On/Off control
 * - Brightness (dimming)
 * - Color Temperature
 */
class SmartikaLightAccessory {
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
            brightness: 100,
            colorTemperature: 200, // HomeKit: 140-500 mireds
        };

        // Configure the lightbulb service
        this.configureService();
    }

    /**
     * Configure the Lightbulb service
     */
    configureService() {
        // Get or create the Lightbulb service
        this.service = this.accessory.getService(this.Service.Lightbulb) ||
            this.accessory.addService(this.Service.Lightbulb, this.device.typeName);

        // Set the service name
        this.service.setCharacteristic(this.Characteristic.Name, this.device.typeName);

        // Configure On characteristic
        this.service.getCharacteristic(this.Characteristic.On)
            .onGet(this.getOn.bind(this))
            .onSet(this.setOn.bind(this));

        // Configure Brightness characteristic
        this.service.getCharacteristic(this.Characteristic.Brightness)
            .onGet(this.getBrightness.bind(this))
            .onSet(this.setBrightness.bind(this));

        // Configure Color Temperature characteristic (if device supports it)
        // Most Smartika lights support color temperature
        this.service.getCharacteristic(this.Characteristic.ColorTemperature)
            .onGet(this.getColorTemperature.bind(this))
            .onSet(this.setColorTemperature.bind(this))
            .setProps({
                minValue: 140,  // ~7142K (cool white)
                maxValue: 500,  // ~2000K (warm white)
            });

        this.log.debug(`Configured light accessory: ${this.device.typeName} (0x${this.device.shortAddress.toString(16)})`);
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
        } catch (error) {
            this.log.error(`Failed to set power for ${this.device.typeName}:`, error.message);
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
        }
    }

    /**
     * Handle GET Brightness
     * @returns {number} - Brightness percentage (0-100)
     */
    getBrightness() {
        this.log.debug(`GET Brightness for ${this.device.typeName}: ${this.state.brightness}%`);
        return this.state.brightness;
    }

    /**
     * Handle SET Brightness
     * @param {number} value - Brightness percentage (0-100)
     */
    async setBrightness(value) {
        this.log.info(`SET Brightness for ${this.device.typeName}: ${value}%`);

        try {
            // Convert 0-100% to 0-255
            const brightness255 = Math.round(value / 100 * 255);
            await this.platform.hub.setLightBrightness(brightness255, [this.device.shortAddress]);
            this.state.brightness = value;

            // If brightness is set to > 0, ensure light is on
            if (value > 0 && !this.state.on) {
                this.state.on = true;
                this.service.updateCharacteristic(this.Characteristic.On, true);
            }
        } catch (error) {
            this.log.error(`Failed to set brightness for ${this.device.typeName}:`, error.message);
            throw new this.platform.api.hap.HapStatusError(
                this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
            );
        }
    }

    /**
     * Handle GET ColorTemperature
     * @returns {number} - Color temperature in mireds (140-500)
     */
    getColorTemperature() {
        this.log.debug(`GET ColorTemperature for ${this.device.typeName}: ${this.state.colorTemperature} mireds`);
        return this.state.colorTemperature;
    }

    /**
     * Handle SET ColorTemperature
     * @param {number} value - Color temperature in mireds (140-500)
     */
    async setColorTemperature(value) {
        this.log.info(`SET ColorTemperature for ${this.device.typeName}: ${value} mireds`);

        try {
            // Convert mireds to Smartika temperature (0=warm, 255=cool)
            // HomeKit: 140 (cool/7142K) to 500 (warm/2000K)
            // Smartika: 0 (warm) to 255 (cool)
            // So we need to invert: higher mireds = warmer = lower Smartika value
            const temp255 = Math.round((500 - value) / (500 - 140) * 255);
            await this.platform.hub.setLightTemperature(temp255, [this.device.shortAddress]);
            this.state.colorTemperature = value;
        } catch (error) {
            this.log.error(`Failed to set color temperature for ${this.device.typeName}:`, error.message);
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
        // Update On state
        if (status.on !== undefined && status.on !== this.state.on) {
            this.state.on = status.on;
            this.service.updateCharacteristic(this.Characteristic.On, status.on);
            this.log.debug(`Updated ${this.device.typeName} On: ${status.on}`);
        }

        // Update Brightness
        if (status.brightness !== undefined) {
            // Convert 0-255 to 0-100%
            const brightness = Math.round(status.brightness / 255 * 100);
            if (brightness !== this.state.brightness) {
                this.state.brightness = brightness;
                this.service.updateCharacteristic(this.Characteristic.Brightness, brightness);
                this.log.debug(`Updated ${this.device.typeName} Brightness: ${brightness}%`);
            }
        }

        // Update Color Temperature
        if (status.temperature !== undefined) {
            // Convert Smartika temperature (0=warm, 255=cool) to mireds (140-500)
            // Invert: lower Smartika = warmer = higher mireds
            const mireds = Math.round(500 - (status.temperature / 255 * (500 - 140)));
            if (mireds !== this.state.colorTemperature) {
                this.state.colorTemperature = mireds;
                this.service.updateCharacteristic(this.Characteristic.ColorTemperature, mireds);
                this.log.debug(`Updated ${this.device.typeName} ColorTemperature: ${mireds} mireds`);
            }
        }
    }
}

module.exports = SmartikaLightAccessory;
