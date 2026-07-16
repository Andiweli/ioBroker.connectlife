"use strict";

const legacyClientModule = require("./lib/connectlife-client");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

legacyClientModule.ConnectLifeClient = ConnectLifeClient;

const startAdapter = require("./main");

function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}

function getDeviceDisplayName(device, puid) {
    const nickname = firstNonEmpty(
        device.deviceNickName,
        device.deviceName,
        device.nickName,
        device.name
    );

    if (nickname) {
        return nickname;
    }

    const roomName = firstNonEmpty(device.roomName);
    const typeName = firstNonEmpty(
        device.deviceTypeName,
        device.deviceFeatureName
    );

    if (roomName && typeName) {
        return `${roomName} – ${typeName}`;
    }

    return typeName || roomName || puid;
}

function getTechnicalObjectId(adapter, device, puid) {
    return adapter.sanitizeId(
        device.deviceName ||
        device.name ||
        device.nickName ||
        puid
    );
}

function createAdapter(options) {
    const adapter = startAdapter(options);
    adapter.connectLifeConsecutiveRefreshErrors = 0;
    adapter.connectLifeHadSuccessfulConnection = false;

    const originalProcessDevice = adapter.processDevice.bind(adapter);

    adapter.processDevice = async function processDeviceWithCloudName(device) {
        await originalProcessDevice(device);

        const puid = String(device.puid || device.deviceId || "");
        if (!puid) {
            return;
        }

        const objectId = getTechnicalObjectId(this, device, puid);
        const displayName = getDeviceDisplayName(device, puid);
        const deviceNickName = firstNonEmpty(device.deviceNickName);
        const roomName = firstNonEmpty(device.roomName);
        const deviceTypeName = firstNonEmpty(
            device.deviceTypeName,
            device.deviceFeatureName
        );

        await this.extendObjectAsync(`devices.${objectId}`, {
            type: "device",
            common: {
                name: displayName
            },
            native: {
                puid,
                deviceNickName,
                roomName,
                deviceTypeName
            }
        });

        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceNickName`,
            deviceNickName,
            "Cloud device name",
            "string",
            "info.name"
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.roomName`,
            roomName,
            "Cloud room name",
            "string",
            "info.room"
        );
        await this.setReadOnlyState(
            `devices.${objectId}.info.deviceTypeName`,
            deviceTypeName,
            "Cloud device type",
            "string",
            "info.type"
        );
    };

    adapter.refreshDevices = async function refreshDevices() {
        if (this.refreshRunning || !this.client) return;
        this.refreshRunning = true;

        try {
            const devices = await this.client.getDevices();
            for (const device of devices) {
                await this.processDevice(device);
            }

            this.connectLifeConsecutiveRefreshErrors = 0;
            this.connectLifeHadSuccessfulConnection = true;
            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastUpdate", new Date().toISOString(), true);
            await this.setStateAsync("info.lastError", "", true);
            this.log.debug(`Updated ${devices.length} ConnectLife device(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.connectLifeConsecutiveRefreshErrors += 1;
            await this.setStateAsync("info.lastError", message, true);

            if (
                this.connectLifeHadSuccessfulConnection &&
                this.connectLifeConsecutiveRefreshErrors < 3
            ) {
                this.log.warn(
                    `Temporary ConnectLife polling error ` +
                    `(${this.connectLifeConsecutiveRefreshErrors}/3): ${message}`
                );
            } else {
                this.log.error(message);
                await this.setStateAsync("info.connection", false, true);
            }
        } finally {
            this.refreshRunning = false;
        }
    };

    return adapter;
}

if (require.main !== module) {
    module.exports = createAdapter;
} else {
    createAdapter();
}
