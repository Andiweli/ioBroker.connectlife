"use strict";

const legacyClientModule = require("./lib/connectlife-client");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

legacyClientModule.ConnectLifeClient = ConnectLifeClient;

const startAdapter = require("./main");

function createAdapter(options) {
    const adapter = startAdapter(options);
    adapter.connectLifeConsecutiveRefreshErrors = 0;
    adapter.connectLifeHadSuccessfulConnection = false;

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
