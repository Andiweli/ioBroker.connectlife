"use strict";

const utils = require("@iobroker/adapter-core");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

class ConnectLifeAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "connectlife",
        });

        this.client = null;
        this.pollTimer = null;
        this.refreshRunning = false;
        this.deviceIdByObjectId = new Map();
        this.delayedRefreshTimers = new Set();
        this.consecutiveRefreshErrors = 0;
        this.hadSuccessfulConnection = false;

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.ensureChannel("info", "Information");
        await this.ensureChannel("devices", "Devices");
        await this.setStateAsync("info.connection", false, true);
        await this.setStateAsync("info.lastError", "", true);

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
        });

        this.subscribeStates("devices.*.controls.*");
        if (this.config.allowRawWrites === true) {
            this.subscribeStates("devices.*.raw.*");
        }

        await this.refreshDevices();
        this.scheduleNextPoll();
    }

    scheduleNextPoll() {
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }

        const seconds = Math.max(30, Number(this.config.pollInterval) || 60);
        this.pollTimer = this.setTimeout(async () => {
            this.pollTimer = null;
            await this.refreshDevices();
            this.scheduleNextPoll();
        }, seconds * 1000);
    }

    async refreshDevices() {
        if (this.refreshRunning || !this.client) {
            return;
        }

        this.refreshRunning = true;
        try {
            const devices = await this.client.getDevices();
            for (const device of devices) {
                await this.processDevice(device);
            }

            this.consecutiveRefreshErrors = 0;
            this.hadSuccessfulConnection = true;
            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastUpdate", new Date().toISOString(), true);
            await this.setStateAsync("info.lastError", "", true);
            this.log.debug(`Updated ${devices.length} ConnectLife Cloud device(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.consecutiveRefreshErrors += 1;
            await this.setStateAsync("info.lastError", message, true);

            if (this.hadSuccessfulConnection && this.consecutiveRefreshErrors < 3) {
                this.log.warn(
                    `Temporary ConnectLife Cloud polling error ` +
                        `(${this.consecutiveRefreshErrors}/3): ${message}`,
                );
            } else {
                this.log.error(message);
                await this.setStateAsync("info.connection", false, true);
            }
        } finally {
            this.refreshRunning = false;
        }
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

        await this.setReadOnlyState(
            `devices.${objectId}.info.puid`,
            puid,
            "Device ID",
            "string",
            "info.serial",
        );
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
        await this.setReadOnlyState(
            `devices.${objectId}.info.roomName`,
            roomName,
            "Cloud room name",
            "string",
            "text",
        );
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
                role: "level",
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
        const timer = this.setTimeout(async () => {
            this.delayedRefreshTimers.delete(timer);
            await this.refreshDevices();
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
        const nickname = this.firstNonEmpty(
            device.deviceNickName,
            device.deviceName,
            device.nickName,
            device.name,
        );
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
