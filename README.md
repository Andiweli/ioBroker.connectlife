<img src="admin/connectlife.svg" width="160" alt="ConnectLife Cloud icon">

# ConnectLife Cloud for ioBroker

![Version](https://img.shields.io/github/package-json/v/Andiweli/ioBroker.connectlife?label=version)
![AI Assisted Coding](https://img.shields.io/badge/AI-Assisted%20Coding-white)
[![Support via PayPal](https://img.shields.io/badge/Support%20via-PayPal-0070BA?logo=paypal\&logoColor=white)](https://paypal.me/andiweli)


[Deutsche Dokumentation](README_DE.md)

> [!NOTE]
> Experimental, unofficial ioBroker adapter for the ConnectLife Cloud. It has been tested with Hisense air conditioners. Manufacturer information is available on the [Hisense website](https://global.hisense.com/).
> Accounts created exclusively through Google, Apple or Microsoft sign-in are not currently supported. The adapter requires a ConnectLife email address and password.

## Requirements

- Node.js 22 or 24
- js-controller 6.0.11 or newer
- Admin 7.6.20 or newer
- A ConnectLife account with an email address and ConnectLife password

## Features

- ConnectLife login via Gigya and OAuth
- OAuth refresh-token support to reduce full account logins
- Rate-limit handling with exponential backoff and a visible next retry time
- Automatic discovery of devices registered in the account
- Periodic retrieval of `statusList`
- Automatic creation of raw property states
- Air-conditioner control for power, target temperature, operating mode, fan speed, silent, turbo, eco, horizontal swing and vertical swing
- Optional writing of unknown raw properties
- Connection and error states below `info`
- Automatic one-time retry after a ConnectLife `randStr check fail` response
- Automatic one-time fast retry after an initial transient cloud or device-synchronization error
- Cloud connection status separated from individual device-synchronization errors
- Stable connection indicator during isolated temporary cloud errors

## Screenshots

<div align="center">
<img width="70%" height="70%" alt="settings" src="https://github.com/user-attachments/assets/caca779c-e807-4f31-adb0-7c1ea0ce0aa3" />

<img width="70%" height="70%" alt="objects" src="https://github.com/user-attachments/assets/c161c60b-ec0d-4620-85db-8834ac2388bd" />
</div>

## Installation through ioBroker

Enable expert mode in the ioBroker Admin interface and select **Install adapter from custom URL**.

GitHub URL:

```text
https://github.com/Andiweli/ioBroker.connectlife
```

Open the created instance and enter the ConnectLife email address and password.

## Login rate limits

ConnectLife may temporarily reject full account logins when too many login attempts occur. During this period the instance remains yellow, `info.connection` is `false`, and the adapter writes the reason and scheduled retry time to `info.lastError` and `info.nextRetry`.

Leave the adapter running so its exponential backoff can control the retries. Restarting creates a new client session and forces another full login attempt; this should normally be avoided while the server-side limit is active. After a successful login, `info.connection` becomes `true` and both retry states are cleared.

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
│   ├── lastError
│   └── nextRetry
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
- Publication in the official ioBroker adapter repository

## Changelog

### 0.3.1 (2026-08-06)

- Fixed all reported ESLint/Prettier formatting errors so package and integration tests can run.
- Aligned check and deploy jobs with Node.js 24 while retaining Node.js 22 runtime support and tests.
- Corrected `io-package.json` metadata for the current schema and updated Axios.
- Improved adapter-update startup behavior by marking the cloud connection active immediately after a successful device-list request.
- Kept individual device-synchronization errors separate from the cloud connection state and added one automatic fast initial retry.
- Added explicit startup logging and top-level initialization error handling.
- Documented runtime requirements and ConnectLife login-rate-limit behavior.

### 0.3.0 (2026-08-05)

- Updated the minimum runtime to Node.js 22 and refreshed ioBroker/release dependencies.
- Reworked CI into sequential check, adapter-test and tag-only deploy jobs.
- Integrated rate-limit scheduling directly into the adapter and removed the temporary wrapper entry point.
- Replaced plain Node.js timers with adapter-managed timers.
- Completed responsive JSONConfig sizing and translated all admin texts.
- Added repository-checker maintenance files and settings.

### 0.2.3 (2026-08-04)

- Scheduled rate-limit retries without blocking adapter startup.
- Added `info.nextRetry`.

### 0.2.1 (2026-08-04)

- Added OAuth refresh-token handling and exponential login backoff.

### 0.2.0 (2026-08-04)

- Modernized the adapter structure, protected credentials, JSONConfig i18n and standard tests.

## ❤️ Support

If you enjoy this project and would like to support my work, you can make a small contribution via PayPal.

Your support helps me spend more time maintaining existing projects, fixing bugs, improving compatibility, and working on new features.

[![Support via PayPal](https://img.shields.io/badge/Support%20via-PayPal-0070BA?logo=paypal\&logoColor=white)](https://paypal.me/andiweli)

Thank you for your support!

## License

MIT License

Copyright (c) 2026 Andreas Stürmer
