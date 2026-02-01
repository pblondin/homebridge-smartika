'use strict';

const { PLATFORM_NAME, PLUGIN_NAME } = require('./settings');
const SmartikaPlatform = require('./SmartikaPlatform');

/**
 * Homebridge plugin entry point
 * @param {API} api - Homebridge API
 */
module.exports = (api) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SmartikaPlatform);
};
