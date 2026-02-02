# Homebridge Smartika

[![npm](https://img.shields.io/npm/v/homebridge-smartika.svg)](https://www.npmjs.com/package/homebridge-smartika)
[![npm](https://img.shields.io/npm/dt/homebridge-smartika.svg)](https://www.npmjs.com/package/homebridge-smartika)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

A [Homebridge](https://homebridge.io) plugin for **Smartika** (Artika) smart home devices with **100% local control** — no cloud required!

## Features

- 🏠 **100% Local Control** — All communication stays on your local network
- 🔍 **Auto-Discovery** — Automatically finds your Smartika hub on the network
- 💡 **Lights** — On/off, brightness, and color temperature control
- 🌀 **Ceiling Fans** — On/off and speed control
- 🔌 **Smart Plugs** — On/off control
- 🔄 **Real-time Updates** — Device status polling keeps HomeKit in sync
- 🔐 **Secure** — AES-128-CBC encrypted communication with your hub
- 🛠️ **CLI Tool** — Command-line interface for debugging and direct control

## Supported Devices

| Category        | Devices                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Lights**      | Champagne Track, Mini Wall Washer, Glowbox, Recessed Lighting, Pendants (1-5), Smart Bulb, Spotlight, Sandwich Lights |
| **Fans**        | Ceiling Fan                                                                                                           |
| **Plugs**       | Smart Plug                                                                                                            |
| **Thermostats** | Thermostat, Smart Heater *(coming soon)*                                                                              |

## Requirements

- [Homebridge](https://homebridge.io) v1.8.0 or later
- Node.js v18.0.0+
- Smartika Hub on your local network

## Installation

### Using Homebridge Config UI X (Recommended)

1. Search for **"Smartika"** in the Plugins tab
2. Click **Install**
3. Configure the plugin with your hub's IP address

### Manual Installation

```bash
sudo npm install -g homebridge-smartika
```

## Configuration

### Auto-Discovery (Recommended)

The plugin can automatically discover your Smartika hub on the network — no manual configuration needed! Simply install the plugin and restart Homebridge.

The hub broadcasts its presence on UDP port 4156 every ~10 seconds. If auto-discovery doesn't work (e.g., due to network segmentation or firewall rules), you can configure the hub IP manually.

### Finding Your Hub IP Address (Manual)

If auto-discovery doesn't work, find your hub's IP address by:

1. Checking your router's DHCP client list
2. Using a network scanner app
3. Looking for a device with MAC address starting with `00:12:4B`

### Using Homebridge Config UI X

1. Go to the **Plugins** tab
2. Find **Homebridge Smartika** and click **Settings**
3. Enter your hub's IP address
4. Click **Save**

### Manual Configuration

Add the following to your `config.json`:

```json
{
    "platforms": [
        {
            "platform": "Smartika",
            "name": "Smartika Hub"
        }
    ]
}
```

With manual hub IP (if auto-discovery doesn't work):

```json
{
    "platforms": [
        {
            "platform": "Smartika",
            "name": "Smartika Hub",
            "hubHost": "10.0.0.122"
        }
    ]
}
```

With all options:

### Configuration Options

| Option            | Required | Default          | Description                                                  |
| ----------------- | -------- | ---------------- | ------------------------------------------------------------ |
| `platform`        | ✅        | —                | Must be `"Smartika"`                                         |
| `name`            | ❌        | `"Smartika Hub"` | Display name in Homebridge logs                              |
| `hubHost`         | ❌        | Auto-discover    | IP address of your Smartika hub (auto-discovered if not set) |
| `hubPort`         | ❌        | `1234`           | TCP port for hub communication                               |
| `pollingInterval` | ❌        | `5000`           | Status polling interval in milliseconds                      |
| `debug`           | ❌        | `false`          | Enable verbose debug logging                                 |

## CLI Tool

This plugin includes a powerful command-line interface for direct hub control and debugging.

### Installation

The CLI is installed automatically with the plugin:

```bash
# If installed globally
smartika-cli --help

# Or run directly
npx smartika-cli --help
```

### Usage

```bash
# Discover hubs on the network (no IP needed)
smartika-cli hub-discover

# Run commands on a specific hub
smartika-cli <hub-ip> <command> [arguments...]
```

### Examples

```bash
# Discover Smartika hubs on your network
smartika-cli hub-discover

# Get hub information (ID, MAC, firmware, encryption key)
smartika-cli 10.0.0.122 hub-info

# Get status of all devices
smartika-cli 10.0.0.122 status

# Turn on a device
smartika-cli 10.0.0.122 on 0x28cf

# Set brightness to 50%
smartika-cli 10.0.0.122 dim 50% 0x28cf

# Set color temperature (0=warm, 255=cool)
smartika-cli 10.0.0.122 temp 128 0x28cf

# List registered devices
smartika-cli 10.0.0.122 list

# Get firmware version
smartika-cli 10.0.0.122 firmware

# Preview what devices will appear in HomeKit
smartika-cli 10.0.0.122 homekit-preview

# Interactive pairing wizard for new devices
smartika-cli 10.0.0.122 pair
```

### Available Commands

| Category          | Command        | Description                               |
| ----------------- | -------------- | ----------------------------------------- |
| **Hub Discovery** | `hub-discover` | Find hubs on the network (no IP needed)   |
| **System**        | `hub-info`     | Get hub ID, MAC, firmware, encryption key |
|                   | `ping`         | Send keep-alive ping                      |
|                   | `firmware`     | Get hub firmware version                  |
|                   | `join-enable`  | Enable device pairing mode                |
|                   | `join-disable` | Disable device pairing mode               |
| **Device**        | `discover`     | Discover active devices                   |
|                   | `status`       | Get device status                         |
|                   | `on`           | Turn device(s) on                         |
|                   | `off`          | Turn device(s) off                        |
|                   | `dim`          | Set light brightness                      |
|                   | `temp`         | Set color temperature                     |
|                   | `fan`          | Set fan speed                             |
| **Database**      | `list`         | List registered devices                   |
|                   | `db-add`       | Add device(s) to database                 |
|                   | `db-remove`    | Remove device(s) from database            |
| **Groups**        | `groups`       | List all groups                           |
|                   | `group-read`   | Read group members                        |
|                   | `group-create` | Create a new group                        |
|                   | `group-update` | Update group members                      |
|                   | `group-delete` | Delete group(s)                           |
| **HomeKit**       | `homekit-preview` | Preview HomeKit accessories            |
| **Pairing**       | `pair`         | Interactive wizard to pair new devices    |

## Troubleshooting

### Auto-Discovery Not Working

1. **macOS firewall** — On macOS, you may need to allow Node.js to receive incoming connections:
   - Open **System Settings** → **Network** → **Firewall** → **Options**
   - Add Node.js (run `which node` to find the path) and set to **Allow incoming connections**
   - Or run the CLI with `sudo` to bypass the firewall temporarily
2. **Check firewall** — Ensure UDP port 4156 is not blocked
3. **Same network** — Hub and Homebridge must be on the same subnet
4. **Use CLI to test** — Verify discovery works:
   ```bash
   # May need sudo on macOS if firewall blocks UDP
   sudo smartika-cli hub-discover
   ```
5. **Fallback to manual** — Configure `hubHost` manually if discovery fails

### Hub Not Connecting

1. **Verify the IP address** — Make sure your hub's IP hasn't changed (consider setting a DHCP reservation)
2. **Check network connectivity** — Ensure Homebridge can reach the hub: `ping 10.0.0.122`
3. **Test with CLI** — Use the CLI tool to verify connectivity:
   ```bash
   smartika-cli 10.0.0.122 ping
   ```
4. **Check firewall** — Ensure port 1234 (TCP) is not blocked

### Devices Not Appearing

1. **Check device registration** — Devices must be registered in the hub's database:
   ```bash
   smartika-cli 10.0.0.122 list
   ```
2. **Pair new devices** — Use the interactive pairing wizard:
   ```bash
   smartika-cli 10.0.0.122 pair
   ```
   Or manually discover and add:
   ```bash
   smartika-cli 10.0.0.122 discover
   smartika-cli 10.0.0.122 db-add 0x28cf
   ```
3. **Preview HomeKit accessories** — Check what will appear in HomeKit:
   ```bash
   smartika-cli 10.0.0.122 homekit-preview
   ```
4. **Restart Homebridge** — After adding devices, restart Homebridge to re-discover

### Status Not Updating

1. **Increase polling frequency** — Reduce `pollingInterval` to 2000-3000ms
2. **Enable debug logging** — Set `"debug": true` to see communication details
3. **Check for errors** — Look for error messages in Homebridge logs

### Debug Mode

Enable debug logging to see detailed communication:

```json
{
    "platform": "Smartika",
    "hubHost": "10.0.0.122",
    "debug": true
}
```

This will log:
- Connection status
- Request/response packets (hex)
- Device status updates
- Error details

## Technical Details

### Protocol

The plugin communicates with the Smartika hub using:
- **Transport**: TCP on port 1234
- **Encryption**: AES-128-CBC with key derived from hub MAC address
- **Protocol**: Custom binary protocol with XOR checksum

### Security

- The encryption key is derived from your hub's unique MAC address using 8-pass AES-ECB
- All commands are encrypted before transmission
- No data is sent to external servers

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Apple Home    │────▶│    Homebridge    │────▶│  Smartika   │
│     (iOS)       │◀────│    Plugin        │◀────│    Hub      │
└─────────────────┘     └──────────────────┘     └─────────────┘
        HomeKit              TCP/AES-CBC           Local Network
```

## Development

### Project Structure

```
smartika-homebridge/
├── src/
│   ├── index.js                 # Plugin entry point
│   ├── settings.js              # Plugin constants
│   ├── SmartikaPlatform.js      # Main platform class
│   ├── SmartikaHubConnection.js # Hub communication
│   ├── SmartikaCrypto.js        # AES encryption
│   ├── SmartikaProtocol.js      # Binary protocol
│   └── accessories/
│       ├── SmartikaLightAccessory.js
│       ├── SmartikaFanAccessory.js
│       └── SmartikaPlugAccessory.js
├── tools/
│   └── smartika-cli.js          # CLI tool
├── test/
│   ├── test-protocol.js
│   └── test-crypto.js
├── config.schema.json           # Homebridge UI schema
└── package.json
```

### Building & Testing

```bash
# Clone the repository
git clone https://github.com/pblondin/smartika-homebridge.git
cd smartika-homebridge

# Install dependencies
npm install

# Run tests
npm test
npm run test:crypto

# Lint code
npm run lint

# Link for local development
npm link
```

### Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Homebridge](https://homebridge.io) team for the amazing platform
- Smartika/Artika for the hardware

---

**Note**: This plugin is not officially affiliated with or endorsed by Smartika or Artika. Use at your own risk.
