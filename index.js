"use strict";

const startAdapter = require("./main");

function createAdapter(options) {
    const adapter = startAdapter(options);
    adapter.nextPollDelayMs = 0;

    adapter.scheduleNextPoll = function scheduleNextPoll(delayMs) {
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }

        const configuredDelayMs = Math.max(30, Number(this.config.pollInterval) || 60) * 1000;
        const requestedDelayMs = Number(delayMs) || Number(this.nextPollDelayMs) || configuredDelayMs;
        const effectiveDelayMs = Math.max(1000, requestedDelayMs);
        this.nextPollDelayMs = 0;

        this.pollTimer = this.setTimeout(async () => {
            this.pollTimer = null;
            await this.refreshDevices();
            this.scheduleNextPoll();
        }, effectiveDelayMs);
    };

    adapter.refreshDevices = async function refreshDevices() {
        if (this.refreshRunning || !this.client) {
            return;
        }

        this.refreshRunning = true;
        try {
            const devices = await this.client.getDevices();
            for (const device of devices) {
                await this.processDevice(device);
            }

            this.nextPollDelayMs = 0;
            this.consecutiveRefreshErrors = 0;
            this.hadSuccessfulConnection = true;
            await this.setStateAsync("info.connection", true, true);
            await this.setStateAsync("info.lastUpdate", new Date().toISOString(), true);
            await this.setStateAsync("info.lastError", "", true);
            await this.setReadOnlyState("info.nextRetry", "", "Next login retry", "string", "date");
            this.log.debug(`Updated ${devices.length} ConnectLife Cloud device(s).`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (error?.isRateLimit && Number(error.retryAfterMs) > 0) {
                const retryAfterMs = Math.max(1000, Number(error.retryAfterMs));
                const retryAt = new Date(Date.now() + retryAfterMs).toISOString();
                this.nextPollDelayMs = retryAfterMs + 1000;

                await this.setStateAsync("info.lastError", message, true);
                await this.setReadOnlyState(
                    "info.nextRetry",
                    retryAt,
                    "Next login retry",
                    "string",
                    "date",
                );

                if (!this.hadSuccessfulConnection) {
                    await this.setStateAsync("info.connection", false, true);
                }

                this.log.warn(
                    `ConnectLife login is temporarily rate-limited. ` +
                        `The next automatic login attempt is scheduled for ${retryAt}. ` +
                        `The adapter remains yellow until a cloud login succeeds.`,
                );
                return;
            }

            this.nextPollDelayMs = 0;
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
    };

    return adapter;
}

if (require.main !== module) {
    module.exports = createAdapter;
} else {
    createAdapter();
}
