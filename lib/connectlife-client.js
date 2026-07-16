"use strict";

const axios = require("axios");
const crypto = require("crypto");

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyyWrNG6q475HIHu7sMVu
vHof6vlgPeixmxa4EL/UsvVvHPz33NnWoQetQqit9TBNzUjMXw0KlY9PXM4iqHUU
U+dSyNDq1jZWIiJ2C2FccppswJtIKL3NRMFvT9PFh6NlP/4FUcQKojgKFbF7Kacc
JPKYHlwaO7qgoIjLxAHlSOXGpucJcOkPzT2EqsSVnW8sn8kenvNmghXDayhgxsh6
AyxK4kehJplEnmX/iYCfNoFXknGcLqFWYccgBz3fybvx30C/0IgU1980L8QsUAv5
esZmN8ugnbRgLRxKRlkQQLxQAiZMZdKTAx665YflT3YMHJvEFE8c2XFgoxHzSMc4
BwIDAQAB
-----END PUBLIC KEY-----`;

const API_KEY = "4_yhTWQmHFpZkQZDSV1uV-_A";
const GMID = "gmid.ver4.AtLt3mZAMA.C8m5VqSTEQDrTRrkYYDgOaJWcyQ-XHow5nzQSXJF3EO3TnqTJ8tKUmQaaQ6z8p0s.zcTbHe6Ax6lHfvTN7JUj7VgO4x8Vl-vk1u0kZcrkKmKWw8K9r0shyut_at5Q0ri6zTewnAv2g1Dc8dauuyd-Sw.sc3";
const CLIENT_ID = "5065059336212";
const CLIENT_SECRET = "07swfKgvJhC3ydOUS9YV_SwVz0i4LKqlOLGNUukYHVMsJRF1b-iWeUGcNlXyYCeK";
const REDIRECT_URI = "https://api.connectlife.io/swagger/oauth2-redirect.html";

class ConnectLifeClient {
    constructor(options) {
        this.login = options.login;
        this.password = options.password;
        this.log = options.log || console;
        this.baseUrl = "https://clife-eu-gateway.hijuconn.com";
        this.accessToken = null;
        this.tokenValidUntil = 0;

        this.http = axios.create({
            timeout: 30000,
            headers: {
                "User-Agent": "Runner/2.0.6 (iPhone; iOS 17.2.1; Scale/3.00)"
            },
            validateStatus: status => status >= 200 && status < 300
        });
    }

    async ensureToken(force = false) {
        if (!force && this.accessToken && Date.now() < this.tokenValidUntil) {
            return this.accessToken;
        }

        const loginResponse = await this.postForm(
            "https://accounts.eu1.gigya.com/accounts.login",
            {
                loginID: this.login,
                password: this.password,
                APIKey: API_KEY,
                gmid: GMID
            }
        );

        const loginToken = loginResponse?.sessionInfo?.cookieValue;
        const uid = loginResponse?.UID;
        if (!loginToken || !uid) {
            throw new Error(`ConnectLife login failed: ${this.describeApiError(loginResponse)}`);
        }

        const jwtResponse = await this.postForm(
            "https://accounts.eu1.gigya.com/accounts.getJWT",
            {
                APIKey: API_KEY,
                gmid: GMID,
                login_token: loginToken
            }
        );

        if (!jwtResponse?.id_token) {
            throw new Error(`ConnectLife JWT request failed: ${this.describeApiError(jwtResponse)}`);
        }

        const authorizeResponse = await this.postJson(
            "https://oauth.hijuconn.com/oauth/authorize",
            {
                client_id: CLIENT_ID,
                idToken: jwtResponse.id_token,
                response_type: "code",
                redirect_uri: REDIRECT_URI,
                thirdType: "CDC",
                thirdClientId: uid
            }
        );

        if (!authorizeResponse?.code) {
            throw new Error(`ConnectLife OAuth authorization failed: ${this.describeApiError(authorizeResponse)}`);
        }

        const tokenResponse = await this.postForm(
            "https://oauth.hijuconn.com/oauth/token",
            {
                client_id: CLIENT_ID,
                code: authorizeResponse.code,
                grant_type: "authorization_code",
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI
            }
        );

        if (!tokenResponse?.access_token) {
            throw new Error(`ConnectLife token request failed: ${this.describeApiError(tokenResponse)}`);
        }

        this.accessToken = tokenResponse.access_token;
        const expiresIn = Number(tokenResponse.expires_in) || 86400;
        this.tokenValidUntil = Date.now() + Math.max(300, expiresIn - 300) * 1000;
        return this.accessToken;
    }

    async getDevices() {
        const token = await this.ensureToken();
        const requestData = {
            ...this.getCommonRequestData(),
            accessToken: token
        };
        const query = {
            ...requestData,
            sign: this.getSignature(requestData)
        };

        try {
            const response = await this.http.get(
                `${this.baseUrl}/clife-svc/pu/get_device_status_list`,
                { params: query }
            );
            const body = response.data;
            const apiResponse = body?.response;
            if (!Array.isArray(apiResponse?.deviceList)) {
                if (this.looksLikeTokenError(body)) {
                    await this.ensureToken(true);
                    return this.getDevices();
                }
                throw new Error(`Device list missing: ${this.describeApiError(body)}`);
            }
            return apiResponse.deviceList;
        } catch (error) {
            throw this.wrapHttpError(error, "Device list request failed");
        }
    }

    async setProperties(deviceId, properties) {
        const token = await this.ensureToken();
        const requestData = {
            ...this.getCommonRequestData(),
            puid: deviceId,
            properties,
            accessToken: token
        };
        const body = {
            ...requestData,
            sign: this.getSignature(requestData)
        };

        try {
            const response = await this.http.post(
                `${this.baseUrl}/device/pu/property/set`,
                body,
                { headers: { "Content-Type": "application/json" } }
            );
            const result = response.data;
            if (this.looksLikeTokenError(result)) {
                await this.ensureToken(true);
                return this.setProperties(deviceId, properties);
            }
            return result?.response ?? result;
        } catch (error) {
            throw this.wrapHttpError(error, "Property update failed");
        }
    }

    getSignature(data) {
        const sortedKeys = Object.keys(data).sort();
        const parts = sortedKeys.map(key => {
            const value = data[key];
            const serialized = value !== null && typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
            return `${key}=${serialized}`;
        });

        const source = `${parts.join("&")}D9519A4B756946F081B7BB5B5E8D1197`;
        const digest = crypto.createHash("sha256").update(source).digest();
        const encrypted = crypto.publicEncrypt(
            {
                key: PUBLIC_KEY,
                padding: crypto.constants.RSA_PKCS1_PADDING
            },
            digest
        );
        return encrypted.toString("base64");
    }

    getCommonRequestData() {
        const timestamp = Date.now().toString();
        return {
            appId: "47110565134383",
            appSecret: "yOzhz6junYno-nmULM3Wr7PU_dpSZN22ZdluvVWZ4uW5ZwwG8fIGCHTbrhcnU-iv",
            languageId: "12",
            randStr: crypto.createHash("md5").update(timestamp).digest("hex"),
            timeStamp: timestamp,
            timezone: "1.0",
            version: "5.0"
        };
    }

    async postForm(url, data) {
        try {
            const response = await this.http.post(
                url,
                new URLSearchParams(data).toString(),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );
            return response.data;
        } catch (error) {
            throw this.wrapHttpError(error, `Request to ${url} failed`);
        }
    }

    async postJson(url, data) {
        try {
            const response = await this.http.post(url, data, {
                headers: { "Content-Type": "application/json" }
            });
            return response.data;
        } catch (error) {
            throw this.wrapHttpError(error, `Request to ${url} failed`);
        }
    }

    looksLikeTokenError(data) {
        const text = JSON.stringify(data || {}).toLowerCase();
        return text.includes("token") &&
            (text.includes("expired") || text.includes("invalid") || text.includes("unauthorized"));
    }

    describeApiError(data) {
        if (!data) return "empty response";
        return data.errorMessage ||
            data.errorDetails ||
            data.message ||
            data.error ||
            JSON.stringify(data).slice(0, 1000);
    }

    wrapHttpError(error, prefix) {
        const responseData = error?.response?.data;
        const status = error?.response?.status;
        const details = responseData ? this.describeApiError(responseData) : error.message;
        return new Error(`${prefix}${status ? ` (HTTP ${status})` : ""}: ${details}`);
    }
}

module.exports = { ConnectLifeClient };
