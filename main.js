"use strict";

const utils = require("@iobroker/adapter-core");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

const INITIAL_REFRESH_RETRY_MS = 5000;

class ConnectLifeAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "connectlife",
        });

        this.client = null;
        this.pollTimer = null;
        this.nextPollDelayMs = 0;
        this.refreshRunning = false;
        this.deviceIdByObjectId = new Map();
        this.delayedRefreshTimers = new Set();
        this.consecutiveRefreshErrors = 0;
        this.hadSuccessfulConnection = false;
        this.initialRefreshRetryAvailable = true;
        this.unloading = false;

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        try {
            await this.ensureChannel("info", "Information");
            await this.ensureChannel("devices", "Devices");
            await this.setStateAsync("info.connection", false, true);
            await this.setStateAsync("info.lastError", "", true);
            await this.setStateAsync("info.nextRetry", "", true);

            if (!this.config.login || !this.config.password) {
                const message = "ConnectLife Cloud login and password are required.";
                this.log.error(message);
                await this.setStateAsync("info.lastError", message, true);
                return;
            }

            this.client = new ConnectLifeClient({
                login: this.config.login,
                password: this.config.password,
                log: this.log,
                scheduleTimeout: this.setTimeout.bind(this),
            });

            this.subscribeStates("devices.*.controls.*");
            if (this.config.allowRawWrites === true) {
                this.subscribeStates("devices.*.raw.*");
            }

            this.log.info("Connecting to ConnectLife Cloud...");
            await this.refreshDevices();
            this.scheduleNextPoll();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(`ConnectLife adapter initialization failed: ${message}`);

            try {
                await this.setStateAsync("info.connection", false, true);
                await this.setStateAsync("info.lastError", message, true);
            } catch (stateError) {
                const stateMessage = stateError instanceof Error ? stateError.message : String(stateError);
                this.log.error(`Could not update initialization error states: ${stateMessage}`);
            }
        }
    }

    scheduleNextPoll(delayMs) {
        if (this.unloading || !this.client) {
            return;
        }

        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }

        const configuredDelayMs = Math.max(30, Number(this.config.pollInterval) || 60) * 1000;
        const requestedDelayMs = Number(delayMs) || Number(this.nextPollDelayMs) || configuredDelayMs;
        const effectiveDelayMs = Math.max(1000, requestedDelayMs);
        this.nextPollDelayMs = 0;

        this.pollTimer = this.setTimeout(async () => {
            this.pollTimer = null;
            try {
                await this.refreshDevices();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log.error(`Unexpected scheduled refresh failure: ${message}`);
            } finally {
                this.scheduleNextPoll();
            }
        }, effectiveDelayMs);
    }

    async refreshDevices() {
        if (this.refreshRunning || !this.client || this.unloading) {
            return;
        }

        this.refreshRunning = true;
        try {
            const devices = await this.client.getDevices();
            const firstSuccessfulConnection = !this.hadSuccessfulConnection;
            const updatedAt = new Date().toISOString();

            this.nextPollDelayMs = 0;
            this.consecutiveRefreshErrors = 0;
            this.hadSuccessfulConnection = true;

            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastUpdate", updatedAt, true);
            await this.setStateAsync("info.lastError", "", true);
            await this.setStateAsync("info.nextRetry", "", true);

            if (firstSuccessfulConnection) {
                this.log.info(
                    `Connected to ConnectLife Cloud. Synchronizing ${devices.length} device(s)...`,
                );
            }

            const synchronizationErrors = [];
            for (const device of devices) {
                try {
                    await this.processDevice(device);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const deviceId = String(device?.puid || device?.deviceId || "unknown device");
                    synchronizationErrors.push(`${deviceId}: ${message}`);
                    this.log.error(`Could not synchronize ConnectLife device ${deviceId}: ${message}`);
                }
            }

            if (synchronizationErrors.length > 0) {
                const details = synchronizationErrors.join("; ").slice(0, 1500);
                const message =
                    `ConnectLife Cloud is connected, but ${synchronizationErrors.length} of ` +
                    `${devices.length} device(s) could not be synchronized: ${details}`;

                if (this.initialRefreshRetryAvailable) {
                    this.initialRefreshRetryAvailable = false;
                    this.nextPollDelayMs = INITIAL_REFRESH_RETRY_MS;
                    this.log.warn(`${message} Retrying device synchronization in 5 seconds.`);
                } else {
                    this.log.warn(message);
                }

                await this.setStateAsync("info.lastError", message, true);
                return;
            }

            this.initialRefreshRetryAvailable = false;
            this.log.debug(`Updated ${devices.length} ConnectLife Cloud device(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (this.isRateLimitError(error)) {
                this.initialRefreshRetryAvailable = false;
                await this.handleRateLimitError(error, message);
                return;
            }

            this.consecutiveRefreshErrors += 1;
            await this.setStateAsync("info.lastError", message, true);

            if (!this.hadSuccessfulConnection && this.initialRefreshRetryAvailable) {
                this.initialRefreshRetryAvailable = false;
                this.nextPollDelayMs = INITIAL_REFRESH_RETRY_MS;
                await this.setStateAsync("info.connection", false, true);
                this.log.warn(
                    `Initial ConnectLife Cloud refresh failed: ${message}. ` +
                        `Retrying automatically in 5 seconds.`,
                );
                return;
            }

            this.nextPollDelayMs = 0;
            if (this.hadSuccessfulConnection && this.consecutiveRefreshErrors < 3) {
                this.log.warn(
                    `Temporary ConnectLife Cloud polling error ` + `(${this.consecutiveRefreshErrors}/3): ${message}`,
                );
            } else {
                this.log.error(message);
                await this.setStateAsync("info.connection", false, true);
            }
        } finally {
            this.refreshRunning = false;
        }
    }

    isRateLimitError(error) {
        return Boolean(
            error && typeof error === "object" && error.isRateLimit === true && Number(error.retryAfterMs) > 0,
        );
    }

    async handleRateLimitError(error, message) {
        const retryAfterMs = Math.max(1000, Number(error.retryAfterMs));
        const retryAtMs = Math.max(Date.now() + 1000, Number(error.retryAt) || Date.now() + retryAfterMs);
        const retryAt = new Date(retryAtMs).toISOString();

        this.nextPollDelayMs = Math.max(1000, retryAtMs - Date.now() + 1000);
        this.consecutiveRefreshErrors = 0;

        await this.setStateAsync("info.connection", false, true);
        await this.setStateAsync("info.lastError", message, true);
        await this.setStateAsync("info.nextRetry", retryAt, true);

        this.log.warn(
            `ConnectLife login is temporarily rate-limited. ` +
                `The next automatic login attempt is scheduled for ${retryAt}.`,
        );
    }

    async processDevice(device) {
        const puid = String(device.puid || device.deviceId || "");
        if (!puid) {
            this.log.warn(`Skipping device without puid: ${JSON.stringify(device).slice(0, 500)}`);
            return;
        }

        const objectId = this.sanitizeId(puid);
        const displayName = this.getDeviceDisplayName(device, puid);
        const deviceNickName = this.firstNonEmpty(device.deviceNickName);
        const roomName = this.firstNonEmpty(device.roomName);
        const deviceTypeName = this.firstNonEmpty(device.deviceTypeName, device.deviceFeatureName);

        this.deviceIdByObjectId.set(objectId, puid);

        await this.extendObjectAsync(`devices.${objectId}`, {
            type: "device",
            common: {
                name: displayName,
            },
            native: {
                puid,
                deviceNickName,
                roomName,
                deviceTypeName,
                deviceTypeCode: device.deviceTypeCode,
                deviceFeatureCode: device.deviceFeatureCode,
            },
        });

        await this.ensureChannel(`devices.${objectId}.info`, "Information");
        await this.ensureChannel(`devices.${objectId}.status`, "Status");
        await this.ensureChannel(`devices.${objectId}.controls`, "Controls");
        await this.ensureChannel(`devices.${objectId}.raw`, "Raw properties");

        await this.setReadOnlyState(`devices.${objectId}.info.puid`, puid, "Device ID", "string", "info.serial");
        await this.setReadOnlyState(
            `devices.${objectId}.info.online`,
            Number(device.offlineState) !== 0,
            "Online",
            "boolean",
            "indicator.reachable",
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceNickName`,
            deviceNickName,
            "Cloud device name",
            "string",
            "info.name",
        );
        await this.setReadOnlyState(`devices.${objectId}.info.roomName`, roomName, "Cloud room name", "string", "text");
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceTypeName`,
            deviceTypeName,
            "Cloud device type",
            "string",
            "info.type",
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceTypeCode`,
            String(device.deviceTypeCode ?? ""),
            "Device type code",
            "string",
            "info.type",
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceFeatureCode`,
            String(device.deviceFeatureCode ?? ""),
            "Device feature code",
            "string",
            "info.type",
        );

        const status = device.statusList && typeof device.statusList === "object" ? device.statusList : {};

        await this.createFriendlyClimateStates(objectId, status);

        if (this.config.createRawStates !== false) {
            for (const [property, value] of Object.entries(status)) {
                await this.createRawState(objectId, property, value);
            }
        }

        await this.setReadOnlyState(
            `devices.${objectId}.status.json`,
            JSON.stringify(status),
            "Complete status JSON",
            "string",
            "json",
        );
    }

    async createFriendlyClimateStates(objectId, status) {
        const definitions = {
            t_power: {
                id: "power",
                name: "Power",
                type: "boolean",
                role: "switch.power",
                toState: value => Number(value) !== 0,
            },
            t_temp: {
                id: "targetTemperature",
                name: "Target temperature",
                type: "number",
                role: "level.temperature",
                unit: "°C",
                min: 10,
                max: 35,
                toState: Number,
            },
            t_work_mode: {
                id: "mode",
                name: "Operating mode",
                type: "number",
                role: "level.mode.airconditioner",
                states: {
                    0: "fan",
                    1: "heat",
                    2: "cool",
                    3: "dry",
                    4: "auto",
                },
                toState: Number,
            },
            t_fan_speed: {
                id: "fanSpeed",
                name: "Fan speed",
                type: "number",
                role: "level.mode.fan",
                states: {
                    0: "auto",
                    5: "super low",
                    6: "low",
                    7: "medium",
                    8: "high",
                    9: "super high",
                },
                toState: Number,
            },
            t_fan_mute: {
                id: "silent",
                name: "Silent mode",
                type: "boolean",
                role: "switch.mode.silent",
                toState: value => Number(value) !== 0,
            },
            t_super: {
                id: "turbo",
                name: "Turbo mode",
                type: "boolean",
                role: "switch.mode.boost",
                toState: value => Number(value) !== 0,
            },
            t_eco: {
                id: "eco",
                name: "Eco mode",
                type: "boolean",
                role: "switch.mode.eco",
                toState: value => Number(value) !== 0,
            },
            t_swing_direction: {
                id: "horizontalSwing",
                name: "Horizontal swing",
                type: "number",
                role: "level.mode.swing",
                states: {
                    0: "straight",
                    1: "right",
                    2: "both sides",
                    3: "swing",
                    4: "left",
                },
                toState: Number,
            },
            t_swing_angle: {
                id: "verticalSwing",
                name: "Vertical swing",
                type: "number",
                role: "level.mode.swing",
                toState: Number,
            },
        };

        for (const [apiProperty, definition] of Object.entries(definitions)) {
            if (!(apiProperty in status)) {
                continue;
            }

            const stateId = `devices.${objectId}.controls.${definition.id}`;
            await this.extendObjectAsync(stateId, {
                type: "state",
                common: {
                    name: definition.name,
                    type: definition.type,
                    role: definition.role,
                    read: true,
                    write: true,
                    ...(definition.unit ? { unit: definition.unit } : {}),
                    ...(definition.min !== undefined ? { min: definition.min } : {}),
                    ...(definition.max !== undefined ? { max: definition.max } : {}),
                    ...(definition.states ? { states: definition.states } : {}),
                },
                native: {
                    apiProperty,
                    deviceObjectId: objectId,
                },
            });
            await this.setStateAsync(stateId, definition.toState(status[apiProperty]), true);
        }
    }

    async createRawState(objectId, property, value) {
        const safeProperty = this.sanitizeId(property);
        const stateId = `devices.${objectId}.raw.${safeProperty}`;
        const normalized = this.normalizeValue(value);
        const type = this.getIoBrokerType(normalized);

        await this.extendObjectAsync(stateId, {
            type: "state",
            common: {
                name: property,
                type,
                role: "state",
                read: true,
                write: this.config.allowRawWrites === true,
            },
            native: {
                apiProperty: property,
                deviceObjectId: objectId,
            },
        });
        await this.setStateAsync(stateId, normalized, true);
    }

    async onStateChange(id, state) {
        if (!state || state.ack || !this.client || !id.startsWith(`${this.namespace}.devices.`)) {
            return;
        }

        try {
            const relativeId = id.slice(this.namespace.length + 1);
            const object = await this.getObjectAsync(relativeId);
            const apiProperty = object?.native?.apiProperty;
            const deviceObjectId = object?.native?.deviceObjectId;

            if (!apiProperty || !deviceObjectId) {
                this.log.warn(`Cannot map writable state ${id} to a ConnectLife Cloud property.`);
                return;
            }

            const puid = this.deviceIdByObjectId.get(deviceObjectId);
            if (!puid) {
                throw new Error(`Unknown device mapping for ${deviceObjectId}`);
            }

            const value = this.convertWriteValue(apiProperty, state.val);
            this.log.info(`Setting ${deviceObjectId}.${apiProperty} to ${JSON.stringify(value)}`);
            await this.client.setProperties(puid, { [apiProperty]: value });

            await this.setStateAsync(relativeId, state.val, true);
            this.scheduleDelayedRefresh();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(message);
            await this.setStateAsync("info.lastError", message, true);
        }
    }

    scheduleDelayedRefresh() {
        if (this.unloading) {
            return;
        }

        const timer = this.setTimeout(async () => {
            this.delayedRefreshTimers.delete(timer);
            try {
                await this.refreshDevices();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.log.error(`Unexpected delayed refresh failure: ${message}`);
            }
        }, 1500);
        this.delayedRefreshTimers.add(timer);
    }

    convertWriteValue(apiProperty, value) {
        const booleans = new Set(["t_power", "t_fan_mute", "t_super", "t_eco", "t_beep"]);
        if (booleans.has(apiProperty)) {
            return value ? 1 : 0;
        }

        if (typeof value === "number") {
            return value;
        }
        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }

        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
                return Number(trimmed);
            }
            try {
                return JSON.parse(trimmed);
            } catch {
                return value;
            }
        }

        return value;
    }

    async onMessage(object) {
        if (!object?.command) {
            return;
        }

        if (object.command === "refresh") {
            await this.refreshDevices();
            if (object.callback) {
                this.sendTo(object.from, object.command, { ok: true }, object.callback);
            }
            return;
        }

        if (object.command === "getDevices") {
            try {
                const devices = this.client ? await this.client.getDevices() : [];
                if (object.callback) {
                    this.sendTo(object.from, object.command, { ok: true, devices }, object.callback);
                }
            } catch (error) {
                if (object.callback) {
                    this.sendTo(
                        object.from,
                        object.command,
                        {
                            ok: false,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        object.callback,
                    );
                }
            }
        }
    }

    async ensureChannel(id, name) {
        await this.extendObjectAsync(id, {
            type: "channel",
            common: { name },
            native: {},
        });
    }

    async setReadOnlyState(id, value, name, type, role) {
        await this.extendObjectAsync(id, {
            type: "state",
            common: {
                name,
                type,
                role,
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setStateAsync(id, value, true);
    }

    firstNonEmpty(...values) {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
        return "";
    }

    getDeviceDisplayName(device, puid) {
        const nickname = this.firstNonEmpty(device.deviceNickName, device.deviceName, device.nickName, device.name);
        if (nickname) {
            return nickname;
        }

        const roomName = this.firstNonEmpty(device.roomName);
        const typeName = this.firstNonEmpty(device.deviceTypeName, device.deviceFeatureName);
        if (roomName && typeName) {
            return `${roomName} – ${typeName}`;
        }

        return typeName || roomName || puid;
    }

    normalizeValue(value) {
        if (value === null || value === undefined) {
            return "";
        }
        if (typeof value === "object") {
            return JSON.stringify(value);
        }
        return value;
    }

    getIoBrokerType(value) {
        if (typeof value === "boolean") {
            return "boolean";
        }
        if (typeof value === "number") {
            return "number";
        }
        return "string";
    }

    sanitizeId(value) {
        const result = String(value)
            .trim()
            .replace(/[.\s]+/g, "_")
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "");
        return result || "device";
    }

    onUnload(callback) {
        this.unloading = true;

        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }

            for (const timer of this.delayedRefreshTimers) {
                this.clearTimeout(timer);
            }
            this.delayedRefreshTimers.clear();

            this.setState("info.connection", false, true);
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new ConnectLifeAdapter(options);
} else {
    new ConnectLifeAdapter();
}
