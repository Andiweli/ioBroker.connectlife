"use strict";

const utils = require("@iobroker/adapter-core");
const { ConnectLifeClient } = require("./lib/connectlife-client");

class ConnectLifeAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: "connectlife"
        });

        this.client = null;
        this.pollTimer = null;
        this.refreshRunning = false;
        this.deviceIdByObjectId = new Map();

        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync("info.connection", false, true);
        await this.setStateAsync("info.lastError", "", true);

        if (!this.config.login || !this.config.password) {
            const message = "ConnectLife login and password are required.";
            this.log.error(message);
            await this.setStateAsync("info.lastError", message, true);
            return;
        }

        this.client = new ConnectLifeClient({
            login: this.config.login,
            password: this.config.password,
            log: this.log
        });

        this.subscribeStates("devices.*.controls.*");
        if (this.config.allowRawWrites !== false) {
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
            await this.refreshDevices();
            this.scheduleNextPoll();
        }, seconds * 1000);
    }

    async refreshDevices() {
        if (this.refreshRunning || !this.client) return;
        this.refreshRunning = true;

        try {
            const devices = await this.client.getDevices();
            for (const device of devices) {
                await this.processDevice(device);
            }

            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastUpdate", new Date().toISOString(), true);
            await this.setStateAsync("info.lastError", "", true);
            this.log.debug(`Updated ${devices.length} ConnectLife device(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(message);
            await this.setStateAsync("info.connection", false, true);
            await this.setStateAsync("info.lastError", message, true);
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

        const objectId = this.sanitizeId(
            device.deviceName ||
            device.name ||
            device.nickName ||
            puid
        );

        this.deviceIdByObjectId.set(objectId, puid);

        await this.extendObjectAsync(`devices.${objectId}`, {
            type: "device",
            common: {
                name: device.deviceName || device.name || device.nickName || puid
            },
            native: {
                puid,
                deviceTypeCode: device.deviceTypeCode,
                deviceFeatureCode: device.deviceFeatureCode
            }
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
            "indicator.connected"
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceTypeCode`,
            String(device.deviceTypeCode ?? ""),
            "Device type code",
            "string",
            "info.type"
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceFeatureCode`,
            String(device.deviceFeatureCode ?? ""),
            "Device feature code",
            "string",
            "info.type"
        );

        const status = device.statusList && typeof device.statusList === "object"
            ? device.statusList
            : {};

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
            "json"
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
                toApi: value => value ? 1 : 0
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
                toApi: Number
            },
            t_work_mode: {
                id: "mode",
                name: "Operating mode",
                type: "number",
                role: "level.mode.airconditioner",
                states: {
                    "0": "fan",
                    "1": "heat",
                    "2": "cool",
                    "3": "dry",
                    "4": "auto"
                },
                toState: Number,
                toApi: Number
            },
            t_fan_speed: {
                id: "fanSpeed",
                name: "Fan speed",
                type: "number",
                role: "level.mode.fan",
                states: {
                    "0": "auto",
                    "5": "super low",
                    "6": "low",
                    "7": "medium",
                    "8": "high",
                    "9": "super high"
                },
                toState: Number,
                toApi: Number
            },
            t_fan_mute: {
                id: "silent",
                name: "Silent mode",
                type: "boolean",
                role: "switch",
                toState: value => Number(value) !== 0,
                toApi: value => value ? 1 : 0
            },
            t_super: {
                id: "turbo",
                name: "Turbo mode",
                type: "boolean",
                role: "switch",
                toState: value => Number(value) !== 0,
                toApi: value => value ? 1 : 0
            },
            t_eco: {
                id: "eco",
                name: "Eco mode",
                type: "boolean",
                role: "switch",
                toState: value => Number(value) !== 0,
                toApi: value => value ? 1 : 0
            },
            t_swing_direction: {
                id: "horizontalSwing",
                name: "Horizontal swing",
                type: "number",
                role: "level.mode",
                states: {
                    "0": "straight",
                    "1": "right",
                    "2": "both sides",
                    "3": "swing",
                    "4": "left"
                },
                toState: Number,
                toApi: Number
            },
            t_swing_angle: {
                id: "verticalSwing",
                name: "Vertical swing",
                type: "number",
                role: "level.mode",
                toState: Number,
                toApi: Number
            }
        };

        for (const [apiProperty, def] of Object.entries(definitions)) {
            if (!(apiProperty in status)) continue;

            const stateId = `devices.${objectId}.controls.${def.id}`;
            await this.extendObjectAsync(stateId, {
                type: "state",
                common: {
                    name: def.name,
                    type: def.type,
                    role: def.role,
                    read: true,
                    write: true,
                    ...(def.unit ? { unit: def.unit } : {}),
                    ...(def.min !== undefined ? { min: def.min } : {}),
                    ...(def.max !== undefined ? { max: def.max } : {}),
                    ...(def.states ? { states: def.states } : {})
                },
                native: {
                    apiProperty,
                    deviceObjectId: objectId
                }
            });
            await this.setStateAsync(stateId, def.toState(status[apiProperty]), true);
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
                role: type === "boolean" ? "indicator" : type === "number" ? "value" : "text",
                read: true,
                write: this.config.allowRawWrites !== false
            },
            native: {
                apiProperty: property,
                deviceObjectId: objectId
            }
        });
        await this.setStateAsync(stateId, normalized, true);
    }

    async onStateChange(id, state) {
        if (!state || state.ack || !this.client) return;
        if (!id.startsWith(`${this.namespace}.devices.`)) return;

        try {
            const relativeId = id.slice(this.namespace.length + 1);
            const object = await this.getObjectAsync(relativeId);
            const apiProperty = object?.native?.apiProperty;
            const deviceObjectId = object?.native?.deviceObjectId;

            if (!apiProperty || !deviceObjectId) {
                this.log.warn(`Cannot map writable state ${id} to a ConnectLife property.`);
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
            this.setTimeout(() => this.refreshDevices(), 1500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(message);
            await this.setStateAsync("info.lastError", message, true);
            await this.setStateAsync("info.connection", false, true);
        }
    }

    convertWriteValue(apiProperty, value) {
        const booleans = new Set(["t_power", "t_fan_mute", "t_super", "t_eco", "t_beep"]);
        if (booleans.has(apiProperty)) return value ? 1 : 0;

        if (typeof value === "number") return value;
        if (typeof value === "boolean") return value ? 1 : 0;

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

    async onMessage(obj) {
        if (!obj || !obj.command) return;

        if (obj.command === "refresh") {
            await this.refreshDevices();
            if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
            return;
        }

        if (obj.command === "getDevices") {
            try {
                const devices = this.client ? await this.client.getDevices() : [];
                if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true, devices }, obj.callback);
            } catch (error) {
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, {
                        ok: false,
                        error: error instanceof Error ? error.message : String(error)
                    }, obj.callback);
                }
            }
        }
    }

    async ensureChannel(id, name) {
        await this.extendObjectAsync(id, {
            type: "channel",
            common: { name },
            native: {}
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
                write: false
            },
            native: {}
        });
        await this.setStateAsync(id, value, true);
    }

    normalizeValue(value) {
        if (value === null || value === undefined) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return value;
    }

    getIoBrokerType(value) {
        if (typeof value === "boolean") return "boolean";
        if (typeof value === "number") return "number";
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
