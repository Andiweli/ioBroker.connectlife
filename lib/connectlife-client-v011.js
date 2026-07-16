"use strict";

const crypto = require("crypto");
const { ConnectLifeClient: BaseConnectLifeClient } = require("./connectlife-client");

const GATEWAY_RANDSTR_CHECK_FAILED = 101005;

class ConnectLifeClient extends BaseConnectLifeClient {
    constructor(options) {
        super(options);
        this.lastGatewayTimestamp = 0;
    }

    getCommonRequestData() {
        const data = super.getCommonRequestData();
        const now = Date.now();
        const timestamp = Math.max(now, this.lastGatewayTimestamp + 1);
        this.lastGatewayTimestamp = timestamp;

        data.timeStamp = timestamp.toString();
        data.randStr = crypto.randomBytes(16).toString("hex");
        return data;
    }

    async getDevices() {
        try {
            return await super.getDevices();
        } catch (error) {
            if (!this.isRandStrError(error)) {
                throw error;
            }

            this.log.debug("ConnectLife rejected randStr. Retrying once with a fresh nonce.");
            await this.wait(100);
            return super.getDevices();
        }
    }

    async setProperties(deviceId, properties) {
        let result = await super.setProperties(deviceId, properties);

        if (this.isRandStrResponse(result)) {
            this.log.debug("ConnectLife rejected randStr during a write. Retrying once with a fresh nonce.");
            await this.wait(100);
            result = await super.setProperties(deviceId, properties);
        }

        const resultCode = result?.resultCode;
        if (result?.errorCode || !(resultCode === 0 || resultCode === "0" || resultCode === undefined)) {
            const errorCode = result?.errorCode ?? resultCode;
            const description = result?.errorDesc || result?.errorMessage || "Unknown gateway error";
            throw new Error(`Property update failed: code=${errorCode}, ${description}`);
        }

        return result;
    }

    isRandStrError(error) {
        return String(error?.message || error).includes("randStr check fail");
    }

    isRandStrResponse(result) {
        return Number(result?.errorCode) === GATEWAY_RANDSTR_CHECK_FAILED ||
            String(result?.errorDesc || "").includes("randStr check fail");
    }

    wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}

module.exports = { ConnectLifeClient };
