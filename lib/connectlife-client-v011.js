"use strict";

const crypto = require("node:crypto");
const { ConnectLifeClient: BaseConnectLifeClient } = require("./connectlife-client");

const GATEWAY_RANDSTR_CHECK_FAILED = 101005;
const INITIAL_LOGIN_BACKOFF_MS = 5 * 60 * 1000;
const MAX_LOGIN_BACKOFF_MS = 60 * 60 * 1000;
const TOKEN_EXPIRY_SAFETY_MS = 30 * 1000;

class ConnectLifeClient extends BaseConnectLifeClient {
    constructor(options) {
        super(options);
        this.lastGatewayTimestamp = 0;
        this.tokenRequestPromise = null;
        this.refreshToken = null;
        this.refreshTokenValidUntil = 0;
        this.accessTokenHardValidUntil = 0;
        this.oauthTokenUrl = "";
        this.oauthClientData = null;
        this.loginBlockedUntil = 0;
        this.loginBackoffMs = INITIAL_LOGIN_BACKOFF_MS;
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

    async postForm(url, data) {
        const response = await super.postForm(url, data);

        if (String(url).includes("/oauth/token")) {
            if (data?.grant_type === "authorization_code") {
                this.oauthTokenUrl = url;
                this.oauthClientData = {
                    client_id: data.client_id,
                    client_secret: data.client_secret,
                    redirect_uri: data.redirect_uri,
                };
            }
            this.captureTokenResponse(response);
        }

        return response;
    }

    async ensureToken(force = false) {
        if (!force && this.accessToken && Date.now() < this.tokenValidUntil) {
            return this.accessToken;
        }

        if (this.tokenRequestPromise) {
            return this.tokenRequestPromise;
        }

        this.tokenRequestPromise = this.obtainToken(force);
        try {
            return await this.tokenRequestPromise;
        } finally {
            this.tokenRequestPromise = null;
        }
    }

    async obtainToken(force) {
        const now = Date.now();

        if (now < this.loginBlockedUntil) {
            if (this.canUseExistingAccessToken()) {
                return this.accessToken;
            }
            throw this.createRateLimitError(this.loginBlockedUntil - now);
        }

        if (this.canRefreshAccessToken()) {
            try {
                return await this.refreshAccessToken();
            } catch (error) {
                if (this.isRateLimitError(error)) {
                    return this.handleRateLimit(error);
                }

                this.log.warn(
                    `ConnectLife token refresh failed; falling back to a full login: ${this.errorMessage(error)}`,
                );
                this.refreshToken = null;
                this.refreshTokenValidUntil = 0;
            }
        }

        try {
            const token = await super.ensureToken(force);
            this.resetLoginBackoff();
            return token;
        } catch (error) {
            if (this.isRateLimitError(error)) {
                return this.handleRateLimit(error);
            }
            throw error;
        }
    }

    canRefreshAccessToken() {
        if (!this.refreshToken || !this.oauthTokenUrl || !this.oauthClientData) {
            return false;
        }
        return !this.refreshTokenValidUntil || Date.now() < this.refreshTokenValidUntil;
    }

    async refreshAccessToken() {
        const response = await super.postForm(this.oauthTokenUrl, {
            ...this.oauthClientData,
            grant_type: "refresh_token",
            refresh_token: this.refreshToken,
        });

        if (!response?.access_token) {
            throw new Error(`ConnectLife token refresh failed: ${this.describeApiError(response)}`);
        }

        this.captureTokenResponse(response);
        this.accessToken = response.access_token;
        const expiresIn = Number(response.expires_in) || 86400;
        this.tokenValidUntil = Date.now() + Math.max(60, expiresIn - 90) * 1000;
        this.resetLoginBackoff();
        this.log.debug("ConnectLife access token refreshed without a full account login.");
        return this.accessToken;
    }

    captureTokenResponse(response) {
        if (!response?.access_token) {
            return;
        }

        const expiresIn = Number(response.expires_in) || 86400;
        this.accessTokenHardValidUntil = Date.now() + expiresIn * 1000;

        if (response.refresh_token) {
            this.refreshToken = response.refresh_token;
        }

        if (response.refreshTokenExpiredTime !== undefined) {
            this.refreshTokenValidUntil = this.parseRefreshTokenExpiry(response.refreshTokenExpiredTime);
        }
    }

    parseRefreshTokenExpiry(value) {
        if (value === null || value === undefined || value === "") {
            return 0;
        }

        if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
            const numeric = Number(value);
            return numeric < 100000000000 ? numeric * 1000 : numeric;
        }

        const parsed = Date.parse(String(value));
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    canUseExistingAccessToken() {
        return Boolean(
            this.accessToken && Date.now() < this.accessTokenHardValidUntil - TOKEN_EXPIRY_SAFETY_MS,
        );
    }

    async handleRateLimit(error) {
        const delay = this.loginBackoffMs;
        this.loginBlockedUntil = Date.now() + delay;
        this.loginBackoffMs = Math.min(delay * 2, MAX_LOGIN_BACKOFF_MS);
        const minutes = Math.ceil(delay / 60000);

        this.log.debug(`ConnectLife login rate-limit response: ${this.errorMessage(error)}`);

        if (this.canUseExistingAccessToken()) {
            this.tokenValidUntil = Math.min(
                this.accessTokenHardValidUntil - TOKEN_EXPIRY_SAFETY_MS,
                this.loginBlockedUntil,
            );
            this.log.warn(
                `ConnectLife account login is temporarily rate-limited. ` +
                    `The still-valid access token will be used and login will be retried in ${minutes} minute(s).`,
            );
            return this.accessToken;
        }

        const rateLimitError = this.createRateLimitError(delay);
        rateLimitError.cause = error;
        throw rateLimitError;
    }

    createRateLimitError(delay) {
        const retryAfterMs = Math.max(1000, Number(delay) || INITIAL_LOGIN_BACKOFF_MS);
        const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
        const error = new Error(
            `ConnectLife login is temporarily rate-limited. Next login attempt in ${minutes} minute(s).`,
        );
        error.isRateLimit = true;
        error.retryAfterMs = retryAfterMs;
        error.retryAt = Date.now() + retryAfterMs;
        return error;
    }

    resetLoginBackoff() {
        this.loginBlockedUntil = 0;
        this.loginBackoffMs = INITIAL_LOGIN_BACKOFF_MS;
    }

    isRateLimitError(error) {
        const message = this.errorMessage(error).toLowerCase();
        return message.includes("rate limit") || message.includes("403048");
    }

    errorMessage(error) {
        return error instanceof Error ? error.message : String(error);
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
        return (
            Number(result?.errorCode) === GATEWAY_RANDSTR_CHECK_FAILED ||
            String(result?.errorDesc || "").includes("randStr check fail")
        );
    }

    wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}

module.exports = { ConnectLifeClient };
