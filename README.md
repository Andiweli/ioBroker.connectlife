# ConnectLife Cloud for ioBroker

[Deutsche Dokumentation](README_DE.md)

Experimental, unofficial ioBroker adapter for the ConnectLife Cloud. It has been tested with Hisense air conditioners. Manufacturer information is available on the [Hisense website](https://global.hisense.com/).

## Features

- ConnectLife login via Gigya and OAuth
- Automatic discovery of devices registered in the account
- Periodic retrieval of `statusList`
- Automatic creation of raw property states
- Air-conditioner control for power, target temperature, operating mode, fan speed, silent, turbo, eco, horizontal swing and vertical swing
- Optional writing of unknown raw properties
- Connection and error states below `info`
- Automatic one-time retry after a ConnectLife `randStr check fail` response
- Stable connection indicator during isolated temporary cloud errors

## Installation through ioBroker

Enable expert mode in the ioBroker Admin interface and select **Install adapter from custom URL**.

GitHub URL:

```text
https://github.com/Andiweli/ioBroker.connectlife
```

Open the created instance and enter the ConnectLife email address and password.

## Writing raw properties

The adapter stores the original properties returned by ConnectLife below `devices.<device>.raw`.

When **Allow writes to unknown raw properties** is enabled, these original properties can be sent directly to the ConnectLife Cloud. This is primarily intended for testing functions that do not yet have a dedicated control state. Not every raw property is writable, and invalid values may be rejected by the cloud or device.

Keep this option disabled for normal operation.

## Object structure

```text
connectlife.0
├── info
│   ├── connection
│   ├── lastUpdate
│   └── lastError
└── devices
    └── DEVICE
        ├── info
        ├── status
        ├── controls
        └── raw
```

## Important notice

The ConnectLife interface used by this adapter is unofficial and reverse-engineered. Endpoints, keys, properties or the login flow may change without notice.

This adapter was developed with AI assistance and is available at https://github.com/Andiweli/ioBroker.connectlife

Based in part on https://github.com/Bilan/connectlife-api-connector

## Not yet included

- Energy consumption
- Push updates through WebSocket or MQTT
- Device-specific user interfaces for washing machines, dryers, dishwashers or refrigerators
- Automatic detection of which reported raw properties are writable
- Publication in the official ioBroker adapter repository

## License

MIT License

Copyright (c) 2026 Andreas
